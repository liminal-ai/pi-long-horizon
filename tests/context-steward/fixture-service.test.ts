import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardErrorCode, StewardResult } from "../../src/context-steward/domain/errors.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { updateGeneratedThreadViewOutputMetadata, openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiSessionEntries,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function expectIssueCode<T>(result: StewardResult<T>, code: StewardErrorCode): void {
  const issues = result.ok ? (result.issues ?? []) : result.issues;
  assert.ok(issues.some((issue) => issue.code === code), `Expected ${code}, received ${issues.map((issue) => issue.code).join(", ")}`);
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n');
}

async function writePiSessionFile(input: {
  sessionFilePath: string;
  sessionId: string;
  cwd: string;
  entries: readonly SessionEntry[];
}): Promise<void> {
  await mkdir(dirname(input.sessionFilePath), { recursive: true });

  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.sessionId,
    timestamp: DEFAULT_TEST_TIMESTAMP,
    cwd: input.cwd,
  };

  const lines = [JSON.stringify(header), ...input.entries.map((entry) => JSON.stringify(entry))];
  await writeFile(input.sessionFilePath, `${lines.join("\n")}\n`, "utf8");
}

async function createSessionFixture(
  resolveProjectPath: (...segments: string[]) => string,
  options: {
    sessionId?: string;
    entries: readonly SessionEntry[];
    cwd?: string;
  },
) {
  const sessionId = options.sessionId ?? "session-001";
  const cwd = options.cwd ?? resolveProjectPath("project");
  const sessionFilePath = resolveProjectPath("pi-sessions", `${sessionId}.jsonl`);

  await writePiSessionFile({
    sessionFilePath,
    sessionId,
    cwd,
    entries: options.entries,
  });

  return makeThreadTarget({
    sessionId,
    sessionFilePath,
    cwd,
  });
}

async function createManagedThread(storeRootDir: string, target = makeThreadTarget()) {
  await ensureTargetSessionFile(target);

  const store = new FileThreadStore(storeRootDir);
  const thread = expectOk(await openOrCreateManagedThread({ target }, store));
  const ctx = makePiExtensionContext(target);

  return { store, thread, ctx, target };
}

async function capturePiMessage(
  store: FileThreadStore,
  threadId: string,
  ctx: ReturnType<typeof makePiExtensionContext>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(mapPiMessageEnd({ message, ctx }));

  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
    }),
  );
}

async function readFixtureJson<T>(
  resolveStorePath: (...segments: string[]) => string,
  fixtureId: string,
  fileName: string,
): Promise<T> {
  return JSON.parse(await readFile(resolveStorePath("fixtures", fixtureId, fileName), "utf8")) as T;
}

async function readFixtureMessages(
  resolveStorePath: (...segments: string[]) => string,
  fixtureId: string,
) {
  const content = await readFile(resolveStorePath("fixtures", fixtureId, "messages.jsonl"), "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Awaited<ReturnType<FileThreadStore["readMessages"]>> extends StewardResult<infer TValue>
      ? TValue extends Array<infer TMessage>
        ? TMessage
        : never
      : never);
}

async function clearTurnState(store: FileThreadStore, threadId: string) {
  const snapshot = expectOk(await store.openThread(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: [],
      turnState: "repair_needed",
    }),
  );
}

async function listManagedThreadDirs(resolveStorePath: (...segments: string[]) => string): Promise<string[]> {
  try {
    return await readdir(resolveStorePath("threads"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

test("creates a fixture from a managed thread with thread-shaped records", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await updateGeneratedThreadViewOutputMetadata({
      store,
      threadId: thread.threadId,
      generatedFilePath: "/tmp/generated/session-001.jsonl",
    });
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Fixture prompt." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({
        content: [{ type: "text", text: "Fixture response." }],
      }),
    );
    await capturePiMessage(store, thread.threadId, ctx, makePiToolResultMessage());

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );

    const fixtureFiles = (await readdir(resolveStorePath("fixtures", fixture.fixtureId))).sort();
    const threadRecord = await readFixtureJson<{ target: { currentGeneratedFilePath?: string; sessionId?: string } }>(
      resolveStorePath,
      fixture.fixtureId,
      "thread.json",
    );

    assert.deepEqual(fixtureFiles, [
      "actors.json",
      "fixture.json",
      "imports.json",
      "messages.jsonl",
      "projections.json",
      "thread.json",
      "turns.json",
    ]);
    assert.equal(threadRecord.target.sessionId, "session-001");
    assert.equal(threadRecord.target.currentGeneratedFilePath, "/tmp/generated/session-001.jsonl");
  });
});

test("creates a fixture from a PI session import without creating a managed thread", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries(),
    });

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "pi_session",
          sessionFilePath: target.sessionFilePath!,
          sessionId: target.sessionId,
        },
      }),
    );

    const imports = await readFixtureJson<Array<{ status: string; importedMessageCount: number }>>(
      resolveStorePath,
      fixture.fixtureId,
      "imports.json",
    );
    const threadRecord = await readFixtureJson<{ target: { cwd?: string } }>(
      resolveStorePath,
      fixture.fixtureId,
      "thread.json",
    );
    const messages = await readFixtureMessages(resolveStorePath, fixture.fixtureId);

    assert.equal(imports.length, 1);
    assert.equal(imports[0]!.status, "complete");
    assert.equal(imports[0]!.importedMessageCount, 3);
    assert.equal(threadRecord.target.cwd, target.cwd);
    assert.notEqual(threadRecord.target.cwd, dirname(target.sessionFilePath!));
    assert.equal(messages.length, 3);
    assert.deepEqual(await listManagedThreadDirs(resolveStorePath), []);
  });
});

