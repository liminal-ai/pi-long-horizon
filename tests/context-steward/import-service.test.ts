import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardErrorCode, StewardResult } from "../../src/context-steward/domain/errors.js";
import { attachExistingPiSession, previewPiSessionImport } from "../../src/context-steward/services/import-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import {
  DEFAULT_PI_MESSAGE_TIMESTAMP,
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiSessionEntries,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import type { AppendMessageInput, CreateThreadInput } from "../../src/context-steward/store/thread-store.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function expectIssueCode<T>(result: StewardResult<T>, code: StewardErrorCode): void {
  const issues = result.ok ? (result.issues ?? []) : result.issues;
  assert.ok(issues.some((issue) => issue.code === code), `Expected issue ${code}, got ${issues.map((issue) => issue.code).join(", ")}`);
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
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

async function listThreadDirs(resolveStorePath: (...segments: string[]) => string): Promise<string[]> {
  try {
    return await readdir(resolveStorePath("threads"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

class ImportPauseAfterNMessagesStore extends FileThreadStore {
  readonly importPaused = createDeferred<void>();
  private readonly importReleased = createDeferred<void>();
  private importedAppendCount = 0;
  threadId: string | undefined;

  constructor(storeRootDir: string, private readonly pauseAfterImportedAppends: number) {
    super(storeRootDir);
  }

  releaseImport(): void {
    this.importReleased.resolve();
  }

  override async createThread(input: CreateThreadInput) {
    const result = await super.createThread(input);
    if (result.ok) {
      this.threadId = result.value.threadId;
    }
    return result;
  }

  override async appendMessage(input: AppendMessageInput) {
    const result = await super.appendMessage(input);
    if (result.ok && input.message.targetMetadata?.imported) {
      this.importedAppendCount += 1;
      if (this.importedAppendCount === this.pauseAfterImportedAppends) {
        this.importPaused.resolve();
        await this.importReleased.promise;
      }
    }
    return result;
  }
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

test("imports an existing PI session into a new managed thread", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries(),
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importedMessages, 3);
    assert.equal(snapshot.messages.length, 3);
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt", "response", "tool_result"]);
    assert.equal(snapshot.thread.target.sessionId, target.sessionId);
    assert.equal(snapshot.thread.target.sessionFilePath, target.sessionFilePath);
  });
});

test("attaches an empty existing PI session and records zero imported messages", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: [],
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importedMessages, 0);
    assert.equal(attached.importRecord.importedMessageCount, 0);
    assert.equal(attached.importRecord.importedSourceRange, undefined);
    assert.equal(snapshot.thread.importSummary.lastImportStatus, "complete");
    assert.equal(snapshot.thread.status.turnState, "ready");
  });
});

test("rejects duplicate attach when the PI target is already managed", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries(),
    });

    expectOk(await openOrCreateManagedThread({ target }, store));
    const attached = await attachExistingPiSession({
      store,
      target,
      sessionFilePath: target.sessionFilePath!,
    });

    expectIssueCode(attached, "TARGET_ASSOCIATION_CONFLICT");
  });
});

test("imports only the selected active branch path for a branched PI session", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const entries = makePiSessionEntries({
      messages: [
        makePiUserMessage({ content: "Root prompt" }),
        makePiAssistantMessage({ content: [{ type: "text", text: "Main branch response" }] }),
        makePiToolResultMessage({ content: [{ type: "text", text: "main-branch-tool" }] }),
      ],
      branchFromIndex: 0,
      branchMessages: [
        makePiAssistantMessage({ content: [{ type: "text", text: "Active branch response" }] }),
        makePiUserMessage({ content: "Active branch follow-up" }),
      ],
    });
    const activeLeafId = entries.at(-1)!.id;
    const target = await createSessionFixture(resolveProjectPath, {
      entries,
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
        activeLeafId,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importRecord.activePathReference, `leaf:${activeLeafId}`);
    assert.deepEqual(
      snapshot.messages.map((message) => message.targetMetadata?.sessionEntryId),
      ["entry-001", "branch-entry-001", "branch-entry-002"],
    );
    assert.equal(snapshot.messages.some((message) => message.parts.some((part) => part.content === "Main branch response")), false);
  });
});

