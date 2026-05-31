import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const sqliteClientMockState = vi.hoisted(() => ({ layerCalls: 0 }));

vi.mock("@effect/sql-sqlite-node/SqliteClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@effect/sql-sqlite-node/SqliteClient")>();
  return {
    ...actual,
    layer: (...args: Parameters<typeof actual.layer>) => {
      sqliteClientMockState.layerCalls += 1;
      return actual.layer(...args);
    },
  };
});

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

  it("uses one SQL layer setup for an appendMany batch", async () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `generated-${++idCounter}`,
    });

    try {
      await store.createThread({ clientThreadId: "client-alpha" });

      sqliteClientMockState.layerCalls = 0;
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
      expect(sqliteClientMockState.layerCalls).toBe(1);
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
