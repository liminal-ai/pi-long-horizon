import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

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
      requestedLowerBound: 30,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
    } as const;

    const firstResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
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
    const firstContent = await readFile(firstResult.generatedFilePath!, "utf8");

    const secondResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
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
    assert.ok(secondResult.archivePath);
    await access(secondResult.archivePath!);
    assert.equal(await readFile(secondResult.archivePath!, "utf8"), firstContent);
    assert.deepEqual(switchedTo, [firstResult.generatedFilePath!, secondResult.generatedFilePath!]);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, secondResult.generatedFilePath);
    assert.equal(thread.value.projections.at(-1)?.generatedFilePath, secondResult.generatedFilePath);
  });
});
