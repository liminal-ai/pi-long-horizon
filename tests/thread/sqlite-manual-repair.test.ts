import assert from "node:assert/strict";
import test from "node:test";

import { repairThreadMaintenance } from "../../src/thread/async-thread/services/thread-maintenance-repair-service.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import {
  expectOk,
  FakeOpenAIInputTokenCounter,
  seedSqliteMaintenanceFixture,
} from "./helpers/sqlite-maintenance-helpers.js";

test("manual SQLite maintenance performs full catch-up and records a full-scope ready status", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await repairThreadMaintenance(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.value.summary.repaired > 0, true);
    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const chunks = expectOk(await fixture.store.readChunks(fixture.threadId));
    assert.equal(snapshot.thread.status.tokenCounting?.status, "ready");
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.scope, "full");
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.status, "ready");
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.remainingDebtCount, 0);
    assert.equal(snapshot.turns.every((turn) => turn.rawTokenCountMetadata?.source === "provider_input_count"), true);
    assert.equal(chunks.every((chunk) => chunk.smoothTokenCountMetadata?.trustClass === "exact"), true);
  });
});

test("successful full manual SQLite repair supersedes stale prepare and background debt records", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const before = expectOk(await fixture.store.openThread(fixture.threadId));
    expectOk(await fixture.store.updateThreadMetadata({
      threadId: fixture.threadId,
      expectedSourceRevision: before.thread.sourceRevision,
      patch: {
        status: {
          ...before.thread.status,
          maintenance: {
            prepare: {
              mode: "prepare",
              scope: "full",
              status: "repair_needed",
              updatedAt: "2026-05-19T00:00:00.000Z",
              sourceRevision: before.thread.sourceRevision,
              fixedCount: 0,
              skippedCount: 2,
              failedCount: 0,
              remainingDebtCount: 2,
              remainingDebt: [
                { category: "raw_turn_token", entityType: "turn", entityId: fixture.turnIds.oldest },
              ],
            },
            background: {
              mode: "background",
              scope: "bounded",
              status: "failed",
              updatedAt: "2026-05-19T00:05:00.000Z",
              sourceRevision: before.thread.sourceRevision,
              fixedCount: 0,
              skippedCount: 1,
              failedCount: 1,
              remainingDebtCount: 1,
              blockers: [{ code: "TOKEN_COUNT_BLOCKED", message: "stale background failure" }],
              remainingDebt: [
                { category: "chunk_smooth_token", entityType: "chunk", entityId: fixture.chunkIds.newestClosed },
              ],
            },
          },
        },
      },
    }));

    const result = await repairThreadMaintenance(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.ok, true);
    const after = expectOk(await fixture.store.openThread(fixture.threadId));
    assert.equal(after.thread.status.maintenance?.manualRepair?.status, "ready");
    assert.equal(after.thread.status.maintenance?.manualRepair?.remainingDebtCount, 0);
    assert.equal(after.thread.status.maintenance?.prepare, undefined);
    assert.equal(after.thread.status.maintenance?.background, undefined);
  });
});

test("manual SQLite maintenance persists provider failures without generating rollout metadata", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();
    counter.failRawTurnIds.add(fixture.turnIds.oldest);

    const result = await repairThreadMaintenance(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    assert.equal(snapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(snapshot.thread.threadViewOutputSummary.generatedOutput, undefined);
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.scope, "full");
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.status, "failed");
    assert.equal(snapshot.thread.status.maintenance?.manualRepair?.failedCount! > 0, true);
    assert.equal(
      snapshot.thread.status.maintenance?.manualRepair?.remainingDebt?.some(
        (debt) => debt.entityId === fixture.turnIds.oldest && debt.category === "raw_turn_token",
      ),
      true,
    );
  });
});
