import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import {
  makePiThreadViewFile,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import { writePiThreadViewFile } from "../../src/thread-view/targets/pi/pi-thread-view-writer.js";

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

test("real file-backed PI output can be written, archived, and loaded through the harness adapter", async () => {
  await withTempFeature3Store(async (context) => {
    const resolver = createPathResolver(context);
    const initial = makePiThreadViewFile({
      threadId: "thread-writer-integration",
      threadViewId: "thread-view-writer-integration",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "first generated content",
          generatedSource: "smooth_turn",
        },
      ],
      entryCount: 1,
    });

    const replacement = makePiThreadViewFile({
      threadId: initial.threadId,
      threadViewId: initial.threadViewId,
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "second generated content",
          generatedSource: "smooth_turn",
        },
      ],
      entryCount: 1,
    });

    const firstWrite = await writePiThreadViewFile(
      {
        threadId: initial.threadId,
        threadViewId: initial.threadViewId,
        file: initial,
      },
      {
        pathResolver: resolver,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );
    const firstContent = await readFile(firstWrite.generatedFilePath, "utf8");

    const secondWrite = await writePiThreadViewFile(
      {
        threadId: replacement.threadId,
        threadViewId: replacement.threadViewId,
        file: replacement,
      },
      {
        pathResolver: resolver,
        now: () => new Date("2026-01-01T00:05:00.000Z"),
      },
    );

    assert.ok(secondWrite.archivePath);
    await access(secondWrite.archivePath!);
    assert.equal(await readFile(secondWrite.archivePath!, "utf8"), firstContent);

    const switchedTo: string[] = [];
    const adapter = createPiCliHarnessAdapter({
      switchSession: async (sessionPath) => {
        switchedTo.push(sessionPath);
        return { cancelled: false };
      },
    });

    const loadResult = await adapter.loadThreadViewFile({
      threadId: replacement.threadId,
      threadViewId: replacement.threadViewId,
      filePath: secondWrite.generatedFilePath,
    });

    assert.equal(loadResult.ok, true);
    assert.deepEqual(switchedTo, [secondWrite.generatedFilePath]);
    assert.match(await readFile(secondWrite.generatedFilePath, "utf8"), /second generated content/);
  });
});
