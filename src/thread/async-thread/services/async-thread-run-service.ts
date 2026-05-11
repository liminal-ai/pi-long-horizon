import {
  createAsyncThreadBlocker,
  type PrepareAsyncThreadInput,
  type PrepareAsyncThreadResult,
} from "../domain/async-thread-status.js";
import type { ThreadViewBandPercentages } from "../../../thread-view/domain/pi-thread-view-file.js";
import type { ThreadStore } from "../../store/thread-store.js";
import type { MessageRecord, TurnRecord } from "../../domain/records.js";
import { createStewardIssue, StewardResultError, type StewardIssue } from "../../domain/errors.js";
import type { ChunkState } from "../domain/chunk-state.js";
import { getPlaceholderArtifactMarker } from "../domain/placeholder-artifact-state.js";
import { DEFAULT_PLACEHOLDER_BUILD_SETTINGS } from "../domain/settings.js";
import {
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
} from "../domain/smooth-turn-state.js";
import { ensurePlaceholderArtifacts } from "./placeholder-artifact-service.js";
import { ensureSmoothTurn } from "./smooth-turn-service.js";
import { buildSmoothTurnText } from "./smooth-turn-format.js";
import { updateChunkState } from "./chunk-service.js";

export interface AsyncThreadRunDependencies {
  store: ThreadStore;
  now?: () => Date;
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

function stringifyPartContent(content: string | Record<string, unknown>): string {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content.text === "string" && content.text.trim().length > 0) {
    return content.text;
  }

  return JSON.stringify(content);
}

function estimateRawMessageTokenCount(message: MessageRecord): number {
  const parts = [...message.parts]
    .sort((left, right) => left.partOrder - right.partOrder)
    .flatMap((part) => [`part:${part.partType}`, stringifyPartContent(part.content)]);
  const metadata = [
    `actor:${message.actorType}`,
    `kind:${message.messageKind}`,
    message.targetMetadata?.piRole ? `piRole:${message.targetMetadata.piRole}` : undefined,
  ].filter((value): value is string => value !== undefined);

  return estimateDeterministicTokenCount([...metadata, ...parts].join(" "));
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

function previewPlaceholderTokenCount(
  kind: "detailed" | "brief",
  smoothText: string,
): number {
  const normalizedText = normalizeDeterministicText(smoothText);
  const smoothTokens = normalizedText.length === 0 ? [] : normalizedText.split(" ");
  const marker = getPlaceholderArtifactMarker(kind);
  const markerTokenCount = estimateDeterministicTokenCount(marker);
  const ratio =
    kind === "detailed"
      ? DEFAULT_PLACEHOLDER_BUILD_SETTINGS.detailedRatio
      : DEFAULT_PLACEHOLDER_BUILD_SETTINGS.briefRatio;
  const targetArtifactTokenCount = Math.max(1, Math.round(smoothTokens.length * ratio));
  const preservedTokenCount =
    smoothTokens.length === 0
      ? 0
      : Math.min(smoothTokens.length, Math.max(1, targetArtifactTokenCount - markerTokenCount));
  const preservedText = smoothTokens.slice(0, preservedTokenCount).join(" ");
  const text = preservedText.length > 0 ? `${preservedText}\n\n${marker}` : marker;

  return estimateDeterministicTokenCount(text);
}

function readPlaceholderTokenCount(
  chunk: ChunkState,
  bandType: "detailed" | "brief",
): number | undefined {
  const placeholder = bandType === "detailed" ? chunk.placeholders?.detailed : chunk.placeholders?.brief;
  if (
    placeholder?.status === "ready" &&
    typeof placeholder.text === "string" &&
    typeof placeholder.tokenCount === "number"
  ) {
    return placeholder.tokenCount;
  }

  const smoothText = normalizeDeterministicText(chunk.smoothText ?? "");
  if (smoothText.length === 0) {
    return undefined;
  }

  return previewPlaceholderTokenCount(bandType, smoothText);
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
    const tokenCount = readPlaceholderTokenCount(candidate.chunk, bandType);

    if (selectedChunkIds.length === 0) {
      selectedChunkIds.push(candidate.chunk.chunkId);
      consumedTokenCount += tokenCount ?? 0;
      consumedCandidateCount += 1;
      continue;
    }

    if (tokenCount === undefined || consumedTokenCount + tokenCount > budget) {
      break;
    }

    selectedChunkIds.push(candidate.chunk.chunkId);
    consumedTokenCount += tokenCount;
    consumedCandidateCount += 1;
  }

  return {
    selectedChunkIds,
    remainingCandidates: candidates.slice(consumedCandidateCount),
  };
}

