import { createStewardIssue, type StewardIssue, type StewardResult } from "../../thread/domain/errors.js";
import {
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  selectTokenCountRecordForScope,
  type CounterSourcePolicyMode,
  type MaterializedOrGeneratedTokenCountScope,
  type TokenCountRecord,
  type TokenCountSourceDecision,
} from "../../token-accounting/index.js";
import type { ChunkState } from "../../thread/async-thread/domain/chunk-state.js";
import type { MessageRecord, ThreadRecord, TurnRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  createSourceStateReference,
  createThreadViewId,
  type BandRecord,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  normalizeBandPercentages,
  validateThreadViewBuildInputs,
  type ThreadViewBandPercentages,
  type ThreadViewBuildInputs,
  type ThreadViewBuildResult,
} from "../domain/pi-thread-view-file.js";
import type { ThreadViewStore } from "../store/thread-view-store.js";
import { ThreadViewMaterializer } from "./thread-view-materializer.js";
export {
  estimateCompactedTextTokenCount,
} from "./pi-token-estimator.js";
import {
  estimateMaterializedMessageTokenCount as estimatePiMaterializedMessageTokenCount,
} from "./pi-token-estimator.js";
export { estimateRawMessageTokenCount } from "./pi-token-estimator.js";

const BAND_ALLOCATION_KEYS = ["fullFidelity", "smooth", "detailed", "brief"] as const;
const BAND_STATUS_BY_RESULT = {
  ready: "ready",
  blocked: "blocked",
  degraded: "incomplete",
} as const;
const DEGRADED_RESULT_ISSUE_CODES = new Set([
  "LOWER_THRESHOLD_UNREACHED",
  "TOKEN_COUNT_DEGRADED",
]);

type BandAllocationKey = (typeof BAND_ALLOCATION_KEYS)[number];

interface BandBudgets {
  fullFidelity: number;
  smooth: number;
  detailed: number;
  brief: number;
}

interface TokenizedTurn {
  turn: TurnRecord;
  rawAccounting: SelectedTokenAccounting;
  smoothAccounting?: SelectedTokenAccounting;
}

interface OrderedChunkCandidate {
  chunk: ChunkState;
  newestTurnOrder: number;
}

interface LowerBandSelectionResult {
  selectedChunkIds: string[];
  consumedTokenCount: number;
  blockers: StewardIssue[];
  remainingCandidates: OrderedChunkCandidate[];
  selectedAccounting: Map<string, SelectedTokenAccounting>;
}

export interface SelectedTokenAccounting {
  count: number;
  record: TokenCountRecord;
  decision: TokenCountSourceDecision;
}

export interface ThreadViewBuilderDependencies {
  threadStore: ThreadStore;
  threadViewStore: ThreadViewStore;
  materializer?: ThreadViewMaterializer;
  now?: () => Date;
  createDraftThreadViewId?: () => string;
}

export function estimateMaterializedMessageTokenCount(content: string | Record<string, unknown>): number {
  return estimatePiMaterializedMessageTokenCount(content);
}

function sortTurnsInSourceOrder(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns].sort((left, right) => {
    if (left.turnOrder !== right.turnOrder) {
      return left.turnOrder - right.turnOrder;
    }

    if (left.sourceRange.fromSourceOrder !== right.sourceRange.fromSourceOrder) {
      return left.sourceRange.fromSourceOrder - right.sourceRange.fromSourceOrder;
    }

    return left.turnId.localeCompare(right.turnId);
  });
}

function sortMessagesInSourceOrder(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.sourceOrder !== right.sourceOrder) {
      return left.sourceOrder - right.sourceOrder;
    }

    return left.messageId.localeCompare(right.messageId);
  });
}

function accountingPolicyModeForAllocation(inputMode: ThreadViewBuildInputs["mode"]): CounterSourcePolicyMode {
  return inputMode;
}

function isFreshTokenCountRecord(record: TokenCountRecord | undefined, expectedSourceRevision?: number): record is TokenCountRecord {
  if (!record) {
    return false;
  }

  return expectedSourceRevision === undefined || record.sourceRevision === expectedSourceRevision;
}

