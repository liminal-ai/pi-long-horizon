import assert from "node:assert/strict";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { countRawTurnMaterialized, countSmoothTurnMaterialized } from "../../src/token-accounting/materialized-representation-counter.js";
import { fail, type StewardResult } from "../../src/context-steward/domain/errors.js";
import { registerContextStewardExtension } from "../../src/context-steward/pi/pi-extension.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { SqliteThreadStore, resolveThreadSqlitePath } from "../../src/context-steward/store/sqlite-thread-store.js";
import type { ThreadStore } from "../../src/context-steward/store/thread-store.js";

class FakeExtensionApi {
  readonly handlers = new Map<string, Array<(event: any, ctx: any) => Promise<unknown> | unknown>>();

  on(eventName: string, handler: (event: any, ctx: any) => Promise<unknown> | unknown): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async emit(eventName: string, event: any, ctx: any): Promise<void> {
    for (const handler of this.handlers.get(eventName) ?? []) {
      await handler(event, ctx);
    }
  }
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
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

async function waitForAssertion(
  assertion: () => Promise<void> | void,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(20);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${description}: ${lastError.message}`;
    throw lastError;
  }

  throw new Error(description);
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n', "utf8");
}

async function assertPathMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path));
}

function exactTokenRecord<
  T extends {
    count: number;
    source: string;
    trustClass: string;
    provider?: string;
    model?: string;
    createdAt?: string;
    provenance?: string;
  },
>(expected: T, count: number): T {
  return {
    ...expected,
    count,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    createdAt: "2026-05-26T12:00:00.000Z",
    provenance: "tests.context-steward.runtime-capture-sqlite.exact-counter",
  };
}

class FlakyAppendSqliteStore extends SqliteThreadStore {
  private appendAttempts = 0;

  override async appendMessage(input: Parameters<ThreadStore["appendMessage"]>[0]) {
    this.appendAttempts += 1;
    if (this.appendAttempts === 1) {
      return fail({
        code: "SQLITE_STORE_UNAVAILABLE",
        message: "SQLite append hit a transient busy lock.",
        threadId: input.threadId,
        cause: "database is locked",
      });
    }

    return super.appendMessage(input);
  }
}

test("production PI capture defaults to SQLite and avoids legacy thread source files", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveStorePath }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-001",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-001.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI);

    const ctx = makePiExtensionContext(target);
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "SQLite prompt" }) }, ctx);
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiAssistantMessage({
          responseId: "response-runtime-sqlite-001",
          content: [{ type: "text", text: "SQLite response" }],
        }),
      },
      ctx,
    );

    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const thread = expectOk(await sqliteStore.findManagedThread(target));
    assert.ok(thread);

    const snapshot = expectOk(await sqliteStore.openThread(thread.threadId));
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt", "response"]);
    assert.equal(snapshot.turns.length, 1);

    await stat(resolveThreadSqlitePath(storeRootDir, thread.threadId));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "thread.json"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "messages.jsonl"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "turns.json"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "chunks.json"));
  });
});

test("duplicate finalized runtime activity stays idempotent through the SQLite default store", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-002",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-002.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI);

    const ctx = makePiExtensionContext(target);
    const event = {
      type: "message_end" as const,
      message: makePiAssistantMessage({
        responseId: "response-runtime-sqlite-duplicate",
        content: [{ type: "text", text: "Duplicate-safe response" }],
      }),
    };

    await pi.emit("message_end", event, ctx);
    await pi.emit("message_end", event, ctx);

    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const thread = expectOk(await sqliteStore.findManagedThread(target));
    assert.ok(thread);

    const snapshot = expectOk(await sqliteStore.openThread(thread.threadId));
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0]?.messageKind, "response");
  });
});

test("runtime user prompt smoothing persists through the SQLite default store without legacy source files", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveStorePath }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-smoothing",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-smoothing.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      userPromptSmoothing: {
        enabled: true,
        provider: {
          async smoothUserPrompt(input) {
            return {
              text: "Please clean up ./src/app.ts and keep threshold 0.82.",
              providerId: "openai-codex",
              modelId: "gpt-5.4-mini",
              reasoningEffort: "none",
              promptVersion: input.promptVersion,
              usage: { inputTokens: 9, outputTokens: 4 },
              elapsedMs: 3,
              generatedAt: "2026-05-26T12:00:00.000Z",
            };
          },
        },
      },
    });

    const ctx = makePiExtensionContext(target);
    const rawPrompt = "maybe clean up ./src/app.ts and keep threshold 0.82";
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: rawPrompt }) }, ctx);

    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const thread = expectOk(await sqliteStore.findManagedThread(target));
    assert.ok(thread);

    await waitForAssertion(async () => {
      const snapshot = expectOk(await sqliteStore.openThread(thread.threadId));
      const component = snapshot.turns[0]?.smooth?.components?.find((candidate) => candidate.kind === "user_prompt");
      assert.equal(component?.text, "Please clean up ./src/app.ts and keep threshold 0.82.");
      assert.equal(snapshot.messages[0]?.parts[0]?.content, rawPrompt);
    }, "runtime SQLite smoothing should persist the user prompt component");

    await stat(resolveThreadSqlitePath(storeRootDir, thread.threadId));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "thread.json"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "messages.jsonl"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "turns.json"));
    await assertPathMissing(resolveStorePath("threads", thread.threadId, "chunks.json"));
  });
});

test("capture surfaces explicit append failure details and succeeds on retry after a transient SQLite store error", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-flaky",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-flaky.jsonl`,
      cwd: projectDir,
    });
    const store = new FlakyAppendSqliteStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Retry this prompt" }),
        ctx: makePiExtensionContext(target),
      }),
    );

    const firstAttempt = await captureFinalizedActivity({
      store,
      threadId: thread.threadId,
      activity,
    });

    assert.equal(firstAttempt.ok, false);
    assert.equal(firstAttempt.issues[0]?.code, "CAPTURE_APPEND_FAILED");
    assert.equal(firstAttempt.issues[0]?.threadId, thread.threadId);
    assert.equal(firstAttempt.issues[0]?.targetSessionId, target.sessionId);
    assert.match(firstAttempt.issues[0]?.message ?? "", /prompt/);
    assert.match(firstAttempt.issues[0]?.cause ?? "", /SQLITE_STORE_UNAVAILABLE/);
    assert.equal(firstAttempt.issues.some((issue) => issue.code === "SQLITE_STORE_UNAVAILABLE"), true);

    const secondAttempt = expectOk(
      await captureFinalizedActivity({
        store,
        threadId: thread.threadId,
        activity,
      }),
    );
    const snapshot = expectOk(await store.openThread(thread.threadId));

    assert.equal(secondAttempt.message.messageKind, "prompt");
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt"]);
    assert.equal(snapshot.messages[0]?.targetMetadata?.sessionId, target.sessionId);
  });
});

