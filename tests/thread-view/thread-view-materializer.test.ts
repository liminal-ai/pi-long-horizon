import assert from "node:assert/strict";
import test from "node:test";

import { ThreadViewMaterializer } from "../../src/thread-view/services/thread-view-materializer.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { makeSelectedLowerBandView, seedDeterministicRebuildThread } from "./helpers.js";

test("materialized emitted sequence preserves band order", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
      smoothTurnId: context.turns.middleNewer.turnId,
      detailedChunkIds: [context.chunks.newerClosed],
      briefChunkIds: [context.chunks.oldestClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => ({
        bandType: message.bandType,
        sourceKind: message.sourceKind,
      })),
      [
        { bandType: "full_fidelity", sourceKind: "raw_turn_message" },
        { bandType: "full_fidelity", sourceKind: "raw_turn_message" },
        { bandType: "smooth", sourceKind: "smooth_turn" },
        { bandType: "detailed", sourceKind: "detailed_chunk_summary" },
        { bandType: "brief", sourceKind: "brief_chunk_summary" },
      ],
    );
    assert.match(String(result.value.emittedMessages[3]?.content), /\[deterministic-placeholder:detailed\]/);
    assert.match(String(result.value.emittedMessages[4]?.content), /\[deterministic-placeholder:brief\]/);
  });
});

test("empty band does not corrupt materialization", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
      detailedChunkIds: [context.chunks.newerClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => ({
        bandType: message.bandType,
        messageOrder: message.messageOrder,
      })),
      [
        { bandType: "full_fidelity", messageOrder: 1 },
        { bandType: "full_fidelity", messageOrder: 2 },
        { bandType: "smooth", messageOrder: 3 },
        { bandType: "smooth", messageOrder: 4 },
        { bandType: "smooth", messageOrder: 5 },
        { bandType: "detailed", messageOrder: 6 },
      ],
    );
    assert.equal(result.value.bandStatuses.smooth, "ready");
    assert.equal(result.value.bandStatuses.brief, "ready");
  });
});

test("band order is preserved when multiple middle or lower bands are empty", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      smoothTurnId: context.turns.middleNewer.turnId,
      briefChunkIds: [context.chunks.oldestClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => message.bandType),
      ["smooth", "brief"],
    );
  });
});

test("missing full-fidelity source messages surface explicit invalid materialization state", async () => {
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

    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.equal(result.value.fullFidelityBand.renderedStatus, "blocked");
    assert.equal(result.value.bandStatuses.full_fidelity, "blocked");
    assert.equal(result.value.issues.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT"), true);
    assert.deepEqual(
      result.value.emittedMessages.filter((message) => message.bandType === "full_fidelity"),
      [],
    );
  });
});
