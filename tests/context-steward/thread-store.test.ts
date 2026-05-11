import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import type { StewardErrorCode, StewardResult } from "../../src/context-steward/domain/errors.js";
import { deriveTargetSessionKeys } from "../../src/context-steward/domain/ids.js";
import type { ActorRecord, MessageRecord, ThreadRecord } from "../../src/context-steward/domain/records.js";
import { createStewardRootIndex } from "../../src/context-steward/domain/records.js";
import { appendSourceMessage, declareThreadActor, openOrCreateManagedThread, updateGeneratedThreadViewOutputMetadata } from "../../src/context-steward/services/thread-service.js";
import { makeActorRecord, makeMessageRecord, makeProjectionRevisionRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";

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
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.code, code);
}

function makePendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
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

async function makeManagedTarget(
  resolveProjectPath: (...segments: string[]) => string,
  overrides: Parameters<typeof makeThreadTarget>[0] = {},
) {
  const sessionId = overrides.sessionId ?? "session-001";
  const hasExplicitSessionFilePath = Object.prototype.hasOwnProperty.call(overrides, "sessionFilePath");
  const sessionFilePath = hasExplicitSessionFilePath
    ? overrides.sessionFilePath
    : resolveProjectPath("pi-sessions", `${sessionId}.jsonl`);

  if (sessionFilePath) {
    await mkdir(dirname(sessionFilePath), { recursive: true });
    await writeFile(sessionFilePath, '{"type":"session"}\n');
  }

  return makeThreadTarget({
    ...overrides,
    sessionId,
    sessionFilePath,
  });
}

class TempWriteFailingFileThreadStore extends FileThreadStore {
  failNextThreadMetadataWrite = false;

  protected override async writeTemporaryFile(filePath: string, content: string): Promise<string> {
    if (this.failNextThreadMetadataWrite && filePath.endsWith("thread.json")) {
      this.failNextThreadMetadataWrite = false;
      throw new Error("simulated temp write failure");
    }

    return super.writeTemporaryFile(filePath, content);
  }
}

class ActorWriteFailingFileThreadStore extends FileThreadStore {
  failNextActorsWrite = false;

  protected override async writeTemporaryFile(filePath: string, content: string): Promise<string> {
    if (this.failNextActorsWrite && filePath.endsWith("actors.json")) {
      this.failNextActorsWrite = false;
      throw new Error("simulated actors write failure");
    }

    return super.writeTemporaryFile(filePath, content);
  }
}

class CollidingTempFileThreadStore extends FileThreadStore {
  protected override async writeTemporaryFile(filePath: string, content: string): Promise<string> {
    if (filePath.endsWith("thread.json")) {
      const tempPath = join(dirname(filePath), `.${basename(filePath)}.collision.tmp`);
      await writeFile(tempPath, content, "utf8");
      return tempPath;
    }

    return super.writeTemporaryFile(filePath, content);
  }

  protected override async commitTemporaryFile(tempPath: string, filePath: string): Promise<void> {
    if (filePath.endsWith("thread.json")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await super.commitTemporaryFile(tempPath, filePath);
  }
}

class FirstActorLookupBlockingFileThreadStore extends FileThreadStore {
  private readonly firstActorLookupStarted = createDeferred<void>();
  private readonly firstActorLookupReleased = createDeferred<void>();
  private readonly secondActorLookupStarted = createDeferred<void>();
  private actorLookupCount = 0;

  async waitForFirstActorLookup(): Promise<void> {
    await this.firstActorLookupStarted.promise;
  }

  releaseFirstActorLookup(): void {
    this.firstActorLookupReleased.resolve();
  }

  async secondActorLookupStartedWhileFirstBlocked(timeoutMs: number): Promise<boolean> {
    return settlesWithin(this.secondActorLookupStarted.promise, timeoutMs);
  }

