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
  resolveChunkPlaceholderTokenAccounting,
  resolveChunkSmoothTokenAccounting,
  resolveRawTurnTokenAccounting,
  resolveSmoothTurnTokenAccounting,
} from "../../../thread-view/services/thread-view-builder.js";
import type { ThreadStore } from "../../store/thread-store.js";
import type { MessageRecord, TurnRecord } from "../../domain/records.js";
import { createStewardIssue, StewardResultError, type StewardIssue } from "../../domain/errors.js";
import type { ChunkState } from "../domain/chunk-state.js";
import { ensurePlaceholderArtifacts } from "./placeholder-artifact-service.js";
import { ensureSmoothTurn, materializeSmoothTurnFromState } from "./smooth-turn-service.js";
import { updateChunkState } from "./chunk-service.js";
import {
  countRawTurnMaterialized,
  OpenAIInputTokenCounter,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface AsyncThreadRunDependencies {
  store: ThreadStore;
  openAIInputTokenCounter?: Pick<
    OpenAIInputTokenCounter,
    | "countRawTurnMaterialized"
    | "countSmoothTurnMaterialized"
    | "countChunkSmoothMaterialized"
    | "countDetailedChunkMaterialized"
    | "countBriefChunkMaterialized"
  >;
  tokenCountModel?: string;
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

const BAND_ALLOCATION_KEYS = ["fullFidelity", "smooth", "detailed", "brief"] as const;

function blockedReadiness(threadId: string, issues: readonly StewardIssue[]): PrepareAsyncThreadResult {
  return {
    threadId,
    smoothReady: false,
    chunksReady: false,
    placeholdersReady: false,
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
): OrderedChunkCandidate[] {
  const candidates: OrderedChunkCandidate[] = [];

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

    candidates.push({
      chunk,
      newestTurnOrder,
    });
  }

  return candidates.sort((left, right) => {
    if (left.newestTurnOrder !== right.newestTurnOrder) {
      return right.newestTurnOrder - left.newestTurnOrder;
    }

    return right.chunk.chunkId.localeCompare(left.chunk.chunkId);
  });
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
    const placeholder = bandType === "detailed"
      ? candidate.chunk.placeholders?.detailed
      : candidate.chunk.placeholders?.brief;
    const accounting = resolveChunkPlaceholderTokenAccounting({
      chunk: candidate.chunk,
      bandType,
      policyMode: "prepare",
    });

    if (selectedChunkIds.length === 0) {
      if (!placeholder?.text || !accounting) {
        break;
      }

      selectedChunkIds.push(candidate.chunk.chunkId);
      consumedTokenCount += accounting.count;
      consumedCandidateCount += 1;
      continue;
    }

    if (!placeholder?.text || !accounting) {
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
    typeof smooth?.tokenCountMetadata?.count === "number" &&
    smooth.sourceRevision === turn.sourceRevision
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

function areChunkPlaceholdersReady(chunk: ChunkState): boolean {
  if (chunk.lifecycleStatus !== "closed" || !chunk.smoothText || typeof chunk.smoothTokenCountMetadata?.count !== "number") {
    return false;
  }

  const detailed = chunk.placeholders?.detailed;
  const brief = chunk.placeholders?.brief;

  return (
    detailed?.status === "ready" &&
    typeof detailed.text === "string" &&
    detailed.text.length > 0 &&
    typeof detailed.tokenCountMetadata?.count === "number" &&
    brief?.status === "ready" &&
    typeof brief.text === "string" &&
    brief.text.length > 0 &&
    typeof brief.tokenCountMetadata?.count === "number"
  );
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

  const orderedChunkCandidates = buildOrderedChunkCandidates(
    input.chunks,
    turnsById,
    lowerBandBoundaryTurnOrder,
  );
  const detailedSelection = selectLowerBandChunkIds(
    orderedChunkCandidates,
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
  };
}

function buildReadinessBlockers(input: {
  threadId: string;
  tokenCountModel?: string;
  requiredPlaceholderBands?: {
    detailed: boolean;
    brief: boolean;
  };
  selectionPlan?: SelectionAwareReadinessPlan;
  turns: ReadonlyArray<TurnRecord>;
  messages: ReadonlyArray<MessageRecord>;
  chunks: ReadonlyArray<ChunkState>;
}): PrepareAsyncThreadResult {
  const requiredPlaceholderBands = input.requiredPlaceholderBands ?? {
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
  const blockers = input.turns
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
    );

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
  }

  const turnIds = new Set(input.turns.map((turn) => turn.turnId));
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

    const detailed = chunk.placeholders?.detailed;
    const brief = chunk.placeholders?.brief;
    const missingDetailed =
      (requiredDetailedChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredPlaceholderBands.detailed &&
      (detailed?.status !== "ready" || !detailed.text || typeof detailed.tokenCountMetadata?.count !== "number");
    const missingBrief =
      (requiredBriefChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredPlaceholderBands.brief &&
      (brief?.status !== "ready" || !brief.text || typeof brief.tokenCountMetadata?.count !== "number");

    if (missingDetailed || missingBrief) {
      const requiredBands = [
        requiredPlaceholderBands.detailed ? "detailed" : undefined,
        requiredPlaceholderBands.brief ? "brief" : undefined,
      ].filter((value): value is "detailed" | "brief" => value !== undefined);
      const requiredBandLabel =
        requiredBands.length === 2
          ? "detailed/brief"
          : requiredBands[0] ?? "detailed/brief";
      blockers.push(
        createAsyncThreadBlocker({
          code: "CHUNK_PLACEHOLDER_MISSING",
          message: `Chunk ${chunk.chunkId} is missing deterministic ${requiredBandLabel} placeholder output required for lower-band rebuild.`,
          threadId: input.threadId,
        }),
      );
    }

    if (requiredDetailedChunkIds?.has(chunk.chunkId)) {
      const expected = resolveChunkPlaceholderTokenAccounting({
        chunk,
        bandType: "detailed",
        policyMode: "prepare",
      })?.record;
      if (
        !isOpenAIProviderInputCount({
          record: detailed?.tokenCountMetadata,
          expected,
          model: input.tokenCountModel,
        })
      ) {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Chunk ${chunk.chunkId} is missing current OpenAI detailed placeholder token count required for strict smart compact allocation.`,
          }),
        );
      }
    }

    if (requiredBriefChunkIds?.has(chunk.chunkId)) {
      const expected = resolveChunkPlaceholderTokenAccounting({
        chunk,
        bandType: "brief",
        policyMode: "prepare",
      })?.record;
      if (
        !isOpenAIProviderInputCount({
          record: brief?.tokenCountMetadata,
          expected,
          model: input.tokenCountModel,
        })
      ) {
        blockers.push(
          tokenCountBlockedIssue({
            threadId: input.threadId,
            message: `Chunk ${chunk.chunkId} is missing current OpenAI brief placeholder token count required for strict smart compact allocation.`,
          }),
        );
      }
    }
  }

  const smoothReady = !blockers.some(
    (issue) => issue.code === "SMOOTH_MISSING" || issue.code === "SMOOTH_INVALID",
  );
  const chunksReady = !blockers.some(
    (issue) => issue.code === "CHUNK_STATE_INVALID" || issue.code === "THREAD_VIEW_STATE_CONFLICT",
  );
  const placeholdersReady = !blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING");

  return {
    threadId: input.threadId,
    smoothReady,
    chunksReady,
    placeholdersReady,
    blockers,
  };
}

async function readReadiness(
  input: {
    threadId: string;
    requestedLowerBound?: number;
    requestedBandPercentages?: ThreadViewBandPercentages;
    requiredPlaceholderBands?: {
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
    tokenCountModel: dependencies.tokenCountModel,
    requiredPlaceholderBands: input.requiredPlaceholderBands,
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
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
): Promise<StewardIssue[]> {
  const startedAt = Date.now();
  let openThreadMs = 0;
  let smoothMs = 0;
  let updateChunkMs = 0;
  let readChunksMs = 0;
  let placeholderMs = 0;
  let closedTurns = 0;
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
  for (const turn of threadSnapshot.value.turns) {
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

    try {
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

  try {
    stepStartedAt = Date.now();
    await updateChunkState(
      {
        threadId,
      },
      {
        store: dependencies.store,
        now: dependencies.now,
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
      updateChunkMs,
      closedTurns,
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
      updateChunkMs,
      readChunksMs,
      closedTurns,
    });
    return chunksSnapshot.issues;
  }

  stepStartedAt = Date.now();
  for (const chunk of chunksSnapshot.value) {
    if (chunk.lifecycleStatus !== "closed") {
      continue;
    }

    closedChunks += 1;
    if (areChunkPlaceholdersReady(chunk)) {
      continue;
    }

    try {
      await ensurePlaceholderArtifacts(
        {
          threadId,
          chunkId: chunk.chunkId,
        },
        {
          store: dependencies.store,
          now: dependencies.now,
        },
      );
    } catch (error) {
      placeholderMs += Date.now() - stepStartedAt;
      result = "placeholderFailed";
      logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
        result,
        openThreadMs,
        smoothMs,
        updateChunkMs,
        readChunksMs,
        placeholderMs,
        closedTurns,
        closedChunks,
      });
      return issuesFromUnknownError(error, threadId);
    }
  }
  placeholderMs = Date.now() - stepStartedAt;

  result = "ok";
  logAsyncMaintenanceTiming(threadId, "repairMissingArtifacts", startedAt, {
    result,
    openThreadMs,
    smoothMs,
    updateChunkMs,
    readChunksMs,
    placeholderMs,
    closedTurns,
    closedChunks,
  });
  return [];
}

async function repairOpenAITokenCounts(
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
  options: {
    includeOpenRawTurns: boolean;
    failureMessage: string;
    missingCounterMessage: string;
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
  let chunksVisited = 0;
  let chunkSmoothCounts = 0;
  let detailedCounts = 0;
  let briefCounts = 0;
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

  try {
    stepStartedAt = Date.now();
    for (const turn of nextTurns) {
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
      if (
        !isOpenAIProviderInputCount({
          record: turn.rawTokenCountMetadata,
          expected: expectedRaw,
          model: dependencies.tokenCountModel,
        })
      ) {
        rawCounts += 1;
        turn.rawTokenCountMetadata = await counter.countRawTurnMaterialized({
          turn,
          messages,
          model: dependencies.tokenCountModel,
          now: dependencies.now,
        });
        turnsChanged = true;
      }

      if (turn.lifecycleStatus !== "closed") {
        continue;
      }

      const turnWithSmoothText = withSmoothMaterializedText(turn, messages);
      if (!turnWithSmoothText.smooth?.text) {
        continue;
      }

      const expectedSmooth = resolveSmoothTurnTokenAccounting({
        turn,
        messages,
        policyMode: "prepare",
      })?.record;
      if (
        !isOpenAIProviderInputCount({
          record: turnWithSmoothText.smooth.tokenCountMetadata,
          expected: expectedSmooth,
          model: dependencies.tokenCountModel,
        })
      ) {
        smoothCounts += 1;
        turn.smooth = {
          ...turn.smooth,
          tokenCountMetadata: await counter.countSmoothTurnMaterialized(turnWithSmoothText, {
            model: dependencies.tokenCountModel,
            now: dependencies.now,
          }),
        };
        turnsChanged = true;
      }
    }
    turnLoopMs = Date.now() - stepStartedAt;
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
    const writeTurnsResult = await dependencies.store.writeTurns({
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
      if (
        !isOpenAIProviderInputCount({
          record: chunk.smoothTokenCountMetadata,
          expected: expectedSmooth,
          model: dependencies.tokenCountModel,
        })
      ) {
        chunkSmoothCounts += 1;
        chunk.smoothTokenCountMetadata = await counter.countChunkSmoothMaterialized(chunk, {
          model: dependencies.tokenCountModel,
          now: dependencies.now,
        });
        chunksChanged = true;
      }

      if (chunk.placeholders?.detailed?.text) {
        const expectedDetailed = resolveChunkPlaceholderTokenAccounting({
          chunk,
          bandType: "detailed",
          policyMode: "prepare",
        })?.record;
        if (
          !isOpenAIProviderInputCount({
            record: chunk.placeholders.detailed.tokenCountMetadata,
            expected: expectedDetailed,
            model: dependencies.tokenCountModel,
          })
        ) {
          detailedCounts += 1;
          chunk.placeholders.detailed = {
            ...chunk.placeholders.detailed,
            tokenCountMetadata: await counter.countDetailedChunkMaterialized(chunk, {
              model: dependencies.tokenCountModel,
              now: dependencies.now,
            }),
          };
          chunksChanged = true;
        }
      }

      if (chunk.placeholders?.brief?.text) {
        const expectedBrief = resolveChunkPlaceholderTokenAccounting({
          chunk,
          bandType: "brief",
          policyMode: "prepare",
        })?.record;
        if (
          !isOpenAIProviderInputCount({
            record: chunk.placeholders.brief.tokenCountMetadata,
            expected: expectedBrief,
            model: dependencies.tokenCountModel,
          })
        ) {
          briefCounts += 1;
          chunk.placeholders.brief = {
            ...chunk.placeholders.brief,
            tokenCountMetadata: await counter.countBriefChunkMaterialized(chunk, {
              model: dependencies.tokenCountModel,
              now: dependencies.now,
            }),
          };
          chunksChanged = true;
        }
      }
    }
    chunkLoopMs = Date.now() - stepStartedAt;
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
    return [];
  }

  stepStartedAt = Date.now();
  const writeChunksResult = await dependencies.store.writeChunks({
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

  return writeChunksResult.ok ? [] : writeChunksResult.issues;
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
  let stepStartedAt = Date.now();
  const snapshot = await dependencies.store.openThread(threadId);
  openThreadMs = Date.now() - stepStartedAt;
  if (!snapshot.ok) {
    result = "openThreadFailed";
    logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
      result,
      openThreadMs,
    });
    return snapshot.issues;
  }

  const messagesById = new Map(snapshot.value.messages.map((message) => [message.messageId, message]));
  const nextTurns = structuredClone(snapshot.value.turns);
  let turnsChanged = false;

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
  }
  loopMs = Date.now() - stepStartedAt;

  if (!turnsChanged) {
    result = "unchanged";
    logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
      result,
      openThreadMs,
      loopMs,
      turnsVisited,
      changedTurns,
    });
    return [];
  }

  stepStartedAt = Date.now();
  const writeTurnsResult = await dependencies.store.writeTurns({
    threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    turns: nextTurns,
    turnState: snapshot.value.thread.status.turnState,
  });
  writeMs = Date.now() - stepStartedAt;
  result = writeTurnsResult.ok ? "updated" : "writeFailed";
  logAsyncMaintenanceTiming(threadId, "persistDegradedRawTokenCountsForClosedTurns", startedAt, {
    result,
    openThreadMs,
    loopMs,
    writeMs,
    turnsVisited,
    changedTurns,
  });

  return writeTurnsResult.ok ? [] : writeTurnsResult.issues;
}

async function persistTokenCountingMaintenanceStatus(input: {
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

  let stepStartedAt = Date.now();
  const artifactIssues = await repairMissingArtifacts(input.threadId, dependencies);
  artifactsMs = Date.now() - stepStartedAt;
  stepStartedAt = Date.now();
  const degradedRawIssues = await persistDegradedRawTokenCountsForClosedTurns(input.threadId, dependencies);
  degradedRawMs = Date.now() - stepStartedAt;
  stepStartedAt = Date.now();
  const tokenCountIssues = await repairOpenAITokenCounts(input.threadId, dependencies, {
    includeOpenRawTurns: false,
    missingCounterMessage:
      "OpenAI materialized token counter is not configured; async maintenance left exact materialized token counts repair-needed for smart compact prepare.",
    failureMessage:
      "OpenAI materialized token counting failed during async maintenance; deterministic artifacts were left with repair-needed heuristic counts for smart compact prepare.",
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
  const blockers = [...artifactIssues, ...tokenCountingIssues, ...persistedStatusIssues].map((issue) => createStewardIssue(issue));
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

  const initialReadiness = await readReadiness(input, dependencies);
  if (initialReadiness.blockers.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT")) {
    return initialReadiness;
  }

  const repairIssues = await repairMissingArtifacts(input.threadId, dependencies);
  if (repairIssues.length > 0) {
    return blockedReadiness(input.threadId, repairIssues);
  }
  const tokenCountRepairIssues = await repairOpenAITokenCounts(input.threadId, dependencies);
  if (tokenCountRepairIssues.length > 0) {
    return blockedReadiness(input.threadId, tokenCountRepairIssues);
  }
  return readReadiness(input, dependencies);
}
