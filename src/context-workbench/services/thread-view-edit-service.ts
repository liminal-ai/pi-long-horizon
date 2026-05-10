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

interface ThreadViewEditServiceOptions {
  createThreadViewId?: () => string;
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

  constructor(
    private readonly threadStore: ThreadStore,
    private readonly threadViewStore: ThreadViewStore,
    options: ThreadViewEditServiceOptions = {},
  ) {
    this.createThreadViewId = options.createThreadViewId ?? (() => createThreadViewId());
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
}
