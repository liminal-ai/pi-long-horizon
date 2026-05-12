import type {
  EnsureSmoothTurnInput,
  EnsureSmoothTurnResult,
  ReadSmoothTurnStateInput,
  ReadSmoothTurnStateResult,
  SmoothTurnState,
} from "../domain/smooth-turn-state.js";
import { toTurnSmoothRecord } from "../domain/smooth-turn-state.js";
import type { ThreadSnapshot, ThreadStore } from "../../store/thread-store.js";
import type { TurnRecord } from "../../domain/records.js";
import type { DeterministicSmoothFormatOptions } from "./smooth-turn-format.js";
import { buildSmoothTurnText } from "./smooth-turn-format.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import { fail, ok, StewardResultError, type StewardResult } from "../../domain/errors.js";
import {
  countSmoothTurnMaterialized,
  validateTokenCountRecord,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface SmoothTurnServiceOptions {
  store: ThreadStore;
  now?: () => Date;
  formatOptions?: Partial<DeterministicSmoothFormatOptions>;
}

export interface PersistSmoothTurnStateInput {
  threadId: string;
  turnId: string;
  expectedSourceRevision: number;
  expectedMessageHighWatermark: number;
  expectedTurnsRevision: number;
  smooth: SmoothTurnState;
}

function findTurn(snapshot: ThreadSnapshot, turnId: string): TurnRecord | undefined {
  return snapshot.turns.find((turn) => turn.turnId === turnId);
}

function sortTurnMessages(snapshot: ThreadSnapshot, turn: TurnRecord) {
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));

  return turn.messageIds
    .map((messageId) => messagesById.get(messageId))
    .filter((message) => message !== undefined)
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function isCurrentTokenCountMetadata(record: TokenCountRecord | undefined, expected: TokenCountRecord): boolean {
  if (!record) {
    return false;
  }

  return (
    validateTokenCountRecord(record).ok &&
    record.scope === expected.scope &&
    record.count === expected.count &&
    record.sourceRevision === expected.sourceRevision &&
    record.representationHash === expected.representationHash
  );
}

function calculateSmoothTokenCountRecord(turn: TurnRecord, generatedAt?: string): TokenCountRecord {
  return countSmoothTurnMaterialized(turn, { createdAt: generatedAt });
}

function withSmoothTokenCountMetadata(smooth: SmoothTurnState, turn: TurnRecord): SmoothTurnState {
  const generatedAt = smooth.generatedAt ?? new Date().toISOString();
  const turnWithSmooth: TurnRecord = {
    ...turn,
    smooth: toTurnSmoothRecord({
      ...smooth,
      generatedAt,
    }),
  };
  const tokenCountMetadata = calculateSmoothTokenCountRecord(turnWithSmooth, generatedAt);

  return {
    ...smooth,
    tokenCountMetadata,
    generatedAt,
  };
}

function evaluateSmoothTurn(turn: TurnRecord): ReadSmoothTurnStateResult {
  const smooth = turn.smooth;
  if (!smooth) {
    return {
      turnId: turn.turnId,
      smoothStatus: "missing",
    };
  }

  if (turn.lifecycleStatus !== "closed") {
    return {
      turnId: turn.turnId,
      smoothStatus: "missing",
      smoothText: smooth.text,
      smoothTokenCount: smooth.tokenCountMetadata?.count,
      smoothStrategy: smooth.strategy,
      generatedAt: smooth.generatedAt,
      sourceRevision: smooth.sourceRevision,
    };
  }

  if (
    smooth.status === "invalid" ||
    !smooth.text ||
    smooth.tokenCountMetadata === undefined ||
    smooth.strategy !== "deterministic_marker_sections_v1" ||
    !smooth.generatedAt ||
    smooth.sourceRevision === undefined
  ) {
    return {
      turnId: turn.turnId,
      smoothStatus: "invalid",
      smoothText: smooth.text,
      smoothTokenCount: smooth.tokenCountMetadata?.count,
      smoothStrategy: smooth.strategy,
      generatedAt: smooth.generatedAt,
      sourceRevision: smooth.sourceRevision,
    };
  }

  const expectedTokenCountMetadata = calculateSmoothTokenCountRecord(turn, smooth.generatedAt);
  if (
    !isCurrentTokenCountMetadata(smooth.tokenCountMetadata, expectedTokenCountMetadata)
  ) {
    return {
      turnId: turn.turnId,
      smoothStatus: "invalid",
      smoothText: smooth.text,
      smoothTokenCount: smooth.tokenCountMetadata?.count,
      smoothStrategy: smooth.strategy,
      generatedAt: smooth.generatedAt,
      sourceRevision: smooth.sourceRevision,
    };
  }

  if (smooth.sourceRevision !== turn.sourceRevision || smooth.status === "stale") {
    return {
      turnId: turn.turnId,
      smoothStatus: "stale",
      smoothText: smooth.text,
      smoothTokenCount: smooth.tokenCountMetadata.count,
      smoothStrategy: smooth.strategy,
      generatedAt: smooth.generatedAt,
      sourceRevision: smooth.sourceRevision,
    };
  }

  return {
    turnId: turn.turnId,
    smoothStatus: "ready",
    smoothText: smooth.text,
    smoothTokenCount: smooth.tokenCountMetadata.count,
    smoothStrategy: smooth.strategy,
    generatedAt: smooth.generatedAt,
    sourceRevision: smooth.sourceRevision,
  };
}

