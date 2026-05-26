import {
  createAsyncThreadBlocker,
  type PrepareAsyncThreadInput,
  type PrepareAsyncThreadResult,
} from "../domain/async-thread-status.js";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ThreadViewBandPercentages } from "../../../thread-view/domain/pi-thread-view-file.js";
import {
  estimateRawMessageTokenCount,
} from "../../../thread-view/services/pi-token-estimator.js";
import {
  resolveChunkSemanticArtifactAccounting,
  resolveChunkSmoothTokenAccounting,
  resolveRawTurnTokenAccounting,
  resolveSmoothTurnTokenAccounting,
} from "../../../thread-view/services/thread-view-builder.js";
import type { ThreadStore } from "../../store/thread-store.js";
import type {
  MessageRecord,
  ThreadMaintenanceDebtRecord,
  ThreadMaintenanceRunMode,
  ThreadMaintenanceRunRecord,
  TurnRecord,
} from "../../domain/records.js";
import {
  createStewardIssue,
  ok,
  StewardResultError,
  type StewardIssue,
  type StewardResult,
} from "../../domain/errors.js";
import {
  getReadyChunkLowerBandArtifact,
  isLegacyPlaceholderChunkState,
  type ChunkState,
} from "../domain/chunk-state.js";
import type { ChunkSemanticArtifactBand } from "../domain/lower-band-artifact-state.js";
import {
  LowerBandCompressionService,
  type LowerBandCompressionLogger,
  type LowerBandCompressionProvider,
} from "./lower-band-compression-service.js";
import { ensureLowerBandTurnProjection } from "./lower-band-turn-projection-service.js";
import { PiCodexLowerBandCompressionProvider } from "./pi-codex-lower-band-compression-provider.js";
import { ensureSmoothTurn, materializeSmoothTurnFromState } from "./smooth-turn-service.js";
import { materializeChunkSmoothTextFromTurns, updateChunkState } from "./chunk-service.js";
import {
  countRawTurnMaterialized,
  createMaterializedRepresentationHash,
  OpenAIInputTokenCounter,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface AsyncThreadArtifactRepairLimits {
  maxSmoothTurns?: number;
  maxProjectionTurns?: number;
  maxTokenTurns?: number;
  maxTokenChunks?: number;
}

export interface AsyncThreadRunDependencies {
  store: ThreadStore;
  lowerBandCompressionProvider?: LowerBandCompressionProvider;
  lowerBandCompressionLogger?: LowerBandCompressionLogger;
  lowerBandCompressionEnabled?: boolean;
  openAIInputTokenCounter?: Pick<
    OpenAIInputTokenCounter,
    | "countRawTurnMaterialized"
    | "countSmoothTurnMaterialized"
    | "countChunkSmoothMaterialized"
    | "countDetailedChunkMaterialized"
    | "countBriefChunkMaterialized"
  > &
    Partial<Pick<OpenAIInputTokenCounter, "countTurnLowerBandProjectionMaterialized">>;
  exactTokenCountRepairEnabled?: boolean;
  tokenCountModel?: string;
  artifactRepairLimits?: AsyncThreadArtifactRepairLimits;
  now?: () => Date;
}

export interface MaintainAsyncThreadInput {
  threadId: string;
}

export interface MaintainAsyncThreadResult {
  threadId: string;
  artifactsReady: boolean;
  tokenCountsReady: boolean;
  blockers: StewardIssue[];
}

interface SelectionAwareReadinessPlan {
  fullFidelityTurnIds: ReadonlySet<string>;
  smoothTurnIds: ReadonlySet<string>;
  detailedChunkIds: ReadonlySet<string>;
  briefChunkIds: ReadonlySet<string>;
  lowerBandBlockers: readonly StewardIssue[];
}

interface TokenizedTurnCandidate {
  turn: TurnRecord;
  rawTokenCount: number;
  smoothTokenCount: number;
}

interface OrderedChunkCandidate {
  chunk: ChunkState;
  newestTurnOrder: number;
}

interface LowerBandSelectionResult {
  selectedChunkIds: string[];
  remainingCandidates: OrderedChunkCandidate[];
}

interface LowerBandCatchUpTarget {
  chunkId: string;
  band: ChunkSemanticArtifactBand;
}

function logAsyncMaintenanceTiming(threadId: string, label: string, startedAt: number, parts: Record<string, unknown> = {}): void {
  const debugDir = join(process.cwd(), ".context-steward", "debug");
  const logPath = join(debugDir, "lh-timing.log");
  const record = {
    at: new Date().toISOString(),
    label,
    threadId,
    totalMs: Date.now() - startedAt,
    ...parts,
  };

  void mkdir(debugDir, { recursive: true })
    .then(() => appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8"))
    .catch(() => undefined);
}

function writeVisibleCatchUpWarning(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Best-effort operator warning only.
  }
}

function isRetryableThreadMutationIssue(issue: StewardIssue): boolean {
  return issue.code === "STALE_SOURCE_REVISION" || issue.code === "STORE_UNAVAILABLE";
}

function createLowerBandCompressionScheduler(
  dependencies: AsyncThreadRunDependencies,
): LowerBandCompressionService | undefined {
  if (dependencies.lowerBandCompressionEnabled === false) {
    return undefined;
  }

  const provider = dependencies.lowerBandCompressionProvider ??
    (process.env.NODE_TEST_CONTEXT === undefined ? new PiCodexLowerBandCompressionProvider() : undefined);
  if (!provider) {
    return undefined;
  }

  return new LowerBandCompressionService({
    store: dependencies.store,
    provider,
    openAIInputTokenCounter: dependencies.openAIInputTokenCounter,
    tokenCountModel: dependencies.tokenCountModel,
    now: dependencies.now,
    logger: dependencies.lowerBandCompressionLogger,
  });
}

const BAND_ALLOCATION_KEYS = ["fullFidelity", "smooth", "detailed", "brief"] as const;
const DEFAULT_BACKGROUND_ARTIFACT_REPAIR_LIMITS: Required<AsyncThreadArtifactRepairLimits> = {
  maxSmoothTurns: 2,
  maxProjectionTurns: 2,
  maxTokenTurns: 2,
  maxTokenChunks: 2,
};

function normalizeRepairLimit(limit: number | undefined): number {
  if (limit === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(limit)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(limit));
}

function blockedReadiness(threadId: string, issues: readonly StewardIssue[]): PrepareAsyncThreadResult {
  return {
    threadId,
    smoothReady: false,
    chunksReady: false,
    lowerBandReady: false,
    blockers: issues.map((issue) => createStewardIssue(issue)),
  };
}

function issuesFromUnknownError(error: unknown, threadId: string): StewardIssue[] {
  if (error instanceof StewardResultError) {
    return error.issues;
  }

  return [
    createStewardIssue({
      code: "STORE_UNAVAILABLE",
      message: "Deterministic async thread preparation failed.",
      threadId,
      cause: error instanceof Error ? error.message : String(error),
    }),
  ];
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

function sortTurnsForBoundedRepair(turns: readonly TurnRecord[], limits?: AsyncThreadArtifactRepairLimits): TurnRecord[] {
  const sorted = sortTurnsInSourceOrder(turns);
  return limits ? sorted.reverse() : sorted;
}

function sortMessagesInSourceOrder(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.sourceOrder !== right.sourceOrder) {
      return left.sourceOrder - right.sourceOrder;
    }

    return left.messageId.localeCompare(right.messageId);
  });
}

function allocateBandBudgets(
  requestedLowerBound: number,
  requestedBandPercentages: ThreadViewBandPercentages,
): Record<(typeof BAND_ALLOCATION_KEYS)[number], number> {
  const factor = 10 ** 4;
  const normalized = {
    fullFidelity: Math.round(requestedBandPercentages.fullFidelity * factor) / factor,
    smooth: Math.round(requestedBandPercentages.smooth * factor) / factor,
    detailed: Math.round(requestedBandPercentages.detailed * factor) / factor,
    brief: Math.round(requestedBandPercentages.brief * factor) / factor,
  };
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
  candidates: readonly TokenizedTurnCandidate[],
  budget: number,
  tokenCountSelector: (candidate: TokenizedTurnCandidate) => number,
): string[] {
  if (budget <= 0 || candidates.length === 0) {
    return [];
  }

  const selectedTurnIds: string[] = [];
  let consumedTokenCount = 0;

  for (const candidate of candidates) {
    const tokenCount = tokenCountSelector(candidate);
    if (tokenCount <= 0) {
      continue;
    }

    if (selectedTurnIds.length === 0) {
      selectedTurnIds.push(candidate.turn.turnId);
      consumedTokenCount += tokenCount;
      continue;
    }

    if (consumedTokenCount + tokenCount > budget) {
      break;
    }

    selectedTurnIds.push(candidate.turn.turnId);
    consumedTokenCount += tokenCount;
  }

  return selectedTurnIds;
}

function buildOrderedChunkCandidates(
  chunks: readonly ChunkState[],
  turnsById: ReadonlyMap<string, TurnRecord>,
  boundaryTurnOrder: number,
): { candidates: OrderedChunkCandidate[]; blockers: StewardIssue[] } {
  const candidates: OrderedChunkCandidate[] = [];
  const blockers: StewardIssue[] = [];

  for (const chunk of chunks) {
    if (chunk.lifecycleStatus !== "closed") {
      continue;
    }

    const turnOrders = chunk.sourceTurnIds
      .map((turnId) => turnsById.get(turnId)?.turnOrder)
      .filter((turnOrder): turnOrder is number => turnOrder !== undefined);

    if (turnOrders.length !== chunk.sourceTurnIds.length || turnOrders.length === 0) {
      continue;
    }

    const newestTurnOrder = Math.max(...turnOrders);
    if (newestTurnOrder >= boundaryTurnOrder) {
      continue;
    }

    if (isLegacyPlaceholderChunkState(chunk)) {
      blockers.push(
        createAsyncThreadBlocker({
          code: "CHUNK_STATE_INVALID",
          message: `Chunk ${chunk.chunkId} is legacy placeholder-era lower-band state and cannot be selected for lower-band output.`,
          threadId: chunk.threadId,
          cause: "legacy_placeholder_chunk_state",
        }),
      );
      continue;
    }

    candidates.push({
      chunk,
      newestTurnOrder,
    });
  }

  return {
    candidates: candidates.sort((left, right) => {
      if (left.newestTurnOrder !== right.newestTurnOrder) {
        return right.newestTurnOrder - left.newestTurnOrder;
      }

      return right.chunk.chunkId.localeCompare(left.chunk.chunkId);
    }),
    blockers,
  };
}

