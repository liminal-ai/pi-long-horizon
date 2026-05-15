import type {
  ChunkCloseReason,
  ChunkState,
  UpdateChunkStateInput,
  UpdateChunkStateResult,
} from "../domain/chunk-state.js";
import { cloneChunkState } from "../domain/chunk-state.js";
import {
  DEFAULT_CHUNK_CLOSE_SETTINGS,
  cloneChunkCloseSettings,
  type ChunkCloseSettings,
  validateChunkCloseSettings,
} from "../domain/settings.js";
import type { MessageRecord, TurnRecord } from "../../domain/records.js";
import { materializeSmoothTurnFromState } from "./smooth-turn-service.js";
import { fail, ok, StewardResultError, type StewardIssue } from "../../domain/errors.js";
import type { ThreadStore } from "../../store/thread-store.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import {
  countChunkSmoothMaterialized,
  countSmoothTurnMaterialized,
  validateTokenCountRecord,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface ChunkServiceOptions {
  store: ThreadStore;
  settings?: ChunkCloseSettings;
  now?: () => Date;
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

function isCurrentSmoothTurn(turn: TurnRecord, messages: readonly MessageRecord[]): boolean {
  if (turn.lifecycleStatus !== "closed") {
    return false;
  }

  const smooth = turn.smooth;
  const materialized = materializeSmoothTurnFromState({ turn, messages });
  if (!smooth || (materialized.status !== "ready" && materialized.status !== "degraded") || !materialized.text) {
    return false;
  }

  if (smooth.tokenCountMetadata === undefined || smooth.sourceRevision === undefined) {
    return false;
  }

  const expectedTokenCountMetadata = countSmoothTurnMaterialized(
    {
      ...turn,
      smooth: {
        ...smooth,
        text: materialized.text,
      },
    },
    { createdAt: smooth.generatedAt },
  );

  return (
    smooth.sourceRevision === turn.sourceRevision &&
    isCurrentTokenCountMetadata(smooth.tokenCountMetadata, expectedTokenCountMetadata)
  );
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
    lifecycleStatus: "open",
    sourceTurnIds: [],
    openedAt,
  };
}

function appendTurnToChunk(chunk: ChunkState, turn: TurnRecord, messages: readonly MessageRecord[]): void {
  const materialized = materializeSmoothTurnFromState({ turn, messages });
  const smoothText = materialized.text;
  const smoothTokenCount = turn.smooth?.tokenCountMetadata?.count;

  if (!smoothText || smoothTokenCount === undefined) {
    return;
  }

  chunk.sourceTurnIds = [...chunk.sourceTurnIds, turn.turnId];
  chunk.smoothText = chunk.smoothText ? `${chunk.smoothText}\n\n${smoothText}` : smoothText;
  chunk.sourceRevision = turn.sourceRevision;
  backfillChunkSmoothTokenCountMetadata(chunk);
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

function refreshClosedChunkFromSmoothTurns(input: {
  chunk: ChunkState;
  turnsById: ReadonlyMap<string, TurnRecord>;
  messagesById: ReadonlyMap<string, MessageRecord>;
}): boolean {
  if (input.chunk.lifecycleStatus !== "closed") {
    return false;
  }

  const materialized = materializeChunkSmoothTextFromTurns(input);
  if (!materialized) {
    return false;
  }

  if (
    input.chunk.smoothText === materialized.text &&
    input.chunk.sourceRevision === materialized.sourceRevision &&
    backfillChunkSmoothTokenCountMetadata(input.chunk) === false
  ) {
    return false;
  }

  input.chunk.smoothText = materialized.text;
  input.chunk.sourceRevision = materialized.sourceRevision;
  input.chunk.placeholders = undefined;
  backfillChunkSmoothTokenCountMetadata(input.chunk);
  return true;
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
  chunk: ChunkState,
  nextTurn: TurnRecord,
  settings: ChunkCloseSettings,
): boolean {
  const nextTokenCount = nextTurn.smooth?.tokenCountMetadata?.count;
  if (nextTokenCount === undefined) {
    return false;
  }
  const chunkTokenCount = chunk.smoothTokenCountMetadata?.count ?? 0;

  return (
    chunkTokenCount >= settings.targetMinSmoothTokens &&
    chunkTokenCount + nextTokenCount > settings.targetSoftMaxSmoothTokens
  );
}

export async function updateChunkState(
  input: UpdateChunkStateInput,
  options: ChunkServiceOptions,
): Promise<UpdateChunkStateResult> {
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

    const assignedTurnIds = new Set(nextChunks.flatMap((chunk) => chunk.sourceTurnIds));
    const messagesById = new Map(snapshotResult.value.messages.map((message) => [message.messageId, message]));
    const turnsById = new Map(snapshotResult.value.turns.map((turn) => [turn.turnId, turn]));
    for (const chunk of nextChunks) {
      if (refreshClosedChunkFromSmoothTurns({ chunk, turnsById, messagesById })) {
        updatedChunkIds.add(chunk.chunkId);
      }
    }
    const turnMessages = (turn: TurnRecord) =>
      sortMessages(
        turn.messageIds
          .map((messageId) => messagesById.get(messageId))
          .filter((message): message is MessageRecord => message !== undefined),
      );
    const eligibleTurns = sortTurns(snapshotResult.value.turns).filter(
      (turn) => isCurrentSmoothTurn(turn, turnMessages(turn)) && !assignedTurnIds.has(turn.turnId),
    );

    for (const turn of eligibleTurns) {
      if (shouldCloseBeforeAppend(openChunk, turn, settings)) {
        closeChunk(openChunk, "soft_threshold", timestamp);
        updatedChunkIds.add(openChunk.chunkId);
        openChunk = createOpenChunk(input.threadId, nextChunks, timestamp);
        nextChunks.push(openChunk);
        updatedChunkIds.add(openChunk.chunkId);
      }

      appendTurnToChunk(openChunk, turn, turnMessages(turn));
      updatedChunkIds.add(openChunk.chunkId);

      if ((openChunk.smoothTokenCountMetadata?.count ?? 0) >= settings.hardMaxSmoothTokens) {
        closeChunk(openChunk, "hard_max", timestamp);
        updatedChunkIds.add(openChunk.chunkId);
        openChunk = createOpenChunk(input.threadId, nextChunks, timestamp);
        nextChunks.push(openChunk);
        updatedChunkIds.add(openChunk.chunkId);
      }
    }

    if (JSON.stringify(originalChunks) !== JSON.stringify(nextChunks)) {
      const writeResult = await options.store.writeChunks({
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

    return result.value;
  });
}