function selectAccounting(input: {
  records: readonly TokenCountRecord[];
  requestedScope: MaterializedOrGeneratedTokenCountScope;
  policyMode: CounterSourcePolicyMode;
}): SelectedTokenAccounting | undefined {
  const result = selectTokenCountRecordForScope({
    records: input.records,
    requestedScope: input.requestedScope,
    mode: input.policyMode,
  });

  if (!result.selected || !result.decision) {
    return undefined;
  }

  return {
    count: result.selected.count,
    record: result.selected,
    decision: result.decision,
  };
}

export function resolveRawTurnTokenAccounting(input: {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
  policyMode?: CounterSourcePolicyMode;
  now?: () => Date;
}): SelectedTokenAccounting {
  const policyMode = input.policyMode ?? "prepare";
  const persistedRecord = isFreshTokenCountRecord(
    (input.turn as TurnRecord & { rawTokenCountMetadata?: TokenCountRecord }).rawTokenCountMetadata,
    input.turn.sourceRevision,
  )
    ? (input.turn as TurnRecord & { rawTokenCountMetadata?: TokenCountRecord }).rawTokenCountMetadata
    : undefined;
  const selectedPersisted = selectAccounting({
    records: persistedRecord ? [persistedRecord] : [],
    requestedScope: "raw_turn_materialized",
    policyMode,
  });

  if (selectedPersisted) {
    return selectedPersisted;
  }

  const computedRecord = countRawTurnMaterialized({
    turn: input.turn,
    messages: input.messages,
    now: input.now,
  });
  const selectedComputed = selectAccounting({
    records: [computedRecord],
    requestedScope: "raw_turn_materialized",
    policyMode,
  });

  if (!selectedComputed) {
    throw new Error(`Raw turn materialized token count for ${input.turn.turnId} was blocked by source policy.`);
  }

  return selectedComputed;
}

export function resolveSmoothTurnTokenAccounting(input: {
  turn: TurnRecord;
  policyMode?: CounterSourcePolicyMode;
  now?: () => Date;
}): SelectedTokenAccounting | undefined {
  if (!input.turn.smooth?.text) {
    return undefined;
  }

  const policyMode = input.policyMode ?? "prepare";
  const expectedSourceRevision = input.turn.smooth.sourceRevision ?? input.turn.sourceRevision;
  const persistedRecord = isFreshTokenCountRecord(input.turn.smooth.tokenCountMetadata, expectedSourceRevision)
    ? input.turn.smooth.tokenCountMetadata
    : undefined;
  const selectedPersisted = selectAccounting({
    records: persistedRecord ? [persistedRecord] : [],
    requestedScope: "smooth_turn_materialized",
    policyMode,
  });

  if (selectedPersisted) {
    return selectedPersisted;
  }

  const computedRecord = countSmoothTurnMaterialized(input.turn, { now: input.now });
  return selectAccounting({
    records: [computedRecord],
    requestedScope: "smooth_turn_materialized",
    policyMode,
  });
}

export function resolveChunkSmoothTokenAccounting(input: {
  chunk: ChunkState;
  policyMode?: CounterSourcePolicyMode;
  now?: () => Date;
}): SelectedTokenAccounting | undefined {
  if (!input.chunk.smoothText) {
    return undefined;
  }

  const policyMode = input.policyMode ?? "prepare";
  const persistedRecord = isFreshTokenCountRecord(input.chunk.smoothTokenCountMetadata, input.chunk.sourceRevision)
    ? input.chunk.smoothTokenCountMetadata
    : undefined;
  const selectedPersisted = selectAccounting({
    records: persistedRecord ? [persistedRecord] : [],
    requestedScope: "chunk_smooth_materialized",
    policyMode,
  });

  if (selectedPersisted) {
    return selectedPersisted;
  }

  const computedRecord = countChunkSmoothMaterialized(input.chunk, { now: input.now });
  return selectAccounting({
    records: [computedRecord],
    requestedScope: "chunk_smooth_materialized",
    policyMode,
  });
}