test("rejects a branched PI session when no active branch can be resolved", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        branchFromIndex: 0,
        branchMessages: [makePiAssistantMessage({ content: [{ type: "text", text: "branch response" }] })],
      }),
    });

    const attached = await attachExistingPiSession({
      store,
      target,
      sessionFilePath: target.sessionFilePath!,
    });
    const threadDirs = await listThreadDirs(resolveStorePath);

    expectIssueCode(attached, "IMPORT_PATH_AMBIGUOUS");
    assert.deepEqual(threadDirs, []);
  });
});

test("preserves imported source order, supported parts, timestamps, and PI metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const entries = makePiSessionEntries({
      messages: [
        makePiUserMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 1_000,
          content: [
            { type: "text", text: "Inspect this file and image." },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
            { type: "fileRef", path: "README.md", mimeType: "text/markdown" } as never,
          ],
        }),
        makePiAssistantMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 2_000,
          responseId: "response-import-001",
          content: [
            { type: "text", text: "I inspected both." },
            { type: "thinking", thinking: "Need to preserve typed parts.", thinkingSignature: "sig-import-001" },
            { type: "toolCall", id: "call-import-001", name: "read", arguments: { path: "README.md" } },
          ],
        }),
        makePiToolResultMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 3_000,
          toolCallId: "call-import-001",
          toolName: "read",
          content: [
            { type: "text", text: "file contents" },
            { type: "file", path: "README.md", mimeType: "text/markdown" } as never,
          ],
        }),
      ],
    });
    const target = await createSessionFixture(resolveProjectPath, {
      entries,
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.deepEqual(snapshot.messages.map((message) => message.sourceOrder), [1, 2, 3]);
    assert.deepEqual(
      snapshot.messages.map((message) => message.parts.map((part) => part.partType)),
      [
        ["text", "image_ref", "file_ref"],
        ["text", "reasoning", "tool_call"],
        ["tool_result", "file_ref"],
      ],
    );
    assert.equal(snapshot.messages[0]?.createdAt, new Date(DEFAULT_PI_MESSAGE_TIMESTAMP + 1_000).toISOString());
    assert.equal(snapshot.messages[1]?.targetMetadata?.responseId, "response-import-001");
    assert.equal(snapshot.messages[2]?.targetMetadata?.toolCallId, "call-import-001");
    assert.equal(snapshot.messages.every((message) => message.targetMetadata?.imported === true), true);
  });
});

test("records import source metadata and appends later live capture after the imported range", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Imported prompt" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Imported response" }] }),
        ],
      }),
    });
    const ctx = makePiExtensionContext(target);

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );

    const livePrompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 5_000,
          content: "Live prompt after import",
        }),
        ctx,
      }),
    );
    const captured = expectOk(
      await captureFinalizedActivity({
        store,
        threadId: attached.thread.threadId,
        activity: livePrompt,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importRecord.sourceSessionId, target.sessionId);
    assert.equal(attached.importRecord.sourcePath, target.sessionFilePath);
    assert.deepEqual(attached.importRecord.importedSourceRange, { fromSourceOrder: 1, toSourceOrder: 2 });
    assert.equal(captured.message.sourceOrder > attached.importRecord.importedSourceRange!.toSourceOrder, true);
    assert.equal(snapshot.imports.length, 1);
  });
});

test("serializes live capture behind an in-progress import so it cannot land inside the imported range", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new ImportPauseAfterNMessagesStore(storeRootDir, 2);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Imported prompt" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Imported response" }] }),
          makePiUserMessage({ content: "Second imported prompt", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 4_000 }),
        ],
      }),
    });
    const ctx = makePiExtensionContext(target);
    const attachPromise = attachExistingPiSession({
      store,
      target,
      sessionFilePath: target.sessionFilePath!,
    });

    await store.importPaused.promise;
    assert.ok(store.threadId);

    const livePrompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 8_000,
          content: "Live prompt during import",
        }),
        ctx,
      }),
    );
    const liveCapturePromise = captureFinalizedActivity({
      store,
      threadId: store.threadId,
      activity: livePrompt,
    });

    assert.equal(await settlesWithin(liveCapturePromise, 50), false);
    assert.equal(expectOk(await store.readMessages(store.threadId)).length, 2);

    store.releaseImport();
    const attached = expectOk(await attachPromise);
    const liveCapture = expectOk(await liveCapturePromise);
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.thread.threadId, store.threadId);
    assert.deepEqual(attached.importRecord.importedSourceRange, { fromSourceOrder: 1, toSourceOrder: 3 });
    assert.equal(liveCapture.message.sourceOrder, 4);
    assert.equal(liveCapture.message.sourceOrder > attached.importRecord.importedSourceRange!.toSourceOrder, true);
    assert.deepEqual(
      snapshot.messages.map((message) => message.targetMetadata?.imported === true),
      [true, true, true, false],
    );
  });
});