  override async listActors(threadId: string): Promise<StewardResult<ActorRecord[]>> {
    this.actorLookupCount += 1;

    if (this.actorLookupCount === 1) {
      this.firstActorLookupStarted.resolve();
      await this.firstActorLookupReleased.promise;
    } else if (this.actorLookupCount === 2) {
      this.secondActorLookupStarted.resolve();
    }

    return super.listActors(threadId);
  }
}

test("creates source thread for a new managed PI session", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath, {
      currentGeneratedFilePath: undefined,
    });

    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.match(thread.threadId, /^thread_/);
    assert.equal(thread.target.runtime, "pi");
    assert.equal(thread.schemaVersion, "context-steward.thread.v1");
    assert.equal(thread.sourceRevision, 0);
    assert.equal(thread.messageHighWatermark, 0);
    assert.deepEqual(messages, []);
  });
});

test("opens existing source thread without creating a duplicate association", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath, {
      sessionFilePath: undefined,
    });
    const enrichedTarget = await makeManagedTarget(resolveProjectPath, {
      sessionId: target.sessionId,
      cwd: target.cwd,
    });

    const created = expectOk(await openOrCreateManagedThread({ target }, store));
    const reopened = expectOk(await openOrCreateManagedThread({ target: enrichedTarget }, store));
    const threadDirs = await readdir(resolveStorePath("threads"));
    const filePathLookup = expectOk(
      await store.findThreadByTarget({
        runtime: "pi",
        sessionFilePath: enrichedTarget.sessionFilePath,
      }),
    );

    assert.equal(reopened.threadId, created.threadId);
    assert.equal(filePathLookup?.threadId, created.threadId);
    assert.deepEqual(threadDirs, [created.threadId]);
  });
});

test("does not merge different PI sessions that only share a cwd", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const sharedCwd = resolveProjectPath("project-shared");
    const firstSessionFilePath = resolveProjectPath("pi-sessions", "session-cwd-a.jsonl");
    await mkdir(dirname(firstSessionFilePath), { recursive: true });
    await writeFile(firstSessionFilePath, '{"type":"session"}\n');
    const firstTarget = makeThreadTarget({
      sessionId: undefined,
      sessionFilePath: firstSessionFilePath,
      cwd: sharedCwd,
      currentGeneratedFilePath: undefined,
    });
    const firstThread = expectOk(
      await openOrCreateManagedThread(
        {
          target: firstTarget,
        },
        store,
      ),
    );
    const secondThread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({
            sessionId: "session-cwd-b",
            sessionFilePath: undefined,
            cwd: sharedCwd,
            currentGeneratedFilePath: undefined,
          }),
        },
        store,
      ),
    );
    const firstLookup = expectOk(
      await store.findThreadByTarget({
        runtime: "pi",
        sessionFilePath: firstTarget.sessionFilePath,
      }),
    );
    const secondLookup = expectOk(
      await store.findThreadByTarget({
        runtime: "pi",
        sessionId: "session-cwd-b",
      }),
    );
    const threadDirs = await readdir(resolveStorePath("threads"));

    assert.notEqual(firstThread.threadId, secondThread.threadId);
    assert.equal(firstLookup?.threadId, firstThread.threadId);
    assert.equal(firstLookup?.target.sessionId, undefined);
    assert.equal(firstLookup?.target.sessionFilePath, firstTarget.sessionFilePath);
    assert.equal(secondLookup?.threadId, secondThread.threadId);
    assert.equal(secondLookup?.target.sessionId, "session-cwd-b");
    assert.equal(secondLookup?.target.sessionFilePath, undefined);
    assert.deepEqual(threadDirs.sort(), [firstThread.threadId, secondThread.threadId].sort());
  });
});

test("reports STORE_UNAVAILABLE when the canonical store root cannot be created", async () => {
  await withTempThreadStore(async ({ resolveProjectPath }) => {
    const blockedPath = resolveProjectPath("blocked-store");
    await writeFile(blockedPath, "not-a-directory\n");

    const store = new FileThreadStore(blockedPath);
    const result = await openOrCreateManagedThread({ target: makeThreadTarget() }, store);

    expectIssueCode(result, "STORE_UNAVAILABLE");
  });
});