function selectLowerBandChunkIds(
  candidates: readonly OrderedChunkCandidate[],
  budget: number,
  bandType: "detailed" | "brief",
): LowerBandSelectionResult {
  if (budget <= 0 || candidates.length === 0) {
    return {
      selectedChunkIds: [],
      remainingCandidates: [...candidates],
    };
  }

  const selectedChunkIds: string[] = [];
  let consumedTokenCount = 0;
  let consumedCandidateCount = 0;

  for (const candidate of candidates) {
    const artifact = getReadyChunkLowerBandArtifact(candidate.chunk, bandType);
    const accounting = resolveChunkSemanticArtifactAccounting({
      chunk: candidate.chunk,
      bandType,
      policyMode: "prepare",
    });

    if (selectedChunkIds.length === 0) {
      if (!artifact?.text || !accounting) {
        break;
      }

      selectedChunkIds.push(candidate.chunk.chunkId);
      consumedTokenCount += accounting.count;
      consumedCandidateCount += 1;
      continue;
    }

    if (!artifact?.text || !accounting) {
      break;
    }

    if (consumedTokenCount + accounting.count > budget) {
      break;
    }

    selectedChunkIds.push(candidate.chunk.chunkId);
    consumedTokenCount += accounting.count;
    consumedCandidateCount += 1;
  }

  return {
    selectedChunkIds,
    remainingCandidates: candidates.slice(consumedCandidateCount),
  };
}

function hasProviderGeneratedLowerBandArtifact(
  chunk: ChunkState,
  bandType: ChunkSemanticArtifactBand,
): boolean {
  const artifact = chunk.lowerBand?.[bandType];
  return artifact?.status === "ready" && typeof artifact.text === "string" && artifact.text.length > 0 && artifact.providerMetadata?.providerId === "openai-codex";
}

function findLowerBandCatchUpTarget(
  candidates: readonly OrderedChunkCandidate[],
  budget: number,
  bandType: ChunkSemanticArtifactBand,
): { target?: LowerBandCatchUpTarget; remainingCandidates: OrderedChunkCandidate[] } {
  if (budget <= 0 || candidates.length === 0) {
    return {
      target: undefined,
      remainingCandidates: [...candidates],
    };
  }

  let consumedTokenCount = 0;
  let consumedCandidateCount = 0;

  for (const candidate of candidates) {
    const accounting = resolveChunkSemanticArtifactAccounting({
      chunk: candidate.chunk,
      bandType,
      policyMode: "prepare",
    });
    if (!accounting || !hasProviderGeneratedLowerBandArtifact(candidate.chunk, bandType)) {
      return {
        target: {
          chunkId: candidate.chunk.chunkId,
          band: bandType,
        },
        remainingCandidates: candidates.slice(consumedCandidateCount),
      };
    }

    if (consumedCandidateCount === 0) {
      consumedCandidateCount += 1;
      consumedTokenCount += accounting.count;
      continue;
    }

    if (consumedTokenCount + accounting.count > budget) {
      break;
    }

    consumedCandidateCount += 1;
    consumedTokenCount += accounting.count;
  }

  return {
    target: undefined,
    remainingCandidates: candidates.slice(consumedCandidateCount),
  };
}

function isSmoothTurnReady(turn: TurnRecord, messages: readonly MessageRecord[]): boolean {
  if (turn.lifecycleStatus !== "closed") {
    return true;
  }

  const smooth = turn.smooth;
  const materialized = materializeSmoothTurnFromState({ turn, messages });

  return (
    (materialized.status === "ready" || materialized.status === "degraded") &&
    typeof materialized.text === "string" &&
    materialized.text.length > 0 &&
    typeof smooth?.tokenCountMetadata?.count === "number"
  );
}

function isCurrentExactLowerBandProjection(turn: TurnRecord): boolean {
  const projection = turn.smooth?.lowerBandProjection;
  if (
    projection?.status !== "ready" ||
    typeof projection.text !== "string" ||
    projection.text.length === 0 ||
    !projection.tokenCountMetadata
  ) {
    return false;
  }

  return (
    projection.tokenCountMetadata.scope === "turn_lower_band_projection_materialized" &&
    projection.tokenCountMetadata.source === "provider_input_count" &&
    projection.tokenCountMetadata.trustClass === "exact" &&
    projection.tokenCountMetadata.provider === "openai" &&
    projection.tokenCountMetadata.representationHash === createMaterializedRepresentationHash(projection.text) &&
    projection.tokenCountMetadata.sourceRevision === projection.sourceRevision
  );
}

function withSmoothMaterializedText(turn: TurnRecord, messages: readonly MessageRecord[]): TurnRecord {
  const materialized = materializeSmoothTurnFromState({ turn, messages });
  if (
    !turn.smooth ||
    (materialized.status !== "ready" && materialized.status !== "degraded") ||
    !materialized.text
  ) {
    return turn;
  }

  return {
    ...turn,
    smooth: {
      ...turn.smooth,
      text: materialized.text,
    },
  };
}

function resolveSmoothTokenCount(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
): number {
  if (isSmoothTurnReady(turn, messages)) {
    return resolveSmoothTurnTokenAccounting({
      turn,
      messages,
      policyMode: "prepare",
    })?.count ?? 0;
  }

  return 0;
}

function tokenCountBlockedIssue(input: {
  threadId: string;
  message: string;
  cause?: string;
}): StewardIssue {
  return createStewardIssue({
    code: "TOKEN_COUNT_BLOCKED",
    message: input.message,
    threadId: input.threadId,
    cause: input.cause,
  });
}

function lowerBandAccountingBlockedIssue(input: {
  threadId: string;
  chunkId: string;
  bandType: "detailed" | "brief";
  mode: PrepareAsyncThreadInput["mode"];
}): StewardIssue {
  return tokenCountBlockedIssue({
    threadId: input.threadId,
    message:
      `Chunk ${input.chunkId} has ready ${input.bandType} lower-band output, ` +
      `but ${input.mode} smart compact cannot derive usable token accounting for it. ` +
      "Selection would silently drop this chunk until exact lower-band accounting is repaired.",
  });
}

function isOpenAIProviderInputCount(input: {
  record: TokenCountRecord | undefined;
  expected: TokenCountRecord | undefined;
  model?: string;
}): boolean {
  if (!input.record || !input.expected) {
    return false;
  }

  return (
    input.record.scope === input.expected.scope &&
    input.record.source === "provider_input_count" &&
    input.record.trustClass === "exact" &&
    input.record.provider === "openai" &&
    (input.model === undefined || input.record.model === input.model) &&
    input.record.representationHash === input.expected.representationHash &&
    input.record.sourceRevision === input.expected.sourceRevision
  );
}

function tokenCountIssueFromError(error: unknown, threadId: string, message: string): StewardIssue {
  return tokenCountBlockedIssue({
    threadId,
    message,
    cause: error instanceof Error ? error.message : String(error),
  });
}

function buildSelectionAwareReadinessPlan(input: {
  requestedLowerBound?: number;
  requestedBandPercentages?: ThreadViewBandPercentages;
  turns: readonly TurnRecord[];
  messages: readonly MessageRecord[];
  chunks: readonly ChunkState[];
}): SelectionAwareReadinessPlan | undefined {
  if (
    input.requestedLowerBound === undefined ||
    !Number.isFinite(input.requestedLowerBound) ||
    input.requestedLowerBound <= 0 ||
    input.requestedBandPercentages === undefined
  ) {
    return undefined;
  }

  const budgets = allocateBandBudgets(input.requestedLowerBound, input.requestedBandPercentages);
  const orderedTurns = sortTurnsInSourceOrder(input.turns);
  const turnsById = new Map(orderedTurns.map((turn) => [turn.turnId, turn]));
  const messagesById = new Map(input.messages.map((message) => [message.messageId, message]));
  const tokenizedTurns = [...orderedTurns]
    .map((turn) => {
      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
      const rawTokenCount = messages.reduce((total, message) => total + estimateRawMessageTokenCount(message), 0);
      return {
        turn,
        rawTokenCount,
        smoothTokenCount: resolveSmoothTokenCount(turn, messages) || rawTokenCount,
      };
    })
    .sort((left, right) => right.turn.turnOrder - left.turn.turnOrder);

  const fullFidelityTurnIds = selectTurnIds(
    tokenizedTurns,
    budgets.fullFidelity,
    (candidate) => candidate.rawTokenCount,
  );
  const oldestFullFidelityTurnOrder = fullFidelityTurnIds.length > 0
    ? Math.min(
        ...fullFidelityTurnIds.map((turnId) => turnsById.get(turnId)?.turnOrder ?? Number.MAX_SAFE_INTEGER),
      )
    : Number.MAX_SAFE_INTEGER;
  const smoothTurnIds = selectTurnIds(
    tokenizedTurns.filter(
      (candidate) =>
        candidate.turn.lifecycleStatus === "closed" &&
        !fullFidelityTurnIds.includes(candidate.turn.turnId) &&
        candidate.turn.turnOrder < oldestFullFidelityTurnOrder &&
        candidate.smoothTokenCount > 0,
    ),
    budgets.smooth,
    (candidate) => candidate.smoothTokenCount,
  );

  const lowerBandBoundaryTurnOrder = [...fullFidelityTurnIds, ...smoothTurnIds]
    .map((turnId) => turnsById.get(turnId)?.turnOrder)
    .filter((turnOrder): turnOrder is number => turnOrder !== undefined)
    .reduce((lowest, turnOrder) => Math.min(lowest, turnOrder), Number.MAX_SAFE_INTEGER);

  const orderedChunkCandidates =
    budgets.detailed > 0 || budgets.brief > 0
      ? buildOrderedChunkCandidates(
        input.chunks,
        turnsById,
        lowerBandBoundaryTurnOrder,
      )
      : { candidates: [] as OrderedChunkCandidate[], blockers: [] as StewardIssue[] };
  const detailedSelection = selectLowerBandChunkIds(
    orderedChunkCandidates.candidates,
    budgets.detailed,
    "detailed",
  );
  const briefSelection = selectLowerBandChunkIds(
    detailedSelection.remainingCandidates,
    budgets.brief,
    "brief",
  );

  return {
    fullFidelityTurnIds: new Set(fullFidelityTurnIds),
    smoothTurnIds: new Set(smoothTurnIds),
    detailedChunkIds: new Set(detailedSelection.selectedChunkIds),
    briefChunkIds: new Set(briefSelection.selectedChunkIds),
    lowerBandBlockers: orderedChunkCandidates.blockers,
  };
}

