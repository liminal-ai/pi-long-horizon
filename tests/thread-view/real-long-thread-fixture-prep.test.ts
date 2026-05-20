import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ThreadRecord } from "../../src/thread/domain/records.js";
import type { ThreadViewRecord } from "../../src/thread-view/domain/thread-view-records.js";
import { createTempFeature3StoreContext } from "../../src/thread-view/test/fixtures.js";
import {
  prepareRealLongThreadFixtureClone,
  rewriteGeneratedPath,
  rewriteSourceTargetPath,
} from "./real-long-thread-fixture-prep.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

test("real long-thread prep rewrites generated and source-target paths for cloned stores", () => {
  const sourceStoreRootDir = "/repo/.context-steward";
  const sourceThreadDir = "/repo/.context-steward/threads/thread-001";
  const targetThreadDir = "/tmp/pi-long-horizon/threads/thread-001";

  assert.equal(
    rewriteGeneratedPath(
      sourceThreadDir,
      targetThreadDir,
      "/repo/.context-steward/threads/thread-001/generated/output.jsonl",
    ),
    "/tmp/pi-long-horizon/threads/thread-001/generated/output.jsonl",
  );
  assert.equal(
    rewriteGeneratedPath(
      sourceThreadDir,
      targetThreadDir,
      "/repo/.context-steward/threads/thread-001/archives/pi-thread-views/archive.jsonl",
    ),
    "/tmp/pi-long-horizon/threads/thread-001/archives/pi-thread-views/archive.jsonl",
  );
  assert.equal(
    rewriteSourceTargetPath(sourceStoreRootDir, "fixtures/real-pi-session/session.jsonl"),
    resolve(sourceStoreRootDir, "..", "fixtures/real-pi-session/session.jsonl"),
  );
  assert.equal(
    rewriteSourceTargetPath(sourceStoreRootDir, "/already/absolute/session.jsonl"),
    "/already/absolute/session.jsonl",
  );
});

test("real long-thread prep helper redistributes the old pseudo-test invariants into focused assertions", async () => {
  const context = await createTempFeature3StoreContext("real-long-thread-prep-");

  try {
    const prepared = await prepareRealLongThreadFixtureClone({
      targetStoreRootDir: context.storeRootDir,
    });
    const thread = expectOk(await prepared.threadStore.openThread(prepared.threadId)).thread;
    const activeThreadView = JSON.parse(
      await readFile(
        context.resolveThreadViewsPath(prepared.threadId, prepared.activeThreadViewId, "thread-view.json"),
        "utf8",
      ),
    ) as ThreadViewRecord;
    const persistedThread = JSON.parse(
      await readFile(context.resolveThreadPath(prepared.threadId, "thread.json"), "utf8"),
    ) as ThreadRecord;

    assert.match(prepared.activeGeneratedFilePath, new RegExp(`^${context.storeRootDir}`));
    assert.equal(prepared.selectedChunkIds.length > 0, true);
    assert.equal(prepared.normalizedChunkIds.length > 0, true);
    assert.equal(prepared.preparedSemanticChunkIds.length > 0, true);
    assert.equal(thread.activeThreadViewId, prepared.activeThreadViewId);
    assert.equal(activeThreadView.state, "active");
    assert.equal(persistedThread.activeThreadViewId, prepared.activeThreadViewId);
    assert.equal(thread.target.sessionFilePath, undefined);
  } finally {
    await context.cleanup();
  }
});