test("failed first managed SQLite capture does not leave a discoverable empty managed thread", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-first-capture-rollback",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-first-capture-rollback.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FlakyAppendSqliteStore(storeRootDir);
    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });

    const ctx = makePiExtensionContext(target);
    await assert.rejects(
      () => pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "First prompt fails" }) }, ctx),
      /CAPTURE_APPEND_FAILED/,
    );

    assert.equal(expectOk(await store.findManagedThread(target)), undefined);

    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Second prompt succeeds" }) }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    const snapshot = expectOk(await store.openThread(thread.threadId));
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt"]);
    assert.equal(snapshot.messages[0]?.parts[0]?.content, "Second prompt succeeds");
  });
});

test("production PI capture still appends new canonical activity while SQLite background repair is counting an older turn", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-runtime-sqlite-background-repair",
      sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-background-repair.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      openAIInputTokenCounter: {
        async countRawTurnMaterialized(input: Parameters<typeof countRawTurnMaterialized>[0]) {
          started.resolve();
          await release.promise;
          return exactTokenRecord(countRawTurnMaterialized(input), 11_001);
        },
        async countSmoothTurnMaterialized(
          turn: Parameters<typeof countSmoothTurnMaterialized>[0],
          options: Parameters<typeof countSmoothTurnMaterialized>[1] = {},
        ) {
          void options;
          return exactTokenRecord(countSmoothTurnMaterialized(turn), 12_001);
        },
      } as any,
    });

    const ctx = makePiExtensionContext(target);
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Prompt before repair" }) }, ctx);
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiAssistantMessage({
          responseId: "response-runtime-sqlite-background-repair",
          content: [{ type: "text", text: "Response before repair" }],
        }),
      },
      ctx,
    );
    await pi.emit("turn_end", { type: "turn_end", timestamp: Date.parse("2026-05-26T12:00:00.000Z") }, ctx);
    await started.promise;

    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Prompt during repair" }) }, ctx);

    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const thread = expectOk(await sqliteStore.findManagedThread(target));
    assert.ok(thread);
    const snapshotWhileRepairBlocked = expectOk(await sqliteStore.openThread(thread.threadId));

    assert.deepEqual(
      snapshotWhileRepairBlocked.messages.map((message) => message.messageKind),
      ["prompt", "response", "prompt"],
    );
    assert.equal(
      snapshotWhileRepairBlocked.messages.some((message) => message.parts.some((part) => part.content === "Prompt during repair")),
      true,
    );
    assert.equal(snapshotWhileRepairBlocked.thread.sourceRevision >= 3, true);

    release.resolve();
    await waitForAssertion(async () => {
      const reopened = expectOk(await sqliteStore.openThread(thread.threadId));
      assert.ok(reopened.thread.status.tokenCounting);
    }, "background repair should resume after canonical capture already persisted");
  });
});

test("turn_end reopen restores SQLite-backed managed state from a fresh store instance", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const priorDelay = process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
    process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = "0";

    try {
      const target = makeThreadTarget({
        sessionId: "session-runtime-sqlite-003",
        sessionFilePath: `${projectDir}/pi/session-runtime-sqlite-003.jsonl`,
        cwd: projectDir,
      });
      await ensureTargetSessionFile(target);

      const pi = new FakeExtensionApi();
      registerContextStewardExtension(pi as unknown as ExtensionAPI);

      const ctx = makePiExtensionContext(target);
      await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Reopen prompt" }) }, ctx);
      await pi.emit(
        "message_end",
        {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-runtime-sqlite-reopen",
            content: [{ type: "text", text: "Reopen response" }],
          }),
        },
        ctx,
      );
      await pi.emit("turn_end", { type: "turn_end", timestamp: Date.parse("2026-05-26T12:00:00.000Z") }, ctx);

      const reopenedStore = new SqliteThreadStore(storeRootDir);
      const thread = expectOk(await reopenedStore.findManagedThread(target));
      assert.ok(thread);

      const snapshot = expectOk(await reopenedStore.openThread(thread.threadId));
      assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt", "response"]);
      assert.equal(snapshot.turns.length, 1);
      assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
      assert.equal(snapshot.thread.status.turnState, "ready");
    } finally {
      if (priorDelay === undefined) {
        delete process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
      } else {
        process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = priorDelay;
      }
    }
  });
});