function isSmoothTurnReady(turn: {
  lifecycleStatus: string;
  sourceRevision: number;
  smooth?: {
    status?: string;
    text?: string;
    tokenCount?: number;
    sourceRevision?: number;
  };
}): boolean {
  if (turn.lifecycleStatus !== "closed") {
    return true;
  }

  const smooth = turn.smooth;

  return (
    (smooth?.status === undefined || smooth?.status === "ready") &&
    typeof smooth?.text === "string" &&
    typeof smooth?.tokenCount === "number" &&
    smooth.sourceRevision === turn.sourceRevision
  );
}

function resolveSmoothTokenCount(
  turn: TurnRecord,
  messagesById: ReadonlyMap<string, MessageRecord>,
): number {
  if (isSmoothTurnReady(turn)) {
    return turn.smooth?.tokenCount ?? 0;
  }

  if (turn.lifecycleStatus !== "closed") {
    return 0;
  }

  const messages = sortMessagesInSourceOrder(
    turn.messageIds
      .map((messageId) => messagesById.get(messageId))
      .filter((message): message is MessageRecord => message !== undefined),
  );
  if (messages.length !== turn.messageIds.length) {
    return 0;
  }

  return buildSmoothTurnText(messages).tokenCount;
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
    .map((turn) => ({
      turn,
      rawTokenCount: sortMessagesInSourceOrder(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      ).reduce((total, message) => total + estimateRawMessageTokenCount(message), 0),
      smoothTokenCount: resolveSmoothTokenCount(turn, messagesById),
    }))
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
    .filter((turn) => turn.lifecycleStatus === "closed" && !isSmoothTurnReady(turn))
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
      chunk.sourceTurnIds.length === 0 ||
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
      chunk.smoothTokenCount <= 0
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

    const detailed = chunk.placeholders?.detailed;
    const brief = chunk.placeholders?.brief;
    const missingDetailed =
      (requiredDetailedChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredPlaceholderBands.detailed &&
      (detailed?.status !== "ready" || !detailed.text || typeof detailed.tokenCount !== "number");
    const missingBrief =
      (requiredBriefChunkIds?.has(chunk.chunkId) ?? true) &&
      requiredPlaceholderBands.brief &&
      (brief?.status !== "ready" || !brief.text || typeof brief.tokenCount !== "number");

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
  const threadSnapshot = await dependencies.store.openThread(threadId);
  if (!threadSnapshot.ok) {
    return threadSnapshot.issues;
  }

  for (const turn of threadSnapshot.value.turns) {
    if (turn.lifecycleStatus !== "closed") {
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
      return issuesFromUnknownError(error, threadId);
    }
  }

  try {
    await updateChunkState(
      {
        threadId,
      },
      {
        store: dependencies.store,
        now: dependencies.now,
      },
    );
  } catch (error) {
    return issuesFromUnknownError(error, threadId);
  }

  const chunksSnapshot = await dependencies.store.readChunks(threadId);
  if (!chunksSnapshot.ok) {
    return chunksSnapshot.issues;
  }

  for (const chunk of chunksSnapshot.value) {
    if (chunk.lifecycleStatus !== "closed") {
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
      return issuesFromUnknownError(error, threadId);
    }
  }

  return [];
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

  const initialReadiness = await readReadiness(input, dependencies);
  if (input.mode === "strict" || initialReadiness.blockers.length === 0) {
    return initialReadiness;
  }

  const repairIssues = await repairMissingArtifacts(input.threadId, dependencies);
  if (repairIssues.length > 0) {
    return blockedReadiness(input.threadId, repairIssues);
  }
  return readReadiness(input, dependencies);
}