function buildReadinessBlockers(input: {
  threadId: string;
  mode: PrepareAsyncThreadInput["mode"];
  tokenCountModel?: string;
  requiredLowerBandArtifacts?: {
    detailed: boolean;
    brief: boolean;
  };
  selectionPlan?: SelectionAwareReadinessPlan;
  turns: ReadonlyArray<TurnRecord>;
  messages: ReadonlyArray<MessageRecord>;
  chunks: ReadonlyArray<ChunkState>;
}): PrepareAsyncThreadResult {
  const requiredLowerBandArtifacts = input.requiredLowerBandArtifacts ?? {
    detailed: true,
    brief: true,
  };
  const requiredFullFidelityTurnIds = input.selectionPlan?.fullFidelityTurnIds;
  const requiredSmoothTurnIds = input.selectionPlan?.smoothTurnIds;
  const requiredDetailedChunkIds = input.selectionPlan?.detailedChunkIds;
  const requiredBriefChunkIds = input.selectionPlan?.briefChunkIds;
  const requiredChunkIds =
    requiredDetailedChunkIds || requiredBriefChunkIds
      ? new Set([...(requiredDetailedChunkIds ?? []), ...(requiredBriefChunkIds ?? [])])
      : undefined;
  const messagesById = new Map(input.messages.map((message) => [message.messageId, message]));
  let lowerBandAccountingBlocked = false;
  const blockers = [
    ...(input.selectionPlan?.lowerBandBlockers ?? []),
    ...input.turns
    .filter((turn) => requiredSmoothTurnIds?.has(turn.turnId) ?? turn.lifecycleStatus === "closed")
    .filter((turn) => {
      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
      return turn.lifecycleStatus === "closed" && !isSmoothTurnReady(turn, messages);
    })
    .map((turn) =>
      createAsyncThreadBlocker({
        code: turn.smooth?.status === "invalid" ? "SMOOTH_INVALID" : "SMOOTH_MISSING",
        message: `Turn ${turn.turnId} is missing deterministic smooth output required for smart compact.`,
        threadId: input.threadId,
      }),
    ),
  ];

  for (const turn of input.turns) {
    if (!requiredFullFidelityTurnIds?.has(turn.turnId)) {
      continue;
    }

    const missingMessageIds = turn.messageIds.filter((messageId) => !messagesById.has(messageId));
    if (missingMessageIds.length === 0) {
      continue;
    }

    blockers.push(
      createAsyncThreadBlocker({
        code: "THREAD_VIEW_STATE_CONFLICT",
        message: `Turn ${turn.turnId} cannot be materialized because canonical source messages are missing for deterministic full-fidelity output.`,
        threadId: input.threadId,
        cause: missingMessageIds.join(", "),
      }),
    );
  }

  for (const turn of input.turns) {
    const messages = sortMessagesInSourceOrder(
      turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );

    const expected = resolveRawTurnTokenAccounting({
      turn,
      messages,
      policyMode: "prepare",
    }).record;
    if (
      !isOpenAIProviderInputCount({
        record: turn.rawTokenCountMetadata,
        expected,
        model: input.tokenCountModel,
      })
    ) {
      blockers.push(
        tokenCountBlockedIssue({
          threadId: input.threadId,
          message:
            `Turn ${turn.turnId} (order ${turn.turnOrder}, lifecycle ${turn.lifecycleStatus}) is missing current OpenAI raw materialized token count required for strict smart compact allocation.` +
            (turn.lifecycleStatus === "open"
              ? " The newest open turn cannot fall back to heuristic raw sizing in strict mode."
              : ""),
        }),
      );
    }

    if (requiredSmoothTurnIds?.has(turn.turnId)) {
      const expected = resolveSmoothTurnTokenAccounting({
        turn,
        messages,
        policyMode: "prepare",
      })?.record;
      if (
        !isOpenAIProviderInputCount({
          record: turn.smooth?.tokenCountMetadata,
          expected,
          model: input.tokenCountModel,
        })
      ) {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Turn ${turn.turnId} is missing current OpenAI smooth materialized token count required for strict smart compact allocation.`,
          }),
        );
      }
    }

    if (turn.lifecycleStatus === "closed" && turn.smooth?.lowerBandProjection) {
      const projection = turn.smooth.lowerBandProjection;
      if (projection.status === "failed") {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Turn ${turn.turnId} is missing current OpenAI conversation-only lower-band projection token count required for lower-band eligibility.`,
            cause: projection.errorMessage ?? projection.errorCode,
          }),
        );
      } else if (projection.status === "invalid") {
        blockers.push(
          createAsyncThreadBlocker({
            code: "SMOOTH_INVALID",
            message: `Turn ${turn.turnId} has invalid conversation-only lower-band projection state.`,
            threadId: input.threadId,
            cause: projection.errorMessage ?? projection.errorCode,
          }),
        );
      } else if (projection.status === "pending") {
        blockers.push(
          createAsyncThreadBlocker({
            code: "SMOOTH_MISSING",
            message: `Turn ${turn.turnId} is missing conversation-only lower-band projection state required for lower-band eligibility.`,
            threadId: input.threadId,
            cause: projection.errorMessage ?? projection.errorCode,
          }),
        );
      } else if (!isCurrentExactLowerBandProjection(turn)) {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Turn ${turn.turnId} has stale conversation-only lower-band projection token count required for lower-band eligibility.`,
          }),
        );
      }
    }
  }

  const turnIds = new Set(input.turns.map((turn) => turn.turnId));
  const turnsById = new Map(input.turns.map((turn) => [turn.turnId, turn]));
  const openChunks = input.chunks.filter((chunk) => chunk.lifecycleStatus === "open");
  if (openChunks.length > 1) {
    blockers.push(
      createAsyncThreadBlocker({
        code: "CHUNK_STATE_INVALID",
        message: `Thread ${input.threadId} has ${openChunks.length} open chunks; expected at most one.`,
        threadId: input.threadId,
      }),
    );
  }

  for (const chunk of input.chunks) {
    if (
      (chunk.lifecycleStatus === "closed" && chunk.sourceTurnIds.length === 0) ||
      chunk.sourceTurnIds.some((turnId) => !turnIds.has(turnId))
    ) {
      blockers.push(
        createAsyncThreadBlocker({
          code: "CHUNK_STATE_INVALID",
          message: `Chunk ${chunk.chunkId} has source turns that do not resolve cleanly against the current thread state.`,
          threadId: input.threadId,
        }),
      );
      continue;
    }

    if (requiredChunkIds && !requiredChunkIds.has(chunk.chunkId)) {
      continue;
    }

    if (chunk.lifecycleStatus !== "closed") {
      continue;
    }

    if (
      !chunk.smoothText ||
      (chunk.smoothTokenCountMetadata?.count ?? 0) <= 0
    ) {
      blockers.push(
        createAsyncThreadBlocker({
          code: "CHUNK_STATE_INVALID",
          message: `Chunk ${chunk.chunkId} is missing deterministic smooth chunk state required for smart compact.`,
          threadId: input.threadId,
        }),
      );
      continue;
    }

    if (requiredChunkIds?.has(chunk.chunkId)) {
      const expected = resolveChunkSmoothTokenAccounting({
        chunk,
        policyMode: "prepare",
      })?.record;
      if (
        !isOpenAIProviderInputCount({
          record: chunk.smoothTokenCountMetadata,
          expected,
          model: input.tokenCountModel,
        })
      ) {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Chunk ${chunk.chunkId} is missing current OpenAI smooth materialized token count required for strict smart compact allocation.`,
          }),
        );
      }
    }

    const detailed = getReadyChunkLowerBandArtifact(chunk, "detailed");
    const brief = getReadyChunkLowerBandArtifact(chunk, "brief");
    const requiresDetailed =
      (requiredDetailedChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredLowerBandArtifacts.detailed;
    const requiresBrief =
      (requiredBriefChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredLowerBandArtifacts.brief;
    const missingDetailed = requiresDetailed && !detailed?.text;
    const missingBrief = requiresBrief && !brief?.text;

    if (missingDetailed || missingBrief) {
      const requiredBands = [
        requiredLowerBandArtifacts.detailed ? "detailed" : undefined,
        requiredLowerBandArtifacts.brief ? "brief" : undefined,
      ].filter((value): value is "detailed" | "brief" => value !== undefined);
      const requiredBandLabel =
        requiredBands.length === 2
          ? "detailed/brief"
          : requiredBands[0] ?? "detailed/brief";
      blockers.push(
        createAsyncThreadBlocker({
          code: "CHUNK_LOWER_BAND_MISSING",
          message: `Chunk ${chunk.chunkId} is missing ready ${requiredBandLabel} lower-band output required for lower-band rebuild.`,
          threadId: input.threadId,
        }),
      );
    }

    if (
      requiredDetailedChunkIds?.has(chunk.chunkId) &&
      detailed?.text &&
      resolveChunkSemanticArtifactAccounting({
        chunk,
        bandType: "detailed",
        policyMode: input.mode,
      }) === undefined
    ) {
      lowerBandAccountingBlocked = true;
      blockers.push(
        lowerBandAccountingBlockedIssue({
          threadId: input.threadId,
          chunkId: chunk.chunkId,
          bandType: "detailed",
          mode: input.mode,
        }),
      );
    }

    if (
      requiredBriefChunkIds?.has(chunk.chunkId) &&
      brief?.text &&
      resolveChunkSemanticArtifactAccounting({
        chunk,
        bandType: "brief",
        policyMode: input.mode,
      }) === undefined
    ) {
      lowerBandAccountingBlocked = true;
      blockers.push(
        lowerBandAccountingBlockedIssue({
          threadId: input.threadId,
          chunkId: chunk.chunkId,
          bandType: "brief",
          mode: input.mode,
        }),
      );
    }

  }

  const smoothReady = !blockers.some(
    (issue) => issue.code === "SMOOTH_MISSING" || issue.code === "SMOOTH_INVALID",
  );
  const chunksReady = !blockers.some(
    (issue) => issue.code === "CHUNK_STATE_INVALID" || issue.code === "THREAD_VIEW_STATE_CONFLICT",
  );
  const lowerBandReady =
    !blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING") &&
    !lowerBandAccountingBlocked;

  return {
    threadId: input.threadId,
    smoothReady,
    chunksReady,
    lowerBandReady,
    blockers,
  };
}

