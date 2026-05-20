import { checkMaintenanceReadiness } from "../../thread/services/turn-service.js";
import { createStewardIssue, type StewardIssue } from "../../thread/domain/errors.js";
import type {
  FixtureRecord,
  MessageRecord,
  ProjectionRevisionRecord,
  ThreadRecord,
  TurnRecord,
} from "../../thread/domain/records.js";
import type { ThreadSnapshot, ThreadStore } from "../../thread/store/thread-store.js";
import {
  getReadyChunkLowerBandArtifact,
  isLegacyPlaceholderChunkState,
  type ChunkState,
} from "../../thread/async-thread/domain/chunk-state.js";
import { prepareAsyncThread } from "../../thread/async-thread/services/async-thread-run-service.js";
import {
  cloneGeneratedOutputMetadata,
  type GeneratedOutputMetadata,
} from "../../thread/domain/output-metadata.js";
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
} from "../../thread-view/domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  mergeWorkbenchIssues,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";

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
  generatedOutput?: GeneratedOutputMetadata;
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

export const LOWER_BAND_INSPECTION_STATUSES = [
  "ready",
  "pending",
  "failed",
  "invalid",
  "blocked_legacy_placeholder",
  "not_applicable_open_chunk",
] as const;

export type LowerBandInspectionStatus = (typeof LOWER_BAND_INSPECTION_STATUSES)[number];

export interface LowerBandInspectionEntry {
  status: LowerBandInspectionStatus;
  present: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface LowerBandChunkInspection {
  chunkId: string;
  lifecycleStatus: ChunkState["lifecycleStatus"];
  sourceTurnIds: string[];
  selectedBands: Array<"detailed" | "brief">;
  legacyPlaceholderBlocked: boolean;
  transcript: LowerBandInspectionEntry;
  detailed: LowerBandInspectionEntry;
  brief: LowerBandInspectionEntry;
}

export interface LowerBandCompactBlocker {
  code: string;
  message: string;
  chunkId?: string;
  bandLabel?: string;
}

export interface InspectLowerBandStatusResult {
  threadId: string;
  threadViewId?: string;
  currentThreadViewId?: string;
  currentProjectionRevisionId?: string;
  chunks: LowerBandChunkInspection[];
  compactBlockers: LowerBandCompactBlocker[];
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

const DEGRADED_BLOCKER_CODES = new Set([
  "THREAD_VIEW_STATE_CONFLICT",
  "TOKEN_COUNT_DEGRADED",
  "LOWER_THRESHOLD_UNREACHED",
  "GENERATED_WRITE_FAILED",
  "PI_RELOAD_FAILED",
]);

function summarizeMissingLowerBandArtifacts(chunk: ChunkState): string[] {
  const missingBands: string[] = [];

  if (chunk.lowerBand?.detailed?.status !== "ready" || !chunk.lowerBand?.detailed?.text) {
    missingBands.push("detailed");
  }

  if (chunk.lowerBand?.brief?.status !== "ready" || !chunk.lowerBand?.brief?.text) {
    missingBands.push("brief");
  }

  return missingBands;
}

function buildChunkIssues(
  chunk: ChunkState,
  knownTurnIds: ReadonlySet<string> | undefined,
): StewardIssue[] {
  const issues: StewardIssue[] = [];

  if (chunk.lifecycleStatus === "closed" && (!chunk.smoothText || (chunk.smoothTokenCountMetadata?.count ?? 0) <= 0)) {
    issues.push(
      createStewardIssue({
        code: "CHUNK_STATE_INVALID",
        message: `Chunk ${chunk.chunkId} is missing deterministic smooth chunk state required for lower-band inspection.`,
        threadId: chunk.threadId,
      }),
    );
  }

  if (chunk.sourceTurnIds.length === 0) {
    issues.push(
      createStewardIssue({
        code: "CHUNK_STATE_INVALID",
        message: `Chunk ${chunk.chunkId} does not reference any source turns.`,
        threadId: chunk.threadId,
      }),
    );
  }

  if (knownTurnIds && chunk.sourceTurnIds.some((turnId) => !knownTurnIds.has(turnId))) {
    issues.push(
      createStewardIssue({
        code: "CHUNK_STATE_INVALID",
        message: `Chunk ${chunk.chunkId} has source turns that do not resolve cleanly against the current thread state.`,
        threadId: chunk.threadId,
      }),
    );
  }

  if (chunk.lifecycleStatus === "closed") {
    if (isLegacyPlaceholderChunkState(chunk)) {
      issues.push(
        createStewardIssue({
          code: "CHUNK_STATE_INVALID",
          message: `Chunk ${chunk.chunkId} is legacy placeholder-era lower-band state and cannot be treated as ready semantic output.`,
          threadId: chunk.threadId,
          cause: "legacy_placeholder_chunk_state",
        }),
      );
    } else {
      const missingLowerBandArtifacts = summarizeMissingLowerBandArtifacts(chunk);
      if (missingLowerBandArtifacts.length > 0) {
        issues.push(
          createStewardIssue({
            code: "CHUNK_LOWER_BAND_MISSING",
            message: `Chunk ${chunk.chunkId} is missing ready ${missingLowerBandArtifacts.join("/")} lower-band output required for lower-band inspection.`,
            threadId: chunk.threadId,
          }),
        );
      }
    }
  }

  return issues;
}

function toWorkbenchChunkRead(
  chunk: ChunkState,
  knownTurnIds: ReadonlySet<string> | undefined,
): WorkbenchChunkRead {
  const detailed = getReadyChunkLowerBandArtifact(chunk, "detailed");
  const brief = getReadyChunkLowerBandArtifact(chunk, "brief");

  return {
    chunkId: chunk.chunkId,
    lifecycleStatus: chunk.lifecycleStatus,
    sourceTurnIds: [...chunk.sourceTurnIds],
    smoothText: chunk.smoothText,
    smoothTokenCount: chunk.smoothTokenCountMetadata?.count,
    detailedSummary: detailed?.text,
    briefSummary: brief?.text,
    issues: buildChunkIssues(chunk, knownTurnIds),
  };
}

class ThreadStoreChunkReader implements WorkbenchChunkReader {
  constructor(private readonly threadStore: ThreadStore) {}

