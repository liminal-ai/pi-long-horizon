import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import * as SqlClient from "@effect/sql/SqlClient";
import * as SqlError from "@effect/sql/SqlError";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Effect } from "effect";

import {
  THREAD_EVENT_SCHEMA_VERSION,
  decodePersistedThreadEvent,
  decodeThreadCreateInput,
  decodeThreadEventAppendInput,
  type ActorRef,
  type AppendThreadEventsInput,
  type HarnessRef,
  type JsonObject,
  type NormalizedThreadEventAppendInput,
  type PersistedThreadEvent,
  type ThreadCreateInput,
  type ThreadEventAppendInput,
  type ThreadEventPayload,
} from "./schema.js";

export interface ThreadEventStoreOptions {
  eventDbPath?: string;
  threadDbPath?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface ProjectedThread {
  threadId: string;
  clientThreadId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageKind = "user" | "assistant" | "tool_result" | "system";
export type MessageStatus = "complete" | "incomplete" | "aborted" | "error";
export type MessageBlockKind = "text" | "thinking" | "tool_call" | "tool_result" | "image" | "file";

export interface ProjectedMessage {
  messageId: string;
  threadId: string;
  messageOrder: number;
  messageKind: MessageKind;
  actor: ActorRef;
  status: MessageStatus;
  createdAt: string;
  sourceThreadEventId: string;
  sourceEventOrder: number;
}

export interface ProjectedMessageBlock {
  blockId: string;
  messageId: string;
  threadId: string;
  blockOrder: number;
  blockKind: MessageBlockKind;
  payload: JsonObject;
  sourceThreadEventId: string;
}

export interface ProjectedMessageWithBlocks extends ProjectedMessage {
  blocks: ProjectedMessageBlock[];
}

export interface ProjectedThreadRead {
  thread: ProjectedThread;
  messages: ProjectedMessageWithBlocks[];
}

export interface CreateThreadResult {
  thread: ProjectedThread;
  created: boolean;
  event?: PersistedThreadEvent;
}

export interface AppendThreadEventResult {
  event: PersistedThreadEvent;
  duplicate: boolean;
  messages: ProjectedMessage[];
  blocks: ProjectedMessageBlock[];
}

export interface AppendThreadEventsSuccess extends AppendThreadEventResult {
  ok: true;
  inputIndex: number;
}

export interface AppendThreadEventsFailure {
  ok: false;
  inputIndex: number;
  error: {
    code: "validation_failed" | "append_failed";
    message: string;
  };
}

export type AppendThreadEventsItemResult = AppendThreadEventsSuccess | AppendThreadEventsFailure;

export interface AppendThreadEventsResult {
  ok: boolean;
  thread?: ProjectedThread;
  results: AppendThreadEventsItemResult[];
  error?: {
    code: "thread_not_found";
    clientThreadId: string;
    message: string;
  };
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

interface ThreadSqlRow {
  thread_id: string;
  client_thread_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageSqlRow {
  message_id: string;
  thread_id: string;
  message_order: number;
  message_kind: MessageKind;
  actor_json: string;
  status: MessageStatus;
  created_at: string;
  source_thread_event_id: string;
  source_event_order: number;
}

interface MessageBlockSqlRow {
  block_id: string;
  message_id: string;
  thread_id: string;
  block_order: number;
  block_kind: MessageBlockKind;
  payload_json: string;
  source_thread_event_id: string;
}

interface SqliteMasterObjectRow {
  name: string;
  type: string;
}

interface SqliteTableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface SqliteIndexListRow {
  name: string;
  unique: number;
  partial: number;
}

interface SqliteIndexInfoRow {
  seqno: number;
  name: string | null;
}

interface ExpectedColumnSchema {
  type: string;
  notnull: boolean;
  pk: boolean;
}

interface ExpectedTableSchema {
  columns: Readonly<Record<string, ExpectedColumnSchema>>;
  uniqueColumnSets: readonly (readonly string[])[];
}

interface MessageProjectionDraft {
  messageKind: MessageKind;
  actor: ActorRef;
  status: MessageStatus;
  createdAt: string;
  blocks: BlockProjectionDraft[];
}

interface BlockProjectionDraft {
  blockKind: MessageBlockKind;
  payload: JsonObject;
}

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const EXPECTED_TABLE_SCHEMAS: Readonly<Record<string, ExpectedTableSchema>> = {
  threads: {
    columns: {
      thread_id: { type: "TEXT", notnull: true, pk: true },
      client_thread_id: { type: "TEXT", notnull: true, pk: false },
      title: { type: "TEXT", notnull: false, pk: false },
      created_at: { type: "TEXT", notnull: true, pk: false },
      updated_at: { type: "TEXT", notnull: true, pk: false },
    },
    uniqueColumnSets: [["client_thread_id"]],
  },
  thread_events: {
    columns: {
      thread_event_id: { type: "TEXT", notnull: true, pk: true },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      event_order: { type: "INTEGER", notnull: true, pk: false },
      schema_version: { type: "TEXT", notnull: true, pk: false },
      event_kind: { type: "TEXT", notnull: true, pk: false },
      idempotency_key: { type: "TEXT", notnull: true, pk: false },
      actor_json: { type: "TEXT", notnull: true, pk: false },
      harness_json: { type: "TEXT", notnull: true, pk: false },
      origin_json: { type: "TEXT", notnull: false, pk: false },
      recorded_at: { type: "TEXT", notnull: true, pk: false },
      occurred_at: { type: "TEXT", notnull: false, pk: false },
      payload_json: { type: "TEXT", notnull: true, pk: false },
    },
    uniqueColumnSets: [["thread_id", "event_order"], ["thread_id", "idempotency_key"]],
  },
  messages: {
    columns: {
      message_id: { type: "TEXT", notnull: true, pk: true },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      message_order: { type: "INTEGER", notnull: true, pk: false },
      message_kind: { type: "TEXT", notnull: true, pk: false },
      actor_json: { type: "TEXT", notnull: true, pk: false },
      status: { type: "TEXT", notnull: true, pk: false },
      created_at: { type: "TEXT", notnull: true, pk: false },
      source_thread_event_id: { type: "TEXT", notnull: true, pk: false },
      source_event_order: { type: "INTEGER", notnull: true, pk: false },
    },
    uniqueColumnSets: [["thread_id", "message_order"]],
  },
  message_blocks: {
    columns: {
      block_id: { type: "TEXT", notnull: true, pk: true },
      message_id: { type: "TEXT", notnull: true, pk: false },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      block_order: { type: "INTEGER", notnull: true, pk: false },
      block_kind: { type: "TEXT", notnull: true, pk: false },
      payload_json: { type: "TEXT", notnull: true, pk: false },
      source_thread_event_id: { type: "TEXT", notnull: true, pk: false },
    },
    uniqueColumnSets: [["message_id", "block_order"]],
  },
};

const THREAD_CREATED_ACTOR: ActorRef = {
  actorKind: "system",
  actorId: "lh-context-thread-events",
};

const DEFAULT_CREATE_HARNESS: HarnessRef = {
  runtime: "lh_context",
};

export class ThreadEventStore {
  private readonly eventDbPath: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(options: ThreadEventStoreOptions) {
    const eventDbPath = options.eventDbPath ?? options.threadDbPath;
    if (!eventDbPath) {
      throw new ThreadEventStoreError("ThreadEventStore requires eventDbPath.");
    }

    this.eventDbPath = resolve(eventDbPath);
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  close(): void {
    // Effect SQL scopes SQLite connections to each operation, so there is no
    // long-lived handle to close. Keep this method for existing callers.
  }

  async createThread(inputValue: ThreadCreateInput | unknown = {}): Promise<CreateThreadResult> {
    const input = decodeThreadCreateInput(inputValue);
    const now = this.now;
    const idGenerator = this.idGenerator;

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;

        return yield* Effect.gen(function*() {
          const requestedClientThreadId = input.clientThreadId;
          if (requestedClientThreadId) {
            const existing = yield* findThreadByClientThreadId(sql, requestedClientThreadId);
            if (existing) {
              return { thread: existing, created: false };
            }
          }

          const threadId = idGenerator();
          const clientThreadId = requestedClientThreadId ?? threadId;
          const recordedAt = now().toISOString();
          const harness = input.harness ?? makeDefaultCreateHarness(clientThreadId, threadId);
          const threadRows = yield* insertThread(sql, {
            threadId,
            clientThreadId,
            title: input.title,
            createdAt: recordedAt,
            updatedAt: recordedAt,
          });

          const insertedThread = threadRows[0];
          if (!insertedThread) {
            const concurrentExisting = yield* findThreadByClientThreadId(sql, clientThreadId);
            if (concurrentExisting) {
              return { thread: concurrentExisting, created: false };
            }
            throw new ThreadEventStoreError("Thread create neither inserted nor found an existing thread.");
          }

          const event = makeThreadCreatedEvent({
            threadId,
            clientThreadId,
            title: input.title,
            threadEventId: idGenerator(),
            recordedAt,
            occurredAt: input.occurredAt,
            harness,
          });
          const eventRows = yield* insertCreatedEvent(sql, event);
          const eventRow = eventRows[0];
          if (!eventRow) {
            throw new ThreadEventStoreError("Thread create did not insert a thread_created source event.");
          }

          return {
            thread: rowToThread(insertedThread),
            created: true,
            event: rowToPersistedEvent(eventRow),
          };
        }).pipe(sql.withTransaction);
      }),
    );
  }

  async appendMany(input: AppendThreadEventsInput | unknown): Promise<AppendThreadEventsResult>;
  async appendMany(clientThreadId: string, events: readonly unknown[]): Promise<AppendThreadEventsResult>;
  async appendMany(
    inputOrClientThreadId: AppendThreadEventsInput | string | unknown,
    maybeEvents?: readonly unknown[],
  ): Promise<AppendThreadEventsResult> {
    const batch = normalizeAppendManyArgs(inputOrClientThreadId, maybeEvents);
    const idGenerator = this.idGenerator;
    const now = this.now;

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        const thread = yield* findThreadByClientThreadId(sql, batch.clientThreadId);
        if (!thread) {
          return {
            ok: false,
            results: [],
            error: {
              code: "thread_not_found" as const,
              clientThreadId: batch.clientThreadId,
              message: `Thread not found for clientThreadId: ${batch.clientThreadId}`,
            },
          };
        }

        let returnedThread = thread;
        const results: AppendThreadEventsItemResult[] = [];
        for (let index = 0; index < batch.events.length; index += 1) {
          const eventInput = batch.events[index];
          let normalized: NormalizedThreadEventAppendInput;
          try {
            normalized = decodeThreadEventAppendInput(eventInput);
          } catch (error) {
            results.push({
              ok: false,
              inputIndex: index,
              error: {
                code: "validation_failed",
                message: error instanceof Error ? error.message : String(error),
              },
            });
            break;
          }

          const appendedEither = yield* appendDecodedEvent(
            sql,
            returnedThread,
            normalized,
            { idGenerator, now },
          ).pipe(Effect.either);
          if (appendedEither._tag === "Left") {
            const error = toThreadEventStoreError(appendedEither.left);
            results.push({
              ok: false,
              inputIndex: index,
              error: {
                code: "append_failed",
                message: error.message,
              },
            });
            break;
          }

          const appended = appendedEither.right;
          if (!appended.duplicate) {
            returnedThread = {
              ...returnedThread,
              updatedAt: appended.event.recordedAt,
            };
          }
          results.push({
            ok: true,
            inputIndex: index,
            ...appended,
          });
        }

        return {
          ok: results.every((result) => result.ok),
          thread: returnedThread,
          results,
        };
      }),
    );
  }

  async append(clientThreadId: string, inputValue: ThreadEventAppendInput | unknown): Promise<AppendThreadEventResult> {
    const result = await this.appendMany(clientThreadId, [inputValue]);
    if (!result.ok) {
      const failure = result.results.find((item): item is AppendThreadEventsFailure => !item.ok);
      throw new ThreadEventStoreError(failure?.error.message ?? result.error?.message ?? "Thread event append failed.");
    }

    const first = result.results[0];
    if (!first?.ok) {
      throw new ThreadEventStoreError("Thread event append produced no result.");
    }

    return {
      event: first.event,
      duplicate: first.duplicate,
      messages: first.messages,
      blocks: first.blocks,
    };
  }

  async list(): Promise<PersistedThreadEvent[]> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<ThreadEventSqlRow>`
          SELECT *
          FROM thread_events
          ORDER BY thread_id ASC, event_order ASC
        `;

        return rows.map(rowToPersistedEvent);
      }),
    );
  }

  async listThreads(): Promise<ProjectedThread[]> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<ThreadSqlRow>`
          SELECT *
          FROM threads
          ORDER BY created_at ASC, thread_id ASC
        `;
        return rows.map(rowToThread);
      }),
    );
  }

  async readThread(clientThreadId: string): Promise<ProjectedThreadRead | undefined> {
    const thread = await this.findThread(clientThreadId);
    if (!thread) {
      return undefined;
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        const messageRows = yield* sql<MessageSqlRow>`
          SELECT *
          FROM messages
          WHERE thread_id = ${thread.threadId}
          ORDER BY message_order ASC
        `;
        const blockRows = yield* sql<MessageBlockSqlRow>`
          SELECT *
          FROM message_blocks
          WHERE thread_id = ${thread.threadId}
          ORDER BY message_id ASC, block_order ASC
        `;

        const blocksByMessage = new Map<string, ProjectedMessageBlock[]>();
        for (const block of blockRows.map(rowToMessageBlock)) {
          const existing = blocksByMessage.get(block.messageId) ?? [];
          existing.push(block);
          blocksByMessage.set(block.messageId, existing);
        }

        return {
          thread,
          messages: messageRows.map((row) => {
            const message = rowToMessage(row);
            return {
              ...message,
              blocks: blocksByMessage.get(message.messageId) ?? [],
            };
          }),
        };
      }),
    );
  }

  private async findThread(clientThreadId: string): Promise<ProjectedThread | undefined> {
    if (!clientThreadId) {
      throw new ThreadEventStoreError("clientThreadId must be non-empty.");
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        return yield* findThreadByClientThreadId(sql, clientThreadId);
      }),
    );
  }

  private runSql<A>(
    program: Effect.Effect<A, unknown, SqlClient.SqlClient>,
  ): Promise<A> {
    mkdirSync(dirname(this.eventDbPath), { recursive: true });

    return Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        yield* setupThreadEventsSchema(sql);
        return yield* program;
      }).pipe(
        Effect.provide(
          SqliteClient.layer({
            filename: this.eventDbPath,
          }),
        ),
        Effect.mapError(toThreadEventStoreError),
      ),
    );
  }
}