export function resolveChunkPlaceholderTokenAccounting(input: {
  chunk: ChunkState;
  bandType: "detailed" | "brief";
  policyMode?: CounterSourcePolicyMode;
  now?: () => Date;
}): SelectedTokenAccounting | undefined {
  const policyMode = input.policyMode ?? "prepare";
  const placeholder = input.bandType === "detailed"
    ? input.chunk.placeholders?.detailed
    : input.chunk.placeholders?.brief;

  if (!placeholder?.text) {
    return undefined;
  }

  const persistedRecord = isFreshTokenCountRecord(placeholder.tokenCountMetadata, input.chunk.sourceRevision)
    ? placeholder.tokenCountMetadata
    : undefined;
  const selectedPersisted = selectAccounting({
    records: persistedRecord ? [persistedRecord] : [],
    requestedScope: input.bandType === "detailed" ? "detailed_chunk_materialized" : "brief_chunk_materialized",
    policyMode,
  });

  if (selectedPersisted) {
    return selectedPersisted;
  }

  const computedRecord = input.bandType === "detailed"
    ? countDetailedChunkMaterialized(input.chunk, { now: input.now })
    : countBriefChunkMaterialized(input.chunk, { now: input.now });

  return selectAccounting({
    records: [computedRecord],
    requestedScope: input.bandType === "detailed" ? "detailed_chunk_materialized" : "brief_chunk_materialized",
    policyMode,
  });
}

function allocateBandBudgets(
  requestedLowerBound: number,
  requestedBandPercentages: ThreadViewBandPercentages,
): BandBudgets {
  const normalized = normalizeBandPercentages(requestedBandPercentages);
  const exactBudgets = BAND_ALLOCATION_KEYS.map((key) => ({
    key,
    exact: requestedLowerBound * (normalized[key] / 100),
  }));
  const baseBudgets = exactBudgets.map((entry) => ({
    ...entry,
    budget: Math.floor(entry.exact),
    remainder: entry.exact - Math.floor(entry.exact),
  }));
  let remaining = requestedLowerBound - baseBudgets.reduce((total, entry) => total + entry.budget, 0);

  baseBudgets
    .slice()
    .sort((left, right) => {
      if (right.remainder !== left.remainder) {
        return right.remainder - left.remainder;
      }

      return BAND_ALLOCATION_KEYS.indexOf(left.key) - BAND_ALLOCATION_KEYS.indexOf(right.key);
    })
    .forEach((entry) => {
      if (remaining <= 0) {
        return;
      }

      const target = baseBudgets.find((candidate) => candidate.key === entry.key);
      if (!target) {
        return;
      }

      target.budget += 1;
      remaining -= 1;
    });

  return {
    fullFidelity: baseBudgets.find((entry) => entry.key === "fullFidelity")?.budget ?? 0,
    smooth: baseBudgets.find((entry) => entry.key === "smooth")?.budget ?? 0,
    detailed: baseBudgets.find((entry) => entry.key === "detailed")?.budget ?? 0,
    brief: baseBudgets.find((entry) => entry.key === "brief")?.budget ?? 0,
  };
}

function selectTurnIds(
  candidates: readonly TokenizedTurn[],
  budget: number,
  accountingSelector: (candidate: TokenizedTurn) => SelectedTokenAccounting | undefined,
): { selectedTurnIds: string[]; consumedTokenCount: number; selectedAccounting: Map<string, SelectedTokenAccounting> } {
  if (budget <= 0 || candidates.length === 0) {
    return {
      selectedTurnIds: [],
      consumedTokenCount: 0,
      selectedAccounting: new Map(),
    };
  }

  const selectedTurnIds: string[] = [];
  const selectedAccounting = new Map<string, SelectedTokenAccounting>();
  let consumedTokenCount = 0;

  for (const candidate of candidates) {
    const accounting = accountingSelector(candidate);
    if (!accounting || accounting.count <= 0) {
      continue;
    }

    if (selectedTurnIds.length === 0) {
      selectedTurnIds.push(candidate.turn.turnId);
      selectedAccounting.set(candidate.turn.turnId, accounting);
      consumedTokenCount += accounting.count;
      continue;
    }

    if (consumedTokenCount + accounting.count > budget) {
      break;
    }

    selectedTurnIds.push(candidate.turn.turnId);
    selectedAccounting.set(candidate.turn.turnId, accounting);
    consumedTokenCount += accounting.count;
  }

  return {
    selectedTurnIds,
    consumedTokenCount,
    selectedAccounting,
  };
}

