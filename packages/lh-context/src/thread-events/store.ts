import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import {
  THREAD_EVENT_SCHEMA_VERSION,
  decodePersistedThreadEvent,
  decodeThreadEventAppendInput,
  type NormalizedThreadEventAppendInput,
  type PersistedThreadEvent,
  type ThreadEventAppendInput,
} from "./schema.js";

export interface ThreadEventStoreOptions {
  threadDbPath: string;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface AppendThreadEventResult {
  event: PersistedThreadEvent;
  duplicate: boolean;
}

interface ThreadEventSqlRow {
  thread_event_id: string;
  thread_id: string;
  event_order: number;
  schema_version: string;
  event_kind: PersistedThreadEvent["eventKind"];
  idempotency_key: string;
  actor_json: string;
  harness_json: string;
  origin_json: string | null;
  recorded_at: string;
  occurred_at: string | null;
  payload_json: string;
}

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export class ThreadEventStore {
  private readonly threadDbPath: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;
  private db?: Database.Database;

  constructor(options: ThreadEventStoreOptions) {
    this.threadDbPath = resolve(options.threadDbPath);
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = undefined;
  }

  append(inputValue: ThreadEventAppendInput | unknown): AppendThreadEventResult {
    const input = decodeThreadEventAppendInput(inputValue);
    const existing = this.findByIdempotencyKey(input.threadId, input.idempotencyKey);
    if (existing) {
      return { event: existing, duplicate: true };
    }

    const appendTransaction = this.database().transaction((normalized: NormalizedThreadEventAppendInput): AppendThreadEventResult => {
      const duplicate = this.findByIdempotencyKey(normalized.threadId, normalized.idempotencyKey);
      if (duplicate) {
        return { event: duplicate, duplicate: true };
      }

      const eventOrder = this.nextEventOrder(normalized.threadId);
      const persisted = decodePersistedThreadEvent({
        schemaVersion: THREAD_EVENT_SCHEMA_VERSION,
        threadEventId: this.idGenerator(),
        threadId: normalized.threadId,
        eventOrder,
        idempotencyKey: normalized.idempotencyKey,
        eventKind: normalized.eventKind,
        actor: normalized.actor,
        harness: normalized.harness,
        origin: normalized.origin,
        recordedAt: this.now().toISOString(),
        occurredAt: normalized.occurredAt,
        payload: normalized.payload,
      });

      this.insert(persisted);
      return { event: persisted, duplicate: false };
    });
    return appendTransaction.immediate(input);
  }

  list(): PersistedThreadEvent[] {
    return this.database()
      .prepare<[], ThreadEventSqlRow>(
        `SELECT *
         FROM thread_events
         ORDER BY thread_id ASC, event_order ASC`,
      )
      .all()
      .map(rowToPersistedEvent);
  }

  private database(): Database.Database {
    if (this.db) {
      return this.db;
    }

    mkdirSync(dirname(this.threadDbPath), { recursive: true });
    const db = new Database(this.threadDbPath);
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS thread_events (
        thread_event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        event_order INTEGER NOT NULL,
        schema_version TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        harness_json TEXT NOT NULL,
        origin_json TEXT,
        recorded_at TEXT NOT NULL,
        occurred_at TEXT,
        payload_json TEXT NOT NULL,
        UNIQUE(thread_id, event_order),
        UNIQUE(thread_id, idempotency_key)
      ) STRICT;
    `);
    this.db = db;
    return db;
  }

  private findByIdempotencyKey(threadId: string, idempotencyKey: string): PersistedThreadEvent | undefined {
    const row = this.database()
      .prepare<[string, string], ThreadEventSqlRow>(
        `SELECT *
         FROM thread_events
         WHERE thread_id = ? AND idempotency_key = ?`,
      )
      .get(threadId, idempotencyKey);

    return row ? rowToPersistedEvent(row) : undefined;
  }

  private nextEventOrder(threadId: string): number {
    // Safe because append allocates inside transaction.immediate() on this SQLite DB,
    // and UNIQUE(thread_id, event_order) backs the ordering invariant.
    const row = this.database()
      .prepare<[string], { max_event_order: number | null }>(
        `SELECT MAX(event_order) AS max_event_order
         FROM thread_events
         WHERE thread_id = ?`,
      )
      .get(threadId);

    return (row?.max_event_order ?? 0) + 1;
  }

  private insert(event: PersistedThreadEvent): void {
    this.database()
      .prepare(
        `INSERT INTO thread_events (
           thread_event_id,
           thread_id,
           event_order,
           schema_version,
           event_kind,
           idempotency_key,
           actor_json,
           harness_json,
           origin_json,
           recorded_at,
           occurred_at,
           payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.threadEventId,
        event.threadId,
        event.eventOrder,
        event.schemaVersion,
        event.eventKind,
        event.idempotencyKey,
        JSON.stringify(event.actor),
        JSON.stringify(event.harness),
        event.origin ? JSON.stringify(event.origin) : null,
        event.recordedAt,
        event.occurredAt ?? null,
        JSON.stringify(event.payload),
      );
  }
}

export function appendThreadEvent(
  threadDbPath: string,
  input: ThreadEventAppendInput | unknown,
): AppendThreadEventResult {
  const store = new ThreadEventStore({ threadDbPath });
  try {
    return store.append(input);
  } finally {
    store.close();
  }
}

export function listThreadEvents(threadDbPath: string): PersistedThreadEvent[] {
  const store = new ThreadEventStore({ threadDbPath });
  try {
    return store.list();
  } finally {
    store.close();
  }
}

function rowToPersistedEvent(row: ThreadEventSqlRow): PersistedThreadEvent {
  return decodePersistedThreadEvent({
    schemaVersion: row.schema_version,
    threadEventId: row.thread_event_id,
    threadId: row.thread_id,
    eventOrder: row.event_order,
    idempotencyKey: row.idempotency_key,
    eventKind: row.event_kind,
    actor: parseJson(row.actor_json),
    harness: parseJson(row.harness_json),
    origin: row.origin_json ? parseJson(row.origin_json) : undefined,
    recordedAt: row.recorded_at,
    occurredAt: row.occurred_at ?? undefined,
    payload: parseJson(row.payload_json),
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}
