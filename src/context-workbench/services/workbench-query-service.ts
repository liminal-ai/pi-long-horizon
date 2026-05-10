import { checkMaintenanceReadiness } from "../../context-steward/services/turn-service.js";
import type { StewardIssue } from "../../context-steward/domain/errors.js";
import type {
  FixtureRecord,
  MessageRecord,
  ThreadRecord,
  TurnRecord,
} from "../../context-steward/domain/records.js";
import type { ThreadSnapshot, ThreadStore } from "../../context-steward/store/thread-store.js";
import {
  BAND_ORDER,
  compareBandTypeOrder,
  cloneWorkbenchChunkRead,
  cloneThreadViewRecord,
  type BandType,
  type LowerBandReadinessEntry,
  type ThreadViewRecord,
  type ThreadViewState,
  type WorkbenchChunkRead,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  mergeWorkbenchIssues,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type { ThreadViewStore } from "../store/thread-view-store.js";

export interface OpenWorkbenchThreadInput {
  threadId: string;
}

export interface OpenFixtureThreadInput {
  fixtureId: string;
}

export interface OpenWorkbenchThreadResult {
  thread: ThreadRecord;
  threadViews: ThreadViewRecord[];
  activeThreadView?: ThreadViewRecord;
  usableStatus: "ready" | "blocked" | "degraded";
  blockers: StewardIssue[];
}

export interface OpenFixtureThreadResult extends OpenWorkbenchThreadResult {
  fixture: FixtureRecord;
}

export interface OpenMessageDetailInput {
  threadId: string;
  messageId: string;
}

export interface OpenTurnDetailInput {
  threadId: string;
  turnId: string;
}

export interface OpenThreadViewDetailInput {
  threadId: string;
  threadViewId: string;
}

export interface OpenChunkDetailInput {
  threadId: string;
  chunkId: string;
}

export interface InspectLowerBandReadinessInput {
  threadId: string;
  threadViewId?: string;
}

export interface MessageDetailResult {
  message: MessageRecord;
  owningTurnId?: string;
}

export interface TurnDetailResult {
  turn: TurnRecord;
  messages: MessageRecord[];
  threadViewPlacements: Array<{ threadViewId: string; state: ThreadViewState; bandType: BandType }>;
}

export interface ThreadViewDetailResult {
  view: ThreadViewRecord;
  sourcePivots: Array<{ bandType: BandType; sourceUnitId: string; sourceUnitType: "turn" | "chunk" }>;
}

export interface ChunkDetailResult {
  chunk: WorkbenchChunkRead;
}

export interface LowerBandReadinessResult {
  detailedBand: LowerBandReadinessEntry[];
  briefBand: LowerBandReadinessEntry[];
}

export interface WorkbenchChunkReader {
  listChunks(threadId: string): Promise<WorkbenchResult<WorkbenchChunkRead[]>>;
}

interface LoadedThreadScope {
  snapshot: ThreadSnapshot;
  threadViews: ThreadViewRecord[];
}

const THREAD_VIEW_STATE_ORDER: Record<ThreadViewState, number> = {
  active: 0,
  draft: 1,
  archived: 2,
};

const EMPTY_CHUNK_READER: WorkbenchChunkReader = {
  async listChunks() {
    return okWorkbenchResult([]);
  },
};

function cloneThread(thread: ThreadRecord): ThreadRecord {
  return structuredClone(thread);
}

function cloneMessage(message: MessageRecord): MessageRecord {
  return structuredClone(message);
}

function cloneTurn(turn: TurnRecord): TurnRecord {
  return structuredClone(turn);
}

function cloneChunk(chunk: WorkbenchChunkRead): WorkbenchChunkRead {
  return cloneWorkbenchChunkRead(chunk);
}

function resolveActiveThreadView(
  thread: ThreadRecord,
  threadViews: readonly ThreadViewRecord[],
): ThreadViewRecord | undefined {
  const pointedView = thread.activeThreadViewId
    ? threadViews.find((view) => view.threadViewId === thread.activeThreadViewId)
    : undefined;

  if (pointedView?.state === "active") {
    return cloneThreadViewRecord(pointedView);
  }

  const activeView = threadViews.find((view) => view.state === "active");
  return activeView ? cloneThreadViewRecord(activeView) : undefined;
}

function buildInspectionResult(
  thread: ThreadRecord,
  threadViews: readonly ThreadViewRecord[],
  blockers: readonly StewardIssue[] = [],
): OpenWorkbenchThreadResult {
  const activeThreadView = resolveActiveThreadView(thread, threadViews);
  const nextThreadViews = threadViews.map(cloneThreadViewRecord);
  const nextBlockers = mergeWorkbenchIssues(blockers);
  const usableStatus =
    nextBlockers.length > 0
      ? nextBlockers.every((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT")
        ? "degraded"
        : "blocked"
      : "ready";

  return {
    thread: cloneThread(thread),
    threadViews: nextThreadViews,
    activeThreadView,
    usableStatus,
    blockers: nextBlockers,
  };
}

function findOwningTurn(turns: readonly TurnRecord[], messageId: string): TurnRecord | undefined {
  return turns.find((turn) => turn.messageIds.includes(messageId));
}

function listTurnPlacements(
  turnId: string,
  threadViews: readonly ThreadViewRecord[],
): Array<{ threadViewId: string; state: ThreadViewState; bandType: BandType }> {
  return threadViews
    .flatMap((view) =>
      BAND_ORDER.flatMap((bandType) => {
        const band =
          bandType === "full_fidelity"
            ? view.fullFidelityBand
            : bandType === "smooth"
              ? view.smoothBand
              : bandType === "detailed"
                ? view.detailedBand
                : view.briefBand;

        return band.sourceUnitType === "turn" && band.selectedIds.includes(turnId)
          ? [{ threadViewId: view.threadViewId, state: view.state, bandType }]
          : [];
      }),
    )
    .sort((left, right) => {
      const stateComparison = THREAD_VIEW_STATE_ORDER[left.state] - THREAD_VIEW_STATE_ORDER[right.state];
      if (stateComparison !== 0) {
        return stateComparison;
      }

      const bandComparison = compareBandTypeOrder(left.bandType, right.bandType);
      if (bandComparison !== 0) {
        return bandComparison;
      }

      return left.threadViewId.localeCompare(right.threadViewId);
    });
}

function buildThreadViewSourcePivots(
  view: ThreadViewRecord,
): Array<{ bandType: BandType; sourceUnitId: string; sourceUnitType: "turn" | "chunk" }> {
  return BAND_ORDER.flatMap((bandType) => {
    const band =
      bandType === "full_fidelity"
        ? view.fullFidelityBand
        : bandType === "smooth"
          ? view.smoothBand
          : bandType === "detailed"
            ? view.detailedBand
            : view.briefBand;

    return band.selectedIds.map((sourceUnitId) => ({
      bandType,
      sourceUnitId,
      sourceUnitType: band.sourceUnitType,
    }));
  });
}

function getBand(view: ThreadViewRecord, bandType: BandType) {
  switch (bandType) {
    case "full_fidelity":
      return view.fullFidelityBand;
    case "smooth":
      return view.smoothBand;
    case "detailed":
      return view.detailedBand;
    case "brief":
      return view.briefBand;
  }
}

function hasSummaryArtifact(chunk: WorkbenchChunkRead, bandType: "detailed" | "brief"): boolean {
  const summary = bandType === "detailed" ? chunk.detailedSummary : chunk.briefSummary;
  return typeof summary === "string" && summary.trim().length > 0;
}

function buildReadinessEntry(
  chunkId: string,
  chunk: WorkbenchChunkRead | undefined,
  bandType: "detailed" | "brief",
): LowerBandReadinessEntry {
  if (!chunk) {
    return { chunkId, status: "blocked" };
  }

  if (chunk.lifecycleStatus === "open") {
    return { chunkId, status: "ineligible_open_chunk" };
  }

  return {
    chunkId,
    status: hasSummaryArtifact(chunk, bandType) ? "eligible" : "missing_artifacts",
  };
}

export class WorkbenchQueryService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly threadViewStore: ThreadViewStore,
    private readonly chunkReader: WorkbenchChunkReader = EMPTY_CHUNK_READER,
  ) {}

  private async loadThreadScope(
    threadId: string,
    options: { includeThreadViews?: boolean } = {},
  ): Promise<WorkbenchResult<LoadedThreadScope>> {
    const threadSnapshot = await this.threadStore.openThread(threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    if (!options.includeThreadViews) {
      return okWorkbenchResult({
        snapshot: threadSnapshot.value,
        threadViews: [],
      });
    }

    const listedViews = await this.threadViewStore.listThreadViews(threadId);
    if (!listedViews.ok) {
      return failWorkbenchResult(...listedViews.issues);
    }

    return okWorkbenchResult(
      {
        snapshot: threadSnapshot.value,
        threadViews: listedViews.value,
      },
      listedViews.issues,
    );
  }

  async openThread(input: OpenWorkbenchThreadInput): Promise<WorkbenchResult<OpenWorkbenchThreadResult>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const listedViews = await this.threadViewStore.listThreadViews(input.threadId);
    if (!listedViews.ok) {
      return failWorkbenchResult(...listedViews.issues);
    }

    const refreshedThreadSnapshot =
      listedViews.issues && listedViews.issues.length > 0
        ? await this.threadStore.openThread(input.threadId)
        : threadSnapshot;
    if (!refreshedThreadSnapshot.ok) {
      return failWorkbenchResult(...refreshedThreadSnapshot.issues);
    }

    const readiness = checkMaintenanceReadiness(refreshedThreadSnapshot.value);

    return okWorkbenchResult(
      buildInspectionResult(
        refreshedThreadSnapshot.value.thread,
        listedViews.value,
        mergeWorkbenchIssues(listedViews.issues, readiness.blockers),
      ),
    );
  }

  async openFixtureThread(input: OpenFixtureThreadInput): Promise<WorkbenchResult<OpenFixtureThreadResult>> {
    const fixtureSnapshot = await this.threadStore.openFixture(input.fixtureId);
    if (!fixtureSnapshot.ok) {
      return failWorkbenchResult(...fixtureSnapshot.issues);
    }

    const readiness = checkMaintenanceReadiness(fixtureSnapshot.value.snapshot);
    const inspection = buildInspectionResult(
      fixtureSnapshot.value.snapshot.thread,
      [],
      readiness.blockers,
    );

    return okWorkbenchResult({
      ...inspection,
      fixture: structuredClone(fixtureSnapshot.value.fixture),
    });
  }

  async openMessageDetail(
    input: OpenMessageDetailInput,
  ): Promise<WorkbenchResult<MessageDetailResult>> {
    const scope = await this.loadThreadScope(input.threadId);
    if (!scope.ok) {
      return failWorkbenchResult(...scope.issues);
    }

    const message = scope.value.snapshot.messages.find((candidate) => candidate.messageId === input.messageId);
    if (!message) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Message ${input.messageId} was not found for thread ${input.threadId}.`,
          threadId: input.threadId,
        }),
      );
    }

    return okWorkbenchResult(
      {
        message: cloneMessage(message),
        owningTurnId: findOwningTurn(scope.value.snapshot.turns, input.messageId)?.turnId,
      },
      scope.issues,
    );
  }

  async openTurnDetail(input: OpenTurnDetailInput): Promise<WorkbenchResult<TurnDetailResult>> {
    const scope = await this.loadThreadScope(input.threadId, { includeThreadViews: true });
    if (!scope.ok) {
      return failWorkbenchResult(...scope.issues);
    }

    const turn = scope.value.snapshot.turns.find((candidate) => candidate.turnId === input.turnId);
    if (!turn) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Turn ${input.turnId} was not found for thread ${input.threadId}.`,
          threadId: input.threadId,
        }),
      );
    }

    const messageById = new Map(
      scope.value.snapshot.messages.map((message) => [message.messageId, message] as const),
    );
    const messages = turn.messageIds
      .map((messageId) => messageById.get(messageId))
      .filter((message): message is MessageRecord => message !== undefined)
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
      .map(cloneMessage);

    return okWorkbenchResult(
      {
        turn: cloneTurn(turn),
        messages,
        threadViewPlacements: listTurnPlacements(turn.turnId, scope.value.threadViews),
      },
      scope.issues,
    );
  }

  async openThreadViewDetail(
    input: OpenThreadViewDetailInput,
  ): Promise<WorkbenchResult<ThreadViewDetailResult>> {
    const openedView = await this.threadViewStore.openThreadView(input.threadId, input.threadViewId);
    if (!openedView.ok) {
      return failWorkbenchResult(...openedView.issues);
    }

    return okWorkbenchResult(
      {
        view: cloneThreadViewRecord(openedView.value.view),
        sourcePivots: buildThreadViewSourcePivots(openedView.value.view),
      },
      openedView.issues,
    );
  }

  async openChunkDetail(input: OpenChunkDetailInput): Promise<WorkbenchResult<ChunkDetailResult>> {
    const listedChunks = await this.chunkReader.listChunks(input.threadId);
    if (!listedChunks.ok) {
      return failWorkbenchResult(...listedChunks.issues);
    }

    const chunk = listedChunks.value.find((candidate) => candidate.chunkId === input.chunkId);
    if (!chunk) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Chunk ${input.chunkId} was not found for thread ${input.threadId}.`,
          threadId: input.threadId,
        }),
      );
    }

    return okWorkbenchResult(
      {
        chunk: cloneChunk(chunk),
      },
      listedChunks.issues,
    );
  }

  async inspectLowerBandReadiness(
    input: InspectLowerBandReadinessInput,
  ): Promise<WorkbenchResult<LowerBandReadinessResult>> {
    const listedChunks = await this.chunkReader.listChunks(input.threadId);
    if (!listedChunks.ok) {
      return failWorkbenchResult(...listedChunks.issues);
    }

    const chunkById = new Map(
      listedChunks.value.map((chunk) => [chunk.chunkId, chunk] as const),
    );

    let detailedChunkIds = listedChunks.value.map((chunk) => chunk.chunkId);
    let briefChunkIds = detailedChunkIds;
    const issues = mergeWorkbenchIssues(listedChunks.issues);

    if (input.threadViewId) {
      const openedView = await this.threadViewStore.openThreadView(input.threadId, input.threadViewId);
      if (!openedView.ok) {
        return failWorkbenchResult(...openedView.issues);
      }

      detailedChunkIds = [...getBand(openedView.value.view, "detailed").selectedIds];
      briefChunkIds = [...getBand(openedView.value.view, "brief").selectedIds];
      issues.push(...mergeWorkbenchIssues(openedView.issues));
    }

    return okWorkbenchResult(
      {
        detailedBand: detailedChunkIds.map((chunkId) =>
          buildReadinessEntry(chunkId, chunkById.get(chunkId), "detailed"),
        ),
        briefBand: briefChunkIds.map((chunkId) =>
          buildReadinessEntry(chunkId, chunkById.get(chunkId), "brief"),
        ),
      },
      issues,
    );
  }
}