function buildSmoothState(
  input: {
    threadId: string;
    turn: TurnRecord;
    generatedAt: string;
    formatOptions?: Partial<DeterministicSmoothFormatOptions>;
  },
  snapshot: ThreadSnapshot,
): SmoothTurnState {
  const formatted = buildSmoothTurnText(sortTurnMessages(snapshot, input.turn), input.formatOptions);
  const smooth: SmoothTurnState = {
    turnId: input.turn.turnId,
    threadId: input.threadId,
    status: "ready",
    text: formatted.text,
    strategy: formatted.strategy,
    generatedAt: input.generatedAt,
    sourceRevision: input.turn.sourceRevision,
  };

  return withSmoothTokenCountMetadata(smooth, input.turn);
}

async function writeSmoothTurn(
  input: {
    snapshot: ThreadSnapshot;
    turn: TurnRecord;
    smooth: SmoothTurnState;
  },
  store: ThreadStore,
): Promise<StewardResult<void>> {
  const turns = input.snapshot.turns.map((turn) =>
    turn.turnId === input.turn.turnId
      ? {
          ...structuredClone(turn),
          smooth: toTurnSmoothRecord(input.smooth),
        }
      : structuredClone(turn),
  );

  const writeResult = await store.writeTurns({
    threadId: input.snapshot.thread.threadId,
    expectedSourceRevision: input.snapshot.thread.sourceRevision,
    expectedMessageHighWatermark: input.snapshot.thread.messageHighWatermark,
    expectedTurnsRevision: input.snapshot.thread.turnsRevision,
    turns,
    turnState: input.snapshot.thread.status.turnState,
  });

  if (!writeResult.ok) {
    return fail(...writeResult.issues);
  }

  return ok(undefined);
}

