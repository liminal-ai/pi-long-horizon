import { createHash } from "node:crypto";

import type {
  ChunkCloseReason,
  ChunkState,
  UpdateChunkStateInput,
  UpdateChunkStateResult,
} from "../domain/chunk-state.js";
import {
  CHUNK_SCHEMA_VERSION,
  cloneChunkState,
  isCanonicalChunkState,
  isLegacyPlaceholderChunkState,
} from "../domain/chunk-state.js";
import {
  DEFAULT_CHUNK_CLOSE_SETTINGS,
  cloneChunkCloseSettings,
  type ChunkCloseSettings,
  validateChunkCloseSettings,
} from "../domain/settings.js";
import type { MessageRecord, TurnRecord } from "../../domain/records.js";
import { materializeSmoothTurnFromState } from "./smooth-turn-service.js";
import { materializeLowerBandTurnProjectionFromState } from "./lower-band-turn-projection-service.js";
import { ok, StewardResultError, type StewardIssue } from "../../domain/errors.js";
import type { ThreadStore } from "../../store/thread-store.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import {
  countChunkSmoothMaterialized,
  createMaterializedRepresentationHash,
  validateTokenCountRecord,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";
import type { EnsureLowerBandChunkArtifactsInput } from "./lower-band-compression-service.js";

export interface ChunkServiceOptions {
  store: ThreadStore;
  settings?: ChunkCloseSettings;
  now?: () => Date;
  lowerBandCompressionScheduler?: Pick<LowerBandCompressionScheduler, "schedule">;
}

export interface LowerBandCompressionScheduler {
  schedule(input: Pick<EnsureLowerBandChunkArtifactsInput, "threadId" | "chunkId" | "requiredBands" | "mode">): boolean;
}

function buildChunkStateIssue(message: string, threadId: string, cause?: string): StewardIssue {
  return {
    code: "CHUNK_STATE_INVALID",
    message,
    threadId,
    cause,
  };
}

function cloneChunks(chunks: readonly ChunkState[]): ChunkState[] {
  return chunks.map((chunk) => cloneChunkState(chunk));
}

function sortTurns(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns].sort((left, right) => {
    if (left.turnOrder !== right.turnOrder) {
      return left.turnOrder - right.turnOrder;
    }

    return left.sourceRange.fromSourceOrder - right.sourceRange.fromSourceOrder;
  });
}

function isCurrentTokenCountMetadata(record: TokenCountRecord | undefined, expected: TokenCountRecord): boolean {
  if (!record) {
    return false;
  }

  const isExactProviderCount = record.source === "provider_input_count" && record.trustClass === "exact";

  return (
    validateTokenCountRecord(record).ok &&
    record.scope === expected.scope &&
    (isExactProviderCount || record.count === expected.count) &&
    record.sourceRevision === expected.sourceRevision &&
    record.representationHash === expected.representationHash
  );
}

