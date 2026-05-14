import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { OpenAIInputTokenCounter } from "../../src/token-accounting/index.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

const STAGE8_WRITE_READY_LOWER_BOUND = 2_000;
const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 1;
  },
}, "gpt-test");

function createPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(
        input.threadId,
        `${stamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

test("smart compact integration path writes, archives, and records generated output using real file-backed stores", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];
    const input = {
      threadId: seeded.threadId,
      requestedLowerBound: STAGE8_WRITE_READY_LOWER_BOUND,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
    } as const;

    const firstResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(firstResult.compactStatus, "success");
    assert.ok(firstResult.generatedFilePath);
    assert.equal(firstResult.blockers.length, 0);
    assert.equal(firstResult.generatedSessionCountPolicy?.status, "usable");
    assert.equal(firstResult.generatedSessionTokenCountMetadata?.source, "provider_input_count");
    assert.equal(firstResult.generatedSessionTokenCountMetadata?.trustClass, "exact");
    assert.equal(
      firstResult.blockers.some((issue) => issue.code === "GENERATED_SESSION_OVER_LOWER_BOUND"),
      false,
    );
    const firstContent = await readFile(firstResult.generatedFilePath!, "utf8");

    const secondResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:05:00.000Z"),
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: () => new Date("2026-01-01T00:05:00.000Z"),
    });

    assert.equal(secondResult.compactStatus, "success");
    assert.ok(secondResult.generatedFilePath);
    assert.equal(secondResult.blockers.length, 0);
    assert.equal(secondResult.blockers.some((issue) => issue.code === "GENERATED_SESSION_OVER_LOWER_BOUND"), false);
    assert.equal(secondResult.archivePath, undefined);
    assert.notEqual(secondResult.generatedFilePath, firstResult.generatedFilePath);
    assert.notEqual(await readFile(secondResult.generatedFilePath!, "utf8"), firstContent);
    assert.deepEqual(switchedTo, [firstResult.generatedFilePath!, secondResult.generatedFilePath!]);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, secondResult.generatedFilePath);
    assert.equal(thread.value.projections.at(-1)?.generatedFilePath, secondResult.generatedFilePath);
    assert.equal(thread.value.thread.threadViewOutputSummary.currentProjectionRevisionId, secondResult.projectionRevisionId);
    assert.equal(thread.value.thread.threadViewOutputSummary.currentThreadViewId, secondResult.threadViewId);
  });
});
