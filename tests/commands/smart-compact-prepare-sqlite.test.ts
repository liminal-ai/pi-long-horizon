import assert from "node:assert/strict";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  createPathResolver,
  expectOk,
  fakeOpenAICounter,
  forceHeuristicOnlyCounts,
  importDeterministicRebuildThreadToSqlite,
} from "./helpers/smart-compact-sqlite-helpers.js";

const SQLITE_READY_LOWER_BOUND = 2_000;
const SQLITE_READY_BANDS = { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 } as const;

test("strict smart compact preserves readiness blockers while prepare mode performs full eligible SQLite catch-up", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);
    await forceHeuristicOnlyCounts(imported.sqliteStore, imported.threadId);

    const strictResult = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_READY_BANDS,
        mode: "strict",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(strictResult.compactStatus, "blocked");
    assert.equal(strictResult.generatedFilePath, undefined);
    assert.equal(strictResult.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);

    const afterStrict = expectOk(await imported.sqliteStore.openThread(imported.threadId));
    assert.equal(afterStrict.turns.some((turn) => turn.rawTokenCountMetadata?.source === "pi_heuristic"), true);

    const prepareResult = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_READY_BANDS,
        mode: "prepare",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.match(prepareResult.compactStatus, /^(success|degraded)$/);
    assert.ok(prepareResult.generatedFilePath);

    const repaired = expectOk(await imported.sqliteStore.openThread(imported.threadId));
    assert.equal(
      repaired.turns.every((turn) => turn.rawTokenCountMetadata?.source === "provider_input_count"),
      true,
    );
    assert.equal(
      repaired.turns.every((turn) => turn.smooth?.tokenCountMetadata?.source === "provider_input_count"),
      true,
    );
    assert.equal(repaired.thread.status.maintenance?.prepare?.scope, "full");
    assert.equal(repaired.thread.threadViewOutputSummary.generatedOutput?.generatedSessionTokenCount, prepareResult.generatedSessionTokenCount);
  });
});