function sortMessages(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function createChunkId(chunks: readonly ChunkState[]): string {
  const highestSequence = chunks.reduce((max, chunk) => {
    const matched = /^chunk-(\d+)$/.exec(chunk.chunkId);
    if (!matched) {
      return max;
    }

    return Math.max(max, Number.parseInt(matched[1] ?? "0", 10));
  }, 0);

  return `chunk-${String(highestSequence + 1).padStart(3, "0")}`;
}

function createOpenChunk(
  threadId: string,
  chunks: readonly ChunkState[],
  openedAt: string,
): ChunkState {
  return {
    chunkId: createChunkId(chunks),
    threadId,
    schemaVersion: CHUNK_SCHEMA_VERSION,
    lifecycleStatus: "open",
    sourceTurnIds: [],
    openedAt,
  };
}

function createConversationTranscriptSourceFingerprint(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

interface ReadyChunkTurnSource {
  smoothText: string;
  projectionText: string;
  projectionTokenCount: number;
  sourceRevision: number;
}

interface NonReadyChunkTurnSource {
  status: "pending" | "failed" | "invalid";
  errorCode?: string;
  errorMessage?: string;
}

function isNonReadyChunkTurnSource(
  value: ReadyChunkTurnSource | NonReadyChunkTurnSource,
): value is NonReadyChunkTurnSource {
  return "status" in value;
}

function readReadyChunkTurnSource(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
): ReadyChunkTurnSource | NonReadyChunkTurnSource {
  const smoothMaterialized = materializeSmoothTurnFromState({ turn, messages });
  if (
    (smoothMaterialized.status !== "ready" && smoothMaterialized.status !== "degraded") ||
    !smoothMaterialized.text
  ) {
    return {
      status: smoothMaterialized.status === "invalid" ? "invalid" : "pending",
      errorCode: "CHUNK_SOURCE_SMOOTH_NOT_READY",
      errorMessage: `Turn ${turn.turnId} is missing current smooth text required for chunk assembly.`,
    };
  }

  const expectedProjection = materializeLowerBandTurnProjectionFromState({ turn, messages });
  if (
    expectedProjection.projectionStatus !== "ready" ||
    !expectedProjection.text ||
    !expectedProjection.sourceFingerprint
  ) {
    return {
      status:
        expectedProjection.projectionStatus === "failed" || expectedProjection.projectionStatus === "invalid"
          ? expectedProjection.projectionStatus
          : "pending",
      errorCode: expectedProjection.errorCode,
      errorMessage: expectedProjection.errorMessage,
    };
  }

  const projection = turn.smooth?.lowerBandProjection;
  if (
    projection?.status !== "ready" ||
    !projection.text ||
    !projection.tokenCountMetadata ||
    projection.tokenCountMetadata.scope !== "turn_lower_band_projection_materialized" ||
    projection.tokenCountMetadata.source !== "provider_input_count" ||
    projection.tokenCountMetadata.trustClass !== "exact" ||
    !validateTokenCountRecord(projection.tokenCountMetadata).ok ||
    projection.text !== expectedProjection.text ||
    projection.sourceFingerprint !== expectedProjection.sourceFingerprint ||
    projection.sourceRevision !== expectedProjection.sourceRevision ||
    projection.tokenCountMetadata.representationHash !== createMaterializedRepresentationHash(projection.text) ||
    projection.tokenCountMetadata.sourceRevision !== projection.sourceRevision
  ) {
    return {
      status: projection?.status === "failed" || projection?.status === "invalid" ? projection.status : "pending",
      errorCode: projection?.errorCode ?? "CHUNK_SOURCE_PROJECTION_NOT_READY",
      errorMessage:
        projection?.errorMessage ??
        `Turn ${turn.turnId} is missing current exact conversation-only projection state required for chunk assembly.`,
    };
  }

  return {
    smoothText: smoothMaterialized.text,
    projectionText: projection.text,
    projectionTokenCount: projection.tokenCountMetadata.count,
    sourceRevision: Math.max(turn.sourceRevision, projection.sourceRevision ?? turn.sourceRevision),
  };
}

function setChunkConversationTranscript(
  chunk: ChunkState,
  input: {
    text: string;
    sourceRevision: number;
    sourceFingerprint: string;
    updatedAt: string;
  },
): boolean {
  if (!isCanonicalChunkState(chunk)) {
    return false;
  }

  const nextTranscript = {
    status: "ready" as const,
    text: input.text,
    sourceRevision: input.sourceRevision,
    sourceFingerprint: input.sourceFingerprint,
    updatedAt: input.updatedAt,
  };
  if (
    chunk.conversationTranscript?.status === nextTranscript.status &&
    chunk.conversationTranscript?.text === nextTranscript.text &&
    chunk.conversationTranscript?.sourceRevision === nextTranscript.sourceRevision &&
    chunk.conversationTranscript?.sourceFingerprint === nextTranscript.sourceFingerprint
  ) {
    return false;
  }

  chunk.conversationTranscript = nextTranscript;
  return true;
}

function setChunkConversationTranscriptNotReady(
  chunk: ChunkState,
  input: {
    status: "pending" | "failed" | "invalid";
    sourceRevision?: number;
    updatedAt: string;
    errorCode?: string;
    errorMessage?: string;
  },
): boolean {
  if (!isCanonicalChunkState(chunk)) {
    return false;
  }

  const nextTranscript = {
    status: input.status,
    sourceRevision: input.sourceRevision,
    updatedAt: input.updatedAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  if (
    chunk.conversationTranscript?.status === nextTranscript.status &&
    chunk.conversationTranscript?.sourceRevision === nextTranscript.sourceRevision &&
    chunk.conversationTranscript?.errorCode === nextTranscript.errorCode &&
    chunk.conversationTranscript?.errorMessage === nextTranscript.errorMessage
  ) {
    return false;
  }

  chunk.conversationTranscript = nextTranscript;
  return true;
}

function appendTurnToChunk(
  chunk: ChunkState,
  turn: TurnRecord,
  turnSource: ReadyChunkTurnSource,
  updatedAt: string,
): void {
  chunk.sourceTurnIds = [...chunk.sourceTurnIds, turn.turnId];
  chunk.smoothText = chunk.smoothText ? `${chunk.smoothText}\n\n${turnSource.smoothText}` : turnSource.smoothText;
  chunk.sourceRevision = Math.max(chunk.sourceRevision ?? 0, turnSource.sourceRevision);
  backfillChunkSmoothTokenCountMetadata(chunk);
  if (isCanonicalChunkState(chunk)) {
    const transcriptText = chunk.conversationTranscript?.text
      ? `${chunk.conversationTranscript.text}\n\n${turnSource.projectionText}`
      : turnSource.projectionText;
    setChunkConversationTranscript(chunk, {
      text: transcriptText,
      sourceRevision: chunk.sourceRevision ?? turnSource.sourceRevision,
      sourceFingerprint: createConversationTranscriptSourceFingerprint(transcriptText),
      updatedAt,
    });
  }
}

export function materializeChunkSmoothTextFromTurns(input: {
  chunk: ChunkState;
  turnsById: ReadonlyMap<string, TurnRecord>;
  messagesById: ReadonlyMap<string, MessageRecord>;
}): { text: string; sourceRevision: number } | undefined {
  const parts: string[] = [];
  let sourceRevision = input.chunk.sourceRevision ?? 0;

  for (const turnId of input.chunk.sourceTurnIds) {
    const turn = input.turnsById.get(turnId);
    if (!turn) {
      return undefined;
    }

    const messages = sortMessages(
      turn.messageIds
        .map((messageId) => input.messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (messages.length !== turn.messageIds.length) {
      return undefined;
    }

    const materialized = materializeSmoothTurnFromState({ turn, messages });
    if ((materialized.status !== "ready" && materialized.status !== "degraded") || !materialized.text) {
      return undefined;
    }

    parts.push(materialized.text);
    sourceRevision = Math.max(sourceRevision, turn.sourceRevision);
  }

  return parts.length > 0
    ? {
        text: parts.join("\n\n"),
        sourceRevision,
      }
    : undefined;
}

export function materializeChunkConversationTranscriptFromTurns(input: {
  chunk: ChunkState;
  turnsById: ReadonlyMap<string, TurnRecord>;
  messagesById: ReadonlyMap<string, MessageRecord>;
}):
  | {
      status: "ready";
      text: string;
      sourceRevision: number;
      sourceFingerprint: string;
    }
  | NonReadyChunkTurnSource
  | undefined {
  const parts: string[] = [];
  let sourceRevision = input.chunk.sourceRevision ?? 0;

  for (const turnId of input.chunk.sourceTurnIds) {
    const turn = input.turnsById.get(turnId);
    if (!turn) {
      return {
        status: "pending",
        errorCode: "CHUNK_SOURCE_TURN_MISSING",
        errorMessage: `Chunk ${input.chunk.chunkId} references turn ${turnId}, which is no longer present.`,
      };
    }

    const messages = sortMessages(
      turn.messageIds
        .map((messageId) => input.messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (messages.length !== turn.messageIds.length) {
      return {
        status: "pending",
        errorCode: "CHUNK_SOURCE_MESSAGES_MISSING",
        errorMessage: `Chunk ${input.chunk.chunkId} is missing canonical messages required for transcript assembly.`,
      };
    }

    const turnSource = readReadyChunkTurnSource(turn, messages);
    if (isNonReadyChunkTurnSource(turnSource)) {
      return turnSource;
    }

    parts.push(turnSource.projectionText);
    sourceRevision = Math.max(sourceRevision, turnSource.sourceRevision);
  }

  const text = parts.join("\n\n");
  return parts.length > 0
    ? {
        status: "ready",
        text,
        sourceRevision,
        sourceFingerprint: createConversationTranscriptSourceFingerprint(text),
      }
    : undefined;
}

function resetStaleOpenChunk(chunk: ChunkState, updatedAt: string): void {
  chunk.sourceTurnIds = [];
  chunk.smoothText = undefined;
  chunk.smoothTokenCountMetadata = undefined;
  chunk.sourceRevision = undefined;
  chunk.openedAt = chunk.openedAt ?? updatedAt;
  chunk.closedAt = undefined;
  chunk.closeReason = undefined;
  if (isCanonicalChunkState(chunk)) {
    chunk.conversationTranscript = undefined;
    chunk.lowerBand = undefined;
  } else {
    chunk.placeholders = undefined;
  }
}

function calculateChunkLowerBandProjectionTokenCount(input: {
  chunk: ChunkState;
  turnsById: ReadonlyMap<string, TurnRecord>;
  messagesById: ReadonlyMap<string, MessageRecord>;
}): number | undefined {
  let total = 0;

  for (const turnId of input.chunk.sourceTurnIds) {
    const turn = input.turnsById.get(turnId);
    if (!turn) {
      return undefined;
    }

    const messages = sortMessages(
      turn.messageIds
        .map((messageId) => input.messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (messages.length !== turn.messageIds.length) {
      return undefined;
    }

    const turnSource = readReadyChunkTurnSource(turn, messages);
    if (isNonReadyChunkTurnSource(turnSource)) {
      return undefined;
    }

    total += turnSource.projectionTokenCount;
  }

  return total;
}

function refreshClosedChunkFromSourceTurns(input: {
  chunk: ChunkState;
  turnsById: ReadonlyMap<string, TurnRecord>;
  messagesById: ReadonlyMap<string, MessageRecord>;
  updatedAt: string;
}): boolean {
  if (input.chunk.lifecycleStatus !== "closed") {
    return false;
  }

  let changed = false;
  let smoothSourceChanged = false;
  let transcriptChanged = false;
  const smoothMaterialized = materializeChunkSmoothTextFromTurns(input);
  if (smoothMaterialized) {
    if (
      input.chunk.smoothText !== smoothMaterialized.text ||
      input.chunk.sourceRevision !== smoothMaterialized.sourceRevision
    ) {
      input.chunk.smoothText = smoothMaterialized.text;
      input.chunk.sourceRevision = smoothMaterialized.sourceRevision;
      changed = true;
      smoothSourceChanged = true;
    }

    if (backfillChunkSmoothTokenCountMetadata(input.chunk)) {
      changed = true;
    }
  }

  if (!isCanonicalChunkState(input.chunk)) {
    if (smoothSourceChanged) {
      input.chunk.placeholders = undefined;
      changed = true;
    }
    return changed;
  }

  const transcript = materializeChunkConversationTranscriptFromTurns(input);
  if (!transcript) {
    return changed;
  }

  if (transcript.status === "ready") {
    transcriptChanged = setChunkConversationTranscript(input.chunk, {
        text: transcript.text,
        sourceRevision: transcript.sourceRevision,
        sourceFingerprint: transcript.sourceFingerprint,
        updatedAt: input.updatedAt,
      });
    changed = transcriptChanged || changed;
    return changed;
  }

  transcriptChanged = setChunkConversationTranscriptNotReady(input.chunk, {
      status: transcript.status,
      sourceRevision: input.chunk.sourceRevision,
      updatedAt: input.updatedAt,
      errorCode: transcript.errorCode,
      errorMessage: transcript.errorMessage,
    });
  changed = transcriptChanged || changed;
  return changed;
}

function backfillChunkSmoothTokenCountMetadata(chunk: ChunkState): boolean {
  if (!chunk.smoothText) {
    return false;
  }

  const expectedTokenCountMetadata = countChunkSmoothMaterialized(chunk);
  if (isCurrentTokenCountMetadata(chunk.smoothTokenCountMetadata, expectedTokenCountMetadata)) {
    return false;
  }

  chunk.smoothTokenCountMetadata = expectedTokenCountMetadata;
  return true;
}

function closeChunk(chunk: ChunkState, reason: ChunkCloseReason, closedAt: string): void {
  chunk.lifecycleStatus = "closed";
  chunk.closedAt = closedAt;
  chunk.closeReason = reason;
}

function shouldCloseBeforeAppend(
  chunkProjectionTokenCount: number,
  nextTurnProjectionTokenCount: number,
  settings: ChunkCloseSettings,
): boolean {
  return (
    chunkProjectionTokenCount >= settings.targetMinSmoothTokens &&
    chunkProjectionTokenCount + nextTurnProjectionTokenCount > settings.targetSoftMaxSmoothTokens
  );
}

export async function updateChunkState(
  input: UpdateChunkStateInput,
  options: ChunkServiceOptions,
): Promise<UpdateChunkStateResult> {
  const chunkIdsToSchedule = new Set<string>();
  return withSerializedThreadOperation(input.threadId, async () => {
    const settings = cloneChunkCloseSettings(options.settings ?? DEFAULT_CHUNK_CLOSE_SETTINGS);
    const settingIssues = validateChunkCloseSettings(settings);
    if (settingIssues.length > 0) {
      return ok({
        threadId: input.threadId,
        updatedChunkIds: [],
        blockers: settingIssues.map((message) => buildChunkStateIssue(message, input.threadId, "settings_invalid")),
      } satisfies UpdateChunkStateResult);
    }

    const snapshotResult = await options.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const chunksResult = await options.store.readChunks(input.threadId);
    if (!chunksResult.ok) {
      return chunksResult;
    }

    const originalChunks = cloneChunks(chunksResult.value);
    const nextChunks = cloneChunks(chunksResult.value);
    const updatedChunkIds = new Set<string>();
    const blockers: StewardIssue[] = [];
    for (const chunk of nextChunks) {
      if (backfillChunkSmoothTokenCountMetadata(chunk)) {
        updatedChunkIds.add(chunk.chunkId);
      }
    }

    const openChunks = nextChunks.filter((chunk) => chunk.lifecycleStatus === "open");
    if (openChunks.length > 1) {
      blockers.push(
        buildChunkStateIssue(
          `Thread ${input.threadId} has ${openChunks.length} open chunks; expected exactly one.`,
          input.threadId,
          "multiple_open_chunks",
        ),
      );
      return ok({
        threadId: input.threadId,
        updatedChunkIds: [],
        blockers,
      } satisfies UpdateChunkStateResult);
    }

    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    let openChunk = openChunks[0];
    if (!openChunk) {
      openChunk = createOpenChunk(input.threadId, nextChunks, timestamp);
      nextChunks.push(openChunk);
      updatedChunkIds.add(openChunk.chunkId);
    }

    const messagesById = new Map(snapshotResult.value.messages.map((message) => [message.messageId, message]));
    const turnsById = new Map(snapshotResult.value.turns.map((turn) => [turn.turnId, turn]));
    for (const chunk of nextChunks) {
      if (refreshClosedChunkFromSourceTurns({ chunk, turnsById, messagesById, updatedAt: timestamp })) {
        updatedChunkIds.add(chunk.chunkId);
      }
    }
    const openChunkProjectionTokenCount = calculateChunkLowerBandProjectionTokenCount({
      chunk: openChunk,
      turnsById,
      messagesById,
    });
    let blockOpenChunkAssembly = false;
    if (openChunk.sourceTurnIds.length > 0 && openChunkProjectionTokenCount === undefined) {
      const referencesMissingSourceTurns = openChunk.sourceTurnIds.some((turnId) => !turnsById.has(turnId));
      if (referencesMissingSourceTurns) {
        resetStaleOpenChunk(openChunk, timestamp);
        updatedChunkIds.add(openChunk.chunkId);
      } else {
        blockOpenChunkAssembly = true;
        blockers.push(
          buildChunkStateIssue(
            `Open chunk ${openChunk.chunkId} is missing current exact conversation-only projection state required for chunk assembly.`,
            input.threadId,
            "open_chunk_projection_not_ready",
          ),
        );
      }
    }
    const assignedTurnIds = new Set(nextChunks.flatMap((chunk) => chunk.sourceTurnIds));
    let currentOpenChunkProjectionTokenCount = calculateChunkLowerBandProjectionTokenCount({
      chunk: openChunk,
      turnsById,
      messagesById,
    }) ?? 0;
    const turnMessages = (turn: TurnRecord) =>
      sortMessages(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
    const eligibleTurns = blockOpenChunkAssembly
      ? []
      : sortTurns(snapshotResult.value.turns)
        .map((turn) => ({
          turn,
          messages: turnMessages(turn),
        }))
        .map(({ turn, messages }) => ({
          turn,
          turnSource: readReadyChunkTurnSource(turn, messages),
        }))
        .filter(
          (candidate): candidate is { turn: TurnRecord; turnSource: ReadyChunkTurnSource } =>
            !assignedTurnIds.has(candidate.turn.turnId) && !isNonReadyChunkTurnSource(candidate.turnSource),
        );

    for (const { turn, turnSource } of eligibleTurns) {
      if (shouldCloseBeforeAppend(currentOpenChunkProjectionTokenCount, turnSource.projectionTokenCount, settings)) {
        closeChunk(openChunk, "soft_threshold", timestamp);
        updatedChunkIds.add(openChunk.chunkId);
        if (isCanonicalChunkState(openChunk) && openChunk.conversationTranscript?.status === "ready") {
          chunkIdsToSchedule.add(openChunk.chunkId);
        }
        openChunk = createOpenChunk(input.threadId, nextChunks, timestamp);
        nextChunks.push(openChunk);
        updatedChunkIds.add(openChunk.chunkId);
        currentOpenChunkProjectionTokenCount = 0;
      }

      appendTurnToChunk(openChunk, turn, turnSource, timestamp);
      updatedChunkIds.add(openChunk.chunkId);
      currentOpenChunkProjectionTokenCount += turnSource.projectionTokenCount;

      if (currentOpenChunkProjectionTokenCount >= settings.hardMaxSmoothTokens) {
        closeChunk(openChunk, "hard_max", timestamp);
        updatedChunkIds.add(openChunk.chunkId);
        if (isCanonicalChunkState(openChunk) && openChunk.conversationTranscript?.status === "ready") {
          chunkIdsToSchedule.add(openChunk.chunkId);
        }
        openChunk = createOpenChunk(input.threadId, nextChunks, timestamp);
        nextChunks.push(openChunk);
        updatedChunkIds.add(openChunk.chunkId);
        currentOpenChunkProjectionTokenCount = 0;
      }
    }

    if (JSON.stringify(originalChunks) !== JSON.stringify(nextChunks)) {
      const changedChunks = nextChunks.filter((chunk) => updatedChunkIds.has(chunk.chunkId));
      const writeResult = options.store.writeChunkRows
        ? await options.store.writeChunkRows({
            threadId: input.threadId,
            expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
            expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
            expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
            chunks: changedChunks,
            orderedChunkIds: nextChunks.map((chunk) => chunk.chunkId),
            updatedAt: timestamp,
          })
        : await options.store.writeChunks({
            threadId: input.threadId,
            expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
            expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
            expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
            chunks: nextChunks,
          });
      if (!writeResult.ok) {
        return writeResult;
      }
    }

    return ok({
      threadId: input.threadId,
      updatedChunkIds: [...updatedChunkIds],
      blockers,
    } satisfies UpdateChunkStateResult);
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }

    const scheduler = options.lowerBandCompressionScheduler;
    if (scheduler) {
      for (const chunkId of chunkIdsToSchedule) {
        scheduler.schedule({
          threadId: input.threadId,
          chunkId,
          requiredBands: ["detailed", "brief"],
          mode: "async_close",
        });
      }
    }

    return result.value;
  });
}
