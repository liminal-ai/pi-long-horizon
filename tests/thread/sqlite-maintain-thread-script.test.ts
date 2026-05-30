import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";

import { repairThreadMaintenance } from "../../src/thread/async-thread/services/thread-maintenance-repair-service.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import {
  expectOk,
  FakeOpenAIInputTokenCounter,
  seedSqliteMaintenanceFixture,
} from "./helpers/sqlite-maintenance-helpers.js";

test("standalone maintain-thread script opens canonical SQLite thread stores", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, resolveThreadPath, resolveThreadSqlitePath, storeRootDir }) => {
    const fixture = await seedSqliteMaintenanceFixture(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();
    const model = "gpt-test-maintenance";

    expectOk(
      await repairThreadMaintenance(
        { threadId: fixture.threadId },
        {
          store: fixture.store,
          openAIInputTokenCounter: counter,
          tokenCountModel: model,
        },
      ),
    );

    assert.equal(existsSync(resolveThreadSqlitePath(fixture.threadId)), true);
    assert.equal(existsSync(resolveThreadPath(fixture.threadId, "thread.json")), false);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/maintain-thread.ts",
        "--root",
        projectDir,
        "--thread",
        fixture.threadId,
        "--token-count-model",
        model,
        "--json",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.includes("thread.json"), false, result.stderr);
    assert.equal(result.stderr.includes("STORE_UNAVAILABLE"), false, result.stderr);

    const parsed = JSON.parse(result.stdout) as { ok: boolean; value?: { threadId: string } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value?.threadId, fixture.threadId);
  });
});
