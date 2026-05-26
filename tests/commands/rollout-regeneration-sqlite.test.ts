import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  createPathResolver,
  expectOk,
  fakeOpenAICounter,
  importDeterministicRebuildThreadToSqlite,
} from "./helpers/smart-compact-sqlite-helpers.js";

const SQLITE_READY_LOWER_BOUND = 2_000;
const SQLITE_READY_BANDS = { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 } as const;

test("smart compact regenerates a missing rollout from SQLite and refreshes current projection metadata", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);

    const first = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_READY_BANDS,
        mode: "strict",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(first.compactStatus, "success");
    assert.ok(first.generatedFilePath);
    const before = expectOk(await imported.sqliteStore.openThread(imported.threadId));
    const canonicalMessageIds = before.messages.map((message) => message.messageId);

    await rm(first.generatedFilePath!, { force: true });

    const second = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_READY_BANDS,
        mode: "strict",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(second.compactStatus, "success");
    assert.ok(second.generatedFilePath);
    assert.notEqual(second.generatedFilePath, first.generatedFilePath);
    await access(second.generatedFilePath!);

    const after = expectOk(await imported.sqliteStore.openThread(imported.threadId));
    assert.deepEqual(after.messages.map((message) => message.messageId), canonicalMessageIds);
    assert.equal(after.projections.length, 2);
    assert.equal(after.thread.target.currentGeneratedFilePath, second.generatedFilePath);
    assert.equal(after.thread.threadViewOutputSummary.currentGeneratedFilePath, second.generatedFilePath);
    assert.equal(after.thread.threadViewOutputSummary.currentProjectionRevisionId, second.projectionRevisionId);
    assert.equal(after.thread.threadViewOutputSummary.generatedOutput?.generatedFilePath, second.generatedFilePath);
    assert.equal(after.thread.threadViewOutputSummary.generatedOutput?.generatedSessionTokenCount, second.generatedSessionTokenCount);
    assert.equal(after.projections.at(-1)?.generatedFilePath, second.generatedFilePath);
    assert.equal(after.projections.at(-1)?.compactSnapshot?.bands.detailed.selectedIds.length !== undefined, true);
  });
});
