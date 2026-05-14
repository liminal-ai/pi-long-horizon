import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { buildSessionContext, CURRENT_SESSION_VERSION, type SessionEntry } from "@earendil-works/pi-coding-agent";

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

test("assistant tool calls use the same canonical IDs as their tool results", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-tool-call-match",
      threadViewId: "thread-view-tool-call-match",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: {
            parts: [
              {
                partType: "tool_call",
                content: {
                  toolCallId: "call-production-001",
                  toolName: "bash",
                  arguments: { cmd: "pwd" },
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
        {
          entryType: "message",
          role: "toolResult",
          content: "tool output",
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-production-001",
            toolName: "bash",
          },
        },
      ],
      entryCount: 2,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const assistantEntry = lines[2] as {
      message: {
        content: Array<{ type: string; id?: string }>;
      };
    };
    const toolResultEntry = lines[3] as {
      message: {
        toolCallId: string;
      };
    };

    assert.equal(assistantEntry.message.content[0]?.type, "toolCall");
    assert.equal(assistantEntry.message.content[0]?.id, "call-production-001");
    assert.equal(toolResultEntry.message.toolCallId, "call-production-001");
    assert.equal(assistantEntry.message.content[0]?.id, toolResultEntry.message.toolCallId);
  });
});

test("assistant turns with multiple tool calls preserve per-call IDs", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-multi-tool-call-match",
      threadViewId: "thread-view-multi-tool-call-match",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: {
            parts: [
              {
                partType: "tool_call",
                content: {
                  id: "call-production-001",
                  name: "read",
                  arguments: { filePath: "README.md" },
                },
              },
              {
                partType: "tool_call",
                content: {
                  toolCallId: "call-production-002",
                  toolName: "bash",
                  arguments: { cmd: "npm test" },
                },
              },
            ],
          },
          generatedSource: "raw_turn_message",
        },
        {
          entryType: "message",
          role: "toolResult",
          content: "read output",
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-production-001",
            toolName: "read",
          },
        },
        {
          entryType: "message",
          role: "toolResult",
          content: "test output",
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-production-002",
            toolName: "bash",
          },
        },
      ],
      entryCount: 3,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const assistantEntry = lines[2] as {
      message: {
        content: Array<{ type: string; id?: string }>;
      };
    };
    const toolResultEntries = lines.slice(3, 5) as Array<{
      message: {
        toolCallId: string;
      };
    }>;

    assert.deepEqual(
      assistantEntry.message.content.map((block) => block.id),
      ["call-production-001", "call-production-002"],
    );
    assert.deepEqual(
      toolResultEntries.map((entry) => entry.message.toolCallId),
      ["call-production-001", "call-production-002"],
    );
  });
});

test("assistant tool calls without real IDs fail fast", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-missing-tool-call-id",
      threadViewId: "thread-view-missing-tool-call-id",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: {
            parts: [
              {
                partType: "tool_call",
                content: {
                  toolName: "bash",
                  arguments: { cmd: "pwd" },
                },
              },
            ],
          },
          generatedSource: "raw_turn_message",
        },
      ],
      entryCount: 1,
    });

    await assert.rejects(
      writePiThreadViewFile(
        { threadId: file.threadId, threadViewId: file.threadViewId, file },
        { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
      ),
      /Assistant tool_call part is missing a tool call ID\./,
    );
  });
});

test("model and thinking settings serialize before message entries and restore without defaults", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-settings",
      threadViewId: "thread-view-settings",
      modelProvider: "openai-codex",
      modelId: "gpt-5.5",
      thinkingLevel: "low",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "Visible raw assistant message",
          generatedSource: "raw_turn_message",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const modelEntry = lines[2] as { type: string; provider: string; modelId: string };
    const thinkingEntry = lines[3] as { type: string; thinkingLevel: string };
    const messageEntry = lines[4] as {
      type: string;
      parentId: string;
      message: {
        provider: string;
        model: string;
      };
    };
    const sessionContext = buildSessionContext(lines.slice(1) as SessionEntry[]);

    // PI restores resume settings by replaying the active path; assistant entries also
    // contribute model state, so generated assistant metadata must stay aligned.
    assert.equal(modelEntry.type, "model_change");
    assert.equal(modelEntry.provider, "openai-codex");
    assert.equal(modelEntry.modelId, "gpt-5.5");
    assert.equal(thinkingEntry.type, "thinking_level_change");
    assert.equal(thinkingEntry.thinkingLevel, "low");
    assert.equal(messageEntry.type, "message");
    assert.equal(messageEntry.parentId, "thread-view-thinking-level-change-001");
    assert.equal(messageEntry.message.provider, "openai-codex");
    assert.equal(messageEntry.message.model, "gpt-5.5");
    assert.deepEqual(sessionContext.model, {
      provider: "openai-codex",
      modelId: "gpt-5.5",
    });
    assert.equal(sessionContext.thinkingLevel, "low");
  });
});