function findSelectedLowerBandCatchUpTarget(input: {
  requestedLowerBound?: number;
  requestedBandPercentages?: ThreadViewBandPercentages;
  turns: readonly TurnRecord[];
  messages: readonly MessageRecord[];
  chunks: readonly ChunkState[];
}): LowerBandCatchUpTarget | undefined {
  if (
    input.requestedLowerBound === undefined ||
    !Number.isFinite(input.requestedLowerBound) ||
    input.requestedLowerBound <= 0 ||
    input.requestedBandPercentages === undefined
  ) {
    return undefined;
  }

  const budgets = allocateBandBudgets(input.requestedLowerBound, input.requestedBandPercentages);
  const orderedTurns = sortTurnsInSourceOrder(input.turns);
  const turnsById = new Map(orderedTurns.map((turn) => [turn.turnId, turn]));
  const messagesById = new Map(input.messages.map((message) => [message.messageId, message]));
  const tokenizedTurns = [...orderedTurns]
    .map((turn) => {
      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
      const rawTokenCount = messages.reduce((total, message) => total + estimateRawMessageTokenCount(message), 0);
      return {
        turn,
        rawTokenCount,
        smoothTokenCount: resolveSmoothTokenCount(turn, messages) || rawTokenCount,
      };
    })
    .sort((left, right) => right.turn.turnOrder - left.turn.turnOrder);

  const fullFidelityTurnIds = selectTurnIds(
    tokenizedTurns,
    budgets.fullFidelity,
    (candidate) => candidate.rawTokenCount,
  );
  const oldestFullFidelityTurnOrder = fullFidelityTurnIds.length > 0
    ? Math.min(
        ...fullFidelityTurnIds.map((turnId) => turnsById.get(turnId)?.turnOrder ?? Number.MAX_SAFE_INTEGER),
      )
    : Number.MAX_SAFE_INTEGER;
  const smoothTurnIds = selectTurnIds(
    tokenizedTurns.filter(
      (candidate) =>
        candidate.turn.lifecycleStatus === "closed" &&
        !fullFidelityTurnIds.includes(candidate.turn.turnId) &&
        candidate.turn.turnOrder < oldestFullFidelityTurnOrder &&
        candidate.smoothTokenCount > 0,
    ),
    budgets.smooth,
    (candidate) => candidate.smoothTokenCount,
  );

  const lowerBandBoundaryTurnOrder = [...fullFidelityTurnIds, ...smoothTurnIds]
    .map((turnId) => turnsById.get(turnId)?.turnOrder)
    .filter((turnOrder): turnOrder is number => turnOrder !== undefined)
    .reduce((lowest, turnOrder) => Math.min(lowest, turnOrder), Number.MAX_SAFE_INTEGER);
  const orderedChunkCandidates =
    budgets.detailed > 0 || budgets.brief > 0
      ? buildOrderedChunkCandidates(
        input.chunks,
        turnsById,
        lowerBandBoundaryTurnOrder,
      )
      : { candidates: [] as OrderedChunkCandidate[], blockers: [] as StewardIssue[] };

  const detailedTarget = findLowerBandCatchUpTarget(
    orderedChunkCandidates.candidates,
    budgets.detailed,
    "detailed",
  );
  if (detailedTarget.target) {
    return detailedTarget.target;
  }

  return findLowerBandCatchUpTarget(
    detailedTarget.remainingCandidates,
    budgets.brief,
    "brief",
  ).target;
}

async function readReadiness(
  input: {
    threadId: string;
    mode: PrepareAsyncThreadInput["mode"];
    requestedLowerBound?: number;
    requestedBandPercentages?: ThreadViewBandPercentages;
    requiredLowerBandArtifacts?: {
      detailed: boolean;
      brief: boolean;
    };
  },
  dependencies: AsyncThreadRunDependencies,
): Promise<PrepareAsyncThreadResult> {
  const threadSnapshot = await dependencies.store.openThread(input.threadId);
  if (!threadSnapshot.ok) {
    return blockedReadiness(input.threadId, threadSnapshot.issues);
  }

  const chunksSnapshot = await dependencies.store.readChunks(input.threadId);
  if (!chunksSnapshot.ok) {
    return blockedReadiness(input.threadId, chunksSnapshot.issues);
  }

  return buildReadinessBlockers({
    threadId: input.threadId,
    mode: input.mode,
    tokenCountModel: dependencies.tokenCountModel,
    requiredLowerBandArtifacts: input.requiredLowerBandArtifacts,
    selectionPlan: buildSelectionAwareReadinessPlan({
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: input.requestedBandPercentages,
      turns: threadSnapshot.value.turns,
      messages: threadSnapshot.value.messages,
      chunks: chunksSnapshot.value,
    }),
    turns: threadSnapshot.value.turns,
    messages: threadSnapshot.value.messages,
    chunks: chunksSnapshot.value,
  });
}

async function repairMissingArtifacts(
  input: {
    threadId: string;
    requestedLowerBound?: number;
    requestedBandPercentages?: ThreadViewBandPercentages;
  },
  dependencies: AsyncThreadRunDependencies,
  options: {
    warnOnSmoothCatchUp?: boolean;
    limits?: AsyncThreadArtifactRepairLimits;
  } = {},
): Promise<StewardIssue[]> {
  const startedAt = Date.now();
  const threadId = input.threadId;
  let openThreadMs = 0;
  let smoothMs = 0;
  let projectionMs = 0;
  let updateChunkMs = 0;
  let readChunksMs = 0;
  let lowerBandCatchUpMs = 0;
  let closedTurns = 0;
  let projectedTurns = 0;
  let smoothTurnsRepaired = 0;
  let smoothTurnsSkippedByLimit = 0;
  let projectionTurnsSkippedByLimit = 0;
  let closedChunks = 0;
  let result = "unknown";
  let stepStartedAt = Date.now();
  const threadSnapshot = await dependencies.store.openThread(threadId);
  openThreadMs = Date.now() - stepStartedAt;
  if (!threadSnapshot.ok) {
    result = "openThreadFailed";
    logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
      result,
      openThreadMs,
    });
    return threadSnapshot.issues;
  }

  stepStartedAt = Date.now();
  const messagesById = new Map(threadSnapshot.value.messages.map((message) => [message.messageId, message]));
  for (const turn of sortTurnsForBoundedRepair(threadSnapshot.value.turns, options.limits)) {
    if (turn.lifecycleStatus !== "closed") {
      continue;
    }

    closedTurns += 1;
    const messages = sortMessagesInSourceOrder(
      turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (isSmoothTurnReady(turn, messages)) {
      continue;
    }

    if (smoothTurnsRepaired >= normalizeRepairLimit(options.limits?.maxSmoothTurns)) {
      smoothTurnsSkippedByLimit += 1;
      continue;
    }

    try {
      if (options.warnOnSmoothCatchUp) {
        writeVisibleCatchUpWarning(
          `[smart-compact] Smooth catch-up required for turn ${turn.turnId} before lower-band preparation can continue.`,
        );
      }
      await ensureSmoothTurn(
        {
          threadId,
          turnId: turn.turnId,
        },
        {
          store: dependencies.store,
          now: dependencies.now,
        },
      );
      smoothTurnsRepaired += 1;
    } catch (error) {
      smoothMs += Date.now() - stepStartedAt;
      result = "smoothFailed";
      logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
        result,
        openThreadMs,
        smoothMs,
        closedTurns,
      });
      return issuesFromUnknownError(error, threadId);
    }
  }
  smoothMs = Date.now() - stepStartedAt;
  const limitIssues: StewardIssue[] = [];
  if (smoothTurnsSkippedByLimit > 0) {
    limitIssues.push(tokenCountBlockedIssue({
      threadId,
      message: `Async smooth repair limit reached; ${smoothTurnsSkippedByLimit} closed turn(s) still need smooth repair. Run standalone thread maintenance for full catch-up.`,
    }));
  }

  if (dependencies.openAIInputTokenCounter?.countTurnLowerBandProjectionMaterialized) {
    stepStartedAt = Date.now();
    const projectionSnapshot = await dependencies.store.openThread(threadId);
    if (!projectionSnapshot.ok) {
      result = "projectionOpenThreadFailed";
      logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
        result,
        openThreadMs,
        smoothMs,
        projectionMs: Date.now() - stepStartedAt,
        closedTurns,
      });
      return projectionSnapshot.issues;
    }

    for (const turn of sortTurnsForBoundedRepair(projectionSnapshot.value.turns, options.limits)) {
      if (turn.lifecycleStatus !== "closed" || isCurrentExactLowerBandProjection(turn)) {
        continue;
      }

      if (projectedTurns >= normalizeRepairLimit(options.limits?.maxProjectionTurns)) {
        projectionTurnsSkippedByLimit += 1;
        continue;
      }

      projectedTurns += 1;
      try {
        await ensureLowerBandTurnProjection(
          {
            threadId,
            turnId: turn.turnId,
          },
          {
            store: dependencies.store,
            openAIInputTokenCounter: {
              countTurnLowerBandProjectionMaterialized:
                dependencies.openAIInputTokenCounter.countTurnLowerBandProjectionMaterialized.bind(
                  dependencies.openAIInputTokenCounter,
                ),
            },
            tokenCountModel: dependencies.tokenCountModel,
            now: dependencies.now,
          },
        );
      } catch (error) {
        projectionMs += Date.now() - stepStartedAt;
        result = "projectionFailed";
        logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
          result,
          openThreadMs,
          smoothMs,
          projectionMs,
          closedTurns,
          projectedTurns,
        });
        return issuesFromUnknownError(error, threadId);
      }
    }
    projectionMs = Date.now() - stepStartedAt;
    if (projectionTurnsSkippedByLimit > 0) {
      limitIssues.push(tokenCountBlockedIssue({
        threadId,
        message: `Async projection repair limit reached; ${projectionTurnsSkippedByLimit} closed turn(s) still need lower-band projection repair. Run standalone thread maintenance for full catch-up.`,
      }));
    }
  }

  try {
    stepStartedAt = Date.now();
    await updateChunkState(
      {
        threadId,
      },
      {
        store: dependencies.store,
        now: dependencies.now,
        lowerBandCompressionScheduler: createLowerBandCompressionScheduler(dependencies),
      },
    );
    updateChunkMs = Date.now() - stepStartedAt;
  } catch (error) {
    updateChunkMs = Date.now() - stepStartedAt;
    result = "updateChunkFailed";
    logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
      result,
      openThreadMs,
      smoothMs,
      projectionMs,
      updateChunkMs,
      closedTurns,
      projectedTurns,
    });
    return issuesFromUnknownError(error, threadId);
  }

  stepStartedAt = Date.now();
  const chunksSnapshot = await dependencies.store.readChunks(threadId);
  readChunksMs = Date.now() - stepStartedAt;
  if (!chunksSnapshot.ok) {
    result = "readChunksFailed";
    logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
      result,
      openThreadMs,
      smoothMs,
      projectionMs,
      updateChunkMs,
      readChunksMs,
      closedTurns,
      projectedTurns,
    });
    return chunksSnapshot.issues;
  }

  closedChunks = chunksSnapshot.value.filter((chunk) => chunk.lifecycleStatus === "closed").length;

  const lowerBandCompressionService = createLowerBandCompressionScheduler(dependencies);
  if (lowerBandCompressionService) {
    stepStartedAt = Date.now();
    const maxCatchUpAttempts = Math.max(1, closedChunks * 2);

    for (let attempt = 0; attempt < maxCatchUpAttempts; attempt += 1) {
      const catchUpThreadSnapshot = await dependencies.store.openThread(threadId);
      if (!catchUpThreadSnapshot.ok) {
        lowerBandCatchUpMs = Date.now() - stepStartedAt;
        result = "lowerBandCatchUpOpenThreadFailed";
        logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
          result,
          openThreadMs,
          smoothMs,
          projectionMs,
          updateChunkMs,
          readChunksMs,
          lowerBandCatchUpMs,
          closedTurns,
          projectedTurns,
          closedChunks,
        });
        return catchUpThreadSnapshot.issues;
      }

      const catchUpChunksSnapshot = await dependencies.store.readChunks(threadId);
      if (!catchUpChunksSnapshot.ok) {
        lowerBandCatchUpMs = Date.now() - stepStartedAt;
        result = "lowerBandCatchUpReadChunksFailed";
        logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
          result,
          openThreadMs,
          smoothMs,
          projectionMs,
          updateChunkMs,
          readChunksMs,
          lowerBandCatchUpMs,
          closedTurns,
          projectedTurns,
          closedChunks,
        });
        return catchUpChunksSnapshot.issues;
      }

      const catchUpTarget = findSelectedLowerBandCatchUpTarget({
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        turns: catchUpThreadSnapshot.value.turns,
        messages: catchUpThreadSnapshot.value.messages,
        chunks: catchUpChunksSnapshot.value,
      });
      if (!catchUpTarget) {
        break;
      }

      writeVisibleCatchUpWarning(
        `[smart-compact] Lower-band catch-up required for chunk ${catchUpTarget.chunkId} ` +
        `(${catchUpTarget.band}) before lower-band preparation can continue.`,
      );

      try {
        const catchUpResult = await lowerBandCompressionService.run({
          threadId,
          chunkId: catchUpTarget.chunkId,
          requiredBands: [catchUpTarget.band],
          mode: "prepare_catch_up",
        });
        if (catchUpResult.blockers.length > 0) {
          lowerBandCatchUpMs = Date.now() - stepStartedAt;
          result = "lowerBandCatchUpFailed";
          logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
            result,
            openThreadMs,
            smoothMs,
            projectionMs,
            updateChunkMs,
            readChunksMs,
            lowerBandCatchUpMs,
            closedTurns,
            projectedTurns,
            closedChunks,
          });
          return catchUpResult.blockers.map((issue) =>
            createStewardIssue({
              ...issue,
              message: `Lower-band catch-up failed during compact preparation: ${issue.message}`,
            })
          );
        }
      } catch (error) {
        lowerBandCatchUpMs = Date.now() - stepStartedAt;
        result = "lowerBandCatchUpException";
        logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
          result,
          openThreadMs,
          smoothMs,
          projectionMs,
          updateChunkMs,
          readChunksMs,
          lowerBandCatchUpMs,
          closedTurns,
          projectedTurns,
          closedChunks,
        });
        return issuesFromUnknownError(error, threadId);
      }
    }

    lowerBandCatchUpMs = Date.now() - stepStartedAt;
  }

  result = "ok";
  logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
    result,
    openThreadMs,
    smoothMs,
    projectionMs,
    updateChunkMs,
    readChunksMs,
    lowerBandCatchUpMs,
    closedTurns,
    projectedTurns,
    closedChunks,
  });
  return limitIssues;
}

