import type { ThreadStore } from "../../context-steward/store/thread-store.js";
import {
  bandTypeToSourceUnitType,
  cloneBandRecord,
  cloneThreadViewRecord,
  createSourceStateReference,
  createThreadViewId,
  type BandRecord,
  type BandType,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type { ThreadViewStore } from "../store/thread-view-store.js";
import { ThreadViewMaterializer } from "./thread-view-materializer.js";

export interface CreateDraftThreadViewInput {
  threadId: string;
  name?: string;
  purpose?: string;
  now?: () => Date;
}

export interface ArchiveDraftThreadViewInput {
  threadId: string;
  threadViewId: string;
  now?: () => Date;
}

export interface ExcludeTurnFromThreadViewInput {
  threadId: string;
  threadViewId: string;
  turnId: string;
  now?: () => Date;
}

export interface UpdateThreadViewBandsInput {
  threadId: string;
  threadViewId: string;
  fullFidelityBand?: BandRecord;
  smoothBand?: BandRecord;
  detailedBand?: BandRecord;
  briefBand?: BandRecord;
  now?: () => Date;
}

interface ThreadViewEditServiceOptions {
  createThreadViewId?: () => string;
  materializer?: ThreadViewMaterializer;
}

function createEmptyBandRecord(bandType: BandType): BandRecord {
  return {
    bandType,
    sourceUnitType: bandTypeToSourceUnitType(bandType),
    selectedIds: [],
    renderedStatus: "unknown",
  };
}

function excludeTurnFromBand(band: BandRecord, turnId: string): BandRecord {
  if (band.sourceUnitType !== "turn") {
    return cloneBandRecord(band);
  }

  const selectedIds = band.selectedIds.filter((candidate) => candidate !== turnId);
  const exclusions = band.exclusions?.includes(turnId)
    ? [...band.exclusions]
    : [...(band.exclusions ?? []), turnId];

  return {
    ...cloneBandRecord(band),
    selectedIds,
    exclusions,
    renderedStatus: "unknown",
  };
}

function hasViewContentChanged(left: ThreadViewRecord, right: ThreadViewRecord): boolean {
  return JSON.stringify({
    state: left.state,
    status: left.status,
    fullFidelityBand: left.fullFidelityBand,
    smoothBand: left.smoothBand,
    detailedBand: left.detailedBand,
    briefBand: left.briefBand,
    emittedMessages: left.emittedMessages,
  }) !==
    JSON.stringify({
      state: right.state,
      status: right.status,
      fullFidelityBand: right.fullFidelityBand,
      smoothBand: right.smoothBand,
      detailedBand: right.detailedBand,
      briefBand: right.briefBand,
      emittedMessages: right.emittedMessages,
    });
}

export class ThreadViewEditService {
  private readonly createThreadViewId: () => string;
  private readonly materializer: ThreadViewMaterializer;

  constructor(
    private readonly threadStore: ThreadStore,
    private readonly threadViewStore: ThreadViewStore,
    options: ThreadViewEditServiceOptions = {},
  ) {
    this.createThreadViewId = options.createThreadViewId ?? (() => createThreadViewId());
    this.materializer = options.materializer ?? new ThreadViewMaterializer(threadStore);
  }

  async createDraftThreadView(input: CreateDraftThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const createdAt = (input.now ?? (() => new Date()))().toISOString();
    const view: ThreadViewRecord = {
      threadViewId: this.createThreadViewId(),
      threadId: input.threadId,
      state: "draft",
      name: input.name,
      purpose: input.purpose,
      createdAt,
      updatedAt: createdAt,
      sourceStateReference: createSourceStateReference({
        sourceRevision: threadSnapshot.value.thread.sourceRevision,
        messageHighWatermark: threadSnapshot.value.thread.messageHighWatermark,
      }),
      fullFidelityBand: createEmptyBandRecord("full_fidelity"),
      smoothBand: createEmptyBandRecord("smooth"),
      detailedBand: createEmptyBandRecord("detailed"),
      briefBand: createEmptyBandRecord("brief"),
      emittedMessages: [],
      status: "incomplete",
    };

    return this.threadViewStore.createThreadView({ view });
  }

  async archiveDraftThreadView(input: ArchiveDraftThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>> {
    const openedView = await this.threadViewStore.openThreadView(input.threadId, input.threadViewId);
    if (!openedView.ok) {
      return failWorkbenchResult(...openedView.issues);
    }

    if (openedView.value.view.state === "active") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
          message: `Active Thread View ${input.threadViewId} cannot be archived as a draft.`,
          threadId: input.threadId,
        }),
      );
    }

    const nextUpdatedAt = (input.now ?? (() => new Date()))().toISOString();
    const archivedView = await this.threadViewStore.updateThreadView({
      threadId: input.threadId,
      threadViewId: input.threadViewId,
      expectedUpdatedAt: openedView.value.view.updatedAt,
      patch: {
        state: "archived",
        updatedAt: nextUpdatedAt,
      },
    });
    if (!archivedView.ok) {
      return failWorkbenchResult(...archivedView.issues);
    }

    return okWorkbenchResult(cloneThreadViewRecord(archivedView.value), archivedView.issues);
  }

  async excludeTurnFromThreadView(
    input: ExcludeTurnFromThreadViewInput,
  ): Promise<WorkbenchResult<ThreadViewRecord>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    if (!threadSnapshot.value.turns.some((turn) => turn.turnId === input.turnId)) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
          threadId: input.threadId,
        }),
      );
    }

    const openedView = await this.threadViewStore.openThreadView(input.threadId, input.threadViewId);
    if (!openedView.ok) {
      return failWorkbenchResult(...openedView.issues);
    }

    if (openedView.value.view.state !== "draft") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Turn exclusion requires draft state, but ${input.threadViewId} is ${openedView.value.view.state}.`,
          threadId: input.threadId,
        }),
      );
    }

    const currentView = openedView.value.view;
    const nextView = cloneThreadViewRecord({
      ...currentView,
      fullFidelityBand: excludeTurnFromBand(currentView.fullFidelityBand, input.turnId),
      smoothBand: excludeTurnFromBand(currentView.smoothBand, input.turnId),
      emittedMessages: [],
      status: "incomplete",
    });

    if (!hasViewContentChanged(currentView, nextView)) {
      return okWorkbenchResult(cloneThreadViewRecord(currentView), openedView.issues);
    }

    const updatedAt = (input.now ?? (() => new Date()))().toISOString();
    const updatedView = await this.threadViewStore.updateThreadView({
      threadId: input.threadId,
      threadViewId: input.threadViewId,
      expectedUpdatedAt: currentView.updatedAt,
      patch: {
        fullFidelityBand: nextView.fullFidelityBand,
        smoothBand: nextView.smoothBand,
        emittedMessages: [],
        status: nextView.status,
        updatedAt,
      },
    });
    if (!updatedView.ok) {
      return failWorkbenchResult(...updatedView.issues);
    }

    return okWorkbenchResult(cloneThreadViewRecord(updatedView.value), updatedView.issues);
  }

  async updateThreadViewBands(
    input: UpdateThreadViewBandsInput,
  ): Promise<WorkbenchResult<ThreadViewRecord>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const openedView = await this.threadViewStore.openThreadView(input.threadId, input.threadViewId);
    if (!openedView.ok) {
      return failWorkbenchResult(...openedView.issues);
    }

    if (openedView.value.view.state !== "draft") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Band updates require draft state, but ${input.threadViewId} is ${openedView.value.view.state}.`,
          threadId: input.threadId,
        }),
      );
    }

    const turnIds = new Set(threadSnapshot.value.turns.map((turn) => turn.turnId));
    let fullFidelityBand = cloneBandRecord(openedView.value.view.fullFidelityBand);
    if (Object.prototype.hasOwnProperty.call(input, "fullFidelityBand")) {
      const normalizedFullFidelityBand = this.normalizeTurnBandInput(
        "full_fidelity",
        input.fullFidelityBand,
        turnIds,
        input.threadId,
      );
      if (!normalizedFullFidelityBand.ok) {
        return failWorkbenchResult(...normalizedFullFidelityBand.issues);
      }

      fullFidelityBand = normalizedFullFidelityBand.value;
    }

    let smoothBand = cloneBandRecord(openedView.value.view.smoothBand);
    if (Object.prototype.hasOwnProperty.call(input, "smoothBand")) {
      const normalizedSmoothBand = this.normalizeTurnBandInput(
        "smooth",
        input.smoothBand,
        turnIds,
        input.threadId,
      );
      if (!normalizedSmoothBand.ok) {
        return failWorkbenchResult(...normalizedSmoothBand.issues);
      }

      smoothBand = normalizedSmoothBand.value;
    }

    const nextView = cloneThreadViewRecord({
      ...openedView.value.view,
      fullFidelityBand,
      smoothBand,
      detailedBand: input.detailedBand ? cloneBandRecord(input.detailedBand) : openedView.value.view.detailedBand,
      briefBand: input.briefBand ? cloneBandRecord(input.briefBand) : openedView.value.view.briefBand,
    });
    const materialized = await this.materializer.materializeThreadView({
      threadId: input.threadId,
      draftView: nextView,
    });
    if (!materialized.ok) {
      return failWorkbenchResult(...materialized.issues);
    }

    const updatedAt = (input.now ?? (() => new Date()))().toISOString();
    const emittedMessages = materialized.value.emittedMessages;
    const updatedView = await this.threadViewStore.updateThreadView({
      threadId: input.threadId,
      threadViewId: input.threadViewId,
      expectedUpdatedAt: openedView.value.view.updatedAt,
      patch: {
        fullFidelityBand: materialized.value.fullFidelityBand,
        smoothBand: materialized.value.smoothBand,
        detailedBand: input.detailedBand ? cloneBandRecord(input.detailedBand) : undefined,
        briefBand: input.briefBand ? cloneBandRecord(input.briefBand) : undefined,
        emittedMessages,
        sourceStateReference: createSourceStateReference({
          sourceRevision: threadSnapshot.value.thread.sourceRevision,
          messageHighWatermark: threadSnapshot.value.thread.messageHighWatermark,
        }),
        status:
          materialized.value.issues.length > 0 || emittedMessages.length === 0
            ? "incomplete"
            : "ready",
        updatedAt,
      },
    });
    if (!updatedView.ok) {
      return failWorkbenchResult(...updatedView.issues);
    }

    return okWorkbenchResult(cloneThreadViewRecord(updatedView.value), updatedView.issues);
  }

  private normalizeTurnBandInput(
    bandType: BandType,
    band: BandRecord | undefined,
    turnIds: ReadonlySet<string>,
    threadId: string,
  ): WorkbenchResult<BandRecord> {
    const candidate = cloneBandRecord(
      band ??
        createEmptyBandRecord(bandType),
    );
    const selectedIds = [...new Set(candidate.selectedIds)];
    const exclusions = [...new Set(candidate.exclusions ?? [])];
    const missingTurnId = [...selectedIds, ...exclusions].find((turnId) => !turnIds.has(turnId));
    if (missingTurnId) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Turn ${missingTurnId} was not found in thread ${threadId}.`,
          threadId,
        }),
      );
    }

    return okWorkbenchResult({
      ...candidate,
      bandType,
      sourceUnitType: bandTypeToSourceUnitType(bandType),
      selectedIds,
      exclusions: exclusions.length > 0 ? exclusions : undefined,
      renderedStatus: "unknown",
    });
  }
}
