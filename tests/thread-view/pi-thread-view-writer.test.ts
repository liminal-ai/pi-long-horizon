import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";

import {
  makePiThreadViewFile,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import {
  writePiThreadViewFile,
} from "../../src/thread-view/targets/pi/pi-thread-view-writer.js";

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

test("PI-target file write is atomic", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-atomic",
      threadViewId: "thread-view-atomic",
    });

    const result = await writePiThreadViewFile(
      {
        threadId: file.threadId,
        threadViewId: file.threadViewId,
        file,
      },
      {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    assert.equal(result.archivePath, undefined);

    const lines = await readJsonLines(result.generatedFilePath);
    assert.equal((lines[0] as { type: string; version: number }).type, "session");
    assert.equal((lines[0] as { version: number }).version, CURRENT_SESSION_VERSION);
    assert.equal((lines[1] as { type: string; customType: string }).type, "custom");
    assert.equal(
      (lines[1] as { customType: string }).customType,
      "pi-long-horizon.thread-view.output",
    );
    assert.equal((lines[2] as { type: string }).type, "message");
  });
});

test("failed write does not leave partial current target", async () => {
  await withTempFeature3Store(async (context) => {
    const first = makePiThreadViewFile({
      threadId: "thread-write-failure",
      threadViewId: "thread-view-write-failure",
    });
    const resolver = createPathResolver(context);
    const firstResult = await writePiThreadViewFile(
      {
        threadId: first.threadId,
        threadViewId: first.threadViewId,
        file: first,
      },
      {
        pathResolver: resolver,
      },
    );
    const originalContent = await readFile(firstResult.generatedFilePath, "utf8");

    const second = makePiThreadViewFile({
      threadId: first.threadId,
      threadViewId: first.threadViewId,
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "replacement content",
          generatedSource: "smooth_turn",
        },
      ],
      entryCount: 1,
    });

    await assert.rejects(
      writePiThreadViewFile(
        {
          threadId: second.threadId,
          threadViewId: second.threadViewId,
          file: second,
        },
        {
          pathResolver: resolver,
          fs: {
            readFile,
            writeFile: async (filePath, content, encoding) =>
              import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, content, encoding)),
            rename: async (fromPath, toPath) => {
              if (toPath === firstResult.generatedFilePath) {
                throw new Error("simulated rename failure");
              }

              return import("node:fs/promises").then(({ rename }) => rename(fromPath, toPath));
            },
            rm: async (filePath, options) =>
              import("node:fs/promises").then(({ rm }) => rm(filePath, options)),
          },
        },
      ),
      /simulated rename failure/,
    );

    assert.equal(await readFile(firstResult.generatedFilePath, "utf8"), originalContent);
  });
});

test("prior output is archived on successful replacement", async () => {
  await withTempFeature3Store(async (context) => {
    const resolver = createPathResolver(context);
    const first = makePiThreadViewFile({
      threadId: "thread-archive",
      threadViewId: "thread-view-archive",
    });
    const second = makePiThreadViewFile({
      threadId: "thread-archive",
      threadViewId: "thread-view-archive",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "replacement content",
          generatedSource: "smooth_turn",
        },
      ],
      entryCount: 1,
    });

    const firstResult = await writePiThreadViewFile(
      {
        threadId: first.threadId,
        threadViewId: first.threadViewId,
        file: first,
      },
      {
        pathResolver: resolver,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );
    const firstContent = await readFile(firstResult.generatedFilePath, "utf8");

    const secondResult = await writePiThreadViewFile(
      {
        threadId: second.threadId,
        threadViewId: second.threadViewId,
        file: second,
      },
      {
        pathResolver: resolver,
        now: () => new Date("2026-01-01T00:05:00.000Z"),
      },
    );

    assert.ok(secondResult.archivePath);
    await access(secondResult.archivePath!);
    assert.equal(await readFile(secondResult.archivePath!, "utf8"), firstContent);
    assert.notEqual(await readFile(secondResult.generatedFilePath, "utf8"), firstContent);
  });
});

test("tool-result session entries preserve canonical tool metadata", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-tool-result",
      threadViewId: "thread-view-tool-result",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: {
            parts: [
              {
                partType: "tool_result",
                content: {
                  output: "tool output",
                  toolCallId: "call-production-001",
                  toolName: "bash",
                },
              },
            ],
          },
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-production-001",
            toolName: "bash",
          },
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      {
        threadId: file.threadId,
        threadViewId: file.threadViewId,
        file,
      },
      {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const toolResultEntry = lines[2] as {
      message: {
        role: string;
        toolCallId: string;
        toolName: string;
      };
    };

    assert.equal(toolResultEntry.message.role, "toolResult");
    assert.equal(toolResultEntry.message.toolCallId, "call-production-001");
    assert.equal(toolResultEntry.message.toolName, "bash");
  });
});

test("custom session entries preserve PI-native custom metadata", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-custom-role",
      threadViewId: "thread-view-custom-role",
      entries: [
        {
          entryType: "message",
          role: "custom",
          content: {
            actorType: "runtime",
            parts: [
              {
                partOrder: 1,
                partType: "unknown",
                content: {
                  raw: {
                    role: "custom",
                    customType: "context-steward.note",
                    content: "A compact custom note.",
                    display: false,
                    details: {
                      reason: "preserve-raw-message",
                    },
                    timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
                  },
                },
              },
            ],
          },
          generatedSource: "raw_turn_message",
          metadata: {
            piRole: "custom",
            rawType: "custom",
          },
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      {
        threadId: file.threadId,
        threadViewId: file.threadViewId,
        file,
      },
      {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const customEntry = lines[2] as {
      message: {
        role: string;
        customType: string;
        content: string;
        display: boolean;
        details: {
          reason: string;
        };
      };
    };

    assert.equal(customEntry.message.role, "custom");
    assert.equal(customEntry.message.customType, "context-steward.note");
    assert.equal(customEntry.message.content, "A compact custom note.");
    assert.equal(customEntry.message.display, false);
    assert.deepEqual(customEntry.message.details, { reason: "preserve-raw-message" });
  });
});