export async function repairOpenAITokenCounts(
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
  options: {
    includeOpenRawTurns: boolean;
    failureMessage: string;
    missingCounterMessage: string;
    limits?: Pick<AsyncThreadArtifactRepairLimits, "maxTokenTurns" | "maxTokenChunks">;
  } = {
    includeOpenRawTurns: true,
    failureMessage:
      "OpenAI token counting failed during async preparation; strict smart compact cannot use heuristic token counts as success.",
    missingCounterMessage:
      "OpenAI materialized token counter is not configured; strict smart compact cannot use heuristic token counts as success.",
  },
): Promise<StewardIssue[]> {
  const startedAt = Date.now();
  let openThreadMs = 0;
  let turnLoopMs = 0;
  let writeTurnsMs = 0;
  let reopenThreadMs = 0;
  let readChunksMs = 0;
  let chunkLoopMs = 0;
  let writeChunksMs = 0;
  let turnsVisited = 0;
  let rawCounts = 0;
  let smoothCounts = 0;
  let tokenTurnsRepaired = 0;
  let tokenTurnsSkippedByLimit = 0;
  let chunksVisited = 0;
  let chunkSmoothCounts = 0;
  let detailedCounts = 0;
  let briefCounts = 0;
  let tokenChunksRepaired = 0;
  let tokenChunksSkippedByLimit = 0;
  const limitIssues: StewardIssue[] = [];
  let result = "unknown";
  const counter = dependencies.openAIInputTokenCounter;
  if (!counter) {
    result = "missingCounter";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
    });
    return [
      tokenCountBlockedIssue({
        threadId,
        message: options.missingCounterMessage,
      }),
    ];
  }

  let stepStartedAt = Date.now();
  const snapshot = await dependencies.store.openThread(threadId);
  openThreadMs = Date.now() - stepStartedAt;
  if (!snapshot.ok) {
    result = "openThreadFailed";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
    });
    return snapshot.issues;
  }

  const messagesById = new Map(snapshot.value.messages.map((message) => [message.messageId, message]));
  const nextTurns = structuredClone(snapshot.value.turns);
  let turnsChanged = false;
  const changedTurnIds = new Set<string>();

  try {
    stepStartedAt = Date.now();
    for (const turn of sortTurnsForBoundedRepair(nextTurns, options.limits)) {
      turnsVisited += 1;
      if (!options.includeOpenRawTurns && turn.lifecycleStatus !== "closed") {
        continue;
      }

      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
      if (messages.length !== turn.messageIds.length) {
        continue;
      }
      const expectedRaw = resolveRawTurnTokenAccounting({
        turn,
        messages,
        policyMode: "prepare",
      }).record;
      const rawDirty = !isOpenAIProviderInputCount({
        record: turn.rawTokenCountMetadata,
        expected: expectedRaw,
        model: dependencies.tokenCountModel,
      });

      const turnWithSmoothText = turn.lifecycleStatus === "closed" ? withSmoothMaterializedText(turn, messages) : undefined;
      const expectedSmooth = turnWithSmoothText?.smooth?.text
        ? resolveSmoothTurnTokenAccounting({
          turn,
          messages,
          policyMode: "prepare",
        })?.record
        : undefined;
      const smoothDirty = Boolean(
        turnWithSmoothText?.smooth?.text &&
        !isOpenAIProviderInputCount({
          record: turnWithSmoothText.smooth.tokenCountMetadata,
          expected: expectedSmooth,
          model: dependencies.tokenCountModel,
        }),
      );

      if (!rawDirty && !smoothDirty) {
        continue;
      }
      if (tokenTurnsRepaired >= normalizeRepairLimit(options.limits?.maxTokenTurns)) {
        tokenTurnsSkippedByLimit += 1;
        continue;
      }

      if (rawDirty) {
        rawCounts += 1;
        turn.rawTokenCountMetadata = await counter.countRawTurnMaterialized({
          turn,
          messages,
          model: dependencies.tokenCountModel,
          now: dependencies.now,
        });
        turnsChanged = true;
        changedTurnIds.add(turn.turnId);
      }

      if (smoothDirty && turnWithSmoothText) {
        smoothCounts += 1;
        turn.smooth = {
          ...turn.smooth,
          tokenCountMetadata: await counter.countSmoothTurnMaterialized(turnWithSmoothText, {
            model: dependencies.tokenCountModel,
            now: dependencies.now,
          }),
        };
        turnsChanged = true;
        changedTurnIds.add(turn.turnId);
      }
      tokenTurnsRepaired += 1;
    }
    turnLoopMs = Date.now() - stepStartedAt;
    if (tokenTurnsSkippedByLimit > 0) {
      limitIssues.push(tokenCountBlockedIssue({
        threadId,
        message: `Async exact token repair limit reached; ${tokenTurnsSkippedByLimit} turn(s) still need exact token repair. Run standalone thread maintenance for full catch-up.`,
      }));
    }
  } catch (error) {
    result = "turnCountFailed";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
      turnLoopMs: Date.now() - stepStartedAt,
      turnsVisited,
      rawCounts,
      smoothCounts,
    });
    return [
      tokenCountIssueFromError(
        error,
        threadId,
        options.failureMessage,
      ),
    ];
  }

  if (turnsChanged) {
    stepStartedAt = Date.now();
    const updatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const writeTurnsResult = dependencies.store.writeTurnRows
      ? await dependencies.store.writeTurnRows({
          threadId,
          expectedSourceRevision: snapshot.value.thread.sourceRevision,
          expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
          turns: nextTurns.filter((turn) => changedTurnIds.has(turn.turnId)),
          turnState: snapshot.value.thread.status.turnState,
          updatedAt,
        })
      : await dependencies.store.writeTurns({
          threadId,
          expectedSourceRevision: snapshot.value.thread.sourceRevision,
          expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
          expectedTurnsRevision: snapshot.value.thread.turnsRevision,
          turns: nextTurns,
          turnState: snapshot.value.thread.status.turnState,
        });
    writeTurnsMs = Date.now() - stepStartedAt;
    if (!writeTurnsResult.ok) {
      result = "writeTurnsFailed";
      logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
        result,
        openThreadMs,
        turnLoopMs,
        writeTurnsMs,
        turnsVisited,
        rawCounts,
        smoothCounts,
      });
      return writeTurnsResult.issues;
    }
  }

  stepStartedAt = Date.now();
  const latestSnapshot = await dependencies.store.openThread(threadId);
  reopenThreadMs = Date.now() - stepStartedAt;
  if (!latestSnapshot.ok) {
    result = "reopenThreadFailed";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
      turnLoopMs,
      writeTurnsMs,
      reopenThreadMs,
      turnsVisited,
      rawCounts,
      smoothCounts,
    });
    return latestSnapshot.issues;
  }

  stepStartedAt = Date.now();
  const chunksSnapshot = await dependencies.store.readChunks(threadId);
  readChunksMs = Date.now() - stepStartedAt;
  if (!chunksSnapshot.ok) {
    result = "readChunksFailed";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
      turnLoopMs,
      writeTurnsMs,
      reopenThreadMs,
      readChunksMs,
      turnsVisited,
      rawCounts,
      smoothCounts,
    });
    return chunksSnapshot.issues;
  }

  const nextChunks = structuredClone(chunksSnapshot.value);
  let chunksChanged = false;
  const changedChunkIds = new Set<string>();
  try {
    stepStartedAt = Date.now();
    for (const chunk of nextChunks) {
      chunksVisited += 1;
      if (chunk.lifecycleStatus !== "closed" || !chunk.smoothText) {
        continue;
      }

      const expectedSmooth = resolveChunkSmoothTokenAccounting({
        chunk,
        policyMode: "prepare",
      })?.record;
      const chunkSmoothDirty = !isOpenAIProviderInputCount({
        record: chunk.smoothTokenCountMetadata,
        expected: expectedSmooth,
        model: dependencies.tokenCountModel,
      });

      const expectedDetailed = resolveChunkSemanticArtifactAccounting({
        chunk,
        bandType: "detailed",
        policyMode: "prepare",
      })?.record;
      const detailedDirty = Boolean(
        expectedDetailed &&
        chunk.lowerBand?.detailed &&
        !isOpenAIProviderInputCount({
          record: chunk.lowerBand?.detailed?.tokenCountMetadata,
          expected: expectedDetailed,
          model: dependencies.tokenCountModel,
        }),
      );

      const expectedBrief = resolveChunkSemanticArtifactAccounting({
        chunk,
        bandType: "brief",
        policyMode: "prepare",
      })?.record;
      const briefDirty = Boolean(
        expectedBrief &&
        chunk.lowerBand?.brief &&
        !isOpenAIProviderInputCount({
          record: chunk.lowerBand?.brief?.tokenCountMetadata,
          expected: expectedBrief,
          model: dependencies.tokenCountModel,
        }),
      );

      if (!chunkSmoothDirty && !detailedDirty && !briefDirty) {
        continue;
      }
      if (tokenChunksRepaired >= normalizeRepairLimit(options.limits?.maxTokenChunks)) {
        tokenChunksSkippedByLimit += 1;
        continue;
      }

      if (chunkSmoothDirty) {
        chunkSmoothCounts += 1;
        chunk.smoothTokenCountMetadata = await counter.countChunkSmoothMaterialized(chunk, {
          model: dependencies.tokenCountModel,
          now: dependencies.now,
        });
        chunksChanged = true;
        changedChunkIds.add(chunk.chunkId);
      }

      if (detailedDirty && expectedDetailed && chunk.lowerBand?.detailed) {
        detailedCounts += 1;
        chunk.lowerBand = {
          ...(chunk.lowerBand ?? {}),
          detailed: {
            ...chunk.lowerBand.detailed,
            tokenCountMetadata: await counter.countDetailedChunkMaterialized(chunk, {
              model: dependencies.tokenCountModel,
              now: dependencies.now,
            }),
          },
        };
        chunksChanged = true;
        changedChunkIds.add(chunk.chunkId);
      }

      if (briefDirty && expectedBrief && chunk.lowerBand?.brief) {
        briefCounts += 1;
        chunk.lowerBand = {
          ...(chunk.lowerBand ?? {}),
          brief: {
            ...chunk.lowerBand.brief,
            tokenCountMetadata: await counter.countBriefChunkMaterialized(chunk, {
              model: dependencies.tokenCountModel,
              now: dependencies.now,
            }),
          },
        };
        chunksChanged = true;
        changedChunkIds.add(chunk.chunkId);
      }

      tokenChunksRepaired += 1;

    }
    chunkLoopMs = Date.now() - stepStartedAt;
    if (tokenChunksSkippedByLimit > 0) {
      limitIssues.push(tokenCountBlockedIssue({
        threadId,
        message: `Async exact chunk token repair limit reached; ${tokenChunksSkippedByLimit} chunk(s) still need exact token repair. Run standalone thread maintenance for full catch-up.`,
      }));
    }
  } catch (error) {
    result = "chunkCountFailed";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
      turnLoopMs,
      writeTurnsMs,
      reopenThreadMs,
      readChunksMs,
      chunkLoopMs: Date.now() - stepStartedAt,
      turnsVisited,
      rawCounts,
      smoothCounts,
      chunksVisited,
      chunkSmoothCounts,
      detailedCounts,
      briefCounts,
    });
    return [
      tokenCountIssueFromError(
        error,
        threadId,
        options.failureMessage,
      ),
    ];
  }

  if (!chunksChanged) {
    result = "unchanged";
    logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
      result,
      openThreadMs,
      turnLoopMs,
      writeTurnsMs,
      reopenThreadMs,
      readChunksMs,
      chunkLoopMs,
      turnsVisited,
      rawCounts,
      smoothCounts,
      chunksVisited,
      chunkSmoothCounts,
      detailedCounts,
      briefCounts,
    });
    return limitIssues;
  }

  stepStartedAt = Date.now();
  const updatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const writeChunksResult = dependencies.store.writeChunkRows
    ? await dependencies.store.writeChunkRows({
        threadId,
        expectedSourceRevision: latestSnapshot.value.thread.sourceRevision,
        expectedMessageHighWatermark: latestSnapshot.value.thread.messageHighWatermark,
        chunks: nextChunks.filter((chunk) => changedChunkIds.has(chunk.chunkId)),
        updatedAt,
      })
    : await dependencies.store.writeChunks({
        threadId,
        expectedSourceRevision: latestSnapshot.value.thread.sourceRevision,
        expectedMessageHighWatermark: latestSnapshot.value.thread.messageHighWatermark,
        expectedTurnsRevision: latestSnapshot.value.thread.turnsRevision,
        chunks: nextChunks,
      });
  writeChunksMs = Date.now() - stepStartedAt;

  result = writeChunksResult.ok ? "updated" : "writeChunksFailed";
  logAsyncMaintenanceTiming(threadId, "repairOpenAITokenCounts", startedAt, {
    result,
    openThreadMs,
    turnLoopMs,
    writeTurnsMs,
    reopenThreadMs,
    readChunksMs,
    chunkLoopMs,
    writeChunksMs,
    turnsVisited,
    rawCounts,
    smoothCounts,
    chunksVisited,
    chunkSmoothCounts,
    detailedCounts,
    briefCounts,
  });

  return writeChunksResult.ok ? limitIssues : writeChunksResult.issues;
}