test("reconstructs prompt-bounded turns from imported prompts, responses, and tool activity", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Prompt one" }),
          makePiAssistantMessage({
            content: [{ type: "toolCall", id: "call-turn-import-001", name: "read", arguments: { path: "a.ts" } }],
          }),
          makePiToolResultMessage({
            toolCallId: "call-turn-import-001",
            toolName: "read",
            content: [{ type: "text", text: "tool result one" }],
          }),
          makePiUserMessage({ content: "Prompt two", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 4_000 }),
          makePiAssistantMessage({
            timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 5_000,
            content: [{ type: "text", text: "Response two" }],
          }),
        ],
      }),
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(snapshot.turns.length, 2);
    assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
    assert.equal(snapshot.turns[1]?.lifecycleStatus, "open");
    assert.deepEqual(snapshot.turns.map((turn) => turn.messageIds.length), [3, 2]);
  });
});

test("marks only affected imported turns repair_needed when one imported message is partial", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Prompt one" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Healthy response one" }] }),
          makePiUserMessage({ content: "Prompt two", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 2_000 }),
          makePiAssistantMessage({
            timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 3_000,
            content: [{ type: "mystery_partial", value: "partial response two" } as never],
          }),
        ],
      }),
    });
    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importRecord.status, "partial");
    assert.equal(snapshot.thread.status.turnState, "repair_needed");
    assert.deepEqual(snapshot.turns.map((turn) => turn.repairStatus), ["ready", "repair_needed"]);
    assert.deepEqual(
      attached.importRecord.issues
        ?.filter((issue) => issue.code === "UNMAPPED_PART_TYPE")
        .map((issue) => issue.sourceRange),
      [{ fromSourceOrder: 4, toSourceOrder: 4 }],
    );
  });
});

test("continues canonical turn semantics after import when live capture appends a new prompt", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Imported prompt" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Imported response" }] }),
        ],
      }),
    });
    const ctx = makePiExtensionContext(target);
    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );

    const nextPrompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({
          timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 10_000,
          content: "Next live prompt",
        }),
        ctx,
      }),
    );
    expectOk(
      await captureFinalizedActivity({
        store,
        threadId: attached.thread.threadId,
        activity: nextPrompt,
      }),
    );
    const turns = expectOk(await store.readTurns(attached.thread.threadId));

    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.lifecycleStatus, "closed");
    assert.equal(turns[1]?.lifecycleStatus, "open");
  });
});

test("previews the active import path without writing managed thread records", async () => {
  await withTempThreadStore(async ({ resolveProjectPath, resolveStorePath }) => {
    const entries = makePiSessionEntries({
      branchFromIndex: 0,
      branchMessages: [makePiAssistantMessage({ content: [{ type: "text", text: "preview branch" }] })],
    });
    const target = await createSessionFixture(resolveProjectPath, {
      entries,
    });

    const preview = expectOk(
      await previewPiSessionImport({
        sessionFilePath: target.sessionFilePath!,
        target,
        activeLeafId: entries.at(-1)!.id,
      }),
    );
    const threadDirs = await listThreadDirs(resolveStorePath);

    assert.equal(preview.importableMessages, 2);
    assert.equal(preview.activePathReference, `leaf:${entries.at(-1)!.id}`);
    assert.deepEqual(threadDirs, []);
  });
});

test("sorts partial import issues by canonical source order", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Prompt before unknown blocks" }),
          makePiAssistantMessage({
            timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 1_000,
            content: [{ type: "mystery_one", value: "first" } as never],
          }),
          makePiAssistantMessage({
            timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 2_000,
            content: [{ type: "mystery_two", value: "second" } as never],
          }),
        ],
      }),
    });

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath: target.sessionFilePath!,
      }),
    );

    const unmappedIssues = attached.importRecord.issues?.filter((issue) => issue.code === "UNMAPPED_PART_TYPE") ?? [];

    assert.deepEqual(
      unmappedIssues.map((issue) => issue.sourceRange?.fromSourceOrder),
      [2, 3],
    );
  });
});