test("does not leave an openable managed thread behind when creation fails mid-snapshot", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new ActorWriteFailingFileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath);
    store.failNextActorsWrite = true;

    const result = await openOrCreateManagedThread({ target }, store);
    const reopened = expectOk(await new FileThreadStore(storeRootDir).findManagedThread(target));
    const threadDirs = await readdir(resolveStorePath("threads"));

    expectIssueCode(result, "STORE_UNAVAILABLE");
    assert.equal(reopened, undefined);
    assert.deepEqual(threadDirs, []);
  });
});

test("records PI target metadata on the managed thread", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath, {
      sessionId: "session-123",
      cwd: resolveProjectPath("project"),
      currentGeneratedFilePath: resolveProjectPath("generated", "session-123.jsonl"),
    });

    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const snapshot = expectOk(await store.openThread(thread.threadId));

    assert.deepEqual(snapshot.thread.target, target);
  });
});

test("reads source messages from canonical thread records instead of the generated PI file", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const generatedFilePath = resolveProjectPath("generated-session.jsonl");
    await writeFile(generatedFilePath, '{"message":"this should not be read"}\n');
    const target = await makeManagedTarget(resolveProjectPath, {
      currentGeneratedFilePath: generatedFilePath,
    });

    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target,
        },
        store,
      ),
    );

    const actor = makeActorRecord({ actorId: "actor-user", actorType: "human", displayName: "Context Steward" });
    const appended = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-source-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "prompt",
          parts: [{ partId: "part-source-001", partOrder: 1, partType: "text", content: "canonical source" }],
        }),
      }),
    );

    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.messageId, appended.messageId);
    assert.equal(messages[0]?.parts[0]?.content, "canonical source");
  });
});

test("allows mutation when the thread uses a supported schema version", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-agent-001" });
    const appended = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-supported-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "response",
        }),
      }),
    );

    const turns = expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: appended.sourceRevision,
        expectedMessageHighWatermark: appended.sourceOrder,
        expectedTurnsRevision: 0,
        turnState: "ready",
        turns: [
          makeTurnRecord({
            threadId: thread.threadId,
            turnId: "turn-supported-001",
            messageIds: [appended.messageId],
            sourceRange: { fromSourceOrder: appended.sourceOrder, toSourceOrder: appended.sourceOrder },
            sourceRevision: appended.sourceRevision,
            repairStatus: "ready",
          }),
        ],
      }),
    );

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turnId, "turn-supported-001");
  });
});

test("blocks append and turn writes for unsupported schema versions", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const threadJsonPath = resolveStorePath("threads", thread.threadId, "thread.json");
    const persistedThread = JSON.parse(await readFile(threadJsonPath, "utf8")) as ThreadRecord;
    persistedThread.schemaVersion = "context-steward.thread.v99" as ThreadRecord["schemaVersion"];
    await writeFile(threadJsonPath, `${JSON.stringify(persistedThread, null, 2)}\n`);

    const actor = makeActorRecord({ actorId: "actor-unsupported-001" });
    const appendResult = await appendSourceMessage({
      store,
      threadId: thread.threadId,
      actor,
      message: makePendingMessage({
        threadId: thread.threadId,
        messageId: "message-unsupported-001",
        actorId: actor.actorId,
        actorType: actor.actorType,
      }),
    });
    const turnsResult = await store.writeTurns({
      threadId: thread.threadId,
      expectedSourceRevision: 0,
      expectedMessageHighWatermark: 0,
      expectedTurnsRevision: 0,
      turnState: "ready",
      turns: [],
    });

    expectIssueCode(appendResult, "UNSUPPORTED_SCHEMA_VERSION");
    expectIssueCode(turnsResult, "UNSUPPORTED_SCHEMA_VERSION");
  });
});

test("declares an unknown actor before a stored message references it", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-runtime-001", actorType: "runtime", displayName: "PI Runtime" });

    const message = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-actor-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "runtime_event",
        }),
      }),
    );
    const actors = expectOk(await store.listActors(thread.threadId));

    assert.equal(actors.length, 1);
    assert.equal(actors[0]?.actorId, actor.actorId);
    assert.equal(actors[0]?.actorType, actor.actorType);
    assert.equal(actors[0]?.displayName, actor.displayName);
    assert.equal(message.actorId, actor.actorId);
    assert.equal(message.actorType, actor.actorType);
  });
});

