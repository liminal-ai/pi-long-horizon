import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedPlaceholderThread,
} from "../thread-view/helpers.js";

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

async function normalizeClosedChunkTokenCounts(
  context: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>,
) {
  const chunks = await context.threadStore.readChunks(context.threadId);
  assert.equal(chunks.ok, true);

  const thread = await context.threadStore.openThread(context.threadId);
  assert.equal(thread.ok, true);

  await context.threadStore.writeChunks({
    threadId: context.threadId,
    expectedSourceRevision: thread.value.thread.sourceRevision,
    expectedMessageHighWatermark: thread.value.thread.messageHighWatermark,
    expectedTurnsRevision: thread.value.thread.turnsRevision,
    chunks: chunks.value.map((chunk) =>
      chunk.lifecycleStatus === "closed" && chunk.smoothText
        ? {
            ...chunk,
            smoothTokenCount: estimateDeterministicTokenCount(chunk.smoothText),
          }
        : chunk),
  });
}

test("smart compact E2E prepare flow repairs missing deterministic artifacts and archives on replacement", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);
    await normalizeClosedChunkTokenCounts(seeded);
    const switchedTo: string[] = [];
    const input = {
      threadId: seeded.threadId,
      requestedLowerBound: 100,
      requestedBandPercentages: { fullFidelity: 10, smooth: 5, detailed: 70, brief: 15 },
      mode: "prepare",
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
    assert.match(await readFile(firstResult.generatedFilePath!, "utf8"), /\[deterministic-placeholder:detailed\]/);

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
    assert.deepEqual(switchedTo, [firstResult.generatedFilePath!, secondResult.generatedFilePath!]);
  });
});