function buildOrderedChunkCandidates(
  chunks: readonly ChunkState[],
  turnsById: ReadonlyMap<string, TurnRecord>,
  boundaryTurnOrder: number,
): { candidates: OrderedChunkCandidate[]; blockers: StewardIssue[] } {
  const blockers: StewardIssue[] = [];
  const candidates: OrderedChunkCandidate[] = [];

  for (const chunk of chunks) {
    if (chunk.lifecycleStatus !== "closed") {
      continue;
    }

    const turnOrders = chunk.sourceTurnIds
      .map((turnId) => turnsById.get(turnId)?.turnOrder)
      .filter((turnOrder): turnOrder is number => turnOrder !== undefined);

    if (turnOrders.length !== chunk.sourceTurnIds.length || turnOrders.length === 0) {
      blockers.push(
        createStewardIssue({
          code: "CHUNK_STATE_INVALID",
          message: `Chunk ${chunk.chunkId} has source turns that do not resolve cleanly against the current thread state.`,
          threadId: chunk.threadId,
        }),
      );
      continue;
    }

    const newestTurnOrder = Math.max(...turnOrders);
    if (newestTurnOrder >= boundaryTurnOrder) {
      continue;
    }

    candidates.push({
      chunk,
      newestTurnOrder,
    });
  }

  candidates.sort((left, right) => {
    if (left.newestTurnOrder !== right.newestTurnOrder) {
      return right.newestTurnOrder - left.newestTurnOrder;
    }

    return right.chunk.chunkId.localeCompare(left.chunk.chunkId);
  });

  return { candidates, blockers };
}

function selectLowerBandChunkIds(
  candidates: readonly OrderedChunkCandidate[],
  budget: number,
  bandType: "detailed" | "brief",
  policyMode: CounterSourcePolicyMode,
  now?: () => Date,
): LowerBandSelectionResult {
  if (budget <= 0 || candidates.length === 0) {
    return {
      selectedChunkIds: [],
      consumedTokenCount: 0,
      blockers: [],
      remainingCandidates: [...candidates],
      selectedAccounting: new Map(),
    };
  }

  const selectedChunkIds: string[] = [];
  const selectedAccounting = new Map<string, SelectedTokenAccounting>();
  const blockers: StewardIssue[] = [];
  let consumedTokenCount = 0;
  let consumedCandidateCount = 0;

  for (const candidate of candidates) {
    const placeholder = bandType === "detailed"
      ? candidate.chunk.placeholders?.detailed
      : candidate.chunk.placeholders?.brief;
    const accounting = resolveChunkPlaceholderTokenAccounting({
      chunk: candidate.chunk,
      bandType,
      policyMode,
      now,
    });

    if (selectedChunkIds.length === 0) {
      if (!placeholder?.text || !accounting) {
        break;
      }

      consumedCandidateCount += 1;
      selectedChunkIds.push(candidate.chunk.chunkId);
      selectedAccounting.set(candidate.chunk.chunkId, accounting);
      consumedTokenCount += accounting.count;
      continue;
    }

    if (!placeholder?.text || !accounting) {
      break;
    }

    if (consumedTokenCount + accounting.count > budget) {
      break;
    }

    consumedCandidateCount += 1;
    selectedChunkIds.push(candidate.chunk.chunkId);
    selectedAccounting.set(candidate.chunk.chunkId, accounting);
    consumedTokenCount += accounting.count;
  }

  return {
    selectedChunkIds,
    consumedTokenCount,
    blockers,
    remainingCandidates: candidates.slice(consumedCandidateCount),
    selectedAccounting,
  };
}

function buildDegradedAccountingIssues(input: {
  threadId: string;
  selections: readonly {
    bandLabel: string;
    selectedAccounting: ReadonlyMap<string, SelectedTokenAccounting>;
  }[];
}): StewardIssue[] {
  const issues: StewardIssue[] = [];

  for (const selection of input.selections) {
    for (const [sourceUnitId, accounting] of selection.selectedAccounting) {
      if (accounting.decision.status !== "degraded") {
        continue;
      }

      issues.push(
        createStewardIssue({
          code: "TOKEN_COUNT_DEGRADED",
          message: `${selection.bandLabel} selection ${sourceUnitId} used degraded ${accounting.decision.source} token accounting: ${accounting.decision.reason}`,
          threadId: input.threadId,
        }),
      );
    }
  }

  return issues;
}

function buildBandRecord(
  bandType: BandRecord["bandType"],
  selectedIds: readonly string[],
  targetTokenBudget: number,
  renderedStatus: BandRecord["renderedStatus"] = "unknown",
): BandRecord {
  return {
    bandType,
    sourceUnitType: bandType === "full_fidelity" || bandType === "smooth" ? "turn" : "chunk",
    targetTokenBudget,
    selectedIds: [...selectedIds],
    renderedStatus,
  };
}

