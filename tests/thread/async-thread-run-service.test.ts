import assert from "node:assert/strict";
import test from "node:test";

import { prepareAsyncThread } from "../../src/thread/async-thread/services/async-thread-run-service.js";
import { makeChunkState, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedPlaceholderThread,
} from "../thread-view/helpers.js";

test("missing smooth output blocks dependent work explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.middleNewer.turnId
          ? {
              ...turn,
              smooth: undefined,
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.smoothReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "SMOOTH_MISSING"), true);
  });
});

test("missing placeholder output blocks lower-band use explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedMissingDetailedPlaceholderThread(storeRootDir);

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.placeholdersReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), true);
  });
});

test("invalid chunk state is reported explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: "chunk-invalid-open-alpha",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.oldest.turnId],
          smoothText: "invalid open alpha",
          smoothTokenCount: 3,
          placeholders: undefined,
        }),
        makeChunkState({
          chunkId: "chunk-invalid-open-beta",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.middleOlder.turnId],
          smoothText: "invalid open beta",
          smoothTokenCount: 3,
          placeholders: undefined,
        }),
      ],
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.chunksReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_STATE_INVALID"), true);
  });
});

test("invalid Thread View materialization state is reported explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.newest.turnId
          ? {
              ...turn,
              messageIds: [...turn.messageIds, "message-missing-materialization"],
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.chunksReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT"), true);
  });
});