test("reports fixture creation failures with FIXTURE_CREATE_FAILED", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);

    const created = await createRealSessionFixture({
      store,
      source: {
        type: "managed_thread",
        threadId: "thread-missing",
      },
    });

    expectIssueCode(created, "FIXTURE_CREATE_FAILED");
    expectIssueCode(created, "STORE_UNAVAILABLE");
  });
});

test("preserves canonical message order in fixture output", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt one" }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response one" }] }),
    );
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiToolResultMessage({ content: [{ type: "text", text: "Tool output one" }] }),
    );

    const sourceSnapshot = expectOk(await store.openThread(thread.threadId));
    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );
    const fixtureMessages = await readFixtureMessages(resolveStorePath, fixture.fixtureId);

    assert.deepEqual(
      fixtureMessages.map((message) => message.sourceOrder),
      sourceSnapshot.messages.map((message) => message.sourceOrder),
    );
    assert.deepEqual(
      fixtureMessages.map((message) => message.messageKind),
      sourceSnapshot.messages.map((message) => message.messageKind),
    );
  });
});

test("preserves typed part structure in fixture output", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Inspect fixture parts." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({
        content: [
          { type: "text", text: "First text block." },
          { type: "thinking", thinking: "Reason through the fixture.", thinkingSignature: "sig-fixture-001" },
          { type: "toolCall", id: "call-fixture-001", name: "read", arguments: { path: "README.md" } },
        ],
      }),
    );

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );
    const fixtureMessages = await readFixtureMessages(resolveStorePath, fixture.fixtureId);
    const response = fixtureMessages.find((message) => message.messageKind === "response");

    assert.ok(response);
    assert.deepEqual(
      response.parts.map((part) => part.partType),
      ["text", "reasoning", "tool_call"],
    );
    assert.deepEqual(
      response.parts.map((part) => part.partOrder),
      [1, 2, 3],
    );
  });
});

test("marks healthy fixtures as ready", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Healthy prompt." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Healthy response." }] }),
    );

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );
    const fixtureRecord = await readFixtureJson<{ repairStatus: string; issues?: unknown[] }>(
      resolveStorePath,
      fixture.fixtureId,
      "fixture.json",
    );

    assert.equal(fixtureRecord.repairStatus, "ready");
    assert.equal(fixtureRecord.issues, undefined);
  });
});

test("marks incomplete fixtures as repair_needed and records affected ranges", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Broken prompt." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Broken response." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );
    const fixtureRecord = await readFixtureJson<{ repairStatus: string; issues?: Array<{ code: string; sourceRange?: { fromSourceOrder: number; toSourceOrder: number } }> }>(
      resolveStorePath,
      fixture.fixtureId,
      "fixture.json",
    );

    assert.equal(fixtureRecord.repairStatus, "repair_needed");
    assert.ok(fixtureRecord.issues?.some((issue) => issue.code === "TURN_STATE_MISSING"));
    assert.deepEqual(fixtureRecord.issues?.[0]?.sourceRange, { fromSourceOrder: 1, toSourceOrder: 2 });
  });
});

test("records managed-thread fixture metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveStorePath }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Metadata prompt." }));

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );
    const fixtureRecord = await readFixtureJson<{
      fixtureId: string;
      sourceType: string;
      sourceThreadId?: string;
      createdAt: string;
      sourceRange?: { fromSourceOrder: number; toSourceOrder: number };
      status: string;
    }>(resolveStorePath, fixture.fixtureId, "fixture.json");

    assert.equal(fixtureRecord.fixtureId, fixture.fixtureId);
    assert.equal(fixtureRecord.sourceType, "managed_thread");
    assert.equal(fixtureRecord.sourceThreadId, thread.threadId);
    assert.match(fixtureRecord.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(fixtureRecord.sourceRange, { fromSourceOrder: 1, toSourceOrder: 1 });
    assert.equal(fixtureRecord.status, "available");
  });
});

test("records PI-session fixture metadata including import and repair status", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      sessionId: "session-partial",
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Partial prompt." }),
          makePiAssistantMessage({
            content: [{ type: "mystery_partial", value: "unsupported block" } as never],
          }),
        ],
      }),
    });

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "pi_session",
          sessionFilePath: target.sessionFilePath!,
          sessionId: target.sessionId,
        },
      }),
    );
    const fixtureRecord = await readFixtureJson<{
      sourceType: string;
      sourceSessionId?: string;
      sourcePath?: string;
      importStatus?: string;
      repairStatus: string;
      status: string;
    }>(resolveStorePath, fixture.fixtureId, "fixture.json");

    assert.equal(fixtureRecord.sourceType, "pi_session");
    assert.equal(fixtureRecord.sourceSessionId, "session-partial");
    assert.equal(fixtureRecord.sourcePath, target.sessionFilePath);
    assert.equal(fixtureRecord.importStatus, "partial");
    assert.equal(fixtureRecord.repairStatus, "repair_needed");
    assert.equal(fixtureRecord.status, "available");
  });
});