test("model and thinking settings are omitted when not provided", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-no-settings",
      threadViewId: "thread-view-no-settings",
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);

    assert.equal(lines.some((line) => (line as { type?: string }).type === "model_change"), false);
    assert.equal(lines.some((line) => (line as { type?: string }).type === "thinking_level_change"), false);
    assert.equal((lines[2] as { type: string }).type, "message");
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

test("smooth-turn entries serialize as hidden custom messages", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-smooth-custom",
      threadViewId: "thread-view-smooth-custom",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "Smooth compacted content",
          generatedSource: "smooth_turn",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const entry = lines[2] as {
      message: {
        role: string;
        customType: string;
        display: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };

    assert.equal(entry.message.role, "custom");
    assert.equal(entry.message.customType, "pi-long-horizon.compacted-content");
    assert.equal(entry.message.display, false);
    assert.deepEqual(entry.message.content, [{ type: "text", text: "Smooth compacted content" }]);
  });
});

test("detailed chunk summary entries serialize as hidden custom messages", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-detailed-custom",
      threadViewId: "thread-view-detailed-custom",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "Detailed compacted content",
          generatedSource: "detailed_chunk_summary",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const entry = lines[2] as {
      message: {
        role: string;
        customType: string;
        display: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };

    assert.equal(entry.message.role, "custom");
    assert.equal(entry.message.customType, "pi-long-horizon.compacted-content");
    assert.equal(entry.message.display, false);
    assert.deepEqual(entry.message.content, [{ type: "text", text: "Detailed compacted content" }]);
  });
});

test("brief chunk summary entries serialize as hidden custom messages", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-brief-custom",
      threadViewId: "thread-view-brief-custom",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "Brief compacted content",
          generatedSource: "brief_chunk_summary",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const entry = lines[2] as {
      message: {
        role: string;
        customType: string;
        display: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };

    assert.equal(entry.message.role, "custom");
    assert.equal(entry.message.customType, "pi-long-horizon.compacted-content");
    assert.equal(entry.message.display, false);
    assert.deepEqual(entry.message.content, [{ type: "text", text: "Brief compacted content" }]);
  });
});

test("raw turn messages preserve their PI-visible role serialization", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-raw-visible",
      threadViewId: "thread-view-raw-visible",
      entries: [
        {
          entryType: "message",
          role: "user",
          content: "Visible raw turn message",
          generatedSource: "raw_turn_message",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const entry = lines[2] as { message: { role: string } };

    assert.equal(entry.message.role, "user");
  });
});

test("raw assistant turn messages preserve PI assistant serialization metadata", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-raw-assistant-visible",
      threadViewId: "thread-view-raw-assistant-visible",
      entries: [
        {
          entryType: "message",
          role: "assistant",
          content: "Visible raw assistant message",
          generatedSource: "raw_turn_message",
        },
      ],
      entryCount: 1,
    });

    const result = await writePiThreadViewFile(
      { threadId: file.threadId, threadViewId: file.threadViewId, file },
      { pathResolver: createPathResolver(context), now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const lines = await readJsonLines(result.generatedFilePath);
    const entry = lines[2] as {
      message: {
        role: string;
        api: string;
        provider: string;
        model: string;
        content: Array<{ type: string; text: string }>;
      };
    };

    assert.equal(entry.message.role, "assistant");
    assert.equal(entry.message.api, "pi-long-horizon");
    assert.equal(entry.message.provider, "pi-long-horizon");
    assert.equal(entry.message.model, "generated-thread-view");
    assert.deepEqual(entry.message.content, [{ type: "text", text: "Visible raw assistant message" }]);
  });
});
