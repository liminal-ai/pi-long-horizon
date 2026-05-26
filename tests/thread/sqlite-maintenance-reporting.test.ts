import assert from "node:assert/strict";
import test from "node:test";

import { maintainAsyncThread } from "../../src/thread/async-thread/services/async-thread-run-service.js";
import { repairThreadMaintenance } from "../../src/thread/async-thread/services/thread-maintenance-repair-service.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import {
  expectOk,
  FakeOpenAIInputTokenCounter,
  seedSqliteMaintenanceFixture,
} from "./helpers/sqlite-maintenance-helpers.js";

test("SQLite maintenance status reports run counts, blockers, and per-entity debt", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);

    await maintainAsyncThread(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
        artifactRepairLimits: {
          maxSmoothTurns: 0,
          maxProjectionTurns: 0,
          maxTokenTurns: 1,
          maxTokenChunks: 1,
        },
      },
    );

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const background = snapshot.thread.status.maintenance?.background;
    assert.equal(background?.scope, "bounded");
    assert.equal(background?.status, "repair_needed");
    assert.equal(background?.fixedCount! > 0, true);
    assert.equal(background?.failedCount, 0);
    assert.equal(background?.remainingDebtCount! > 0, true);
    assert.equal(background?.blockers?.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.equal(
      background?.remainingDebt?.some((debt) => debt.entityId === fixture.turnIds.oldest && debt.category === "raw_turn_token"),
      true,
    );
    assert.equal(
      background?.remainingDebt?.some((debt) => debt.entityId === fixture.chunkIds.newestClosed && debt.category === "chunk_smooth_token"),
      true,
    );
  });
});

test("bounded background backlog and failed manual repair remain distinguishable in SQLite thread status", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const backgroundCounter = new FakeOpenAIInputTokenCounter();

    await maintainAsyncThread(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: backgroundCounter,
        tokenCountModel: "gpt-test-maintenance",
        artifactRepairLimits: {
          maxSmoothTurns: 0,
          maxProjectionTurns: 0,
          maxTokenTurns: 1,
          maxTokenChunks: 0,
        },
      },
    );

    const failingCounter = new FakeOpenAIInputTokenCounter();
    failingCounter.failRawTurnIds.add(fixture.turnIds.oldest);
    await repairThreadMaintenance(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: failingCounter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const background = snapshot.thread.status.maintenance?.background;
    const manualRepair = snapshot.thread.status.maintenance?.manualRepair;
    assert.equal(background?.scope, "bounded");
    assert.equal(background?.status, "repair_needed");
    assert.equal(manualRepair?.scope, "full");
    assert.equal(manualRepair?.status, "failed");
    assert.equal(manualRepair?.blockers?.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.equal(manualRepair?.remainingDebtCount! > 0, true);
  });
});

test("already-clean SQLite background maintenance reports zero fixed rows", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const repairCounter = new FakeOpenAIInputTokenCounter();

    const repair = await repairThreadMaintenance(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: repairCounter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );
    assert.equal(repair.ok, true);

    const result = await maintainAsyncThread(
      { threadId: fixture.threadId },
      {
        store: fixture.store,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );
    assert.equal(result.artifactsReady, true);
    assert.equal(result.tokenCountsReady, true);

    const snapshot = expectOk(await fixture.store.openThread(fixture.threadId));
    const background = snapshot.thread.status.maintenance?.background;
    assert.equal(background?.scope, "bounded");
    assert.equal(background?.status, "ready");
    assert.equal(background?.fixedCount, 0);
    assert.equal(background?.skippedCount, 0);
    assert.equal(background?.failedCount, 0);
    assert.equal(background?.remainingDebtCount, 0);
  });
});