  async listChunks(threadId: string): Promise<WorkbenchResult<WorkbenchChunkRead[]>> {
    const threadSnapshot = await this.threadStore.openThread(threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const chunks = await this.threadStore.readChunks(threadId);
    if (!chunks.ok) {
      return failWorkbenchResult(...chunks.issues);
    }

    const knownTurnIds = new Set(threadSnapshot.value.turns.map((turn) => turn.turnId));
    return okWorkbenchResult(
      chunks.value.map((chunk) => toWorkbenchChunkRead(chunk, knownTurnIds)),
      mergeWorkbenchIssues(threadSnapshot.issues, chunks.issues),
    );
  }
}

function cloneGeneratedOutput(
  generatedOutput: GeneratedOutputMetadata | undefined,
): GeneratedOutputMetadata | undefined {
  return generatedOutput ? cloneGeneratedOutputMetadata(generatedOutput) : undefined;
}

function inferIssueUsableStatus(blockers: readonly StewardIssue[]): "ready" | "blocked" | "degraded" {
  if (blockers.length === 0) {
    return "ready";
  }

  return blockers.every((issue) => DEGRADED_BLOCKER_CODES.has(issue.code)) ? "degraded" : "blocked";
}

function inferGeneratedOutputUsableStatus(
  generatedOutput: GeneratedOutputMetadata | undefined,
): "ready" | "blocked" | "degraded" {
  if (!generatedOutput || generatedOutput.status === "available") {
    return "ready";
  }

  return generatedOutput.status === "blocked" ? "blocked" : "degraded";
}

function cloneThread(thread: ThreadRecord): ThreadRecord {
  return structuredClone(thread);
}

function projectionToThreadViewRecord(
  projection: ProjectionRevisionRecord,
  currentThreadViewId: string | undefined,
): ThreadViewRecord | undefined {
  const snapshot = projection.compactSnapshot;
  const threadViewId = projection.threadViewId ?? projection.revisionId;
  if (!snapshot) {
    return undefined;
  }

  return {
    threadViewId,
    threadId: projection.threadId,
    state: threadViewId === currentThreadViewId ? "active" : "archived",
    name: `Projection ${projection.revisionId}`,
    purpose: snapshot.requestedLowerBound
      ? `requestedLowerBound=${snapshot.requestedLowerBound}`
      : "Projection compact snapshot",
    createdAt: projection.createdAt,
    updatedAt: projection.createdAt,
    sourceStateReference: snapshot.sourceStateReference ?? projection.sourceStateReference,
    fullFidelityBand: snapshot.bands.full_fidelity,
    smoothBand: snapshot.bands.smooth,
    detailedBand: snapshot.bands.detailed,
    briefBand: snapshot.bands.brief,
    emittedMessages: [],
    status: projection.status === "available" ? "ready" : projection.status === "failed" ? "blocked" : "unknown",
  };
}

async function scopeProjectionForThreadViewId(
  threadStore: ThreadStore,
  threadId: string,
  threadViewId: string,
): Promise<WorkbenchResult<ThreadViewSnapshotLike>> {
  const snapshot = await threadStore.openThread(threadId);
  if (!snapshot.ok) {
    return failWorkbenchResult(...snapshot.issues);
  }

  const projection = snapshot.value.projections.find(
    (candidate) => candidate.threadViewId === threadViewId || candidate.revisionId === threadViewId,
  );
  const view = projection
    ? projectionToThreadViewRecord(projection, snapshot.value.thread.threadViewOutputSummary.currentThreadViewId)
    : undefined;
  if (!projection || !view) {
    return failWorkbenchResult(
      createWorkbenchIssue({
        code: "THREAD_VIEW_NOT_FOUND",
        message: `Projection compact snapshot ${threadViewId} was not found for thread ${threadId}.`,
        threadId,
      }),
    );
  }

  return okWorkbenchResult({ view });
}

interface ThreadViewSnapshotLike {
  view: ThreadViewRecord;
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
  const pointedView = thread.threadViewOutputSummary.currentThreadViewId
    ? threadViews.find((view) => view.threadViewId === thread.threadViewOutputSummary.currentThreadViewId)
    : undefined;

