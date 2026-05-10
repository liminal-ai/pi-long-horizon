import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";

import {
  createContentFingerprint,
  createSourceRange,
  createStableId,
  deriveTargetSessionKeys,
  sortSourceRanges,
} from "../../src/context-steward/domain/ids.js";
import {
  THREAD_SCHEMA_VERSION,
  createStewardRootIndex,
  createThreadRecord,
} from "../../src/context-steward/domain/records.js";
import {
  DEFAULT_PI_MESSAGE_TIMESTAMP,
  DEFAULT_PI_USAGE,
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiSessionEntries,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";

function assertType<T>(_value: T): void {}

test("id and content fingerprint helpers are deterministic", () => {
  const target = makeThreadTarget({
    sessionId: "session-123",
    sessionFilePath: "./relative/session.jsonl",
  });
  const normalizeSessionFilePath = (sessionFilePath: string) => `/normalized/${sessionFilePath}`;

  const firstKeySet = deriveTargetSessionKeys(target, { normalizeSessionFilePath });
  const secondKeySet = deriveTargetSessionKeys(target, { normalizeSessionFilePath });

  assert.deepEqual(firstKeySet, secondKeySet);
  assert.deepEqual(firstKeySet, {
    canonicalKey: "pi:session-id:session-123",
    aliasKeys: ["pi:session-file:/normalized/./relative/session.jsonl"],
  });

  const stableRange = createSourceRange(4, 2);
  const firstStableId = createStableId("turn", { target: firstKeySet, range: stableRange });
  const secondStableId = createStableId("turn", {
    range: createSourceRange(2, 4),
    target: secondKeySet,
  });

  assert.equal(firstStableId, secondStableId);
  assert.equal(stableRange.fromSourceOrder, 2);
  assert.equal(stableRange.toSourceOrder, 4);

  const firstFingerprint = createContentFingerprint({
    role: "assistant",
    content: [{ type: "text", text: "hello" }, { type: "thinking", thinking: "step", thinkingSignature: "sig-1" }],
  });
  const secondFingerprint = createContentFingerprint({
    content: [{ text: "hello", type: "text" }, { thinking: "step", thinkingSignature: "sig-1", type: "thinking" }],
    role: "assistant",
  });
  const changedFingerprint = createContentFingerprint({
    role: "assistant",
    content: [
      { type: "text", text: "different" },
      { type: "thinking", thinking: "step", thinkingSignature: "sig-1" },
    ],
  });

  assert.equal(firstFingerprint, secondFingerprint);
  assert.notEqual(firstFingerprint, changedFingerprint);
  assert.deepEqual(
    sortSourceRanges([createSourceRange(10, 11), createSourceRange(1), createSourceRange(4, 5)]),
    [createSourceRange(1), createSourceRange(4, 5), createSourceRange(10, 11)],
  );
});

test("deriveTargetSessionKeys collapses alias and symlink session file paths to one realpath key", async () => {
  await withTempThreadStore(async ({ resolveProjectPath }) => {
    const sessionsDir = resolveProjectPath("pi-sessions");
    const aliasesDir = resolveProjectPath("aliases");
    const sessionFilePath = resolveProjectPath("pi-sessions", "session-123.jsonl");
    const aliasSessionFilePath = join(sessionsDir, "..", "pi-sessions", "session-123.jsonl");
    const symlinkSessionFilePath = resolveProjectPath("aliases", "session-123-link.jsonl");

    await mkdir(sessionsDir, { recursive: true });
    await mkdir(aliasesDir, { recursive: true });
    await writeFile(sessionFilePath, '{"type":"message"}\n');
    await symlink(sessionFilePath, symlinkSessionFilePath);

    const expectedFileKey = `pi:session-file:${realpathSync(sessionFilePath)}`;

    assert.deepEqual(
      deriveTargetSessionKeys(makeThreadTarget({ sessionId: undefined, sessionFilePath })),
      {
        canonicalKey: expectedFileKey,
        aliasKeys: [],
      },
    );
    assert.deepEqual(
      deriveTargetSessionKeys(
        makeThreadTarget({
          sessionId: undefined,
          sessionFilePath: aliasSessionFilePath,
        }),
      ),
      {
        canonicalKey: expectedFileKey,
        aliasKeys: [],
      },
    );
    assert.deepEqual(
      deriveTargetSessionKeys(
        makeThreadTarget({
          sessionId: undefined,
          sessionFilePath: symlinkSessionFilePath,
        }),
      ),
      {
        canonicalKey: expectedFileKey,
        aliasKeys: [],
      },
    );
    assert.deepEqual(
      deriveTargetSessionKeys(
        makeThreadTarget({
          sessionId: "session-123",
          sessionFilePath: symlinkSessionFilePath,
        }),
      ),
      {
        canonicalKey: "pi:session-id:session-123",
        aliasKeys: [expectedFileKey],
      },
    );
  });
});

test("schema-version constants match thread initialization", () => {
  const target = makeThreadTarget({
    currentGeneratedFilePath: "/tmp/generated/session-123.jsonl",
  });

  const thread = createThreadRecord({
    threadId: "thread-123",
    target,
    createdAt: "2026-05-09T12:00:00.000Z",
  });
  const rootIndex = createStewardRootIndex();

  assert.equal(THREAD_SCHEMA_VERSION, "context-steward.thread.v1");
  assert.equal(thread.schemaVersion, THREAD_SCHEMA_VERSION);
  assert.equal(thread.createdSchemaVersion, THREAD_SCHEMA_VERSION);
  assert.equal(thread.lastMigratedSchemaVersion, THREAD_SCHEMA_VERSION);
  assert.equal(rootIndex.schemaVersion, THREAD_SCHEMA_VERSION);
  assert.deepEqual(rootIndex.threadByTargetKey, {});

  assert.equal(thread.sourceRevision, 0);
  assert.equal(thread.messageHighWatermark, 0);
  assert.deepEqual(thread.importSummary, { count: 0 });
  assert.deepEqual(thread.projectionSummary, {
    count: 0,
    currentGeneratedFilePath: "/tmp/generated/session-123.jsonl",
  });
  assert.deepEqual(thread.status, { turnState: "unknown" });
  assert.deepEqual(thread.indexes, { targetEventKeys: {} });
  assert.deepEqual(thread.target, target);
});

test("PI fixture builders match installed message and session entry contracts", () => {
  const user = makePiUserMessage({
    content: [
      { type: "text", text: "Inspect this image." },
      { type: "image", data: "aW1hZ2UtZGF0YQ==", mimeType: "image/png" },
    ],
  });
  const assistant = makePiAssistantMessage({
    content: [
      { type: "text", text: "Running the read tool." },
      { type: "thinking", thinking: "Need file contents first.", thinkingSignature: "sig-thinking-001" },
      { type: "toolCall", id: "call-123", name: "read", arguments: { path: "README.md" } },
    ],
  });
  const toolResult = makePiToolResultMessage({
    content: [
      { type: "text", text: "file contents" },
      { type: "image", data: "c2NyZWVuc2hvdA==", mimeType: "image/png" },
    ],
  });
  const entries = makePiSessionEntries({
    startedAt: DEFAULT_TEST_TIMESTAMP,
    messages: [user, assistant, toolResult],
  });

  assertType<UserMessage>(user);
  assertType<AssistantMessage>(assistant);
  assertType<ToolResultMessage>(toolResult);
  assertType<SessionMessageEntry>(entries[0]);
  assertType<SessionMessageEntry>(entries[1]);
  assertType<SessionMessageEntry>(entries[2]);

  assert.deepEqual(user, {
    role: "user",
    content: [
      { type: "text", text: "Inspect this image." },
      { type: "image", data: "aW1hZ2UtZGF0YQ==", mimeType: "image/png" },
    ],
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
  });
  assert.deepEqual(assistant, {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    content: [
      { type: "text", text: "Running the read tool." },
      { type: "thinking", thinking: "Need file contents first.", thinkingSignature: "sig-thinking-001" },
      { type: "toolCall", id: "call-123", name: "read", arguments: { path: "README.md" } },
    ],
    usage: DEFAULT_PI_USAGE,
    stopReason: "stop",
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
  });
  assert.deepEqual(toolResult, {
    role: "toolResult",
    toolCallId: "call-001",
    toolName: "bash",
    content: [
      { type: "text", text: "file contents" },
      { type: "image", data: "c2NyZWVuc2hvdA==", mimeType: "image/png" },
    ],
    isError: false,
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
  });

  assert.deepEqual(entries, [
    {
      type: "message",
      id: "entry-001",
      parentId: null,
      timestamp: DEFAULT_TEST_TIMESTAMP,
      message: user,
    },
    {
      type: "message",
      id: "entry-002",
      parentId: "entry-001",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: assistant,
    },
    {
      type: "message",
      id: "entry-003",
      parentId: "entry-002",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: toolResult,
    },
  ]);
});
