import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { runCli } from "../../src/commands/run.js";
import { ThreadEventStore, ThreadEventStoreError } from "../../src/thread-events/store.js";
import type { ThreadEventAppendInput } from "../../src/thread-events/schema.js";

function tempThreadDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "lhx-thread-events-")), "thread.sqlite");
}

function listSqliteTables(dbPath: string): string[] {
  const db = new Database(dbPath);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
  } finally {
    db.close();
  }
}

function createLegacyShapedThreadDb(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_revision INTEGER NOT NULL,
        message_high_watermark INTEGER NOT NULL,
        turns_revision INTEGER NOT NULL,
        target_runtime TEXT NOT NULL,
        target_session_id TEXT,
        target_session_file_path TEXT,
        current_generated_file_path TEXT,
        thread_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE messages (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        source_order INTEGER NOT NULL,
        source_revision INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        message_kind TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        target_event_key TEXT,
        message_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, message_id)
      ) STRICT;
    `);
  } finally {
    db.close();
  }
}

function createSameColumnsMissingUniqueThreadDb(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        client_thread_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  } finally {
    db.close();
  }
}

function createPartialUniqueThreadDb(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        client_thread_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX idx_threads_client_thread_id_partial
        ON threads(client_thread_id)
        WHERE title IS NOT NULL;
    `);
  } finally {
    db.close();
  }
}

