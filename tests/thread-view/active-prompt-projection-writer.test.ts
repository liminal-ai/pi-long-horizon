import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { makePiThreadViewFile, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { writePiThreadViewFile } from "../../src/thread-view/targets/pi/pi-thread-view-writer.js";
import { refreshActivePromptProjectionFile } from "../../src/thread-view/targets/pi/active-prompt-projection-writer.js";

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

async function readJsonLines(filePath: string): Promise<unknown[]> {
  return (await readFile(filePath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test("active prompt projection writer truncates only matching tool-result session entries", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-active-projection",
      threadViewId: "thread-view-active-projection",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: "A".repeat(200),
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-rewrite-001",
            toolName: "read",
          },
        },
        {
          entryType: "message",
          role: "toolResult",
          content: "B".repeat(200),
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-rewrite-002",
            toolName: "read",
          },
        },
      ],
      entryCount: 2,
    });
    const written = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const refreshed = await refreshActivePromptProjectionFile({
      generatedFilePath: written.generatedFilePath,
      decisions: [
        {
          toolCallId: "call-rewrite-001",
          truncatedCharLimit: 16,
          rawZoneTokenThreshold: 100,
        },
      ],
    });

    assert.equal(refreshed.updated, true);
    assert.deepEqual(refreshed.updatedToolCallIds, ["call-rewrite-001"]);
    assert.deepEqual(refreshed.cleanableToolCallIds, ["call-rewrite-001"]);

    const lines = await readJsonLines(written.generatedFilePath);
    const firstToolResult = lines[2] as { message: { content: Array<{ text: string }> } };
    const secondToolResult = lines[3] as { message: { content: Array<{ text: string }> } };

    assert.equal(firstToolResult.message.content[0]?.text, `${"A".repeat(16)}...`);
    assert.equal(secondToolResult.message.content[0]?.text, "B".repeat(200));
  });
});

test("active prompt projection writer reports already-current matching entries", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-active-projection-current",
      threadViewId: "thread-view-active-projection-current",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: `${"A".repeat(16)}...`,
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-current-001",
            toolName: "read",
          },
        },
      ],
      entryCount: 1,
    });
    const written = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const refreshed = await refreshActivePromptProjectionFile({
      generatedFilePath: written.generatedFilePath,
      decisions: [
        {
          toolCallId: "call-current-001",
          truncatedCharLimit: 16,
          rawZoneTokenThreshold: 100,
        },
      ],
    });

    assert.equal(refreshed.updated, false);
    assert.equal(refreshed.skippedReason, "already_current");
    assert.deepEqual(refreshed.updatedToolCallIds, []);
    assert.deepEqual(refreshed.cleanableToolCallIds, ["call-current-001"]);
  });
});

test("active prompt projection writer reports cleanable entries for mixed already-current and updated matches", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-active-projection-mixed",
      threadViewId: "thread-view-active-projection-mixed",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: `${"A".repeat(16)}...`,
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-mixed-current",
            toolName: "read",
          },
        },
        {
          entryType: "message",
          role: "toolResult",
          content: "B".repeat(200),
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-mixed-updated",
            toolName: "read",
          },
        },
      ],
      entryCount: 2,
    });
    const written = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const refreshed = await refreshActivePromptProjectionFile({
      generatedFilePath: written.generatedFilePath,
      decisions: [
        {
          toolCallId: "call-mixed-current",
          truncatedCharLimit: 16,
          rawZoneTokenThreshold: 100,
        },
        {
          toolCallId: "call-mixed-updated",
          truncatedCharLimit: 16,
          rawZoneTokenThreshold: 100,
        },
      ],
    });

    assert.equal(refreshed.updated, true);
    assert.deepEqual(refreshed.updatedToolCallIds, ["call-mixed-updated"]);
    assert.deepEqual(refreshed.cleanableToolCallIds, ["call-mixed-current", "call-mixed-updated"]);
  });
});

test("active prompt projection writer skips the rename when the file changes during refresh", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-active-projection-race",
      threadViewId: "thread-view-active-projection-race",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: "R".repeat(200),
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-race-writer-001",
            toolName: "read",
          },
        },
      ],
      entryCount: 1,
    });
    const written = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const refreshed = await refreshActivePromptProjectionFile(
      {
        generatedFilePath: written.generatedFilePath,
        decisions: [
          {
            toolCallId: "call-race-writer-001",
            truncatedCharLimit: 16,
            rawZoneTokenThreshold: 100,
          },
        ],
      },
      {
        fs: {
          mkdir,
          readFile,
          rename,
          rm,
          stat,
          writeFile: async (filePath, content, encoding) => {
            await writeFile(filePath, content, encoding);
            if (filePath.includes(".prompt-projection.tmp")) {
              await appendFile(written.generatedFilePath, " ");
            }
          },
        },
      },
    );

    assert.equal(refreshed.updated, false);
    assert.equal(refreshed.skippedReason, "changed_during_write");
    assert.deepEqual(refreshed.updatedToolCallIds, []);
    assert.deepEqual(refreshed.cleanableToolCallIds, []);
  });
});