async function persistSmoothTurnStateWithinSerializedThreadOperation(
  input: PersistSmoothTurnStateInput,
  store: ThreadStore,
): Promise<StewardResult<void>> {
  const snapshotResult = await store.openThread(input.threadId);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }

  if (snapshotResult.value.thread.sourceRevision !== input.expectedSourceRevision) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} source revision ${snapshotResult.value.thread.sourceRevision} does not match expected ${input.expectedSourceRevision}.`,
      threadId: input.threadId,
    });
  }

  if (snapshotResult.value.thread.messageHighWatermark !== input.expectedMessageHighWatermark) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} message high watermark ${snapshotResult.value.thread.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
      threadId: input.threadId,
    });
  }

  if (snapshotResult.value.thread.turnsRevision !== input.expectedTurnsRevision) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} turns revision ${snapshotResult.value.thread.turnsRevision} does not match expected ${input.expectedTurnsRevision}.`,
      threadId: input.threadId,
      cause: "turns_revision",
    });
  }

  const turn = findTurn(snapshotResult.value, input.turnId);
  if (!turn) {
    return fail({
      code: "TURN_STATE_MISSING",
      message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
      threadId: input.threadId,
    });
  }

  const smooth = withSmoothTokenCountMetadata(input.smooth, turn);

  if (turn.sourceRevision !== smooth.sourceRevision) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Turn ${input.turnId} source revision ${turn.sourceRevision} does not match smooth source revision ${smooth.sourceRevision}.`,
      threadId: input.threadId,
    });
  }

  return writeSmoothTurn(
    {
      snapshot: snapshotResult.value,
      turn,
      smooth,
    },
    store,
  );
}

function isRetryableTurnsRevisionFailure(result: StewardResult<void>): boolean {
  return (
    !result.ok &&
    result.issues.some((issue) => issue.code === "STALE_SOURCE_REVISION" && issue.cause === "turns_revision")
  );
}

async function persistSmoothTurnStateWithRetry(
  input: PersistSmoothTurnStateInput,
  store: ThreadStore,
): Promise<StewardResult<void>> {
  let nextInput = { ...input };
  let lastResult: StewardResult<void> | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await persistSmoothTurnStateWithinSerializedThreadOperation(nextInput, store);
    if (result.ok) {
      return result;
    }

    lastResult = result;
    if (!isRetryableTurnsRevisionFailure(result)) {
      return result;
    }

    const latestSnapshot = await store.openThread(input.threadId);
    if (!latestSnapshot.ok) {
      return latestSnapshot;
    }

    nextInput = {
      ...nextInput,
      expectedTurnsRevision: latestSnapshot.value.thread.turnsRevision,
    };
  }

  return (
    lastResult ??
    fail({
      code: "STORE_UNAVAILABLE",
      message: `Smooth turn state for ${input.turnId} could not be persisted.`,
      threadId: input.threadId,
    })
  );
}

export async function persistSmoothTurnState(
  input: PersistSmoothTurnStateInput,
  options: Pick<SmoothTurnServiceOptions, "store">,
): Promise<void> {
  return withSerializedThreadOperation(input.threadId, async () =>
    persistSmoothTurnStateWithRetry(input, options.store),
  ).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }
  });
}

export async function readSmoothTurnState(
  input: ReadSmoothTurnStateInput,
  options: Pick<SmoothTurnServiceOptions, "store">,
): Promise<ReadSmoothTurnStateResult> {
  const snapshotResult = await options.store.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new StewardResultError(snapshotResult.issues);
  }

  const turn = findTurn(snapshotResult.value, input.turnId);
  if (!turn) {
    throw new StewardResultError([
      {
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
        threadId: input.threadId,
      },
    ]);
  }

  return evaluateSmoothTurn(turn);
}

export async function ensureSmoothTurn(
  input: EnsureSmoothTurnInput,
  options: SmoothTurnServiceOptions,
): Promise<EnsureSmoothTurnResult> {
  return withSerializedThreadOperation(input.threadId, async () => {
    const snapshotResult = await options.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const turn = findTurn(snapshotResult.value, input.turnId);
    if (!turn) {
      return fail({
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
        threadId: input.threadId,
      });
    }

    const current = evaluateSmoothTurn(turn);
    if (turn.lifecycleStatus !== "closed") {
      return ok({
        turnId: current.turnId,
        smoothStatus: current.smoothStatus,
        smoothTokenCount: current.smoothTokenCount,
      } satisfies EnsureSmoothTurnResult);
    }

    if (current.smoothStatus === "ready") {
      return ok({
        turnId: current.turnId,
        smoothStatus: current.smoothStatus,
        smoothTokenCount: current.smoothTokenCount,
      } satisfies EnsureSmoothTurnResult);
    }

    const smooth = buildSmoothState(
      {
        threadId: input.threadId,
        turn,
        generatedAt: (options.now ?? (() => new Date()))().toISOString(),
        formatOptions: options.formatOptions,
      },
      snapshotResult.value,
    );

    const writeResult = await persistSmoothTurnStateWithRetry(
      {
        threadId: input.threadId,
        turnId: turn.turnId,
        expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
        expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
        expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
        smooth,
      },
      options.store,
    );
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok({
      turnId: smooth.turnId,
      smoothStatus: smooth.status,
      smoothTokenCount: smooth.tokenCountMetadata?.count,
    } satisfies EnsureSmoothTurnResult);
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }

    return result.value;
  });
}