function createDraftViewRecord(
  thread: ThreadRecord,
  input: ThreadViewBuildInputs,
  draftThreadViewId: string,
  createdAt: string,
  budgets: BandBudgets,
): ThreadViewRecord {
  return {
    threadViewId: draftThreadViewId,
    threadId: input.threadId,
    state: "draft",
    name: `Deterministic rebuild ${createdAt}`,
    purpose: `requestedLowerBound=${input.requestedLowerBound}; mode=${input.mode}`,
    createdAt,
    updatedAt: createdAt,
    sourceStateReference: createSourceStateReference({
      sourceRevision: thread.sourceRevision,
      messageHighWatermark: thread.messageHighWatermark,
    }),
    fullFidelityBand: buildBandRecord("full_fidelity", [], budgets.fullFidelity),
    smoothBand: buildBandRecord("smooth", [], budgets.smooth),
    detailedBand: buildBandRecord("detailed", [], budgets.detailed),
    briefBand: buildBandRecord("brief", [], budgets.brief),
    emittedMessages: [],
    status: "incomplete",
  };
}

function orderSelectedTurns(
  selectedIds: readonly string[],
  orderedTurns: readonly TurnRecord[],
): string[] {
  const selectedTurnIds = new Set(selectedIds);
  return orderedTurns.filter((turn) => selectedTurnIds.has(turn.turnId)).map((turn) => turn.turnId);
}

function orderSelectedChunks(
  selectedIds: readonly string[],
  orderedCandidates: readonly OrderedChunkCandidate[],
): string[] {
  const selectedChunkIds = new Set(selectedIds);
  return [...orderedCandidates]
    .sort((left, right) => left.newestTurnOrder - right.newestTurnOrder)
    .filter((candidate) => selectedChunkIds.has(candidate.chunk.chunkId))
    .map((candidate) => candidate.chunk.chunkId);
}

function inferResultStatus(
  blockers: readonly StewardIssue[],
  resultingTokenCount: number,
  requestedLowerBound: number,
): ThreadViewBuildResult["status"] {
  if (blockers.some((issue) => !DEGRADED_RESULT_ISSUE_CODES.has(issue.code))) {
    return "blocked";
  }

  if (resultingTokenCount > requestedLowerBound || blockers.length > 0) {
    return "degraded";
  }

  return "ready";
}

function unwrapOrThrow<T>(result: StewardResult<T>, context: string): T {
  if (result.ok) {
    return result.value;
  }

  const summary = result.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | ");
  throw new Error(`${context}: ${summary}`);
}

async function openOrCreateDraftView(
  input: ThreadViewBuildInputs,
  thread: ThreadRecord,
  budgets: BandBudgets,
  dependencies: ThreadViewBuilderDependencies,
): Promise<ThreadViewRecord> {
  const existingViews = unwrapOrThrow(
    await dependencies.threadViewStore.listThreadViews(input.threadId),
    `Failed to list Thread Views for ${input.threadId}`,
  );
  const existingDraft = existingViews.find((view) => view.state === "draft");
  if (existingDraft) {
    return existingDraft;
  }

  const createdAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const draftView = createDraftViewRecord(
    thread,
    input,
    (dependencies.createDraftThreadViewId ?? (() => createThreadViewId()))(),
    createdAt,
    budgets,
  );

  return unwrapOrThrow(
    await dependencies.threadViewStore.createThreadView({ view: draftView }),
    `Failed to create draft Thread View for ${input.threadId}`,
  );
}