export class ThreadEventStoreError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message, causeValue === undefined ? undefined : { cause: causeValue });
    this.name = "ThreadEventStoreError";
  }
}

function toThreadEventStoreError(error: unknown): ThreadEventStoreError {
  return error instanceof ThreadEventStoreError
    ? error
    : new ThreadEventStoreError("Thread event SQLite operation failed.", error);
}

export async function createThread(
  eventDbPath: string,
  input?: ThreadCreateInput | unknown,
): Promise<CreateThreadResult> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return await store.createThread(input);
  } finally {
    store.close();
  }
}

export async function appendThreadEvents(
  eventDbPath: string,
  input: AppendThreadEventsInput | unknown,
): Promise<AppendThreadEventsResult>;
export async function appendThreadEvents(
  eventDbPath: string,
  clientThreadId: string,
  events: readonly unknown[],
): Promise<AppendThreadEventsResult>;
export async function appendThreadEvents(
  eventDbPath: string,
  inputOrClientThreadId: AppendThreadEventsInput | string | unknown,
  maybeEvents?: readonly unknown[],
): Promise<AppendThreadEventsResult> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return typeof inputOrClientThreadId === "string"
      ? await store.appendMany(inputOrClientThreadId, maybeEvents ?? [])
      : await store.appendMany(inputOrClientThreadId);
  } finally {
    store.close();
  }
}