async function persistDegradedRawTokenCountsForClosedTurns(
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
): Promise<StewardIssue[]> {
  const startedAt = Date.now();
  let openThreadMs = 0;
  let loopMs = 0;
  let writeMs = 0;
  let turnsVisited = 0;
  let changedTurns = 0;
  let result = "unknown";
  let lastIssues: StewardIssue[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    turnsVisited = 0;
    changedTurns = 0;

    let stepStartedAt = Date.now();
    const snapshot = await dependencies.store.openThread(threadId);
    openThreadMs += Date.now() - stepStartedAt;
    if (!snapshot.ok) {
      result = "openThreadFailed";
      lastIssues = snapshot.issues;
      if (attempt < 3 && snapshot.issues.some(isRetryableThreadMutationIssue)) {
        continue;
      }
      logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
        result,
        openThreadMs,
        attempt,
      });
      return snapshot.issues;
    }

    const messagesById = new Map(snapshot.value.messages.map((message) => [message.messageId, message]));
    const nextTurns = structuredClone(snapshot.value.turns);
    let turnsChanged = false;
    const changedTurnIds = new Set<string>();

    stepStartedAt = Date.now();
    for (const turn of nextTurns) {
      turnsVisited += 1;
      if (turn.lifecycleStatus !== "closed") {
        continue;
      }

      const messages = sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
      if (messages.length !== turn.messageIds.length) {
        continue;
      }

      const expected = countRawTurnMaterialized({
        turn,
        messages,
        now: dependencies.now,
      });
      if (
        isOpenAIProviderInputCount({
          record: turn.rawTokenCountMetadata,
          expected,
          model: dependencies.tokenCountModel,
        }) ||
        (
          turn.rawTokenCountMetadata?.scope === expected.scope &&
          turn.rawTokenCountMetadata.source === expected.source &&
          turn.rawTokenCountMetadata.trustClass === expected.trustClass &&
          turn.rawTokenCountMetadata.sourceRevision === expected.sourceRevision &&
          turn.rawTokenCountMetadata.representationHash === expected.representationHash &&
          turn.rawTokenCountMetadata.count === expected.count
        )
      ) {
        continue;
      }

      turn.rawTokenCountMetadata = expected;
      turnsChanged = true;
      changedTurns += 1;
      changedTurnIds.add(turn.turnId);
    }
    loopMs += Date.now() - stepStartedAt;

    if (!turnsChanged) {
      result = "unchanged";
      logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
        result,
        openThreadMs,
        loopMs,
        turnsVisited,
        changedTurns,
        attempt,
      });
      return [];
    }

    stepStartedAt = Date.now();
    const updatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const writeTurnsResult = dependencies.store.writeTurnRows
      ? await dependencies.store.writeTurnRows({
          threadId,
          expectedSourceRevision: snapshot.value.thread.sourceRevision,
          expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
          turns: nextTurns.filter((turn) => changedTurnIds.has(turn.turnId)),
          turnState: snapshot.value.thread.status.turnState,
          updatedAt,
        })
      : await dependencies.store.writeTurns({
          threadId,
          expectedSourceRevision: snapshot.value.thread.sourceRevision,
          expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
          expectedTurnsRevision: snapshot.value.thread.turnsRevision,
          turns: nextTurns,
          turnState: snapshot.value.thread.status.turnState,
        });
    writeMs += Date.now() - stepStartedAt;
    result = writeTurnsResult.ok ? "updated" : "writeFailed";
    if (writeTurnsResult.ok) {
      logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
        result,
        openThreadMs,
        loopMs,
        writeMs,
        turnsVisited,
        changedTurns,
        attempt,
      });
      return [];
    }

    lastIssues = writeTurnsResult.issues;
    if (!writeTurnsResult.issues.some(isRetryableThreadMutationIssue)) {
      break;
    }
  }

  logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
    result,
    openThreadMs,
    loopMs,
    writeMs,
    turnsVisited,
    changedTurns,
    attempts: 3,
  });

  return lastIssues;
}