test("reuses an existing actor identity for later messages", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-agent-reuse", actorType: "agent", displayName: "Pair Agent" });

    expectOk(await declareThreadActor(store, thread.threadId, actor));
    const firstMessage = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-reuse-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
        }),
      }),
    );
    const secondMessage = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-reuse-002",
          actorId: actor.actorId,
          actorType: actor.actorType,
          parts: [{ partId: "part-reuse-002", partOrder: 1, partType: "text", content: "follow-up" }],
        }),
      }),
    );
    const actors = expectOk(await store.listActors(thread.threadId));

    assert.equal(actors.length, 1);
    assert.equal(firstMessage.actorId, actor.actorId);
    assert.equal(secondMessage.actorId, actor.actorId);
  });
});

test("serializes concurrent appends for the same thread across store instances", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const bootstrapStore = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, bootstrapStore));
    const actor = makeActorRecord({ actorId: "actor-concurrent-001", actorType: "agent" });
    expectOk(await declareThreadActor(bootstrapStore, thread.threadId, actor));

    const storeA = new CollidingTempFileThreadStore(storeRootDir);
    const storeB = new CollidingTempFileThreadStore(storeRootDir);
    const [firstResult, secondResult] = await Promise.all([
      appendSourceMessage({
        store: storeA,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-concurrent-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
        }),
      }),
      appendSourceMessage({
        store: storeB,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-concurrent-002",
          actorId: actor.actorId,
          actorType: actor.actorType,
        }),
      }),
    ]);
    const first = expectOk(firstResult);
    const second = expectOk(secondResult);
    const snapshot = expectOk(await new FileThreadStore(storeRootDir).openThread(thread.threadId));

    assert.deepEqual(
      snapshot.messages.map((message) => message.messageId),
      ["message-concurrent-001", "message-concurrent-002"],
    );
    assert.deepEqual(
      snapshot.messages.map((message) => message.sourceOrder),
      [1, 2],
    );
    assert.equal(first.sourceOrder, 1);
    assert.equal(second.sourceOrder, 2);
    assert.equal(snapshot.thread.sourceRevision, 2);
    assert.equal(snapshot.thread.messageHighWatermark, 2);
  });
});

test("preserves invocation order while actor declaration work is blocked", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FirstActorLookupBlockingFileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-concurrent-blocked-001", actorType: "agent" });

    const firstAppend = appendSourceMessage({
      store,
      threadId: thread.threadId,
      actor,
      message: makePendingMessage({
        threadId: thread.threadId,
        messageId: "message-concurrent-blocked-001",
        actorId: actor.actorId,
        actorType: actor.actorType,
      }),
    });

    await store.waitForFirstActorLookup();

    const secondAppend = appendSourceMessage({
      store,
      threadId: thread.threadId,
      actor,
      message: makePendingMessage({
        threadId: thread.threadId,
        messageId: "message-concurrent-blocked-002",
        actorId: actor.actorId,
        actorType: actor.actorType,
      }),
    });

    assert.equal(await store.secondActorLookupStartedWhileFirstBlocked(50), false);

    store.releaseFirstActorLookup();

    const [firstResult, secondResult] = await Promise.all([firstAppend, secondAppend]);
    const first = expectOk(firstResult);
    const second = expectOk(secondResult);
    const snapshot = expectOk(await new FileThreadStore(storeRootDir).openThread(thread.threadId));
    const actors = expectOk(await store.listActors(thread.threadId));

    assert.deepEqual(
      snapshot.messages.map((message) => [message.messageId, message.sourceOrder]),
      [
        ["message-concurrent-blocked-001", 1],
        ["message-concurrent-blocked-002", 2],
      ],
    );
    assert.equal(first.sourceOrder, 1);
    assert.equal(second.sourceOrder, 2);
    assert.equal(actors.length, 1);
    assert.equal(snapshot.thread.sourceRevision, 2);
    assert.equal(snapshot.thread.messageHighWatermark, 2);
  });
});