function createSameNameViewDb(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE VIEW threads AS
      SELECT
        'thread-id' AS thread_id,
        'client-id' AS client_thread_id,
        NULL AS title,
        '2026-05-30T12:01:00.000Z' AS created_at,
        '2026-05-30T12:01:00.000Z' AS updated_at;
    `);
  } finally {
    db.close();
  }
}

function appendInput(overrides: Partial<ThreadEventAppendInput> = {}): ThreadEventAppendInput {
  return {
    idempotencyKey: "idem-1",
    eventKind: "user_prompt",
    actor: { actorKind: "user", actorId: "user-1", displayName: "Lee" },
    harness: { runtime: "codex", externalThreadId: "external-thread-1" },
    occurredAt: "2026-05-30T12:00:00.000Z",
    origin: { envelopeId: "env-1", envelopeOrder: 1 },
    payload: { text: "Hello" },
    ...overrides,
  };
}

function turnEndInput(overrides: Partial<ThreadEventAppendInput> = {}): ThreadEventAppendInput {
  return appendInput({
    idempotencyKey: "turn-end-1",
    eventKind: "turn_end",
    actor: { actorKind: "runtime", actorId: "codex-cli" },
    payload: {},
    ...overrides,
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("ThreadEventStore", () => {
  it("stores wrapped causes on ThreadEventStoreError using the standard Error cause", () => {
    const cause = new Error("underlying failure");
    const error = new ThreadEventStoreError("Thread event SQLite operation failed.", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ThreadEventStoreError");
    expect(error.cause).toBe(cause);
    expect(error.causeValue).toBe(cause);
  });

  it("creates threads explicitly and returns existing client threads without another source event", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      const created = await store.createThread({ clientThreadId: "client-alpha", title: "Alpha" });
      expect(created.created).toBe(true);
      expect(created.thread).toMatchObject({
        threadId: "generated-1",
        clientThreadId: "client-alpha",
        title: "Alpha",
        createdAt: "2026-05-30T12:01:00.000Z",
        updatedAt: "2026-05-30T12:01:00.000Z",
      });
      expect(created.event).toMatchObject({
        threadEventId: "generated-2",
        threadId: "generated-1",
        eventOrder: 1,
        eventKind: "thread_created",
        payload: { _tag: "thread_created", clientThreadId: "client-alpha", title: "Alpha" },
      });

      const existing = await store.createThread({ clientThreadId: "client-alpha", title: "Ignored retry title" });
      expect(existing).toEqual({ thread: created.thread, created: false });
      expect(await store.list()).toHaveLength(1);
      expect(await store.listThreads()).toEqual([created.thread]);
    } finally {
      store.close();
    }
  });

  it("creates anonymous threads by mirroring generated canonical id to clientThreadId", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      const created = await store.createThread();
      expect(created.created).toBe(true);
      expect(created.thread.threadId).toBe("generated-1");
      expect(created.thread.clientThreadId).toBe("generated-1");
      expect(created.event?.eventKind).toBe("thread_created");
    } finally {
      store.close();
    }
  });

  it("rejects legacy-shaped steward thread.sqlite before creating any thread-event tables", async () => {
    const dbPath = tempThreadDbPath();
    createLegacyShapedThreadDb(dbPath);
    const store = new ThreadEventStore({ eventDbPath: dbPath });

    try {
      await expect(store.createThread({ clientThreadId: "client-alpha" })).rejects.toThrow(
        /incompatible thread-events database schema/,
      );
      expect(listSqliteTables(dbPath)).toEqual(["messages", "threads"]);
    } finally {
      store.close();
    }
  });

  it("rejects same-column incompatible schemas before creating partial thread-event tables", async () => {
    const dbPath = tempThreadDbPath();
    createSameColumnsMissingUniqueThreadDb(dbPath);
    const store = new ThreadEventStore({ eventDbPath: dbPath });

    try {
      await expect(store.createThread({ clientThreadId: "client-alpha" })).rejects.toThrow(
        /incompatible thread-events database schema/,
      );
      expect(listSqliteTables(dbPath)).toEqual(["threads"]);
    } finally {
      store.close();
    }
  });

  it("rejects partial unique indexes for required uniqueness before creating partial thread-event tables", async () => {
    const dbPath = tempThreadDbPath();
    createPartialUniqueThreadDb(dbPath);
    const store = new ThreadEventStore({ eventDbPath: dbPath });

    try {
      await expect(store.createThread({ clientThreadId: "client-alpha" })).rejects.toThrow(
        /incompatible thread-events database schema/,
      );
      expect(listSqliteTables(dbPath)).toEqual(["threads"]);
    } finally {
      store.close();
    }
  });

  it("rejects same-name views before creating partial thread-event tables", async () => {
    const dbPath = tempThreadDbPath();
    createSameNameViewDb(dbPath);
    const store = new ThreadEventStore({ eventDbPath: dbPath });

    try {
      await expect(store.createThread({ clientThreadId: "client-alpha" })).rejects.toThrow(
        /incompatible thread-events database schema/,
      );
      expect(listSqliteTables(dbPath)).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("reports missing client threads on append without inserting source events", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      const result = await store.appendMany("missing-client", [appendInput()]);
      expect(result).toMatchObject({
        ok: false,
        results: [],
        error: { code: "thread_not_found", clientThreadId: "missing-client" },
      });
      expect(await store.list()).toEqual([]);
      expect(await store.listThreads()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("appends batches sequentially and projects messages and blocks in the same source-event transaction", async () => {
    let idCounter = 0;
    let recordedAtCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date(Date.UTC(2026, 4, 30, 12, 1, recordedAtCounter++)),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      const created = await store.createThread({ clientThreadId: "client-alpha" });
      const appended = await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi there" },
        }),
        appendInput({
          idempotencyKey: "thinking-1",
          eventKind: "assistant_thinking",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { thinkingKind: "reasoning", text: "User greeted me" },
        }),
        appendInput({
          idempotencyKey: "tool-call-1",
          eventKind: "tool_call",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { toolCallId: "call-1", toolName: "lookup", argumentsJson: { q: "weather" } },
        }),
        appendInput({
          idempotencyKey: "tool-result-1",
          eventKind: "tool_result",
          actor: { actorKind: "tool", actorId: "lookup" },
          payload: { toolCallId: "call-1", toolName: "lookup", outputText: "failed", isError: true },
        }),
        appendInput({
          idempotencyKey: "runtime-1",
          eventKind: "runtime_note",
          actor: { actorKind: "runtime", actorId: "codex-cli" },
          payload: { text: "context compacted", systemKind: "context_change" },
        }),
      ]);

      expect(appended.ok).toBe(true);
      expect(appended.thread).toMatchObject({
        threadId: created.thread.threadId,
        clientThreadId: created.thread.clientThreadId,
        createdAt: created.thread.createdAt,
        updatedAt: "2026-05-30T12:01:06.000Z",
      });
      expect(appended.results).toHaveLength(6);
      expect(appended.results.every((result) => result.ok && result.duplicate === false)).toBe(true);

      const events = await store.list();
      expect(events.map((event) => [event.eventOrder, event.eventKind])).toEqual([
        [1, "thread_created"],
        [2, "user_prompt"],
        [3, "assistant_text"],
        [4, "assistant_thinking"],
        [5, "tool_call"],
        [6, "tool_result"],
        [7, "runtime_note"],
      ]);

      const read = await store.readThread("client-alpha");
      expect(read?.thread.updatedAt).toBe(appended.thread?.updatedAt);
      expect(read?.messages.map((message) => ({
        order: message.messageOrder,
        kind: message.messageKind,
        status: message.status,
        blockKind: message.blocks[0]?.blockKind,
        payload: message.blocks[0]?.payload,
        sourceEventOrder: message.sourceEventOrder,
      }))).toEqual([
        {
          order: 1,
          kind: "user",
          status: "complete",
          blockKind: "text",
          payload: { text: "Hello" },
          sourceEventOrder: 2,
        },
        {
          order: 2,
          kind: "assistant",
          status: "complete",
          blockKind: "text",
          payload: { text: "Hi there" },
          sourceEventOrder: 3,
        },
        {
          order: 3,
          kind: "assistant",
          status: "complete",
          blockKind: "thinking",
          payload: { thinkingKind: "reasoning", text: "User greeted me" },
          sourceEventOrder: 4,
        },
        {
          order: 4,
          kind: "assistant",
          status: "complete",
          blockKind: "tool_call",
          payload: { toolCallId: "call-1", toolName: "lookup", argumentsJson: { q: "weather" } },
          sourceEventOrder: 5,
        },
        {
          order: 5,
          kind: "tool_result",
          status: "error",
          blockKind: "tool_result",
          payload: { toolCallId: "call-1", toolName: "lookup", outputText: "failed", isError: true },
          sourceEventOrder: 6,
        },
        {
          order: 6,
          kind: "system",
          status: "complete",
          blockKind: "text",
          payload: { text: "context compacted", systemKind: "context_change" },
          sourceEventOrder: 7,
        },
      ]);
      expect(read?.messages.map((message) => message.messageId)).toEqual([
        "msg_Z2VuZXJhdGVkLTE_1",
        "msg_Z2VuZXJhdGVkLTE_2",
        "msg_Z2VuZXJhdGVkLTE_3",
        "msg_Z2VuZXJhdGVkLTE_4",
        "msg_Z2VuZXJhdGVkLTE_5",
        "msg_Z2VuZXJhdGVkLTE_6",
      ]);
    } finally {
      store.close();
    }
  });

  it("persists all appendMany successes in one batch", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });

      const appended = await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "first" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "second" },
        }),
        appendInput({ idempotencyKey: "prompt-2", payload: { text: "third" } }),
      ]);

      expect(appended.ok).toBe(true);
      expect(appended.results).toHaveLength(3);
      expect(await store.list("client-alpha")).toHaveLength(4);
    } finally {
      store.close();
    }
  });

  it("returns existing events for duplicate idempotency keys without duplicating projections", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const first = await store.append("client-alpha", appendInput());
      const duplicate = await store.append("client-alpha", appendInput({ payload: { text: "Different ignored text" } }));

      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.event).toEqual(first.event);
      expect(duplicate.messages).toEqual(first.messages);
      expect(duplicate.blocks).toEqual(first.blocks);
      expect((await store.readThread("client-alpha"))?.messages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("stops append batches on first failure while preserving earlier committed event transactions", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const result = await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "valid-1", payload: { text: "first" } }),
        appendInput({
          idempotencyKey: "invalid-thinking",
          eventKind: "assistant_thinking",
          payload: { text: "missing thinking kind" },
        }),
        appendInput({ idempotencyKey: "not-processed", payload: { text: "third" } }),
      ]);

      expect(result.ok).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({ ok: true, inputIndex: 0 });
      expect(result.results[1]).toMatchObject({
        ok: false,
        inputIndex: 1,
        error: { code: "validation_failed" },
      });
      expect((await store.readThread("client-alpha"))?.messages.map((message) => message.blocks[0]?.payload)).toEqual([
        { text: "first" },
      ]);
      expect((await store.list()).map((event) => event.idempotencyKey)).toEqual([
        "thread_created:client-alpha",
        "valid-1",
      ]);
    } finally {
      store.close();
    }
  });

  it("rejects old junk-drawer and non-canonical thinking source events", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await expect(store.append("client-alpha", {
        ...appendInput(),
        eventKind: "unknown_activity",
        payload: { summary: "surprise" },
      })).rejects.toThrow(/Invalid thread event append input/);
      await expect(store.append("client-alpha", appendInput({
        idempotencyKey: "thinking-old-reasoning-text",
        eventKind: "assistant_thinking",
        payload: { thinkingKind: "reasoning_text", text: "old name" },
      }))).rejects.toThrow(/Invalid assistant_thinking payload/);
      await expect(store.append("client-alpha", appendInput({
        idempotencyKey: "thinking-redacted",
        eventKind: "assistant_thinking",
        payload: { thinkingKind: "redacted_reasoning" },
      }))).rejects.toThrow(/Invalid assistant_thinking payload/);
      expect((await store.readThread("client-alpha"))?.messages).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("rejects append input that provides service-generated fields", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await expect(
        store.append("client-alpha", {
          ...appendInput(),
          threadId: "caller-supplied-thread-id",
          schemaVersion: "thread_event.v1",
          eventOrder: 99,
        }),
      ).rejects.toThrow(/must not include generated field/);
    } finally {
      store.close();
    }
  });

  it("persists turn_end without message projection and atomically writes a deterministic trigger", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const result = await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi" },
        }),
        turnEndInput(),
      ]);

      expect(result.ok).toBe(true);
      expect(result.results[2]).toMatchObject({
        ok: true,
        duplicate: false,
        triggered: true,
        event: { eventKind: "turn_end", payload: { _tag: "turn_end" } },
        messages: [],
        blocks: [],
      });
      const triggers = await store.listTurnProcessingTriggers();
      expect(triggers).toHaveLength(1);
      expect(triggers[0]).toMatchObject({
        threadId: result.thread?.threadId,
        turnEndEventOrder: 4,
        status: "pending",
      });
      expect(triggers[0]?.triggerId).toContain("_4");
    } finally {
      store.close();
    }
  });

  it("skips events after first turn_end until the next user_prompt", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const result = await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "first" } }),
        turnEndInput(),
        appendInput({
          idempotencyKey: "skipped-assistant",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "skipped" },
        }),
        turnEndInput({ idempotencyKey: "skipped-turn-end" }),
        appendInput({ idempotencyKey: "prompt-2", payload: { text: "second" } }),
      ]);

      expect(result.ok).toBe(true);
      expect(result.results).toHaveLength(5);
      expect(result.results[2]).toEqual({
        ok: true,
        inputIndex: 2,
        skipped: true,
        reason: "ignored_after_turn_end",
      });
      expect(result.results[3]).toEqual({
        ok: true,
        inputIndex: 3,
        skipped: true,
        reason: "ignored_after_turn_end",
      });
      expect((await store.list()).map((event) => event.idempotencyKey)).toEqual([
        "thread_created:client-alpha",
        "prompt-1",
        "turn-end-1",
        "prompt-2",
      ]);
      expect((await store.readThread("client-alpha"))?.messages.map((message) => message.blocks[0]?.payload)).toEqual([
        { text: "first" },
        { text: "second" },
      ]);
    } finally {
      store.close();
    }
  });

  it("re-enters skip mode when a retried batch hits a duplicate winning turn_end", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const batch = [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "first" } }),
        turnEndInput(),
        appendInput({
          idempotencyKey: "skipped-assistant",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "skipped" },
        }),
      ];
      await store.appendMany("client-alpha", batch);
      const retry = await store.appendMany("client-alpha", batch);

      expect(retry.results[1]).toMatchObject({
        ok: true,
        duplicate: true,
        event: { eventKind: "turn_end" },
        triggered: true,
      });
      expect(retry.results[2]).toEqual({
        ok: true,
        inputIndex: 2,
        skipped: true,
        reason: "ignored_after_turn_end",
      });
      expect(await store.listTurnProcessingTriggers()).toHaveLength(1);
      expect((await store.list()).map((event) => event.idempotencyKey)).toEqual([
        "thread_created:client-alpha",
        "prompt-1",
        "turn-end-1",
      ]);
    } finally {
      store.close();
    }
  });

  it("persists turn_end with no open span without creating a trigger", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const result = await store.append("client-alpha", turnEndInput());

      expect(result).toMatchObject({
        event: { eventKind: "turn_end" },
        triggered: false,
        reason: "no_open_turn_span",
        messages: [],
        blocks: [],
      });
      expect(await store.listTurnProcessingTriggers()).toEqual([]);
      expect((await store.list()).map((event) => event.eventKind)).toEqual(["thread_created", "turn_end"]);
    } finally {
      store.close();
    }
  });

  it("rejects turn_end payloads with extra fields", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      const result = await store.appendMany("client-alpha", [
        turnEndInput({ payload: { reason: "unexpected" } as ThreadEventAppendInput["payload"] }),
      ]);

      expect(result.ok).toBe(false);
      expect(result.results[0]).toMatchObject({
        ok: false,
        inputIndex: 0,
        error: { code: "validation_failed" },
      });
      expect(await store.listTurnProcessingTriggers()).toEqual([]);
      expect((await store.list()).map((event) => event.eventKind)).toEqual(["thread_created"]);
    } finally {
      store.close();
    }
  });

  it("worker persists deterministic non-ready turn state and blocks chunking without exact projection count", async () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      const created = await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi" },
        }),
        turnEndInput(),
      ]);

      const processed = await store.processNextTurnEndTrigger();
      expect(processed).toMatchObject({
        completed: true,
        retryable: false,
        reason: "turn_not_ready",
        turn: {
          turnId: `turn_${Buffer.from(created.thread.threadId, "utf8").toString("base64url")}_1`,
          turnOrder: 1,
          processingStatus: "non_ready",
          messageIds: [
            `msg_${Buffer.from(created.thread.threadId, "utf8").toString("base64url")}_1`,
            `msg_${Buffer.from(created.thread.threadId, "utf8").toString("base64url")}_2`,
          ],
        },
      });
      expect((await store.listTurnProcessingTriggers())[0]?.status).toBe("complete");
      expect(await store.readChunks("client-alpha")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("does not claim another trigger for the same thread while one worker is running", async () => {
    let countCalls = 0;
    let releaseCount!: () => void;
    const countBlocker = new Promise<void>((resolve) => {
      releaseCount = resolve;
    });
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      worker: {
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection() {
            countCalls += 1;
            await countBlocker;
            return { count: 5 };
          },
        },
      },
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "first" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "one" },
        }),
        turnEndInput({ idempotencyKey: "turn-end-1" }),
        appendInput({ idempotencyKey: "prompt-2", payload: { text: "second" } }),
        appendInput({
          idempotencyKey: "assistant-2",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "two" },
        }),
        turnEndInput({ idempotencyKey: "turn-end-2" }),
      ]);

      const firstRun = store.processNextTurnEndTrigger();
      await waitFor(async () => {
        const triggers = await store.listTurnProcessingTriggers();
        return countCalls === 1 && triggers[0]?.status === "claimed" && triggers[1]?.status === "pending";
      });

      expect(await store.processNextTurnEndTrigger()).toMatchObject({
        completed: false,
        retryable: false,
        reason: "no_pending_trigger",
      });
      expect(countCalls).toBe(1);

      releaseCount();
      expect(await firstRun).toMatchObject({ completed: true, retryable: false });
      expect((await store.listTurnProcessingTriggers()).map((trigger) => trigger.status)).toEqual([
        "complete",
        "pending",
      ]);
    } finally {
      releaseCount?.();
      store.close();
    }
  });

  it("does not process a later same-thread trigger before earlier triggers are complete", async () => {
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      worker: {
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection() {
            return { count: 5 };
          },
        },
      },
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "first" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "one" },
        }),
        turnEndInput({ idempotencyKey: "turn-end-1" }),
        appendInput({ idempotencyKey: "prompt-2", payload: { text: "second" } }),
        appendInput({
          idempotencyKey: "assistant-2",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "two" },
        }),
        turnEndInput({ idempotencyKey: "turn-end-2" }),
      ]);

      const triggers = await store.listTurnProcessingTriggers();
      expect(triggers).toHaveLength(2);

      expect(await store.processTurnEndTrigger(triggers[1]!.triggerId)).toMatchObject({
        completed: false,
        retryable: false,
        reason: "no_pending_trigger",
      });
      expect(await store.readTurns("client-alpha")).toEqual([]);

      expect(await store.processTurnEndTrigger(triggers[0]!.triggerId)).toMatchObject({
        completed: true,
        retryable: false,
      });
      expect(await store.processTurnEndTrigger(triggers[1]!.triggerId)).toMatchObject({
        completed: true,
        retryable: false,
      });

      const turns = await store.readTurns("client-alpha");
      expect(turns.map((turn) => [turn.turnOrder, turn.turnEndEventOrder])).toEqual([[1, 4], [2, 7]]);
      expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(2);
      expect((await store.listTurnProcessingTriggers()).map((trigger) => trigger.status)).toEqual([
        "complete",
        "complete",
      ]);
    } finally {
      store.close();
    }
  });

  it("worker chunks an eligible current turn incrementally and is idempotent on rerun", async () => {
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      worker: {
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection(input) {
            expect(input.text).toContain("Hello");
            return { count: 5 };
          },
        },
      },
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi" },
        }),
        turnEndInput(),
      ]);

      const processed = await store.processNextTurnEndTrigger();
      expect(processed.completed).toBe(true);
      expect(processed.updatedChunkIds).toHaveLength(1);
      expect((await store.readTurns("client-alpha"))[0]).toMatchObject({
        turnOrder: 1,
        processingStatus: "ready",
      });
      const chunks = await store.readChunks("client-alpha");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        chunkOrder: 1,
        lifecycleStatus: "open",
        sourceTurnIds: [(await store.readTurns("client-alpha"))[0]?.turnId],
      });
      expect(await store.processNextTurnEndTrigger()).toMatchObject({
        completed: false,
        reason: "no_pending_trigger",
      });
      expect(await store.readChunks("client-alpha")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("worker writes ready detailed and brief artifacts inline when a chunk closes", async () => {
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      worker: {
        chunkSettings: { hardMaxSmoothTokens: 1 },
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection() {
            return { count: 5 };
          },
        },
        chunkCompressionProvider: {
          async compressChunk(input) {
            return { text: `${input.band}:${input.transcript.slice(0, 10)}` };
          },
        },
      },
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi" },
        }),
        turnEndInput(),
      ]);

      await store.processNextTurnEndTrigger();
      const chunks = await store.readChunks("client-alpha");
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        lifecycleStatus: "closed",
        closeReason: "hard_max",
        lowerBand: {
          detailed: { status: "ready" },
          brief: { status: "ready" },
        },
      });
      expect(chunks[1]).toMatchObject({
        lifecycleStatus: "open",
        sourceTurnIds: [],
      });
    } finally {
      store.close();
    }
  });

  it("retry fills missing artifacts on an already-closed chunk before completing the trigger", async () => {
    const dbPath = tempThreadDbPath();
    const store = new ThreadEventStore({
      threadDbPath: dbPath,
      worker: {
        chunkSettings: { hardMaxSmoothTokens: 1 },
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection() {
            return { count: 5 };
          },
        },
        chunkCompressionProvider: {
          async compressChunk(input) {
            return { text: `${input.band}:retry:${input.transcript.slice(0, 10)}` };
          },
        },
      },
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });
      await store.appendMany("client-alpha", [
        appendInput({ idempotencyKey: "prompt-1", payload: { text: "Hello" } }),
        appendInput({
          idempotencyKey: "assistant-1",
          eventKind: "assistant_text",
          actor: { actorKind: "assistant", actorId: "assistant-main" },
          payload: { text: "Hi" },
        }),
        turnEndInput(),
      ]);

      await store.processNextTurnEndTrigger();
      const trigger = (await store.listTurnProcessingTriggers())[0]!;
      const closedChunk = (await store.readChunks("client-alpha")).find((chunk) => chunk.lifecycleStatus === "closed")!;
      expect(closedChunk.lowerBand).toMatchObject({
        detailed: { status: "ready" },
        brief: { status: "ready" },
      });

      const db = new Database(dbPath);
      try {
        db.prepare("UPDATE chunks SET lower_band_json = NULL WHERE chunk_id = ?").run(closedChunk.chunkId);
        db.prepare(`
          UPDATE turn_processing_triggers
          SET status = 'failed',
              completed_at = NULL,
              claimed_at = NULL,
              last_error = 'simulated transient artifact persistence failure'
          WHERE trigger_id = ?
        `).run(trigger.triggerId);
      } finally {
        db.close();
      }

      const retry = await store.processTurnEndTrigger(trigger.triggerId);
      expect(retry).toMatchObject({ completed: true, retryable: false });

      const repairedClosedChunk = (await store.readChunks("client-alpha"))
        .find((chunk) => chunk.chunkId === closedChunk.chunkId)!;
      expect(repairedClosedChunk.lowerBand).toMatchObject({
        detailed: { status: "ready", text: expect.stringContaining("detailed:retry") },
        brief: { status: "ready", text: expect.stringContaining("brief:retry") },
      });
      expect((await store.listTurnProcessingTriggers())[0]).toMatchObject({
        triggerId: trigger.triggerId,
        status: "complete",
      });
    } finally {
      store.close();
    }
  });
});

describe("thread-events CLI", () => {
  it("creates a thread, appends from input JSON, and reads projected messages", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lhx-thread-events-cli-"));
    const eventDbPath = path.join(tempDir, "thread-events.sqlite");
    const eventPath = path.join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(appendInput({ eventKind: "runtime_note", payload: { text: "captured" } })));

    const create = await runCli([
      "thread-events",
      "create",
      "--event-db",
      eventDbPath,
      "--client-thread-id",
      "client-cli",
      "--title",
      "CLI thread",
    ]);
    expect(create.exitCode).toBe(0);
    expect(create.stderr).toBe("");
    expect(JSON.parse(create.stdout)).toMatchObject({
      created: true,
      thread: { clientThreadId: "client-cli", title: "CLI thread" },
      event: { eventKind: "thread_created" },
    });

    const append = await runCli([
      "thread-events",
      "append",
      "--event-db",
      eventDbPath,
      "--client-thread-id",
      "client-cli",
      "--file",
      eventPath,
    ]);
    expect(append.exitCode).toBe(0);
    expect(append.stderr).toBe("");
    expect(JSON.parse(append.stdout)).toMatchObject({
      ok: true,
      results: [{
        ok: true,
        duplicate: false,
        event: {
          schemaVersion: "thread_event.v1",
          eventKind: "runtime_note",
          eventOrder: 2,
          payload: { _tag: "runtime_note", text: "captured" },
        },
      }],
    });

    const list = await runCli(["thread-events", "list", "--event-db", eventDbPath, "--json"]);
    expect(list.exitCode).toBe(0);
    expect(list.stderr).toBe("");
    expect(JSON.parse(list.stdout).map((event: { eventKind: string }) => event.eventKind)).toEqual([
      "thread_created",
      "runtime_note",
    ]);

    const read = await runCli([
      "thread-events",
      "read",
      "--event-db",
      eventDbPath,
      "--client-thread-id",
      "client-cli",
      "--json",
    ]);
    expect(read.exitCode).toBe(0);
    expect(read.stderr).toBe("");
    expect(JSON.parse(read.stdout).messages).toMatchObject([
      {
        messageKind: "system",
        blocks: [{ blockKind: "text", payload: { text: "captured", systemKind: "lifecycle" } }],
      },
    ]);
  });

  it("surfaces invalid payloads as structured append failures", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lhx-thread-events-cli-invalid-"));
    const eventDbPath = path.join(tempDir, "thread-events.sqlite");
    const eventPath = path.join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(appendInput({
      eventKind: "assistant_thinking",
      payload: { text: "no thinking kind" },
    })));

    const create = await runCli([
      "thread-events",
      "create",
      "--event-db",
      eventDbPath,
      "--client-thread-id",
      "client-cli",
    ]);
    expect(create.exitCode).toBe(0);

    const result = await runCli([
      "thread-events",
      "append",
      "--event-db",
      eventDbPath,
      "--client-thread-id",
      "client-cli",
      "--file",
      eventPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      results: [{
        ok: false,
        error: {
          code: "validation_failed",
        },
      }],
    });
  });
});
