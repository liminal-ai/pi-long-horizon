import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  mapPiMessageEndToThreadEvents,
  recordParallelEventIntakeMessageEnd,
  recordParallelEventIntakeTurnEnd,
  type ParallelEventIntakeLogger,
} from "../../src/context-steward/pi/parallel-event-intake.js";
import {
  DEFAULT_PI_MESSAGE_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadRecord,
} from "../../src/context-steward/test/fixtures.js";
import { ThreadEventStore } from "../../packages/lh-context/src/thread-events/store.js";

function tempDbPath(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallel-event-intake-")).then((dir) => join(dir, "thread.sqlite"));
}

function createProductionStylePluralTables(dbPath: string): void {
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

      CREATE TABLE turns (
        thread_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        turn_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, turn_index)
      ) STRICT;

      CREATE TABLE chunks (
        thread_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, chunk_index)
      ) STRICT;

      INSERT INTO threads (
        thread_id,
        created_at,
        updated_at,
        source_revision,
        message_high_watermark,
        turns_revision,
        target_runtime,
        thread_json
      ) VALUES ('legacy-thread', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1, 1, 1, 'pi', '{}');
      INSERT INTO messages (
        thread_id,
        message_id,
        source_order,
        source_revision,
        actor_id,
        message_kind,
        captured_at,
        message_json
      ) VALUES ('legacy-thread', 'legacy-message', 1, 1, 'user', 'user_prompt', '2026-01-01T00:00:00.000Z', '{}');
      INSERT INTO turns (thread_id, turn_index, turn_json) VALUES ('legacy-thread', 1, '{}');
      INSERT INTO chunks (thread_id, chunk_index, chunk_json) VALUES ('legacy-thread', 1, '{}');
    `);
  } finally {
    db.close();
  }
}

function sqliteTables(dbPath: string): string[] {
  const db = new Database(dbPath);
  try {
    return db.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);
  } finally {
    db.close();
  }
}

function rowCount(dbPath: string, tableName: string): number {
  const db = new Database(dbPath);
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

function makeStoreResolver(dbPath: string) {
  return {
    resolveThreadDbPath(threadId: string): string | undefined {
      return threadId === "thread-001" ? dbPath : undefined;
    },
  };
}

function warningCollector() {
  const warnings: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const logger: ParallelEventIntakeLogger = {
    warn(message, details) {
      warnings.push({ message, details });
    },
  };
  return { logger, warnings };
}

test("parallel event intake coexists with plural production tables and populates singular tables", async () => {
  const dbPath = await tempDbPath();
  createProductionStylePluralTables(dbPath);
  assert.deepEqual(["threads", "messages", "turns", "chunks"].map((table) => rowCount(dbPath, table)), [1, 1, 1, 1]);

  const ctx = makePiExtensionContext();
  const thread = makeThreadRecord({
    sourceRevision: 42,
    threadViewOutputSummary: { count: 1, currentGeneratedFilePath: "/tmp/generated/pi-session.jsonl" },
  });

  const result = await recordParallelEventIntakeMessageEnd({
    store: makeStoreResolver(dbPath),
    thread,
    ctx,
    event: {
      type: "message_end",
      message: makePiUserMessage({ content: "Create the fixture replay test." }),
    },
    now: () => new Date("2026-01-01T00:00:01.000Z"),
  });
  assert.equal(result.ok, true);

  assert.deepEqual(sqliteTables(dbPath), [
    "chunk",
    "chunks",
    "event",
    "message",
    "message_block",
    "messages",
    "thread",
    "threads",
    "turn",
    "turn_trigger",
    "turns",
  ]);
  assert.deepEqual(["threads", "messages", "turns", "chunks"].map((table) => rowCount(dbPath, table)), [1, 1, 1, 1]);

  const eventStore = new ThreadEventStore({ eventDbPath: dbPath });
  try {
    const events = await eventStore.list();
    assert.deepEqual(events.map((event) => event.eventKind), ["thread_created", "runtime_note", "user_prompt"]);
    const marker = events.find((event) => event.eventKind === "runtime_note");
    assert.deepEqual(marker?.payload, {
      _tag: "runtime_note",
      text: "Parallel event intake started.",
      systemKind: "lifecycle",
      metadata: {
        managedThreadId: "thread-001",
        sourceRevisionAtStart: 42,
        currentGeneratedFilePathAtStart: "/tmp/generated/pi-session.jsonl",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
    });
    assert.equal((await eventStore.readThread(thread.threadId))?.messages.length, 1);
  } finally {
    eventStore.close();
  }
});

test("parallel event intake maps PI message_end content to canonical event kinds in order", () => {
  const ctx = makePiExtensionContext();
  const thread = makeThreadRecord();
  const userEvents = mapPiMessageEndToThreadEvents({
    thread,
    ctx,
    message: makePiUserMessage({ content: "Please inspect the run." }),
  });
  assert.deepEqual(userEvents.map((event) => event.eventKind), ["user_prompt"]);
  assert.deepEqual(userEvents[0]?.payload, { text: "Please inspect the run." });

  const assistantEvents = mapPiMessageEndToThreadEvents({
    thread,
    ctx,
    message: makePiAssistantMessage({
      responseId: "resp-001",
      content: [
        { type: "thinking", thinking: "I should inspect the SQLite state." },
        { type: "toolCall", id: "call-001", name: "read", arguments: { path: "store.ts" } },
        { type: "text", text: "The event path is ready." },
      ],
    }),
  });
  assert.deepEqual(assistantEvents.map((event) => event.eventKind), [
    "assistant_thinking",
    "tool_call",
    "assistant_text",
  ]);
  assert.deepEqual(assistantEvents.map((event) => event.origin?.envelopeOrder), [1, 2, 3]);

  const toolEvents = mapPiMessageEndToThreadEvents({
    thread,
    ctx,
    message: makePiToolResultMessage({
      toolCallId: "call-001",
      toolName: "read",
      content: [{ type: "text", text: "Original untruncated tool output." }],
    }),
  });
  assert.deepEqual(toolEvents.map((event) => event.eventKind), ["tool_result"]);
  assert.deepEqual(toolEvents[0]?.payload, {
    toolCallId: "call-001",
    toolName: "read",
    outputText: "Original untruncated tool output.",
    isError: false,
  });
});

test("parallel event intake appends turn_end, processes its trigger, and is idempotent", async () => {
  const dbPath = await tempDbPath();
  const ctx = makePiExtensionContext();
  const thread = makeThreadRecord();
  const store = makeStoreResolver(dbPath);

  const messageResult = await recordParallelEventIntakeMessageEnd({
    store,
    thread,
    ctx,
    event: { type: "message_end", message: makePiUserMessage({ content: "Start the turn." }) },
    now: () => new Date("2026-01-01T00:00:01.000Z"),
  });
  assert.equal(messageResult.ok, true);

  const turnResult = await recordParallelEventIntakeTurnEnd({
    store,
    thread,
    ctx,
    event: { type: "turn_end", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 1_000 },
    finalized: { finalized: true, finalizedTurnId: "legacy-turn-001", turns: [] },
    now: () => new Date("2026-01-01T00:00:02.000Z"),
  });
  assert.equal(turnResult.ok, true);
  assert.deepEqual(turnResult.ok && !turnResult.skipped ? turnResult.processedTriggerIds?.length : undefined, 1);

  const eventStore = new ThreadEventStore({ eventDbPath: dbPath });
  try {
    assert.deepEqual((await eventStore.list()).map((event) => event.eventKind), [
      "thread_created",
      "runtime_note",
      "user_prompt",
      "turn_end",
    ]);
    assert.equal((await eventStore.listTurnProcessingTriggers())[0]?.status, "complete");
    assert.equal((await eventStore.readTurns(thread.threadId)).length, 1);
    assert.equal((await eventStore.readChunks(thread.threadId)).length, 1);
  } finally {
    eventStore.close();
  }

  await recordParallelEventIntakeMessageEnd({
    store,
    thread,
    ctx,
    event: { type: "message_end", message: makePiUserMessage({ content: "Start the turn." }) },
    now: () => new Date("2026-01-01T00:00:03.000Z"),
  });
  const replayTurn = await recordParallelEventIntakeTurnEnd({
    store,
    thread,
    ctx,
    event: { type: "turn_end", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 1_000 },
    finalized: { finalized: true, finalizedTurnId: "legacy-turn-001", turns: [] },
    now: () => new Date("2026-01-01T00:00:04.000Z"),
  });
  assert.equal(replayTurn.ok, true);
  assert.deepEqual(replayTurn.ok && !replayTurn.skipped ? replayTurn.processedTriggerIds : undefined, []);

  const replayStore = new ThreadEventStore({ eventDbPath: dbPath });
  try {
    assert.equal((await replayStore.list()).length, 4);
    assert.equal((await replayStore.readThread(thread.threadId))?.messages.length, 1);
    assert.equal((await replayStore.listTurnProcessingTriggers()).length, 1);
    assert.equal((await replayStore.readTurns(thread.threadId)).length, 1);
    assert.equal((await replayStore.readChunks(thread.threadId)).length, 1);
  } finally {
    replayStore.close();
  }
});

test("parallel event intake records one lifecycle marker across subsequent events", async () => {
  const dbPath = await tempDbPath();
  const ctx = makePiExtensionContext();
  const thread = makeThreadRecord();
  const store = makeStoreResolver(dbPath);

  await recordParallelEventIntakeMessageEnd({
    store,
    thread,
    ctx,
    event: { type: "message_end", message: makePiUserMessage({ timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP }) },
    now: () => new Date("2026-01-01T00:00:01.000Z"),
  });
  await recordParallelEventIntakeMessageEnd({
    store,
    thread,
    ctx,
    event: {
      type: "message_end",
      message: makePiAssistantMessage({
        timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 1,
        responseId: "resp-marker-test",
        content: [{ type: "text", text: "Done." }],
      }),
    },
    now: () => new Date("2026-01-01T00:00:02.000Z"),
  });

  const eventStore = new ThreadEventStore({ eventDbPath: dbPath });
  try {
    const lifecycleMarkers = (await eventStore.list()).filter((event) =>
      event.eventKind === "runtime_note" && event.idempotencyKey === "parallel-event-intake:start:thread-001"
    );
    assert.equal(lifecycleMarkers.length, 1);
  } finally {
    eventStore.close();
  }
});

test("parallel event intake reports missing SQLite DB path as a failure", async () => {
  const { logger, warnings } = warningCollector();
  const result = await recordParallelEventIntakeMessageEnd({
    store: {
      resolveThreadDbPath() {
        return undefined;
      },
    },
    thread: makeThreadRecord(),
    ctx: makePiExtensionContext(),
    event: { type: "message_end", message: makePiUserMessage() },
    logger,
  });

  assert.deepEqual(result, {
    ok: false,
    threadId: "thread-001",
    eventType: "message_end",
    cause: "SQLite thread DB path unavailable for parallel event intake",
    reason: "thread_db_path_unavailable",
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.message, "parallel event intake failed");
  assert.deepEqual(warnings[0]?.details, {
    threadId: "thread-001",
    eventType: "message_end",
    cause: "SQLite thread DB path unavailable for parallel event intake",
    reason: "thread_db_path_unavailable",
  });
});

test("parallel event intake failures are logged and non-throwing", async () => {
  const { logger, warnings } = warningCollector();
  const result = await recordParallelEventIntakeMessageEnd({
    store: makeStoreResolver("/tmp/not-used.sqlite"),
    thread: makeThreadRecord(),
    ctx: makePiExtensionContext(),
    event: { type: "message_end", message: makePiUserMessage() },
    logger,
    threadEventStoreFactory() {
      throw new Error("synthetic append failure");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    threadId: "thread-001",
    eventType: "message_end",
    cause: "synthetic append failure",
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.message, "parallel event intake failed");
  assert.deepEqual(warnings[0]?.details, {
    threadId: "thread-001",
    eventType: "message_end",
    cause: "synthetic append failure",
  });
});
