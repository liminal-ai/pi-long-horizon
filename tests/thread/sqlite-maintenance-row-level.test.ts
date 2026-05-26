import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { maintainAsyncThread } from "../../src/thread/async-thread/services/async-thread-run-service.js";
import { isCanonicalChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { makeActorRecord, makeMessageRecord } from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import {
  expectOk,
  FakeOpenAIInputTokenCounter,
  seedSqliteMaintenanceFixture,
} from "./helpers/sqlite-maintenance-helpers.js";

function makeExactTokenRecord<T extends { count: number; source: string; trustClass: string; createdAt: string }>(
  record: T,
  count: number,
): T {
  return {
    ...record,
    count,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: "gpt-test-maintenance",
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: `tests.thread.sqlite-maintenance-row-level.${count}`,
  } as T;
}

async function waitForCall(counter: FakeOpenAIInputTokenCounter, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (counter.calls.some((call) => call.startsWith(prefix))) {
      return;
    }
    await sleep(10);
  }

  throw new Error(`Timed out waiting for ${prefix}`);
}

test("bounded SQLite background maintenance repairs only the configured recent rows and leaves visible debt", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await maintainAsyncThread(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
        artifactRepairLimits: {
          maxSmoothTurns: 0,
          maxProjectionTurns: 0,
          maxTokenTurns: 1,
          maxTokenChunks: 1,
        },
      },
    );

    assert.equal(result.artifactsReady, true);
    assert.equal(result.tokenCountsReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const chunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const newestTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest);
    const oldestTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.oldest);
    const newestChunk = chunks.find((chunk) => chunk.chunkId === fixture.chunkIds.newestClosed);
    const oldestChunk = chunks.find((chunk) => chunk.chunkId === fixture.chunkIds.oldestClosed);

    assert.equal(newestTurn?.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(newestTurn?.smooth?.tokenCountMetadata?.trustClass, "exact");
    assert.equal(oldestTurn?.rawTokenCountMetadata?.source, "pi_heuristic");
    assert.equal(oldestTurn?.smooth?.tokenCountMetadata?.trustClass, "heuristic_estimate");
    assert.equal(oldestChunk?.smoothTokenCountMetadata?.source, "provider_input_count");
    assert.equal(newestChunk?.smoothTokenCountMetadata?.source, "pi_heuristic");
    assert.equal(snapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(snapshot.thread.status.maintenance?.background?.scope, "bounded");
    assert.equal(snapshot.thread.status.maintenance?.background?.status, "repair_needed");
    assert.equal(snapshot.thread.status.maintenance?.background?.fixedCount! > 0, true);
    assert.equal(snapshot.thread.status.maintenance?.background?.remainingDebtCount! > 0, true);
    assert.equal(
      snapshot.thread.status.maintenance?.background?.remainingDebt?.some(
        (debt) => debt.entityId === fixture.turnIds.oldest && debt.category === "raw_turn_token",
      ),
      true,
    );
  });
});

test("SQLite turn row maintenance writes preserve newer same-row derived fields", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const staleTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest)!;

    expectOk(
      await fixture.store.writeTurnRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        turns: [
          {
            ...staleTurn,
            rawTokenCountMetadata: makeExactTokenRecord(staleTurn.rawTokenCountMetadata!, 1111),
          },
        ],
      }),
    );

    expectOk(
      await fixture.store.writeTurnRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        turns: [
          {
            ...staleTurn,
            smooth: {
              ...staleTurn.smooth!,
              tokenCountMetadata: makeExactTokenRecord(staleTurn.smooth!.tokenCountMetadata!, 2222),
            },
          },
        ],
      }),
    );

    const finalSnapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const finalTurn = finalSnapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest)!;
    assert.equal(finalTurn.rawTokenCountMetadata?.count, 1111);
    assert.equal(finalTurn.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(finalTurn.smooth?.tokenCountMetadata?.count, 2222);
    assert.equal(finalTurn.smooth?.tokenCountMetadata?.source, "provider_input_count");
  });
});

test("SQLite turn row maintenance writes preserve newer omitted lower-band projection artifacts", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const staleTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest)!;
    assert.ok(staleTurn.smooth?.lowerBandProjection);

    expectOk(
      await fixture.store.writeTurnRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        turns: [
          {
            ...staleTurn,
            smooth: {
              ...staleTurn.smooth,
              lowerBandProjection: {
                ...staleTurn.smooth.lowerBandProjection,
                text: "Newer regenerated turn projection",
              },
            },
          },
        ],
      }),
    );

    expectOk(
      await fixture.store.writeTurnRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        turns: [
          {
            ...staleTurn,
            smooth: {
              ...staleTurn.smooth,
              tokenCountMetadata: makeExactTokenRecord(staleTurn.smooth.tokenCountMetadata!, 3333),
              lowerBandProjection: undefined,
            },
          },
        ],
      }),
    );

    const finalSnapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const finalTurn = finalSnapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest)!;
    assert.equal(finalTurn.smooth?.tokenCountMetadata?.count, 3333);
    assert.equal(finalTurn.smooth?.lowerBandProjection?.text, "Newer regenerated turn projection");
  });
});