test("turn state changes do not mutate stored message content", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-turn-001", actorType: "human" });
    const prompt = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-turn-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "prompt",
          parts: [{ partId: "part-turn-001", partOrder: 1, partType: "text", content: "open turn" }],
        }),
      }),
    );

    const before = expectOk(await store.readMessages(thread.threadId));
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: prompt.sourceRevision,
        expectedMessageHighWatermark: prompt.sourceOrder,
        expectedTurnsRevision: 0,
        turnState: "ready",
        turns: [
          makeTurnRecord({
            threadId: thread.threadId,
            turnId: "turn-open-001",
            lifecycleStatus: "open",
            repairStatus: "ready",
            initiatingMessageId: prompt.messageId,
            messageIds: [prompt.messageId],
            sourceRange: { fromSourceOrder: prompt.sourceOrder, toSourceOrder: prompt.sourceOrder },
            sourceRevision: prompt.sourceRevision,
          }),
        ],
      }),
    );
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: prompt.sourceRevision,
        expectedMessageHighWatermark: prompt.sourceOrder,
        expectedTurnsRevision: 1,
        turnState: "ready",
        turns: [
          makeTurnRecord({
            threadId: thread.threadId,
            turnId: "turn-open-001",
            lifecycleStatus: "closed",
            repairStatus: "ready",
            initiatingMessageId: prompt.messageId,
            messageIds: [prompt.messageId],
            sourceRange: { fromSourceOrder: prompt.sourceOrder, toSourceOrder: prompt.sourceOrder },
            sourceRevision: prompt.sourceRevision,
            closedAt: "2026-01-01T00:00:10.000Z",
          }),
        ],
      }),
    );
    const after = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(after, before);
  });
});

test("repair-style turn rewrites do not mutate stored message content or source order", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const actor = makeActorRecord({ actorId: "actor-repair-001", actorType: "agent" });
    const response = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-repair-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "response",
          parts: [{ partId: "part-repair-001", partOrder: 1, partType: "text", content: "repair me later" }],
        }),
      }),
    );

    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: response.sourceRevision,
        expectedMessageHighWatermark: response.sourceOrder,
        expectedTurnsRevision: 0,
        turnState: "repair_needed",
        turns: [],
      }),
    );
    const before = expectOk(await store.readMessages(thread.threadId));
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: response.sourceRevision,
        expectedMessageHighWatermark: response.sourceOrder,
        expectedTurnsRevision: 1,
        turnState: "ready",
        turns: [
          makeTurnRecord({
            threadId: thread.threadId,
            turnId: "turn-repair-001",
            lifecycleStatus: "open",
            repairStatus: "ready",
            initiatingMessageId: response.messageId,
            messageIds: [response.messageId],
            sourceRange: { fromSourceOrder: response.sourceOrder, toSourceOrder: response.sourceOrder },
            sourceRevision: response.sourceRevision,
            repairMetadata: {
              repairedAt: "2026-01-01T00:00:20.000Z",
              sourceRevisionChecked: response.sourceRevision,
            },
          }),
        ],
      }),
    );
    const after = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(after, before);
  });
});

test("records the generated PI session file path on the thread target metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const generatedFilePath = resolveProjectPath("generated", "session-001.jsonl");

    expectOk(
      await updateGeneratedThreadViewOutputMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath,
      }),
    );

    const snapshot = expectOk(await store.openThread(thread.threadId));
    assert.equal(snapshot.thread.target.currentGeneratedFilePath, generatedFilePath);
  });
});

test("represents a missing generated PI session file path explicitly", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath, {
      currentGeneratedFilePath: undefined,
    });
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target,
        },
        store,
      ),
    );

    const snapshot = expectOk(await store.openThread(thread.threadId));
    assert.equal(snapshot.thread.target.currentGeneratedFilePath, undefined);
    assert.equal(snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath, undefined);
  });
});