export async function persistTokenCountingMaintenanceStatus(input: {
  threadId: string;
  dependencies: AsyncThreadRunDependencies;
  status: "ready" | "repair_needed";
  issues: readonly StewardIssue[];
}): Promise<StewardIssue[]> {
  const startedAt = Date.now();
  let openThreadMs = 0;
  let writeMs = 0;
  let result = "unknown";
  let stepStartedAt = Date.now();
  const snapshot = await input.dependencies.store.openThread(input.threadId);
  openThreadMs = Date.now() - stepStartedAt;
  if (!snapshot.ok) {
    result = "openThreadFailed";
    logAsyncMaintenanceTiming(input.threadId, "persistTokenCountingMaintenanceStatus", startedAt, {
      result,
      openThreadMs,
      status: input.status,
      issueCount: input.issues.length,
    });
    return snapshot.issues;
  }

  const updatedAt = (input.dependencies.now ?? (() => new Date()))().toISOString();
  stepStartedAt = Date.now();
  const writeResult = await input.dependencies.store.updateThreadMetadata({
    threadId: input.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    patch: {
      status: {
        ...snapshot.value.thread.status,
        tokenCounting: {
          status: input.status,
          updatedAt,
          sourceRevision: snapshot.value.thread.sourceRevision,
          issueCount: input.issues.length,
          issues: input.issues.map((issue) => createStewardIssue(issue)),
        },
      },
      updatedAt,
    },
  });
  writeMs = Date.now() - stepStartedAt;
  result = writeResult.ok ? "updated" : "writeFailed";
  logAsyncMaintenanceTiming(input.threadId, "persistTokenCountingMaintenanceStatus", startedAt, {
    result,
    openThreadMs,
    writeMs,
    status: input.status,
    issueCount: input.issues.length,
  });

  return writeResult.ok ? [] : writeResult.issues;
}

interface ThreadMaintenanceSnapshot {
  sourceRevision: number;
  debt: ThreadMaintenanceDebtRecord[];
}

function maintenanceStatusKey(mode: ThreadMaintenanceRunMode): "background" | "manualRepair" | "prepare" {
  switch (mode) {
    case "background":
      return "background";
    case "manual_repair":
      return "manualRepair";
    case "prepare":
      return "prepare";
  }
}

function isExpectedMaintenanceBacklogIssue(issue: StewardIssue): boolean {
  return (
    issue.code === "TOKEN_COUNT_BLOCKED" &&
    (
      issue.cause === "exact_token_count_repair_skipped" ||
      issue.message.includes("limit reached") ||
      issue.message.includes("intentionally skipped")
    )
  );
}

function isSmoothTurnReadyForMaintenance(turn: TurnRecord, messages: readonly MessageRecord[]): boolean {
  const materialized = materializeSmoothTurnFromState({ turn, messages });
  return (
    (materialized.status === "ready" || materialized.status === "degraded") &&
    typeof materialized.text === "string" &&
    materialized.text.length > 0
  );
}