export async function appendThreadEvent(
  eventDbPath: string,
  clientThreadId: string,
  input: ThreadEventAppendInput | unknown,
): Promise<AppendThreadEventResult> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return await store.append(clientThreadId, input);
  } finally {
    store.close();
  }
}

export async function listThreadEvents(eventDbPath: string): Promise<PersistedThreadEvent[]> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return await store.list();
  } finally {
    store.close();
  }
}

export async function listThreads(eventDbPath: string): Promise<ProjectedThread[]> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return await store.listThreads();
  } finally {
    store.close();
  }
}

export async function readThread(eventDbPath: string, clientThreadId: string): Promise<ProjectedThreadRead | undefined> {
  const store = new ThreadEventStore({ eventDbPath });
  try {
    return await store.readThread(clientThreadId);
  } finally {
    store.close();
  }
}

function setupThreadEventsSchema(sql: SqlClient.SqlClient): Effect.Effect<void, SqlError.SqlError | ThreadEventStoreError> {
  return Effect.gen(function*() {
    yield* sql.unsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    yield* sql.unsafe("PRAGMA foreign_keys = ON");
    yield* Effect.gen(function*() {
      yield* assertCompatibleThreadEventsSchema(sql);
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS threads (
          thread_id TEXT PRIMARY KEY,
          client_thread_id TEXT NOT NULL UNIQUE,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `);
      yield* sql.unsafe(`
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
        ) STRICT
      `);
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS messages (
          message_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          message_order INTEGER NOT NULL,
          message_kind TEXT NOT NULL,
          actor_json TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          source_thread_event_id TEXT NOT NULL,
          source_event_order INTEGER NOT NULL,
          UNIQUE(thread_id, message_order)
        ) STRICT
      `);
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS message_blocks (
          block_id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          block_order INTEGER NOT NULL,
          block_kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          source_thread_event_id TEXT NOT NULL,
          UNIQUE(message_id, block_order)
        ) STRICT
      `);
      yield* sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_messages_thread_order
        ON messages(thread_id, message_order)
      `);
      yield* sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_message_blocks_thread_message_order
        ON message_blocks(thread_id, message_id, block_order)
      `);
    }).pipe(sql.withTransaction);
  });
}

function assertCompatibleThreadEventsSchema(
  sql: SqlClient.SqlClient,
): Effect.Effect<void, SqlError.SqlError | ThreadEventStoreError> {
  return Effect.gen(function*() {
    const tableNames = Object.keys(EXPECTED_TABLE_SCHEMAS);
    const rows = yield* sql<SqliteMasterObjectRow>`
      SELECT name, type
      FROM sqlite_master
      WHERE name IN ${sql.in(tableNames)}
    `;

    for (const row of rows) {
      const expectedSchema = EXPECTED_TABLE_SCHEMAS[row.name];
      if (!expectedSchema) {
        continue;
      }

      if (row.type !== "table") {
        return yield* Effect.fail(incompatibleSchemaError(row.name));
      }

      const tableInfo = yield* sql.unsafe<SqliteTableInfoRow>(`PRAGMA table_info(${row.name})`);
      if (!hasExpectedColumns(tableInfo, expectedSchema.columns)) {
        return yield* Effect.fail(incompatibleSchemaError(row.name));
      }

      const uniqueColumnSets = yield* loadUniqueColumnSets(sql, row.name);
      for (const expectedUniqueColumns of expectedSchema.uniqueColumnSets) {
        if (!hasColumnSet(uniqueColumnSets, expectedUniqueColumns)) {
          return yield* Effect.fail(incompatibleSchemaError(row.name));
        }
      }
    }
  });
}

function hasExpectedColumns(
  actualColumns: readonly SqliteTableInfoRow[],
  expectedColumns: Readonly<Record<string, ExpectedColumnSchema>>,
): boolean {
  const expectedEntries = Object.entries(expectedColumns);
  if (actualColumns.length !== expectedEntries.length) {
    return false;
  }

  const actualByName = new Map(actualColumns.map((column) => [column.name, column]));
  return expectedEntries.every(([name, expected]) => {
    const actual = actualByName.get(name);
    return actual !== undefined &&
      actual.type.toUpperCase() === expected.type &&
      Boolean(actual.notnull) === expected.notnull &&
      Boolean(actual.pk) === expected.pk;
  });
}

function loadUniqueColumnSets(
  sql: SqlClient.SqlClient,
  tableName: string,
): Effect.Effect<readonly (readonly string[])[], SqlError.SqlError> {
  return Effect.gen(function*() {
    const indexes = yield* sql.unsafe<SqliteIndexListRow>(`PRAGMA index_list(${tableName})`);
    const uniqueColumnSets: string[][] = [];
    for (const index of indexes) {
      if (!index.unique || index.partial) {
        continue;
      }

      const indexedColumns = yield* sql.unsafe<SqliteIndexInfoRow>(`PRAGMA index_info(${index.name})`);
      uniqueColumnSets.push(
        [...indexedColumns]
          .sort((left, right) => left.seqno - right.seqno)
          .flatMap((column) => column.name ? [column.name] : []),
      );
    }

    return uniqueColumnSets;
  });
}

function hasColumnSet(
  actualColumnSets: readonly (readonly string[])[],
  expectedColumnSet: readonly string[],
): boolean {
  return actualColumnSets.some((actualColumnSet) =>
    actualColumnSet.length === expectedColumnSet.length &&
    actualColumnSet.every((column, index) => column === expectedColumnSet[index])
  );
}

function incompatibleSchemaError(tableName: string): ThreadEventStoreError {
  return new ThreadEventStoreError(
    `Refusing to use incompatible thread-events database schema at table '${tableName}'. ` +
      "Use a dedicated source-event/projection database, not a legacy steward thread.sqlite.",
  );
}

function normalizeAppendManyArgs(
  inputOrClientThreadId: AppendThreadEventsInput | string | unknown,
  maybeEvents?: readonly unknown[],
): { clientThreadId: string; events: readonly unknown[] } {
  if (typeof inputOrClientThreadId === "string") {
    assertNonEmptyClientThreadId(inputOrClientThreadId);
    if (!Array.isArray(maybeEvents)) {
      throw new ThreadEventStoreError("appendMany requires an events array.");
    }
    return { clientThreadId: inputOrClientThreadId, events: maybeEvents };
  }

  if (isObject(inputOrClientThreadId) && typeof inputOrClientThreadId.clientThreadId === "string") {
    assertNonEmptyClientThreadId(inputOrClientThreadId.clientThreadId);
    const events = inputOrClientThreadId.events;
    if (!Array.isArray(events)) {
      throw new ThreadEventStoreError("appendMany requires an events array.");
    }
    return { clientThreadId: inputOrClientThreadId.clientThreadId, events };
  }

  throw new ThreadEventStoreError("appendMany requires clientThreadId and events.");
}

function assertNonEmptyClientThreadId(clientThreadId: string): void {
  if (clientThreadId.length === 0) {
    throw new ThreadEventStoreError("clientThreadId must be non-empty.");
  }
}

function makeDefaultCreateHarness(clientThreadId: string, threadId: string): HarnessRef {
  return clientThreadId === threadId
    ? DEFAULT_CREATE_HARNESS
    : { runtime: "lh_context", externalThreadId: clientThreadId };
}

function makeThreadCreatedEvent(input: {
  threadId: string;
  clientThreadId: string;
  title?: string;
  threadEventId: string;
  recordedAt: string;
  occurredAt?: string;
  harness: HarnessRef;
}): PersistedThreadEvent {
  return decodePersistedThreadEvent({
    schemaVersion: THREAD_EVENT_SCHEMA_VERSION,
    threadEventId: input.threadEventId,
    threadId: input.threadId,
    eventOrder: 1,
    idempotencyKey: `thread_created:${input.clientThreadId}`,
    eventKind: "thread_created",
    actor: THREAD_CREATED_ACTOR,
    harness: input.harness,
    recordedAt: input.recordedAt,
    occurredAt: input.occurredAt,
    payload: {
      _tag: "thread_created",
      clientThreadId: input.clientThreadId,
      title: input.title,
    },
  });
}

function makePersistedEventDraft(
  input: NormalizedThreadEventAppendInput,
  threadId: string,
  threadEventId: string,
  recordedAt: string,
): Omit<PersistedThreadEvent, "eventOrder"> {
  return decodePersistedThreadEvent({
    schemaVersion: THREAD_EVENT_SCHEMA_VERSION,
    threadEventId,
    threadId,
    eventOrder: 1,
    idempotencyKey: input.idempotencyKey,
    eventKind: input.eventKind,
    actor: input.actor,
    harness: input.harness,
    origin: input.origin,
    recordedAt,
    occurredAt: input.occurredAt,
    payload: input.payload,
  });
}

function appendDecodedEvent(
  sql: SqlClient.SqlClient,
  thread: ProjectedThread,
  input: NormalizedThreadEventAppendInput,
  dependencies: {
    idGenerator: () => string;
    now: () => Date;
  },
): Effect.Effect<AppendThreadEventResult, SqlError.SqlError | ThreadEventStoreError> {
  return Effect.gen(function*() {
    const duplicate = yield* findByIdempotencyKey(sql, thread.threadId, input.idempotencyKey);
    if (duplicate) {
      const projections = yield* findProjectionsForEvent(sql, duplicate.threadEventId);
      return {
        event: duplicate,
        duplicate: true,
        ...projections,
      };
    }

    const eventDraft = makePersistedEventDraft(
      input,
      thread.threadId,
      dependencies.idGenerator(),
      dependencies.now().toISOString(),
    );
    const insertedRows = yield* insertEvent(sql, eventDraft);
    const insertedRow = insertedRows[0];
    if (insertedRow) {
      const event = rowToPersistedEvent(insertedRow);
      const projections = yield* projectEvent(sql, event);
      yield* updateThreadUpdatedAt(sql, thread.threadId, event.recordedAt);
      return {
        event,
        duplicate: false,
        ...projections,
      };
    }

    const concurrentDuplicate = yield* findByIdempotencyKey(sql, thread.threadId, input.idempotencyKey);
    if (concurrentDuplicate) {
      const projections = yield* findProjectionsForEvent(sql, concurrentDuplicate.threadEventId);
      return {
        event: concurrentDuplicate,
        duplicate: true,
        ...projections,
      };
    }

    return yield* Effect.fail(
      new ThreadEventStoreError("Thread event append neither inserted nor found an existing duplicate event."),
    );
  }).pipe(sql.withTransaction);
}

function insertThread(
  sql: SqlClient.SqlClient,
  thread: ProjectedThread,
): Effect.Effect<ReadonlyArray<ThreadSqlRow>, SqlError.SqlError> {
  return sql<ThreadSqlRow>`
    INSERT INTO threads (
      thread_id,
      client_thread_id,
      title,
      created_at,
      updated_at
    )
    VALUES (
      ${thread.threadId},
      ${thread.clientThreadId},
      ${thread.title ?? null},
      ${thread.createdAt},
      ${thread.updatedAt}
    )
    ON CONFLICT(client_thread_id) DO NOTHING
    RETURNING *
  `;
}

function insertCreatedEvent(
  sql: SqlClient.SqlClient,
  event: PersistedThreadEvent,
): Effect.Effect<ReadonlyArray<ThreadEventSqlRow>, SqlError.SqlError> {
  return sql<ThreadEventSqlRow>`
    INSERT INTO thread_events (
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
    )
    VALUES (
      ${event.threadEventId},
      ${event.threadId},
      ${event.eventOrder},
      ${event.schemaVersion},
      ${event.eventKind},
      ${event.idempotencyKey},
      ${JSON.stringify(event.actor)},
      ${JSON.stringify(event.harness)},
      ${event.origin ? JSON.stringify(event.origin) : null},
      ${event.recordedAt},
      ${event.occurredAt ?? null},
      ${JSON.stringify(event.payload)}
    )
    RETURNING *
  `;
}

function insertEvent(
  sql: SqlClient.SqlClient,
  event: Omit<PersistedThreadEvent, "eventOrder">,
): Effect.Effect<ReadonlyArray<ThreadEventSqlRow>, SqlError.SqlError> {
  return sql<ThreadEventSqlRow>`
    INSERT INTO thread_events (
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
    )
    SELECT
      ${event.threadEventId},
      ${event.threadId},
      COALESCE(MAX(event_order), 0) + 1,
      ${event.schemaVersion},
      ${event.eventKind},
      ${event.idempotencyKey},
      ${JSON.stringify(event.actor)},
      ${JSON.stringify(event.harness)},
      ${event.origin ? JSON.stringify(event.origin) : null},
      ${event.recordedAt},
      ${event.occurredAt ?? null},
      ${JSON.stringify(event.payload)}
    FROM thread_events
    WHERE thread_id = ${event.threadId}
    ON CONFLICT(thread_id, idempotency_key) DO NOTHING
    RETURNING *
  `;
}

function findThreadByClientThreadId(
  sql: SqlClient.SqlClient,
  clientThreadId: string,
): Effect.Effect<ProjectedThread | undefined, SqlError.SqlError> {
  return Effect.map(
    sql<ThreadSqlRow>`
      SELECT *
      FROM threads
      WHERE client_thread_id = ${clientThreadId}
    `,
    (rows) => {
      const row = rows[0];
      return row ? rowToThread(row) : undefined;
    },
  );
}

function findByIdempotencyKey(
  sql: SqlClient.SqlClient,
  threadId: string,
  idempotencyKey: string,
): Effect.Effect<PersistedThreadEvent | undefined, SqlError.SqlError> {
  return Effect.map(
    sql<ThreadEventSqlRow>`
      SELECT *
      FROM thread_events
      WHERE thread_id = ${threadId} AND idempotency_key = ${idempotencyKey}
    `,
    (rows) => {
      const row = rows[0];
      return row ? rowToPersistedEvent(row) : undefined;
    },
  );
}

function projectEvent(
  sql: SqlClient.SqlClient,
  event: PersistedThreadEvent,
): Effect.Effect<{ messages: ProjectedMessage[]; blocks: ProjectedMessageBlock[] }, SqlError.SqlError> {
  return Effect.gen(function*() {
    const drafts = projectionDraftsForEvent(event);
    if (drafts.length === 0) {
      return { messages: [], blocks: [] };
    }

    const nextOrderRows = yield* sql<{ max_message_order: number | null }>`
      SELECT MAX(message_order) AS max_message_order
      FROM messages
      WHERE thread_id = ${event.threadId}
    `;
    const firstMessageOrder = (nextOrderRows[0]?.max_message_order ?? 0) + 1;
    const messages: ProjectedMessage[] = [];
    const blocks: ProjectedMessageBlock[] = [];

    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index]!;
      const messageOrder = firstMessageOrder + index;
      const messageId = projectedMessageId(event.threadId, messageOrder);
      const messageRows = yield* insertMessage(sql, {
        messageId,
        threadId: event.threadId,
        messageOrder,
        messageKind: draft.messageKind,
        actor: draft.actor,
        status: draft.status,
        createdAt: draft.createdAt,
        sourceThreadEventId: event.threadEventId,
        sourceEventOrder: event.eventOrder,
      });
      const messageRow = messageRows[0];
      if (!messageRow) {
        continue;
      }

      const message = rowToMessage(messageRow);
      messages.push(message);

      for (let blockIndex = 0; blockIndex < draft.blocks.length; blockIndex += 1) {
        const blockDraft = draft.blocks[blockIndex]!;
        const blockOrder = blockIndex + 1;
        const blockRows = yield* insertMessageBlock(sql, {
          blockId: projectedBlockId(messageId, blockOrder),
          messageId,
          threadId: event.threadId,
          blockOrder,
          blockKind: blockDraft.blockKind,
          payload: blockDraft.payload,
          sourceThreadEventId: event.threadEventId,
        });
        const blockRow = blockRows[0];
        if (blockRow) {
          blocks.push(rowToMessageBlock(blockRow));
        }
      }
    }

    return { messages, blocks };
  });
}

function projectionDraftsForEvent(event: PersistedThreadEvent): MessageProjectionDraft[] {
  switch (event.payload._tag) {
    case "thread_created":
      return [];
    case "user_prompt":
      return [{
        messageKind: "user",
        actor: event.actor,
        status: "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{ blockKind: "text", payload: { text: event.payload.text } }],
      }];
    case "assistant_text":
      return [{
        messageKind: "assistant",
        actor: event.actor,
        status: "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{ blockKind: "text", payload: { text: event.payload.text } }],
      }];
    case "assistant_thinking":
      return [{
        messageKind: "assistant",
        actor: event.actor,
        status: "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{ blockKind: "thinking", payload: omitTag(event.payload) }],
      }];
    case "tool_call":
      return [{
        messageKind: "assistant",
        actor: event.actor,
        status: "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{ blockKind: "tool_call", payload: omitTag(event.payload) }],
      }];
    case "tool_result":
      return [{
        messageKind: "tool_result",
        actor: event.actor,
        status: event.payload.isError ? "error" : "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{ blockKind: "tool_result", payload: omitTag(event.payload) }],
      }];
    case "runtime_note":
      return [{
        messageKind: "system",
        actor: event.actor,
        status: "complete",
        createdAt: event.occurredAt ?? event.recordedAt,
        blocks: [{
          blockKind: "text",
          payload: {
            text: event.payload.text,
            systemKind: event.payload.systemKind ?? "lifecycle",
          },
        }],
      }];
  }
}

function insertMessage(
  sql: SqlClient.SqlClient,
  message: Omit<ProjectedMessage, "actor"> & { actor: ActorRef },
): Effect.Effect<ReadonlyArray<MessageSqlRow>, SqlError.SqlError> {
  return sql<MessageSqlRow>`
    INSERT INTO messages (
      message_id,
      thread_id,
      message_order,
      message_kind,
      actor_json,
      status,
      created_at,
      source_thread_event_id,
      source_event_order
    )
    VALUES (
      ${message.messageId},
      ${message.threadId},
      ${message.messageOrder},
      ${message.messageKind},
      ${JSON.stringify(message.actor)},
      ${message.status},
      ${message.createdAt},
      ${message.sourceThreadEventId},
      ${message.sourceEventOrder}
    )
    RETURNING *
  `;
}

function insertMessageBlock(
  sql: SqlClient.SqlClient,
  block: Omit<ProjectedMessageBlock, "payload"> & { payload: JsonObject },
): Effect.Effect<ReadonlyArray<MessageBlockSqlRow>, SqlError.SqlError> {
  return sql<MessageBlockSqlRow>`
    INSERT INTO message_blocks (
      block_id,
      message_id,
      thread_id,
      block_order,
      block_kind,
      payload_json,
      source_thread_event_id
    )
    VALUES (
      ${block.blockId},
      ${block.messageId},
      ${block.threadId},
      ${block.blockOrder},
      ${block.blockKind},
      ${JSON.stringify(block.payload)},
      ${block.sourceThreadEventId}
    )
    RETURNING *
  `;
}

function updateThreadUpdatedAt(
  sql: SqlClient.SqlClient,
  threadId: string,
  updatedAt: string,
): Effect.Effect<ReadonlyArray<never>, SqlError.SqlError> {
  return sql`
    UPDATE threads
    SET updated_at = ${updatedAt}
    WHERE thread_id = ${threadId}
  `;
}

function findProjectionsForEvent(
  sql: SqlClient.SqlClient,
  threadEventId: string,
): Effect.Effect<{ messages: ProjectedMessage[]; blocks: ProjectedMessageBlock[] }, SqlError.SqlError> {
  return Effect.gen(function*() {
    const messageRows = yield* sql<MessageSqlRow>`
      SELECT *
      FROM messages
      WHERE source_thread_event_id = ${threadEventId}
      ORDER BY message_order ASC
    `;
    const blockRows = yield* sql<MessageBlockSqlRow>`
      SELECT *
      FROM message_blocks
      WHERE source_thread_event_id = ${threadEventId}
      ORDER BY message_id ASC, block_order ASC
    `;

    return {
      messages: messageRows.map(rowToMessage),
      blocks: blockRows.map(rowToMessageBlock),
    };
  });
}

function rowToThread(row: ThreadSqlRow): ProjectedThread {
  return {
    threadId: row.thread_id,
    clientThreadId: row.client_thread_id,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function rowToMessage(row: MessageSqlRow): ProjectedMessage {
  return {
    messageId: row.message_id,
    threadId: row.thread_id,
    messageOrder: row.message_order,
    messageKind: row.message_kind,
    actor: parseJson(row.actor_json) as ActorRef,
    status: row.status,
    createdAt: row.created_at,
    sourceThreadEventId: row.source_thread_event_id,
    sourceEventOrder: row.source_event_order,
  };
}

function rowToMessageBlock(row: MessageBlockSqlRow): ProjectedMessageBlock {
  return {
    blockId: row.block_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    blockOrder: row.block_order,
    blockKind: row.block_kind,
    payload: parseJson(row.payload_json) as JsonObject,
    sourceThreadEventId: row.source_thread_event_id,
  };
}

function projectedMessageId(threadId: string, messageOrder: number): string {
  return `msg_${toIdSegment(threadId)}_${messageOrder}`;
}

function projectedBlockId(messageId: string, blockOrder: number): string {
  return `blk_${toIdSegment(messageId)}_${blockOrder}`;
}

function toIdSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function omitTag(payload: ThreadEventPayload): JsonObject {
  const { _tag: _unused, ...rest } = payload;
  return rest;
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