test("represents absent projection revisions as an empty collection", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));

    const projections = expectOk(await store.readProjectionRevisions(thread.threadId));

    assert.deepEqual(projections, []);
  });
});

test("keeps the PI target session id separate from the canonical thread id", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: await makeManagedTarget(resolveProjectPath, {
            sessionId: "session-separate-001",
          }),
        },
        store,
      ),
    );

    assert.notEqual(thread.threadId, thread.target.sessionId);
    assert.equal(thread.target.sessionId, "session-separate-001");
  });
});

test("reads canonical source ordering instead of any generated file ordering", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const generatedFilePath = resolveProjectPath("generated-order.jsonl");
    await writeFile(generatedFilePath, '{"message":"second"}\n{"message":"first"}\n');

    const thread = expectOk(
      await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store),
    );
    expectOk(
      await updateGeneratedThreadViewOutputMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath,
      }),
    );

    const actor = makeActorRecord({ actorId: "actor-order-001" });
    const first = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-order-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
          parts: [{ partId: "part-order-001", partOrder: 1, partType: "text", content: "first" }],
        }),
      }),
    );
    const second = expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-order-002",
          actorId: actor.actorId,
          actorType: actor.actorType,
          parts: [{ partId: "part-order-002", partOrder: 1, partType: "text", content: "second" }],
        }),
      }),
    );

    const messages = expectOk(await store.readMessages(thread.threadId));
    assert.deepEqual(
      messages.map((message) => [message.sourceOrder, message.messageId]),
      [
        [first.sourceOrder, first.messageId],
        [second.sourceOrder, second.messageId],
      ],
    );
  });
});

test("reads projection metadata without treating the generated file as source history", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store),
    );
    const generatedFilePath = resolveProjectPath("generated", "projection-001.jsonl");

    const revision = makeProjectionRevisionRecord({
      revisionId: "projection-001",
      threadId: thread.threadId,
      generatedFilePath,
      status: "available",
    });

    expectOk(await store.writeProjectionRevision(revision));

    const projections = expectOk(await store.readProjectionRevisions(thread.threadId));
    assert.deepEqual(projections, [revision]);
  });
});

test("keeps the active generated path separate from the latest projection summary", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store),
    );
    const latestProjectionPath = resolveProjectPath("generated", "projection-latest.jsonl");
    const activeGeneratedPath = resolveProjectPath("generated", "projection-active.jsonl");

    expectOk(
      await store.writeProjectionRevision(
        makeProjectionRevisionRecord({
          revisionId: "projection-summary-001",
          threadId: thread.threadId,
          generatedFilePath: latestProjectionPath,
          status: "available",
        }),
      ),
    );

    expectOk(
      await updateGeneratedThreadViewOutputMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath: activeGeneratedPath,
      }),
    );

    const snapshot = expectOk(await store.openThread(thread.threadId));

    assert.equal(snapshot.thread.target.currentGeneratedFilePath, activeGeneratedPath);
    assert.equal(snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath, latestProjectionPath);
    assert.equal(snapshot.thread.threadViewOutputSummary.count, 1);
    assert.equal(snapshot.thread.threadViewOutputSummary.lastRevisionStatus, "available");
  });
});

test("returns refreshed projection summary details after recording a revision through metadata updates", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store),
    );
    const latestProjectionPath = resolveProjectPath("generated", "projection-revision.jsonl");
    const activeGeneratedPath = resolveProjectPath("generated", "projection-active.jsonl");

    const updatedThread = expectOk(
      await updateGeneratedThreadViewOutputMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath: activeGeneratedPath,
        revision: makeProjectionRevisionRecord({
          revisionId: "projection-summary-002",
          threadId: thread.threadId,
          generatedFilePath: latestProjectionPath,
          status: "stale",
        }),
      }),
    );

    assert.equal(updatedThread.target.currentGeneratedFilePath, activeGeneratedPath);
    assert.equal(updatedThread.threadViewOutputSummary.currentGeneratedFilePath, latestProjectionPath);
    assert.equal(updatedThread.threadViewOutputSummary.count, 1);
    assert.equal(updatedThread.threadViewOutputSummary.lastRevisionStatus, "stale");
  });
});