export async function buildDraftThreadView(
  input: ThreadViewBuildInputs,
  dependencies?: ThreadViewBuilderDependencies,
): Promise<ThreadViewBuildResult> {
  const inputErrors = validateThreadViewBuildInputs(input);
  if (inputErrors.length > 0) {
    throw new Error(`Invalid Thread View build inputs: ${inputErrors.join(" ")}`);
  }

  if (!dependencies?.threadStore || !dependencies.threadViewStore) {
    throw new Error("ThreadViewBuilder requires threadStore and threadViewStore dependencies.");
  }

  const materializer = dependencies.materializer ?? new ThreadViewMaterializer(dependencies.threadStore);
  const threadSnapshot = unwrapOrThrow(
    await dependencies.threadStore.openThread(input.threadId),
    `Failed to open thread ${input.threadId}`,
  );
  const chunkState = unwrapOrThrow(
    await dependencies.threadStore.readChunks(input.threadId),
    `Failed to read chunk state for ${input.threadId}`,
  );
  const orderedTurns = sortTurnsInSourceOrder(threadSnapshot.turns);
  const turnsById = new Map(orderedTurns.map((turn) => [turn.turnId, turn]));
  const messagesById = new Map(threadSnapshot.messages.map((message) => [message.messageId, message]));
  const accountingPolicyMode = accountingPolicyModeForAllocation(input.mode);
  const tokenizedTurns = [...orderedTurns]
    .map((turn) => {
      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );

      return {
        turn,
        rawAccounting: resolveRawTurnTokenAccounting({
          turn,
          messages,
          policyMode: accountingPolicyMode,
          now: dependencies.now,
        }),
        smoothAccounting: resolveSmoothTurnTokenAccounting({
          turn,
          policyMode: accountingPolicyMode,
          now: dependencies.now,
        }),
      } satisfies TokenizedTurn;
    })
    .sort((left, right) => right.turn.turnOrder - left.turn.turnOrder);
  const budgets = allocateBandBudgets(input.requestedLowerBound, input.requestedBandPercentages);
  const fullFidelitySelection = selectTurnIds(
    tokenizedTurns,
    budgets.fullFidelity,
    (candidate) => candidate.rawAccounting,
  );
  const oldestFullFidelityTurnOrder = fullFidelitySelection.selectedTurnIds.length > 0
    ? Math.min(
        ...fullFidelitySelection.selectedTurnIds.map((turnId) => turnsById.get(turnId)?.turnOrder ?? Number.MAX_SAFE_INTEGER),
      )
    : Number.MAX_SAFE_INTEGER;
  const smoothCandidates = tokenizedTurns.filter(
    (candidate) =>
      !fullFidelitySelection.selectedTurnIds.includes(candidate.turn.turnId) &&
      candidate.turn.turnOrder < oldestFullFidelityTurnOrder &&
      candidate.smoothAccounting !== undefined &&
      candidate.smoothAccounting.count > 0 &&
      candidate.turn.smooth?.text,
  );
  const smoothSelection = selectTurnIds(
    smoothCandidates,
    budgets.smooth,
    (candidate) => candidate.smoothAccounting,
  );
  const selectedUpperTurnOrders = [...fullFidelitySelection.selectedTurnIds, ...smoothSelection.selectedTurnIds]
    .map((turnId) => turnsById.get(turnId)?.turnOrder)
    .filter((turnOrder): turnOrder is number => turnOrder !== undefined);
  const lowerBandBoundaryTurnOrder = selectedUpperTurnOrders.length > 0
    ? Math.min(...selectedUpperTurnOrders)
    : Number.MAX_SAFE_INTEGER;
  const orderedChunkCandidates = buildOrderedChunkCandidates(
    chunkState,
    turnsById,
    lowerBandBoundaryTurnOrder,
  );
  const detailedSelection = selectLowerBandChunkIds(
    orderedChunkCandidates.candidates,
    budgets.detailed,
    "detailed",
    accountingPolicyMode,
    dependencies.now,
  );
  const briefSelection = detailedSelection.blockers.length > 0
    ? {
        selectedChunkIds: [],
        consumedTokenCount: 0,
        blockers: [] as StewardIssue[],
        remainingCandidates: detailedSelection.remainingCandidates,
        selectedAccounting: new Map<string, SelectedTokenAccounting>(),
      }
    : selectLowerBandChunkIds(
        detailedSelection.remainingCandidates,
        budgets.brief,
        "brief",
        accountingPolicyMode,
        dependencies.now,
      );
  const selectedDetailedChunkIds = orderSelectedChunks(
    detailedSelection.selectedChunkIds,
    orderedChunkCandidates.candidates,
  );
  const selectedBriefChunkIds = orderSelectedChunks(
    briefSelection.selectedChunkIds,
    orderedChunkCandidates.candidates,
  );
  const selectionBlockers = [
    ...orderedChunkCandidates.blockers,
    ...detailedSelection.blockers,
    ...briefSelection.blockers,
  ];
  const degradedAccountingIssues = buildDegradedAccountingIssues({
    threadId: input.threadId,
    selections: [
      { bandLabel: "Full-fidelity", selectedAccounting: fullFidelitySelection.selectedAccounting },
      { bandLabel: "Smooth", selectedAccounting: smoothSelection.selectedAccounting },
      { bandLabel: "Detailed", selectedAccounting: detailedSelection.selectedAccounting },
      { bandLabel: "Brief", selectedAccounting: briefSelection.selectedAccounting },
    ],
  });

  const draftView = await openOrCreateDraftView(input, threadSnapshot.thread, budgets, dependencies);
  const orderedFullFidelityTurnIds = orderSelectedTurns(fullFidelitySelection.selectedTurnIds, orderedTurns);
  const orderedSmoothTurnIds = orderSelectedTurns(smoothSelection.selectedTurnIds, orderedTurns);
  const nextDraftView: ThreadViewRecord = {
    ...draftView,
    sourceStateReference: createSourceStateReference({
      sourceRevision: threadSnapshot.thread.sourceRevision,
      messageHighWatermark: threadSnapshot.thread.messageHighWatermark,
    }),
    fullFidelityBand: buildBandRecord("full_fidelity", orderedFullFidelityTurnIds, budgets.fullFidelity),
    smoothBand: buildBandRecord("smooth", orderedSmoothTurnIds, budgets.smooth),
    detailedBand: buildBandRecord("detailed", selectedDetailedChunkIds, budgets.detailed),
    briefBand: buildBandRecord("brief", selectedBriefChunkIds, budgets.brief),
    emittedMessages: [],
    status: "incomplete",
  };
  const materialized = unwrapOrThrow(
    await materializer.materializeThreadView({
      threadId: input.threadId,
      draftView: nextDraftView,
    }),
    `Failed to materialize draft Thread View for ${input.threadId}`,
  );
  const resultingTokenCount =
    fullFidelitySelection.consumedTokenCount +
    smoothSelection.consumedTokenCount +
    detailedSelection.consumedTokenCount +
    briefSelection.consumedTokenCount;
  const thresholdBlockers: StewardIssue[] = [];
  if (fullFidelitySelection.consumedTokenCount > input.requestedLowerBound) {
    thresholdBlockers.push(
      createStewardIssue({
        code: "LOWER_THRESHOLD_UNREACHED",
        message: `Full-fidelity selection alone consumed ${fullFidelitySelection.consumedTokenCount} tokens, exceeding requested lower bound ${input.requestedLowerBound}.`,
        threadId: input.threadId,
      }),
    );
  } else if (resultingTokenCount > input.requestedLowerBound) {
    thresholdBlockers.push(
      createStewardIssue({
        code: "LOWER_THRESHOLD_UNREACHED",
        message: `Deterministic rebuild consumed ${resultingTokenCount} tokens, which is above requested lower bound ${input.requestedLowerBound}.`,
        threadId: input.threadId,
      }),
    );
  }

  const blockers = [
    ...selectionBlockers,
    ...materialized.issues,
    ...thresholdBlockers,
    ...degradedAccountingIssues,
  ];
  const resultStatus = inferResultStatus(blockers, resultingTokenCount, input.requestedLowerBound);
  const updatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  unwrapOrThrow(
    await dependencies.threadViewStore.updateThreadView({
      threadId: input.threadId,
      threadViewId: draftView.threadViewId,
      expectedUpdatedAt: draftView.updatedAt,
      patch: {
        sourceStateReference: nextDraftView.sourceStateReference,
        fullFidelityBand: {
          ...materialized.fullFidelityBand,
          targetTokenBudget: budgets.fullFidelity,
          renderedStatus: materialized.fullFidelityBand.renderedStatus,
        },
        smoothBand: {
          ...materialized.smoothBand,
          targetTokenBudget: budgets.smooth,
          renderedStatus: materialized.smoothBand.renderedStatus,
        },
        detailedBand: {
          ...nextDraftView.detailedBand,
          renderedStatus: selectionBlockers.length > 0 ? "blocked" : materialized.bandStatuses.detailed,
        },
        briefBand: {
          ...nextDraftView.briefBand,
          renderedStatus: selectionBlockers.length > 0 ? "blocked" : materialized.bandStatuses.brief,
        },
        emittedMessages: materialized.emittedMessages,
        status: BAND_STATUS_BY_RESULT[resultStatus],
        updatedAt,
      },
    }),
    `Failed to persist rebuilt draft Thread View ${draftView.threadViewId}`,
  );

  return {
    draftThreadViewId: draftView.threadViewId,
    status: resultStatus,
    resultingTokenCount,
    blockers,
  };
}