  if (pointedView) {
    return cloneThreadViewRecord(pointedView);
  }

  return undefined;
}

function buildInspectionResult(
  thread: ThreadRecord,
  threadViews: readonly ThreadViewRecord[],
  blockers: readonly StewardIssue[] = [],
  generatedOutput?: GeneratedOutputMetadata,
): OpenWorkbenchThreadResult {
  const activeThreadView = resolveActiveThreadView(thread, threadViews);
  const nextThreadViews = threadViews.map(cloneThreadViewRecord);
  const nextBlockers = mergeWorkbenchIssues(blockers, generatedOutput?.issues);
  const issueStatus = inferIssueUsableStatus(nextBlockers);
  const generatedOutputStatus = inferGeneratedOutputUsableStatus(generatedOutput);
  const usableStatus =
    issueStatus === "blocked" || generatedOutputStatus === "blocked"
      ? "blocked"
      : issueStatus === "degraded" || generatedOutputStatus === "degraded"
        ? "degraded"
        : "ready";

  return {
    thread: cloneThread(thread),
    threadViews: nextThreadViews,
    activeThreadView,
    usableStatus,
    blockers: nextBlockers,
    generatedOutput: cloneGeneratedOutput(generatedOutput),
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
  if (chunk.placeholderExplicit || chunk.summaryQuality === "deterministic_placeholder_not_semantic") {
    return false;
  }

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

function selectedLowerBandsForChunk(input: {
  chunkId: string;
  detailedChunkIds: ReadonlySet<string>;
  briefChunkIds: ReadonlySet<string>;
}): Array<"detailed" | "brief"> {
  const selectedBands: Array<"detailed" | "brief"> = [];
  if (input.detailedChunkIds.has(input.chunkId)) {
    selectedBands.push("detailed");
  }
  if (input.briefChunkIds.has(input.chunkId)) {
    selectedBands.push("brief");
  }
  return selectedBands;
}

function buildTranscriptInspection(chunk: ChunkState): LowerBandInspectionEntry {
  if (chunk.lifecycleStatus === "open") {
    return {
      status: "not_applicable_open_chunk",
      present: false,
    };
  }

  if (isLegacyPlaceholderChunkState(chunk)) {
    return {
      status: "blocked_legacy_placeholder",
      present: false,
    };
  }

  const transcript = chunk.conversationTranscript;
  return {
    status: transcript?.status ?? "pending",
    present: typeof transcript?.text === "string" && transcript.text.trim().length > 0,
    errorCode: transcript?.errorCode,
    errorMessage: transcript?.errorMessage,
  };
}

function buildLowerBandArtifactInspection(
  chunk: ChunkState,
  bandType: "detailed" | "brief",
): LowerBandInspectionEntry {
  if (chunk.lifecycleStatus === "open") {
    return {
      status: "not_applicable_open_chunk",
      present: false,
    };
  }

  if (isLegacyPlaceholderChunkState(chunk)) {
    return {
      status: "blocked_legacy_placeholder",
      present: false,
    };
  }

  const artifact = chunk.lowerBand?.[bandType];
  return {
    status: artifact?.status ?? "pending",
    present: typeof artifact?.text === "string" && artifact.text.trim().length > 0,
    errorCode: artifact?.errorCode,
    errorMessage: artifact?.errorMessage,
  };
}

function extractChunkIdFromBlocker(message: string): string | undefined {
  const match = message.match(/\bChunk (\S+)/i);
  return match?.[1];
}

function extractBandLabelFromBlocker(message: string): string | undefined {
  const parenthesized = message.match(/\((detailed|brief)\)/i);
  if (parenthesized?.[1]) {
    return parenthesized[1].toLowerCase();
  }

  const missing = message.match(/\b(detailed\/brief|detailed|brief) lower-band\b/i);
  if (missing?.[1]) {
    return missing[1].toLowerCase();
  }

  const failed = message.match(/\bfailed (detailed|brief) lower-band\b/i);
  return failed?.[1]?.toLowerCase();
}

function formatCompactBlocker(issue: StewardIssue): LowerBandCompactBlocker {
  return {
    code: issue.code,
    message: issue.message,
    chunkId: extractChunkIdFromBlocker(issue.message),
    bandLabel: extractBandLabelFromBlocker(issue.message),
  };
}

export function formatLowerBandInspectionJson(report: InspectLowerBandStatusResult): string {
  return JSON.stringify(report, null, 2);
}

export class WorkbenchQueryService {
  constructor(
    private readonly threadStore: ThreadStore,
    _legacyThreadViewStore?: unknown,
    private readonly chunkReader: WorkbenchChunkReader = new ThreadStoreChunkReader(threadStore),
  ) {}

  private async loadAsyncThreadBlockers(input: {
    threadId: string;
    snapshot: ThreadSnapshot;
  }): Promise<StewardIssue[]> {
    const hasAsyncThreadState =
      input.snapshot.turns.some((turn) => turn.smooth !== undefined) ||
      input.snapshot.projections.length > 0 ||
      input.snapshot.thread.threadViewOutputSummary.generatedOutput !== undefined;
    if (!hasAsyncThreadState) {
      const chunks = await this.threadStore.readChunks(input.threadId);
      if (!chunks.ok) {
        return [...chunks.issues];
      }

      if (chunks.value.length === 0) {
        return [];
      }
    }

    const readiness = await prepareAsyncThread(
      {
        threadId: input.threadId,
        mode: "strict",
      },
      {
        store: this.threadStore,
      },
    );

    return readiness.blockers;
  }

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

    const threadViews = threadSnapshot.value.projections
      .map((projection) =>
        projectionToThreadViewRecord(
          projection,
          threadSnapshot.value.thread.threadViewOutputSummary.currentThreadViewId,
        ),
      )
      .filter((view): view is ThreadViewRecord => view !== undefined);

    return okWorkbenchResult(
      {
        snapshot: threadSnapshot.value,
        threadViews,
      },
    );
  }

  async openThread(input: OpenWorkbenchThreadInput): Promise<WorkbenchResult<OpenWorkbenchThreadResult>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const threadViews = threadSnapshot.value.projections
      .map((projection) =>
        projectionToThreadViewRecord(
          projection,
          threadSnapshot.value.thread.threadViewOutputSummary.currentThreadViewId,
        ),
      )
      .filter((view): view is ThreadViewRecord => view !== undefined);

    const readiness = checkMaintenanceReadiness(threadSnapshot.value);
    const asyncThreadBlockers = await this.loadAsyncThreadBlockers({
      threadId: input.threadId,
      snapshot: threadSnapshot.value,
    });

    return okWorkbenchResult(
      buildInspectionResult(
        threadSnapshot.value.thread,
        threadViews,
        mergeWorkbenchIssues(readiness.blockers, asyncThreadBlockers),
        threadSnapshot.value.thread.threadViewOutputSummary.generatedOutput,
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
      fixtureSnapshot.value.snapshot.thread.threadViewOutputSummary.generatedOutput,
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
    const resolvedView = await scopeProjectionForThreadViewId(
      this.threadStore,
      input.threadId,
      input.threadViewId,
    );
    if (!resolvedView.ok) {
      return failWorkbenchResult(...resolvedView.issues);
    }

    return okWorkbenchResult(
      {
        view: cloneThreadViewRecord(resolvedView.value.view),
        sourcePivots: buildThreadViewSourcePivots(resolvedView.value.view),
      },
      resolvedView.issues,
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
      const openedView = await scopeProjectionForThreadViewId(this.threadStore, input.threadId, input.threadViewId);
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

  async inspectLowerBandStatus(
    input: InspectLowerBandReadinessInput,
  ): Promise<WorkbenchResult<InspectLowerBandStatusResult>> {
    const scope = await this.loadThreadScope(input.threadId);
    if (!scope.ok) {
      return failWorkbenchResult(...scope.issues);
    }

    const chunksResult = await this.threadStore.readChunks(input.threadId);
    if (!chunksResult.ok) {
      return failWorkbenchResult(...chunksResult.issues);
    }

    let detailedChunkIds = new Set<string>();
    let briefChunkIds = new Set<string>();
    const issues = mergeWorkbenchIssues(scope.issues, chunksResult.issues);

    if (input.threadViewId) {
      const openedView = await scopeProjectionForThreadViewId(this.threadStore, input.threadId, input.threadViewId);
      if (!openedView.ok) {
        return failWorkbenchResult(...openedView.issues);
      }

      detailedChunkIds = new Set(getBand(openedView.value.view, "detailed").selectedIds);
      briefChunkIds = new Set(getBand(openedView.value.view, "brief").selectedIds);
      issues.push(...mergeWorkbenchIssues(openedView.issues));
    }

    const blockers = await this.loadAsyncThreadBlockers({
      threadId: input.threadId,
      snapshot: scope.value.snapshot,
    });
    const closedChunks = chunksResult.value
      .filter((chunk) => chunk.lifecycleStatus === "closed")
      .map((chunk) => ({
        chunkId: chunk.chunkId,
        lifecycleStatus: chunk.lifecycleStatus,
        sourceTurnIds: [...chunk.sourceTurnIds],
        selectedBands: selectedLowerBandsForChunk({
          chunkId: chunk.chunkId,
          detailedChunkIds,
          briefChunkIds,
        }),
        legacyPlaceholderBlocked: isLegacyPlaceholderChunkState(chunk),
        transcript: buildTranscriptInspection(chunk),
        detailed: buildLowerBandArtifactInspection(chunk, "detailed"),
        brief: buildLowerBandArtifactInspection(chunk, "brief"),
      }));

    return okWorkbenchResult(
      {
        threadId: input.threadId,
        threadViewId: input.threadViewId,
        currentThreadViewId: scope.value.snapshot.thread.threadViewOutputSummary.currentThreadViewId,
        currentProjectionRevisionId: scope.value.snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId,
        chunks: closedChunks,
        compactBlockers: blockers
          .filter((issue) => issue.code === "CHUNK_STATE_INVALID" || issue.code === "CHUNK_LOWER_BAND_MISSING")
          .map(formatCompactBlocker),
      },
      mergeWorkbenchIssues(issues, blockers),
    );
  }
}