test("rejects managed reopen attempts that would rewrite a stored session id through an alias match", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const originalTarget = await makeManagedTarget(resolveProjectPath, {
      sessionId: "session-alias-original-001",
      sessionFilePath: resolveProjectPath("pi-sessions", "session-alias-original-001.jsonl"),
    });
    const originalThread = expectOk(await openOrCreateManagedThread({ target: originalTarget }, store));
    const originalThreadJsonPath = resolveStorePath("threads", originalThread.threadId, "thread.json");
    const indexJsonPath = resolveStorePath("index.json");
    const threadBefore = await readFile(originalThreadJsonPath, "utf8");
    const indexBefore = await readFile(indexJsonPath, "utf8");

    const result = await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-alias-conflict-001",
          sessionFilePath: originalTarget.sessionFilePath,
          cwd: originalTarget.cwd,
          currentGeneratedFilePath: undefined,
        }),
      },
      store,
    );

    const threadAfter = await readFile(originalThreadJsonPath, "utf8");
    const indexAfter = await readFile(indexJsonPath, "utf8");
    const reopenedOriginal = expectOk(await store.findThreadByTarget(originalTarget));
    const conflictingLookup = expectOk(
      await store.findThreadByTarget({
        runtime: "pi",
        sessionId: "session-alias-conflict-001",
      }),
    );

    expectIssueCode(result, "TARGET_ASSOCIATION_CONFLICT");
    assert.equal(threadAfter, threadBefore);
    assert.equal(indexAfter, indexBefore);
    assert.equal(reopenedOriginal?.threadId, originalThread.threadId);
    assert.equal(reopenedOriginal?.target.sessionId, originalTarget.sessionId);
    assert.equal(conflictingLookup, undefined);
  });
});

test("leaves the original thread target and root target index intact after a failed target reassociation", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const originalTarget = await makeManagedTarget(resolveProjectPath, {
      sessionId: "session-original-001",
      sessionFilePath: resolveProjectPath("pi-sessions", "session-original-001.jsonl"),
    });
    const conflictingTarget = await makeManagedTarget(resolveProjectPath, {
      sessionId: "session-conflict-001",
      sessionFilePath: resolveProjectPath("pi-sessions", "session-conflict-001.jsonl"),
    });
    const originalThread = expectOk(await openOrCreateManagedThread({ target: originalTarget }, store));
    const conflictingThread = expectOk(await openOrCreateManagedThread({ target: conflictingTarget }, store));
    const originalThreadJsonPath = resolveStorePath("threads", originalThread.threadId, "thread.json");
    const indexJsonPath = resolveStorePath("index.json");
    const threadBefore = await readFile(originalThreadJsonPath, "utf8");
    const indexBefore = await readFile(indexJsonPath, "utf8");

    const result = await store.updateThreadMetadata({
      threadId: originalThread.threadId,
      patch: {
        target: conflictingTarget,
        updatedAt: "2026-05-09T12:00:00.000Z",
      },
    });

    const threadAfter = await readFile(originalThreadJsonPath, "utf8");
    const indexAfter = await readFile(indexJsonPath, "utf8");
    const reopenedOriginal = expectOk(await store.findThreadByTarget(originalTarget));
    const reopenedConflicting = expectOk(await store.findThreadByTarget(conflictingTarget));
    const persistedIndex = JSON.parse(indexAfter) as ReturnType<typeof createStewardRootIndex>;
    const originalKeySet = deriveTargetSessionKeys(originalTarget);
    const conflictingKeySet = deriveTargetSessionKeys(conflictingTarget);

    expectIssueCode(result, "TARGET_ASSOCIATION_CONFLICT");
    assert.equal(threadAfter, threadBefore);
    assert.equal(indexAfter, indexBefore);
    assert.deepEqual(reopenedOriginal?.target, originalTarget);
    assert.equal(reopenedOriginal?.threadId, originalThread.threadId);
    assert.equal(reopenedConflicting?.threadId, conflictingThread.threadId);
    assert.equal(persistedIndex.threadByTargetKey[originalKeySet.canonicalKey], originalThread.threadId);
    assert.equal(persistedIndex.threadByTargetKey[conflictingKeySet.canonicalKey], conflictingThread.threadId);
    for (const aliasKey of originalKeySet.aliasKeys) {
      assert.equal(persistedIndex.threadByTargetKey[aliasKey], originalThread.threadId);
    }
    for (const aliasKey of conflictingKeySet.aliasKeys) {
      assert.equal(persistedIndex.threadByTargetKey[aliasKey], conflictingThread.threadId);
    }
  });
});