function collectThreadMaintenanceDebt(input: {
  snapshotTurns: readonly TurnRecord[];
  snapshotMessages: readonly MessageRecord[];
  chunks: readonly ChunkState[];
  tokenCountModel?: string;
}): ThreadMaintenanceDebtRecord[] {
  const messagesById = new Map(input.snapshotMessages.map((message) => [message.messageId, message]));
  const debt: ThreadMaintenanceDebtRecord[] = [];

  for (const turn of sortTurnsInSourceOrder(input.snapshotTurns)) {
    if (turn.lifecycleStatus !== "closed") {
      continue;
    }

    const messages = sortMessagesInSourceOrder(
      turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (messages.length !== turn.messageIds.length) {
      debt.push({
        category: "turn_source_messages_missing",
        entityType: "turn",
        entityId: turn.turnId,
        detail: "canonical_messages_missing",
      });
      continue;
    }

    if (!isSmoothTurnReadyForMaintenance(turn, messages)) {
      debt.push({
        category: "smooth_turn",
        entityType: "turn",
        entityId: turn.turnId,
      });
    }

    const projection = turn.smooth?.lowerBandProjection;
    if (
      projection?.status !== "ready" ||
      !projection.text ||
      !projection.tokenCountMetadata ||
      projection.tokenCountMetadata.source !== "provider_input_count" ||
      projection.tokenCountMetadata.trustClass !== "exact"
    ) {
      debt.push({
        category: "turn_lower_band_projection",
        entityType: "turn",
        entityId: turn.turnId,
      });
    }

    const expectedRaw = resolveRawTurnTokenAccounting({
      turn,
      messages,
      policyMode: "prepare",
    }).record;
    if (
      !isOpenAIProviderInputCount({
        record: turn.rawTokenCountMetadata,
        expected: expectedRaw,
        model: input.tokenCountModel,
      })
    ) {
      debt.push({
        category: "raw_turn_token",
        entityType: "turn",
        entityId: turn.turnId,
      });
    }

    const turnWithSmoothText = withSmoothMaterializedText(turn, messages);
    const expectedSmooth = turnWithSmoothText?.smooth?.text
      ? resolveSmoothTurnTokenAccounting({
          turn,
          messages,
          policyMode: "prepare",
        })?.record
      : undefined;
    if (
      expectedSmooth &&
      !isOpenAIProviderInputCount({
        record: turnWithSmoothText?.smooth?.tokenCountMetadata,
        expected: expectedSmooth,
        model: input.tokenCountModel,
      })
    ) {
      debt.push({
        category: "smooth_turn_token",
        entityType: "turn",
        entityId: turn.turnId,
      });
    }
  }

  for (const chunk of input.chunks) {
    if (chunk.lifecycleStatus !== "closed") {
      continue;
    }

    if (isLegacyPlaceholderChunkState(chunk)) {
      debt.push({
        category: "chunk_state",
        entityType: "chunk",
        entityId: chunk.chunkId,
        detail: "legacy_placeholder_state",
      });
      continue;
    }

    if (chunk.conversationTranscript?.status !== "ready") {
      debt.push({
        category: "chunk_state",
        entityType: "chunk",
        entityId: chunk.chunkId,
        detail: chunk.conversationTranscript?.status ?? "missing_transcript",
      });
    }

    if (chunk.lowerBand?.detailed?.status !== "ready") {
      debt.push({
        category: "detailed_chunk_artifact",
        entityType: "chunk",
        entityId: chunk.chunkId,
      });
    }

    if (chunk.lowerBand?.brief?.status !== "ready") {
      debt.push({
        category: "brief_chunk_artifact",
        entityType: "chunk",
        entityId: chunk.chunkId,
      });
    }

    const expectedSmooth = resolveChunkSmoothTokenAccounting({
      chunk,
      policyMode: "prepare",
    })?.record;
    if (
      expectedSmooth &&
      !isOpenAIProviderInputCount({
        record: chunk.smoothTokenCountMetadata,
        expected: expectedSmooth,
        model: input.tokenCountModel,
      })
    ) {
      debt.push({
        category: "chunk_smooth_token",
        entityType: "chunk",
        entityId: chunk.chunkId,
      });
    }

    const expectedDetailed = resolveChunkSemanticArtifactAccounting({
      chunk,
      bandType: "detailed",
      policyMode: "prepare",
    })?.record;
    if (
      expectedDetailed &&
      !isOpenAIProviderInputCount({
        record: chunk.lowerBand?.detailed?.tokenCountMetadata,
        expected: expectedDetailed,
        model: input.tokenCountModel,
      })
    ) {
      debt.push({
        category: "detailed_chunk_token",
        entityType: "chunk",
        entityId: chunk.chunkId,
      });
    }

    const expectedBrief = resolveChunkSemanticArtifactAccounting({
      chunk,
      bandType: "brief",
      policyMode: "prepare",
    })?.record;
    if (
      expectedBrief &&
      !isOpenAIProviderInputCount({
        record: chunk.lowerBand?.brief?.tokenCountMetadata,
        expected: expectedBrief,
        model: input.tokenCountModel,
      })
    ) {
      debt.push({
        category: "brief_chunk_token",
        entityType: "chunk",
        entityId: chunk.chunkId,
      });
    }
  }

  return debt;
}

async function readThreadMaintenanceSnapshot(
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
): Promise<StewardResult<ThreadMaintenanceSnapshot>> {
  const snapshot = await dependencies.store.openThread(threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  const chunks = await dependencies.store.readChunks(threadId);
  if (!chunks.ok) {
    return chunks;
  }

  return ok({
    sourceRevision: snapshot.value.thread.sourceRevision,
    debt: collectThreadMaintenanceDebt({
      snapshotTurns: snapshot.value.turns,
      snapshotMessages: snapshot.value.messages,
      chunks: chunks.value,
      tokenCountModel: dependencies.tokenCountModel,
    }),
  });
}

function maintenanceDebtKey(debt: ThreadMaintenanceDebtRecord): string {
  return `${debt.entityType}:${debt.entityId ?? ""}:${debt.category}:${debt.detail ?? ""}`;
}

function countResolvedMaintenanceDebt(
  initial: ThreadMaintenanceSnapshot | undefined,
  finalSnapshot: ThreadMaintenanceSnapshot,
): number {
  if (!initial) {
    return 0;
  }

  const remaining = new Set(finalSnapshot.debt.map(maintenanceDebtKey));
  return initial.debt.filter((debt) => !remaining.has(maintenanceDebtKey(debt))).length;
}

export async function persistThreadMaintenanceRunStatus(input: {
  threadId: string;
  runMode: ThreadMaintenanceRunMode;
  scope: "bounded" | "full";
  fixedCount: number;
  skippedCount: number;
  failedCount: number;
  blockers: readonly StewardIssue[];
  dependencies: AsyncThreadRunDependencies;
  maintenanceSnapshot?: ThreadMaintenanceSnapshot;
}): Promise<StewardIssue[]> {
  const snapshot = input.maintenanceSnapshot
    ? ok(input.maintenanceSnapshot)
    : await readThreadMaintenanceSnapshot(input.threadId, input.dependencies);
  if (!snapshot.ok) {
    return snapshot.issues;
  }

  const updatedAt = (input.dependencies.now ?? (() => new Date()))().toISOString();
  const hardFailureCount = input.blockers.filter((issue) => !isExpectedMaintenanceBacklogIssue(issue)).length;
  const hasFailureBlocker = hardFailureCount > 0;
  const status =
    hasFailureBlocker
      ? "failed"
      : snapshot.value.debt.length > 0
        ? "repair_needed"
        : "ready";
  const run: ThreadMaintenanceRunRecord = {
    mode: input.runMode,
    scope: input.scope,
    status,
    updatedAt,
    sourceRevision: snapshot.value.sourceRevision,
    fixedCount: input.fixedCount,
    skippedCount: input.skippedCount,
    failedCount: hardFailureCount,
    remainingDebtCount: snapshot.value.debt.length,
    blockers: input.blockers.map((issue) => createStewardIssue(issue)),
    remainingDebt: snapshot.value.debt,
  };

  if (input.dependencies.store.persistMaintenanceStatus) {
    const persisted = await input.dependencies.store.persistMaintenanceStatus({
      threadId: input.threadId,
      expectedSourceRevision: snapshot.value.sourceRevision,
      runMode: input.runMode,
      run,
    });
    return persisted.ok ? [] : persisted.issues;
  }

  const threadSnapshot = await input.dependencies.store.openThread(input.threadId);
  if (!threadSnapshot.ok) {
    return threadSnapshot.issues;
  }

  const maintenance = {
    ...(threadSnapshot.value.thread.status.maintenance ?? {}),
    [maintenanceStatusKey(input.runMode)]: run,
  };
  const writeResult = await input.dependencies.store.updateThreadMetadata({
    threadId: input.threadId,
    expectedSourceRevision: threadSnapshot.value.thread.sourceRevision,
    patch: {
      status: {
        ...threadSnapshot.value.thread.status,
        maintenance,
      },
      updatedAt,
    },
  });

  return writeResult.ok ? [] : writeResult.issues;
}

export async function maintainAsyncThread(
  input: MaintainAsyncThreadInput,
  dependencies?: AsyncThreadRunDependencies,
): Promise<MaintainAsyncThreadResult> {
  const startedAt = Date.now();
  let artifactsMs = 0;
  let degradedRawMs = 0;
  let exactCountsMs = 0;
  let statusMs = 0;
  if (!dependencies?.store) {
    const blockers = [
      createStewardIssue({
        code: "STORE_UNAVAILABLE",
        message: "maintainAsyncThread requires a thread store dependency.",
        threadId: input.threadId,
      }),
    ];

    logAsyncMaintenanceTiming(input.threadId, "maintainAsyncThread", startedAt, {
      result: "missingStore",
    });
    return {
      threadId: input.threadId,
      artifactsReady: false,
      tokenCountsReady: false,
      blockers,
    };
  }

  const initialMaintenance = await readThreadMaintenanceSnapshot(input.threadId, dependencies);
  let stepStartedAt = Date.now();
  const artifactIssues = await repairMissingArtifacts(
    {
      threadId: input.threadId,
    },
    dependencies,
    {
      limits: dependencies.artifactRepairLimits ?? DEFAULT_BACKGROUND_ARTIFACT_REPAIR_LIMITS,
    },
  );
  artifactsMs = Date.now() - stepStartedAt;
  stepStartedAt = Date.now();
  const degradedRawIssues = await persistDegradedRawTokenCountsForClosedTurns(input.threadId, dependencies);
  degradedRawMs = Date.now() - stepStartedAt;
  stepStartedAt = Date.now();
  const tokenCountIssues =
    dependencies.exactTokenCountRepairEnabled === false
      ? [
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message:
              "OpenAI materialized token count repair was intentionally skipped during PI async background maintenance; exact materialized counts remain repair-needed for smart compact prepare.",
            cause: "exact_token_count_repair_skipped",
          }),
        ]
      : await repairOpenAITokenCounts(input.threadId, dependencies, {
          includeOpenRawTurns: false,
          missingCounterMessage:
            "OpenAI materialized token counter is not configured; async maintenance left exact materialized token counts repair-needed for smart compact prepare.",
          failureMessage:
            "OpenAI materialized token counting failed during async maintenance; deterministic artifacts were left with repair-needed heuristic counts for smart compact prepare.",
          limits: dependencies.artifactRepairLimits ?? DEFAULT_BACKGROUND_ARTIFACT_REPAIR_LIMITS,
        });
  exactCountsMs = Date.now() - stepStartedAt;
  const tokenCountingIssues = [...degradedRawIssues, ...tokenCountIssues];
  stepStartedAt = Date.now();
  const persistedStatusIssues = await persistTokenCountingMaintenanceStatus({
    threadId: input.threadId,
    dependencies,
    status: tokenCountingIssues.length === 0 ? "ready" : "repair_needed",
    issues: tokenCountingIssues,
  });
  statusMs = Date.now() - stepStartedAt;
  const maintenanceBlockers = [...artifactIssues, ...tokenCountingIssues, ...persistedStatusIssues].map((issue) => createStewardIssue(issue));
  const finalMaintenance = await readThreadMaintenanceSnapshot(input.threadId, dependencies);
  const persistedMaintenanceIssues = finalMaintenance.ok
    ? await persistThreadMaintenanceRunStatus({
        threadId: input.threadId,
        runMode: "background",
        scope: "bounded",
        fixedCount: countResolvedMaintenanceDebt(
          initialMaintenance.ok ? initialMaintenance.value : undefined,
          finalMaintenance.value,
        ),
        skippedCount: finalMaintenance.value.debt.length,
        failedCount: maintenanceBlockers.length,
        blockers: maintenanceBlockers,
        dependencies,
        maintenanceSnapshot: finalMaintenance.value,
      })
    : finalMaintenance.issues;
  const blockers = [...maintenanceBlockers, ...persistedMaintenanceIssues].map((issue) => createStewardIssue(issue));
  logAsyncMaintenanceTiming(input.threadId, "maintainAsyncThread", startedAt, {
    result: "ok",
    artifactsMs,
    degradedRawMs,
    exactCountsMs,
    statusMs,
    artifactIssues: artifactIssues.length,
    degradedRawIssues: degradedRawIssues.length,
    tokenCountIssues: tokenCountIssues.length,
    persistedStatusIssues: persistedStatusIssues.length,
    persistedMaintenanceIssues: persistedMaintenanceIssues.length,
    blockers: blockers.length,
  });

  return {
    threadId: input.threadId,
    artifactsReady: artifactIssues.length === 0,
    tokenCountsReady: tokenCountingIssues.length === 0 && persistedStatusIssues.length === 0,
    blockers,
  };
}

export async function prepareAsyncThread(
  input: PrepareAsyncThreadInput,
  dependencies?: AsyncThreadRunDependencies,
): Promise<PrepareAsyncThreadResult> {
  if (!dependencies?.store) {
    return blockedReadiness(input.threadId, [
      {
        code: "STORE_UNAVAILABLE",
        message: "prepareAsyncThread requires a thread store dependency.",
        threadId: input.threadId,
      },
    ]);
  }

  if (input.mode === "strict") {
    return readReadiness(input, dependencies);
  }

  const initialMaintenance = await readThreadMaintenanceSnapshot(input.threadId, dependencies);
  if (!initialMaintenance.ok) {
    return blockedReadiness(input.threadId, initialMaintenance.issues);
  }

  const initialReadiness = await readReadiness(input, dependencies);
  if (initialReadiness.blockers.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT")) {
    return initialReadiness;
  }

  const repairIssues = await repairMissingArtifacts(
    {
      threadId: input.threadId,
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: input.requestedBandPercentages,
    },
    dependencies,
    {
      warnOnSmoothCatchUp: true,
    },
  );
  if (repairIssues.length > 0) {
    await persistThreadMaintenanceRunStatus({
      threadId: input.threadId,
      runMode: "prepare",
      scope: "full",
      fixedCount: 0,
      skippedCount: initialMaintenance.value.debt.length,
      failedCount: repairIssues.length,
      blockers: repairIssues,
      dependencies,
    });
    return blockedReadiness(input.threadId, repairIssues);
  }
  const tokenCountRepairIssues = await repairOpenAITokenCounts(input.threadId, dependencies);
  if (tokenCountRepairIssues.length > 0) {
    await persistThreadMaintenanceRunStatus({
      threadId: input.threadId,
      runMode: "prepare",
      scope: "full",
      fixedCount: 0,
      skippedCount: initialMaintenance.value.debt.length,
      failedCount: tokenCountRepairIssues.length,
      blockers: tokenCountRepairIssues,
      dependencies,
    });
    return blockedReadiness(input.threadId, tokenCountRepairIssues);
  }
  const finalReadiness = await readReadiness(input, dependencies);
  const finalMaintenance = await readThreadMaintenanceSnapshot(input.threadId, dependencies);
  const finalDebtCount = finalMaintenance.ok ? finalMaintenance.value.debt.length : initialMaintenance.value.debt.length;
  await persistThreadMaintenanceRunStatus({
    threadId: input.threadId,
    runMode: "prepare",
    scope: "full",
    fixedCount: Math.max(0, initialMaintenance.value.debt.length - finalDebtCount),
    skippedCount: finalDebtCount,
    failedCount: finalReadiness.blockers.length,
    blockers: finalReadiness.blockers,
    dependencies,
  });

  return {
    ...finalReadiness,
    blockers: finalReadiness.blockers.map((issue) =>
      issue.code === "SMOOTH_MISSING" || issue.code === "SMOOTH_INVALID"
        ? createStewardIssue({
            ...issue,
            message: `Smooth catch-up failed during compact preparation: ${issue.message}`,
          })
        : issue),
  };
}