test("SQLite chunk row maintenance writes preserve newer same-row derived fields", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const chunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const staleChunk = chunks.find((chunk) => chunk.chunkId === fixture.chunkIds.oldestClosed)!;
    if (!isCanonicalChunkState(staleChunk)) {
      throw new Error("Expected canonical chunk fixture.");
    }
    assert.ok(staleChunk.lowerBand?.detailed?.tokenCountMetadata);

    expectOk(
      await fixture.store.writeChunkRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        chunks: [
          {
            ...staleChunk,
            smoothTokenCountMetadata: makeExactTokenRecord(staleChunk.smoothTokenCountMetadata!, 4444),
          },
        ],
      }),
    );

    expectOk(
      await fixture.store.writeChunkRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        chunks: [
          {
            ...staleChunk,
            lowerBand: {
              ...staleChunk.lowerBand,
              detailed: {
                ...staleChunk.lowerBand!.detailed!,
                tokenCountMetadata: makeExactTokenRecord(staleChunk.lowerBand!.detailed!.tokenCountMetadata!, 5555),
              },
            },
          },
        ],
      }),
    );

    const finalChunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const finalChunk = finalChunks.find((chunk) => chunk.chunkId === fixture.chunkIds.oldestClosed)!;
    assert.equal(finalChunk.smoothTokenCountMetadata?.count, 4444);
    assert.equal(finalChunk.smoothTokenCountMetadata?.source, "provider_input_count");
    assert.equal(finalChunk.lowerBand?.detailed?.tokenCountMetadata?.count, 5555);
    assert.equal(finalChunk.lowerBand?.detailed?.tokenCountMetadata?.source, "provider_input_count");
  });
});

test("SQLite chunk row maintenance writes preserve newer omitted lower-band artifacts", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const chunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const staleChunk = chunks.find((chunk) => chunk.chunkId === fixture.chunkIds.oldestClosed)!;
    if (!isCanonicalChunkState(staleChunk)) {
      throw new Error("Expected canonical chunk fixture.");
    }
    assert.ok(staleChunk.lowerBand?.detailed);

    expectOk(
      await fixture.store.writeChunkRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        chunks: [
          {
            ...staleChunk,
            lowerBand: {
              ...staleChunk.lowerBand,
              detailed: {
                ...staleChunk.lowerBand.detailed,
                text: "Newer regenerated detailed chunk artifact",
              },
            },
          },
        ],
      }),
    );

    expectOk(
      await fixture.store.writeChunkRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        chunks: [
          {
            ...staleChunk,
            smoothTokenCountMetadata: makeExactTokenRecord(staleChunk.smoothTokenCountMetadata!, 6666),
            lowerBand: undefined,
          },
        ],
      }),
    );

    const finalChunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const finalChunk = finalChunks.find((chunk) => chunk.chunkId === fixture.chunkIds.oldestClosed)!;
    assert.equal(finalChunk.smoothTokenCountMetadata?.count, 6666);
    assert.equal(finalChunk.lowerBand?.detailed?.text, "Newer regenerated detailed chunk artifact");
    assert.equal(finalChunk.lowerBand?.brief?.status, "ready");
  });
});

test("SQLite token repair defers stale derived writes without clobbering newer canonical messages", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();
    let releaseRaw!: () => void;
    counter.pauseRawTurnIds.add(fixture.turnIds.newest);
    counter.rawTurnGate = new Promise<void>((resolve) => {
      releaseRaw = resolve;
    });

    const maintenance = maintainAsyncThread(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
        artifactRepairLimits: {
          maxSmoothTurns: 0,
          maxProjectionTurns: 0,
          maxTokenTurns: 1,
          maxTokenChunks: 0,
        },
      },
    );

    await waitForCall(counter, `raw:${fixture.turnIds.newest}`);
    expectOk(await fixture.store.appendMessage({
      threadId: fixture.threadId,
      actor: makeActorRecord({ actorId: "actor-human", actorType: "human" }),
      message: (() => {
        const message = makeMessageRecord({
          threadId: fixture.threadId,
          messageId: "message-maintenance-race",
          actorId: "actor-human",
          actorType: "human",
          messageKind: "prompt",
        });
        const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
        return pending;
      })(),
    }));
    releaseRaw();

    const result = await maintenance;
    assert.equal(result.tokenCountsReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "STALE_SOURCE_REVISION"), true);

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const newestTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest);
    assert.equal(snapshot.messages.some((message) => message.messageId === "message-maintenance-race"), true);
    assert.equal(newestTurn?.rawTokenCountMetadata?.source, "pi_heuristic");
    assert.equal(snapshot.thread.status.maintenance?.background?.status, "failed");
    assert.equal(
      snapshot.thread.status.maintenance?.background?.remainingDebt?.some(
        (debt) => debt.entityId === fixture.turnIds.newest && debt.category === "raw_turn_token",
      ),
      true,
    );
  });
});

test("dependent chunk readiness is invalidated when a source turn projection becomes stale", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const newestTurn = snapshot.turns.find((turn) => turn.turnId === fixture.turnIds.newest)!;
    const updatedTurn = {
      ...newestTurn,
      smooth: {
        ...newestTurn.smooth!,
        lowerBandProjection: {
          ...newestTurn.smooth!.lowerBandProjection!,
          status: "pending" as const,
          text: undefined,
          tokenCountMetadata: undefined,
        },
      },
    };

    expectOk(
      await fixture.store.writeTurnRows!({
        threadId: fixture.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        turns: [updatedTurn],
        turnState: snapshot.thread.status.turnState,
      }),
    );

    const updateResult = await updateChunkState(
      { threadId: fixture.threadId },
      { store: fixture.store },
    );
    assert.equal(updateResult.updatedChunkIds.includes(fixture.chunkIds.newestClosed), true);

    const chunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    const affectedChunk = chunks.find((chunk) => chunk.chunkId === fixture.chunkIds.newestClosed);
    assert.equal(affectedChunk?.conversationTranscript?.status, "pending");
    assert.equal(affectedChunk?.lowerBand?.detailed?.status, "ready");
    assert.equal(affectedChunk?.lowerBand?.brief?.status, "ready");
  });
});