test("leaves the last committed metadata file intact when a temp metadata write fails", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new TempWriteFailingFileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const threadJsonPath = resolveStorePath("threads", thread.threadId, "thread.json");
    const before = await readFile(threadJsonPath, "utf8");

    store.failNextThreadMetadataWrite = true;
    const result = await updateGeneratedThreadViewOutputMetadata({
      store,
      threadId: thread.threadId,
      generatedFilePath: "/tmp/generated/failure-case.jsonl",
    });
    const after = await readFile(threadJsonPath, "utf8");

    expectIssueCode(result, "STORE_UNAVAILABLE");
    assert.equal(after, before);
  });
});

test("writes thread view output summary with legacy projection summary read compatibility", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: await makeManagedTarget(resolveProjectPath) }, store));
    const threadJsonPath = resolveStorePath("threads", thread.threadId, "thread.json");
    const generatedFilePath = resolveProjectPath("generated", "thread-view-output.jsonl");

    expectOk(
      await updateGeneratedThreadViewOutputMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath,
      }),
    );

    const legacyThreadViewOutputSummaryField = `projection${"Summary"}`;
    const persisted = JSON.parse(await readFile(threadJsonPath, "utf8")) as {
      threadViewOutputSummary?: ThreadRecord["threadViewOutputSummary"];
      [key: string]: unknown;
    };
    assert.equal(persisted[legacyThreadViewOutputSummaryField], undefined);
    assert.equal(persisted.threadViewOutputSummary?.currentGeneratedFilePath, generatedFilePath);

    persisted[legacyThreadViewOutputSummaryField] = persisted.threadViewOutputSummary;
    delete persisted.threadViewOutputSummary;
    await writeFile(threadJsonPath, `${JSON.stringify(persisted, null, 2)}\n`);

    const reopened = expectOk(await store.openThread(thread.threadId));
    assert.equal(reopened.thread.threadViewOutputSummary.currentGeneratedFilePath, generatedFilePath);
  });
});

test("rebuilds missing target-key index entries from existing threads on startup", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await makeManagedTarget(resolveProjectPath, {
      sessionId: "session-rebuild-001",
      sessionFilePath: resolveProjectPath("pi-sessions", "session-rebuild-001.jsonl"),
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const actor = makeActorRecord({ actorId: "actor-rebuild-001" });
    expectOk(
      await appendSourceMessage({
        store,
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-rebuild-001",
          actorId: actor.actorId,
          actorType: actor.actorType,
        }),
      }),
    );
    await writeFile(resolveStorePath("index.json"), `${JSON.stringify(createStewardRootIndex(), null, 2)}\n`);

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopenedThread = expectOk(await reopenedStore.findThreadByTarget(target));
    const rebuiltIndex = JSON.parse(await readFile(resolveStorePath("index.json"), "utf8")) as ReturnType<
      typeof createStewardRootIndex
    >;
    const keySet = deriveTargetSessionKeys(target);

    assert.equal(reopenedThread?.threadId, thread.threadId);
    assert.equal(rebuiltIndex.threadByTargetKey[keySet.canonicalKey], thread.threadId);
    for (const aliasKey of keySet.aliasKeys) {
      assert.equal(rebuiltIndex.threadByTargetKey[aliasKey], thread.threadId);
    }
  });
});
