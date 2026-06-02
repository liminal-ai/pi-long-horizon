import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  worker?: TurnEndWorkerDependencies;
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
  trigger?: TurnProcessingTrigger;
  triggered?: boolean;
  reason?: "no_open_turn_span";
}

export interface AppendThreadEventsSuccess extends AppendThreadEventResult {
  ok: true;
  inputIndex: number;
}

export interface AppendThreadEventsSkipped {
  ok: true;
  inputIndex: number;
  skipped: true;
  reason: "ignored_after_turn_end";
}

export interface AppendThreadEventsFailure {
  ok: false;
  inputIndex: number;
  error: {
    code: "validation_failed" | "append_failed";
    message: string;
  };
}

export type AppendThreadEventsItemResult =
  | AppendThreadEventsSuccess
  | AppendThreadEventsSkipped
  | AppendThreadEventsFailure;

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

export type TurnProcessingTriggerStatus = "pending" | "claimed" | "complete" | "failed";
export type TurnLifecycleStatus = "closed";
export type TurnProcessingStatus = "ready" | "non_ready" | "failed";
export type ChunkLifecycleStatus = "open" | "closed";

export interface TurnProcessingTrigger {
  triggerId: string;
  threadId: string;
  turnEndEventOrder: number;
  status: TurnProcessingTriggerStatus;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  completedAt?: string;
  attemptCount: number;
  lastError?: string;
}

export interface CanonicalTurn {
  turnId: string;
  threadId: string;
  turnOrder: number;
  lifecycleStatus: TurnLifecycleStatus;
  processingStatus: TurnProcessingStatus;
  initiatingMessageId: string;
  messageIds: string[];
  fromMessageOrder: number;
  toMessageOrder: number;
  fromEventOrder: number;
  turnEndEventOrder: number;
  openedAt: string;
  closedAt: string;
  sourceRevision: number;
  rawTokenCountMetadata?: JsonObject;
  smooth?: JsonObject;
  lowerBandProjection?: JsonObject;
  repairMetadata?: JsonObject;
}

export interface CanonicalChunk {
  chunkId: string;
  threadId: string;
  chunkOrder: number;
  lifecycleStatus: ChunkLifecycleStatus;
  openedAt: string;
  closedAt?: string;
  closeReason?: "soft_threshold" | "hard_max";
  sourceRevision?: number;
  sourceTurnIds: string[];
  smoothText?: string;
  smoothTokenCountMetadata?: JsonObject;
  conversationTranscript?: JsonObject;
  lowerBand?: JsonObject;
}

export interface TurnSmoothingProvider {
  smoothUserPrompt(input: {
    threadId: string;
    turnId: string;
    text: string;
  }): Promise<{ text: string; metadata?: JsonObject }>;
}

export interface TurnLowerBandProjectionTokenCounter {
  countTurnLowerBandProjection(input: {
    threadId: string;
    turnId: string;
    text: string;
  }): Promise<{ count: number; metadata?: JsonObject }>;
}

export interface ChunkLowerBandCompressionProvider {
  compressChunk(input: {
    threadId: string;
    chunkId: string;
    band: "detailed" | "brief";
    transcript: string;
  }): Promise<{ text: string; metadata?: JsonObject }>;
}

export interface TurnEndWorkerDependencies {
  smoothingProvider?: TurnSmoothingProvider;
  lowerBandProjectionTokenCounter?: TurnLowerBandProjectionTokenCounter;
  chunkCompressionProvider?: ChunkLowerBandCompressionProvider;
  chunkSettings?: Partial<ChunkCloseSettings>;
}

export interface ChunkCloseSettings {
  targetMinSmoothTokens: number;
  targetSoftMaxSmoothTokens: number;
  hardMaxSmoothTokens: number;
}

export interface ProcessTurnEndTriggerResult {
  trigger?: TurnProcessingTrigger;
  turn?: CanonicalTurn;
  updatedChunkIds: string[];
  completed: boolean;
  retryable: boolean;
  reason?: "no_pending_trigger" | "turn_not_ready";
}

interface TriggerSqlRow {
  trigger_id: string;
  thread_id: string;
  turn_end_event_order: number;
  status: TurnProcessingTriggerStatus;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  attempt_count: number;
  last_error: string | null;
}

interface TurnSqlRow {
  turn_id: string;
  thread_id: string;
  turn_order: number;
  lifecycle_status: TurnLifecycleStatus;
  processing_status: TurnProcessingStatus;
  initiating_message_id: string;
  message_ids_json: string;
  from_message_order: number;
  to_message_order: number;
  from_event_order: number;
  turn_end_event_order: number;
  opened_at: string;
  closed_at: string;
  source_revision: number;
  raw_token_count_metadata_json: string | null;
  smooth_json: string | null;
  lower_band_projection_json: string | null;
  repair_metadata_json: string | null;
}

interface ChunkSqlRow {
  chunk_id: string;
  thread_id: string;
  chunk_order: number;
  lifecycle_status: ChunkLifecycleStatus;
  opened_at: string;
  closed_at: string | null;
  close_reason: "soft_threshold" | "hard_max" | null;
  source_revision: number | null;
  source_turn_ids_json: string;
  smooth_text: string | null;
  smooth_token_count_metadata_json: string | null;
  conversation_transcript_json: string | null;
  lower_band_json: string | null;
}

interface TurnWorkerInput {
  trigger: TurnProcessingTrigger;
  turnEndEvent: PersistedThreadEvent;
  messages: ProjectedMessageWithBlocks[];
  turnOrder: number;
}

interface ComputedTurnProjection {
  turn: CanonicalTurn;
  turnIsChunkEligible: boolean;
}

interface ComputedChunkArtifact {
  threadId: string;
  chunkId: string;
  band: "detailed" | "brief";
  record: JsonObject;
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

type SqlValue = string | number | bigint | null;
type SqlIn = { readonly _tag: "in"; readonly values: readonly SqlValue[] };

type Sql = (<A = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: readonly (SqlValue | SqlIn)[]
) => EffectValue<ReadonlyArray<A>>) & {
  unsafe: <A = Record<string, unknown>>(sqlText: string) => EffectValue<ReadonlyArray<A>>;
  in: (values: readonly SqlValue[]) => SqlIn;
  withTransaction: <A>(effect: EffectValue<A>) => EffectValue<A>;
};

class EffectValue<A> {
  constructor(private readonly evaluate: () => A) {}

  run(): A {
    return this.evaluate();
  }

  pipe<B>(fn: (effect: EffectValue<A>) => EffectValue<B>): EffectValue<B> {
    return fn(this);
  }

  [Symbol.iterator](): Generator<EffectValue<A>, A> {
    const self = this;
    function* iterator(): Generator<EffectValue<A>, A> {
      return (yield self) as A;
    }
    return iterator();
  }
}

let currentSql: Sql | undefined;
const Sql = new EffectValue<Sql>(() => {
  if (!currentSql) {
    throw new ThreadEventStoreError("Thread event SQLite client is not available.");
  }
  return currentSql;
});

const Effect = {
  gen<A>(body: () => Generator<EffectValue<any>, A, any>): EffectValue<A> {
    return new EffectValue(() => {
      const iterator = body();
      let next = iterator.next();
      while (!next.done) {
        next = iterator.next(next.value.run());
      }
      return next.value;
    });
  },
  map<A, B>(effect: EffectValue<A>, mapper: (value: A) => B): EffectValue<B> {
    return new EffectValue(() => mapper(effect.run()));
  },
  fail(error: unknown): EffectValue<never> {
    return new EffectValue(() => { throw error; });
  },
  either<A>(effect: EffectValue<A>): EffectValue<{ _tag: "Right"; right: A } | { _tag: "Left"; left: unknown }> {
    return new EffectValue(() => {
      try {
        return { _tag: "Right", right: effect.run() };
      } catch (error) {
        return { _tag: "Left", left: error };
      }
    });
  },
};

function openThreadEventsDb(filename: string): DatabaseSync {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  applyPragmas(db);
  return db;
}

function applyPragmas(db: DatabaseSync): void {
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");
}

function makeSql(db: DatabaseSync): Sql {
  const sql = (<A = Record<string, unknown>>(strings: TemplateStringsArray, ...values: readonly (SqlValue | SqlIn)[]) =>
    new EffectValue<ReadonlyArray<A>>(() => {
      const { text, params } = renderSql(strings, values);
      return db.prepare(text).all(...params) as A[];
    })) as Sql;
  sql.unsafe = <A = Record<string, unknown>>(sqlText: string) => new EffectValue<ReadonlyArray<A>>(() => {
    const trimmed = sqlText.trim();
    if (/^(CREATE|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed) && !/^PRAGMA\s+(table_info|index_list|index_info)\b/i.test(trimmed)) {
      db.exec(sqlText);
      return [];
    }
    return db.prepare(sqlText).all() as A[];
  });
  sql.in = (values: readonly SqlValue[]) => ({ _tag: "in", values });
  sql.withTransaction = <A>(effect: EffectValue<A>) => new EffectValue(() => withTransaction(db, () => effect.run()));
  return sql;
}

function renderSql(strings: TemplateStringsArray, values: readonly (SqlValue | SqlIn)[]): { text: string; params: SqlValue[] } {
  let text = strings[0] ?? "";
  const params: SqlValue[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (isSqlIn(value)) {
      text += `(${value.values.map(() => "?").join(", ") || "NULL"})`;
      params.push(...value.values);
    } else {
      text += "?";
      params.push(value);
    }
    text += strings[index + 1] ?? "";
  }
  return { text, params };
}

function isSqlIn(value: SqlValue | SqlIn): value is SqlIn {
  return typeof value === "object" && value !== null && "_tag" in value && value._tag === "in";
}

function withTransaction<A>(db: DatabaseSync, body: () => A): A {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const DEFAULT_CHUNK_CLOSE_SETTINGS: ChunkCloseSettings = {
  targetMinSmoothTokens: 1_200,
  targetSoftMaxSmoothTokens: 1_800,
  hardMaxSmoothTokens: 2_200,
};

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
  turn_processing_triggers: {
    columns: {
      trigger_id: { type: "TEXT", notnull: true, pk: true },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      turn_end_event_order: { type: "INTEGER", notnull: true, pk: false },
      status: { type: "TEXT", notnull: true, pk: false },
      created_at: { type: "TEXT", notnull: true, pk: false },
      updated_at: { type: "TEXT", notnull: true, pk: false },
      claimed_at: { type: "TEXT", notnull: false, pk: false },
      completed_at: { type: "TEXT", notnull: false, pk: false },
      attempt_count: { type: "INTEGER", notnull: true, pk: false },
      last_error: { type: "TEXT", notnull: false, pk: false },
    },
    uniqueColumnSets: [["thread_id", "turn_end_event_order"]],
  },
  turns: {
    columns: {
      turn_id: { type: "TEXT", notnull: true, pk: true },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      turn_order: { type: "INTEGER", notnull: true, pk: false },
      lifecycle_status: { type: "TEXT", notnull: true, pk: false },
      processing_status: { type: "TEXT", notnull: true, pk: false },
      initiating_message_id: { type: "TEXT", notnull: true, pk: false },
      message_ids_json: { type: "TEXT", notnull: true, pk: false },
      from_message_order: { type: "INTEGER", notnull: true, pk: false },
      to_message_order: { type: "INTEGER", notnull: true, pk: false },
      from_event_order: { type: "INTEGER", notnull: true, pk: false },
      turn_end_event_order: { type: "INTEGER", notnull: true, pk: false },
      opened_at: { type: "TEXT", notnull: true, pk: false },
      closed_at: { type: "TEXT", notnull: true, pk: false },
      source_revision: { type: "INTEGER", notnull: true, pk: false },
      raw_token_count_metadata_json: { type: "TEXT", notnull: false, pk: false },
      smooth_json: { type: "TEXT", notnull: false, pk: false },
      lower_band_projection_json: { type: "TEXT", notnull: false, pk: false },
      repair_metadata_json: { type: "TEXT", notnull: false, pk: false },
    },
    uniqueColumnSets: [["thread_id", "turn_order"], ["thread_id", "turn_end_event_order"]],
  },
  chunks: {
    columns: {
      chunk_id: { type: "TEXT", notnull: true, pk: true },
      thread_id: { type: "TEXT", notnull: true, pk: false },
      chunk_order: { type: "INTEGER", notnull: true, pk: false },
      lifecycle_status: { type: "TEXT", notnull: true, pk: false },
      opened_at: { type: "TEXT", notnull: true, pk: false },
      closed_at: { type: "TEXT", notnull: false, pk: false },
      close_reason: { type: "TEXT", notnull: false, pk: false },
      source_revision: { type: "INTEGER", notnull: false, pk: false },
      source_turn_ids_json: { type: "TEXT", notnull: true, pk: false },
      smooth_text: { type: "TEXT", notnull: false, pk: false },
      smooth_token_count_metadata_json: { type: "TEXT", notnull: false, pk: false },
      conversation_transcript_json: { type: "TEXT", notnull: false, pk: false },
      lower_band_json: { type: "TEXT", notnull: false, pk: false },
    },
    uniqueColumnSets: [["thread_id", "chunk_order"]],
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
  private readonly worker: TurnEndWorkerDependencies;

  constructor(options: ThreadEventStoreOptions) {
    const eventDbPath = options.eventDbPath ?? options.threadDbPath;
    if (!eventDbPath) {
      throw new ThreadEventStoreError("ThreadEventStore requires eventDbPath.");
    }

    this.eventDbPath = resolve(eventDbPath);
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.worker = options.worker ?? {};
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
        const sql = yield* Sql;

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
        const sql = yield* Sql;
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
        let skipUntilUserPrompt = false;
        for (let index = 0; index < batch.events.length; index += 1) {
          const eventInput = batch.events[index];
          if (skipUntilUserPrompt && !isUserPromptAppendInput(eventInput)) {
            results.push({
              ok: true,
              inputIndex: index,
              skipped: true,
              reason: "ignored_after_turn_end",
            });
            continue;
          }

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

          if (skipUntilUserPrompt && normalized.eventKind === "user_prompt") {
            skipUntilUserPrompt = false;
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
          if (appended.event.eventKind === "turn_end" && appended.triggered !== false) {
            skipUntilUserPrompt = true;
          }
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
    if (!first?.ok || "skipped" in first) {
      throw new ThreadEventStoreError("Thread event append produced no result.");
    }

    return {
      event: first.event,
      duplicate: first.duplicate,
      messages: first.messages,
      blocks: first.blocks,
      trigger: first.trigger,
      triggered: first.triggered,
      reason: first.reason,
    };
  }

  async list(): Promise<PersistedThreadEvent[]> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
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
        const sql = yield* Sql;
        const rows = yield* sql<ThreadSqlRow>`
          SELECT *
          FROM threads
          ORDER BY created_at ASC, thread_id ASC
        `;
        return rows.map(rowToThread);
      }),
    );
  }

  async listTurnProcessingTriggers(): Promise<TurnProcessingTrigger[]> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        const rows = yield* sql<TriggerSqlRow>`
          SELECT *
          FROM turn_processing_triggers
          ORDER BY created_at ASC, trigger_id ASC
        `;
        return rows.map(rowToTrigger);
      }),
    );
  }

  async readTurns(clientThreadId: string): Promise<CanonicalTurn[]> {
    const thread = await this.findThread(clientThreadId);
    if (!thread) {
      return [];
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        const rows = yield* sql<TurnSqlRow>`
          SELECT *
          FROM turns
          WHERE thread_id = ${thread.threadId}
          ORDER BY turn_order ASC
        `;
        return rows.map(rowToTurn);
      }),
    );
  }

  async readChunks(clientThreadId: string): Promise<CanonicalChunk[]> {
    const thread = await this.findThread(clientThreadId);
    if (!thread) {
      return [];
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        const rows = yield* sql<ChunkSqlRow>`
          SELECT *
          FROM chunks
          WHERE thread_id = ${thread.threadId}
          ORDER BY chunk_order ASC
        `;
        return rows.map(rowToChunk);
      }),
    );
  }

  async processNextTurnEndTrigger(): Promise<ProcessTurnEndTriggerResult> {
    const claimed = await this.claimNextTurnEndTrigger();
    if (!claimed) {
      return {
        updatedChunkIds: [],
        completed: false,
        retryable: false,
        reason: "no_pending_trigger",
      };
    }

    return this.processClaimedTurnEndTrigger(claimed);
  }

  async processTurnEndTrigger(triggerId: string): Promise<ProcessTurnEndTriggerResult> {
    const claimed = await this.claimTurnEndTrigger(triggerId);
    if (!claimed) {
      return {
        updatedChunkIds: [],
        completed: false,
        retryable: false,
        reason: "no_pending_trigger",
      };
    }

    return this.processClaimedTurnEndTrigger(claimed);
  }

  async readThread(clientThreadId: string): Promise<ProjectedThreadRead | undefined> {
    const thread = await this.findThread(clientThreadId);
    if (!thread) {
      return undefined;
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
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

  private async claimNextTurnEndTrigger(): Promise<TurnProcessingTrigger | undefined> {
    const now = this.now;
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        const rows = yield* sql<TriggerSqlRow>`
          SELECT *
          FROM turn_processing_triggers
          WHERE status IN ('pending', 'failed')
            AND NOT EXISTS (
              SELECT 1
              FROM turn_processing_triggers claimed
              WHERE claimed.thread_id = turn_processing_triggers.thread_id
                AND claimed.status = 'claimed'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM turn_processing_triggers earlier
              WHERE earlier.thread_id = turn_processing_triggers.thread_id
                AND earlier.turn_end_event_order < turn_processing_triggers.turn_end_event_order
                AND earlier.status <> 'complete'
            )
          ORDER BY created_at ASC, trigger_id ASC
          LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
          return undefined;
        }
        return yield* claimTrigger(sql, row.trigger_id, now().toISOString());
      }),
    );
  }

  private async claimTurnEndTrigger(triggerId: string): Promise<TurnProcessingTrigger | undefined> {
    const now = this.now;
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* claimTrigger(sql, triggerId, now().toISOString());
      }),
    );
  }

  private async processClaimedTurnEndTrigger(
    trigger: TurnProcessingTrigger,
  ): Promise<ProcessTurnEndTriggerResult> {
    try {
      const input = await this.readTurnWorkerInput(trigger);
      if (!input) {
        await this.markTriggerFailed(trigger.triggerId, "Turn trigger source state was not found.");
        return { trigger, updatedChunkIds: [], completed: false, retryable: true };
      }

      const computed = await computeTurnProjection(input, this.worker);
      const persisted = await this.persistComputedTurn(trigger, computed);
      if (!persisted.turnIsChunkEligible) {
        const completedTrigger = await this.completeTrigger(persisted.trigger.triggerId);
        return {
          trigger: completedTrigger ?? persisted.trigger,
          turn: persisted.turn,
          updatedChunkIds: [],
          completed: true,
          retryable: false,
          reason: "turn_not_ready",
        };
      }

      const chunkUpdate = await this.updateChunkForTurn(persisted.turn);
      const priorMissingArtifactTargets = await this.readClosedChunkArtifactTargetsForTurn(persisted.turn);
      const chunkArtifacts = await computeClosedChunkArtifacts(
        uniqueChunksById([...chunkUpdate.closedChunks, ...priorMissingArtifactTargets]),
        this.worker,
        this.now,
      );
      const finalChunks = await this.persistChunkArtifactsAndCompleteTrigger(
        persisted.trigger.triggerId,
        chunkArtifacts,
      );
      return {
        trigger: finalChunks.trigger,
        turn: persisted.turn,
        updatedChunkIds: [...new Set([...chunkUpdate.updatedChunkIds, ...finalChunks.updatedChunkIds])],
        completed: true,
        retryable: false,
      };
    } catch (error) {
      await this.markTriggerFailed(
        trigger.triggerId,
        error instanceof Error ? error.message : String(error),
      );
      return {
        trigger,
        updatedChunkIds: [],
        completed: false,
        retryable: true,
      };
    }
  }

  private async readTurnWorkerInput(trigger: TurnProcessingTrigger): Promise<TurnWorkerInput | undefined> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* readTurnWorkerInput(sql, trigger);
      }),
    );
  }

  private async persistComputedTurn(
    trigger: TurnProcessingTrigger,
    computed: ComputedTurnProjection,
  ): Promise<{ trigger: TurnProcessingTrigger; turn: CanonicalTurn; turnIsChunkEligible: boolean }> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* persistComputedTurn(sql, trigger, computed);
      }),
    );
  }

  private async updateChunkForTurn(
    turn: CanonicalTurn,
  ): Promise<{ updatedChunkIds: string[]; closedChunks: CanonicalChunk[] }> {
    const settings = { ...DEFAULT_CHUNK_CLOSE_SETTINGS, ...this.worker.chunkSettings };
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* updateChunkForEligibleTurn(sql, turn, settings);
      }),
    );
  }

  private async readClosedChunkArtifactTargetsForTurn(turn: CanonicalTurn): Promise<CanonicalChunk[]> {
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* readClosedChunkArtifactTargetsForTurn(sql, turn.threadId, turn.turnId);
      }),
    );
  }

  private async persistChunkArtifactsAndCompleteTrigger(
    triggerId: string,
    artifacts: readonly ComputedChunkArtifact[],
  ): Promise<{ trigger?: TurnProcessingTrigger; updatedChunkIds: string[] }> {
    const now = this.now;
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* Effect.gen(function*() {
          const updatedChunkIds: string[] = [];
          for (const artifact of artifacts) {
            yield* persistChunkArtifact(sql, artifact);
            updatedChunkIds.push(artifact.chunkId);
          }
          const trigger = yield* markTriggerComplete(sql, triggerId, now().toISOString());
          return { trigger, updatedChunkIds };
        }).pipe(sql.withTransaction);
      }),
    );
  }

  private async completeTrigger(triggerId: string): Promise<TurnProcessingTrigger | undefined> {
    const now = this.now;
    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* markTriggerComplete(sql, triggerId, now().toISOString());
      }),
    );
  }

  private async markTriggerFailed(triggerId: string, message: string): Promise<void> {
    const now = this.now;
    await this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        yield* markTriggerFailed(sql, triggerId, message, now().toISOString());
      }),
    );
  }

  private async findThread(clientThreadId: string): Promise<ProjectedThread | undefined> {
    if (!clientThreadId) {
      throw new ThreadEventStoreError("clientThreadId must be non-empty.");
    }

    return this.runSql(
      Effect.gen(function*() {
        const sql = yield* Sql;
        return yield* findThreadByClientThreadId(sql, clientThreadId);
      }),
    );
  }

  async runSql<A>(program: EffectValue<A>): Promise<A> {
    const db = openThreadEventsDb(this.eventDbPath);
    const previousSql = currentSql;
    try {
      const sql = makeSql(db);
      currentSql = sql;
      setupThreadEventsSchema(sql).run();
      return program.run();
    } catch (error) {
      throw toThreadEventStoreError(error);
    } finally {
      currentSql = previousSql;
      db.close();
    }
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

function setupThreadEventsSchema(sql: Sql): EffectValue<void> {
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
        CREATE TABLE IF NOT EXISTS turn_processing_triggers (
          trigger_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          turn_end_event_order INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          claimed_at TEXT,
          completed_at TEXT,
          attempt_count INTEGER NOT NULL,
          last_error TEXT,
          UNIQUE(thread_id, turn_end_event_order)
        ) STRICT
      `);
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS turns (
          turn_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          turn_order INTEGER NOT NULL,
          lifecycle_status TEXT NOT NULL,
          processing_status TEXT NOT NULL,
          initiating_message_id TEXT NOT NULL,
          message_ids_json TEXT NOT NULL,
          from_message_order INTEGER NOT NULL,
          to_message_order INTEGER NOT NULL,
          from_event_order INTEGER NOT NULL,
          turn_end_event_order INTEGER NOT NULL,
          opened_at TEXT NOT NULL,
          closed_at TEXT NOT NULL,
          source_revision INTEGER NOT NULL,
          raw_token_count_metadata_json TEXT,
          smooth_json TEXT,
          lower_band_projection_json TEXT,
          repair_metadata_json TEXT,
          UNIQUE(thread_id, turn_order),
          UNIQUE(thread_id, turn_end_event_order)
        ) STRICT
      `);
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS chunks (
          chunk_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          chunk_order INTEGER NOT NULL,
          lifecycle_status TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          close_reason TEXT,
          source_revision INTEGER,
          source_turn_ids_json TEXT NOT NULL,
          smooth_text TEXT,
          smooth_token_count_metadata_json TEXT,
          conversation_transcript_json TEXT,
          lower_band_json TEXT,
          UNIQUE(thread_id, chunk_order)
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
      yield* sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_turn_processing_triggers_status
        ON turn_processing_triggers(status, updated_at)
      `);
      yield* sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_turns_thread_order
        ON turns(thread_id, turn_order)
      `);
      yield* sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_chunks_thread_order
        ON chunks(thread_id, chunk_order)
      `);
    }).pipe(sql.withTransaction);
  });
}

function assertCompatibleThreadEventsSchema(
  sql: Sql,
): EffectValue<void> {
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
  sql: Sql,
  tableName: string,
): EffectValue<readonly (readonly string[])[]> {
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
  sql: Sql,
  thread: ProjectedThread,
  input: NormalizedThreadEventAppendInput,
  dependencies: {
    idGenerator: () => string;
    now: () => Date;
  },
): EffectValue<AppendThreadEventResult> {
  return Effect.gen(function*() {
    const duplicate = yield* findByIdempotencyKey(sql, thread.threadId, input.idempotencyKey);
    if (duplicate) {
      const projections = yield* findProjectionsForEvent(sql, duplicate.threadEventId);
      const trigger = duplicate.eventKind === "turn_end"
        ? yield* findTriggerForTurnEnd(sql, duplicate.threadId, duplicate.eventOrder)
        : undefined;
      return {
        event: duplicate,
        duplicate: true,
        trigger,
        triggered: duplicate.eventKind === "turn_end" ? trigger !== undefined : undefined,
        reason: duplicate.eventKind === "turn_end" && !trigger ? "no_open_turn_span" as const : undefined,
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
      const trigger = event.eventKind === "turn_end"
        ? yield* ensureTriggerForTurnEnd(sql, event)
        : undefined;
      yield* updateThreadUpdatedAt(sql, thread.threadId, event.recordedAt);
      return {
        event,
        duplicate: false,
        trigger,
        triggered: event.eventKind === "turn_end" ? trigger !== undefined : undefined,
        reason: event.eventKind === "turn_end" && !trigger ? "no_open_turn_span" as const : undefined,
        ...projections,
      };
    }

    const concurrentDuplicate = yield* findByIdempotencyKey(sql, thread.threadId, input.idempotencyKey);
    if (concurrentDuplicate) {
      const projections = yield* findProjectionsForEvent(sql, concurrentDuplicate.threadEventId);
      const trigger = concurrentDuplicate.eventKind === "turn_end"
        ? yield* findTriggerForTurnEnd(sql, concurrentDuplicate.threadId, concurrentDuplicate.eventOrder)
        : undefined;
      return {
        event: concurrentDuplicate,
        duplicate: true,
        trigger,
        triggered: concurrentDuplicate.eventKind === "turn_end" ? trigger !== undefined : undefined,
        reason: concurrentDuplicate.eventKind === "turn_end" && !trigger ? "no_open_turn_span" as const : undefined,
        ...projections,
      };
    }

    return yield* Effect.fail(
      new ThreadEventStoreError("Thread event append neither inserted nor found an existing duplicate event."),
    );
  }).pipe(sql.withTransaction);
}

function insertThread(
  sql: Sql,
  thread: ProjectedThread,
): EffectValue<ReadonlyArray<ThreadSqlRow>> {
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
  sql: Sql,
  event: PersistedThreadEvent,
): EffectValue<ReadonlyArray<ThreadEventSqlRow>> {
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
  sql: Sql,
  event: Omit<PersistedThreadEvent, "eventOrder">,
): EffectValue<ReadonlyArray<ThreadEventSqlRow>> {
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
  sql: Sql,
  clientThreadId: string,
): EffectValue<ProjectedThread | undefined> {
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
  sql: Sql,
  threadId: string,
  idempotencyKey: string,
): EffectValue<PersistedThreadEvent | undefined> {
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
  sql: Sql,
  event: PersistedThreadEvent,
): EffectValue<{ messages: ProjectedMessage[]; blocks: ProjectedMessageBlock[] }> {
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
    case "turn_end":
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
  sql: Sql,
  message: Omit<ProjectedMessage, "actor"> & { actor: ActorRef },
): EffectValue<ReadonlyArray<MessageSqlRow>> {
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
  sql: Sql,
  block: Omit<ProjectedMessageBlock, "payload"> & { payload: JsonObject },
): EffectValue<ReadonlyArray<MessageBlockSqlRow>> {
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
  sql: Sql,
  threadId: string,
  updatedAt: string,
): EffectValue<ReadonlyArray<never>> {
  return sql`
    UPDATE threads
    SET updated_at = ${updatedAt}
    WHERE thread_id = ${threadId}
  `;
}

function ensureTriggerForTurnEnd(
  sql: Sql,
  event: PersistedThreadEvent,
): EffectValue<TurnProcessingTrigger | undefined> {
  return Effect.gen(function*() {
    const closesOpenSpan = yield* turnEndClosesOpenSpan(sql, event.threadId, event.eventOrder);
    if (!closesOpenSpan) {
      return undefined;
    }

    const triggerId = turnProcessingTriggerId(event.threadId, event.eventOrder);
    const triggerRows = yield* sql<TriggerSqlRow>`
      INSERT INTO turn_processing_triggers (
        trigger_id,
        thread_id,
        turn_end_event_order,
        status,
        created_at,
        updated_at,
        claimed_at,
        completed_at,
        attempt_count,
        last_error
      )
      VALUES (
        ${triggerId},
        ${event.threadId},
        ${event.eventOrder},
        ${"pending"},
        ${event.recordedAt},
        ${event.recordedAt},
        ${null},
        ${null},
        ${0},
        ${null}
      )
      ON CONFLICT(thread_id, turn_end_event_order) DO NOTHING
      RETURNING *
    `;
    const inserted = triggerRows[0];
    if (inserted) {
      return rowToTrigger(inserted);
    }

    return yield* findTriggerForTurnEnd(sql, event.threadId, event.eventOrder);
  });
}

function turnEndClosesOpenSpan(
  sql: Sql,
  threadId: string,
  turnEndEventOrder: number,
): EffectValue<boolean> {
  return Effect.map(
    sql<{ event_kind: string }>`
      SELECT event_kind
      FROM thread_events
      WHERE thread_id = ${threadId}
        AND event_order < ${turnEndEventOrder}
        AND event_kind IN ('user_prompt', 'turn_end')
      ORDER BY event_order DESC
      LIMIT 1
    `,
    (rows) => rows[0]?.event_kind === "user_prompt",
  );
}

function findTriggerForTurnEnd(
  sql: Sql,
  threadId: string,
  turnEndEventOrder: number,
): EffectValue<TurnProcessingTrigger | undefined> {
  return Effect.map(
    sql<TriggerSqlRow>`
      SELECT *
      FROM turn_processing_triggers
      WHERE thread_id = ${threadId} AND turn_end_event_order = ${turnEndEventOrder}
    `,
    (rows) => rows[0] ? rowToTrigger(rows[0]) : undefined,
  );
}

function findProjectionsForEvent(
  sql: Sql,
  threadEventId: string,
): EffectValue<{ messages: ProjectedMessage[]; blocks: ProjectedMessageBlock[] }> {
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

function claimTrigger(
  sql: Sql,
  triggerId: string,
  claimedAt: string,
): EffectValue<TurnProcessingTrigger | undefined> {
  return Effect.gen(function*() {
    const rows = yield* sql<TriggerSqlRow>`
      UPDATE turn_processing_triggers
      SET
        status = 'claimed',
        claimed_at = ${claimedAt},
        updated_at = ${claimedAt},
        attempt_count = attempt_count + 1,
        last_error = NULL
      WHERE trigger_id = ${triggerId}
        AND status IN ('pending', 'failed')
        AND NOT EXISTS (
          SELECT 1
          FROM turn_processing_triggers claimed
          WHERE claimed.thread_id = turn_processing_triggers.thread_id
            AND claimed.status = 'claimed'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM turn_processing_triggers earlier
          WHERE earlier.thread_id = turn_processing_triggers.thread_id
            AND earlier.turn_end_event_order < turn_processing_triggers.turn_end_event_order
            AND earlier.status <> 'complete'
        )
      RETURNING *
    `;
    return rows[0] ? rowToTrigger(rows[0]) : undefined;
  });
}

function markTriggerFailed(
  sql: Sql,
  triggerId: string,
  message: string,
  updatedAt: string,
): EffectValue<TurnProcessingTrigger | undefined> {
  return Effect.map(
    sql<TriggerSqlRow>`
      UPDATE turn_processing_triggers
      SET
        status = 'failed',
        updated_at = ${updatedAt},
        last_error = ${message}
      WHERE trigger_id = ${triggerId}
      RETURNING *
    `,
    (rows) => rows[0] ? rowToTrigger(rows[0]) : undefined,
  );
}

function markTriggerComplete(
  sql: Sql,
  triggerId: string,
  completedAt: string,
): EffectValue<TurnProcessingTrigger | undefined> {
  return Effect.map(
    sql<TriggerSqlRow>`
      UPDATE turn_processing_triggers
      SET
        status = 'complete',
        completed_at = ${completedAt},
        updated_at = ${completedAt},
        last_error = NULL
      WHERE trigger_id = ${triggerId}
      RETURNING *
    `,
    (rows) => rows[0] ? rowToTrigger(rows[0]) : undefined,
  );
}

function readTurnWorkerInput(
  sql: Sql,
  trigger: TurnProcessingTrigger,
): EffectValue<TurnWorkerInput | undefined> {
  return Effect.gen(function*() {
    const turnEndRows = yield* sql<ThreadEventSqlRow>`
      SELECT *
      FROM thread_events
      WHERE thread_id = ${trigger.threadId}
        AND event_order = ${trigger.turnEndEventOrder}
        AND event_kind = 'turn_end'
    `;
    const turnEndRow = turnEndRows[0];
    if (!turnEndRow) {
      return undefined;
    }
    const turnEndEvent = rowToPersistedEvent(turnEndRow);
    const priorBoundaryRows = yield* sql<ThreadEventSqlRow>`
      SELECT *
      FROM thread_events
      WHERE thread_id = ${trigger.threadId}
        AND event_order < ${trigger.turnEndEventOrder}
        AND event_kind IN ('user_prompt', 'turn_end')
      ORDER BY event_order DESC
      LIMIT 1
    `;
    const priorBoundary = priorBoundaryRows[0] ? rowToPersistedEvent(priorBoundaryRows[0]) : undefined;
    if (priorBoundary?.eventKind !== "user_prompt") {
      return undefined;
    }

    const messageRows = yield* sql<MessageSqlRow>`
      SELECT *
      FROM messages
      WHERE thread_id = ${trigger.threadId}
        AND source_event_order >= ${priorBoundary.eventOrder}
        AND source_event_order < ${trigger.turnEndEventOrder}
      ORDER BY message_order ASC
    `;
    if (messageRows.length === 0) {
      return undefined;
    }

    const messageIds = messageRows.map((row) => row.message_id);
    const blockRows = yield* sql<MessageBlockSqlRow>`
      SELECT *
      FROM message_blocks
      WHERE message_id IN ${sql.in(messageIds)}
      ORDER BY message_id ASC, block_order ASC
    `;
    const blocksByMessage = new Map<string, ProjectedMessageBlock[]>();
    for (const block of blockRows.map(rowToMessageBlock)) {
      const existing = blocksByMessage.get(block.messageId) ?? [];
      existing.push(block);
      blocksByMessage.set(block.messageId, existing);
    }
    const maxTurnRows = yield* sql<{ max_turn_order: number | null }>`
      SELECT MAX(turn_order) AS max_turn_order
      FROM turns
      WHERE thread_id = ${trigger.threadId}
        AND turn_end_event_order < ${trigger.turnEndEventOrder}
    `;

    return {
      trigger,
      turnEndEvent,
      messages: messageRows.map((row) => {
        const message = rowToMessage(row);
        return { ...message, blocks: blocksByMessage.get(message.messageId) ?? [] };
      }),
      turnOrder: (maxTurnRows[0]?.max_turn_order ?? 0) + 1,
    };
  });
}

async function computeTurnProjection(
  input: TurnWorkerInput,
  dependencies: TurnEndWorkerDependencies,
): Promise<ComputedTurnProjection> {
  const userMessage = input.messages.find((message) => message.messageKind === "user");
  if (!userMessage) {
    throw new ThreadEventStoreError("Turn worker input is missing an initiating user message.");
  }

  const generatedAt = input.turnEndEvent.recordedAt;
  const components = [];
  let userPromptSmoothFailed = false;
  for (const message of input.messages) {
    for (const block of message.blocks) {
      if (block.blockKind === "thinking") {
        const text = typeof block.payload.text === "string" ? block.payload.text.trim() : "";
        components.push({
          componentId: `${message.messageId}:${block.blockId}`,
          kind: "thinking",
          status: text ? "ready" : "omitted",
          text: text || undefined,
          quality: text ? "deterministic_preserved" : "omitted_no_plaintext",
          sourceMessageIds: [message.messageId],
          sourceBlockIds: [block.blockId],
          generatedAt,
        });
        continue;
      }

      if (message.messageKind === "tool_result" || block.blockKind === "tool_call" || block.blockKind === "tool_result") {
        components.push({
          componentId: `${message.messageId}:${block.blockId}`,
          kind: "tool_exchange",
          status: "ready",
          text: stablePayloadText(block.payload),
          quality: "deterministic_rendered",
          sourceMessageIds: [message.messageId],
          sourceBlockIds: [block.blockId],
          generatedAt,
        });
        continue;
      }

      const text = blockPayloadText(block);
      if (!text) {
        continue;
      }
      const isUserPrompt = message.messageKind === "user";
      let componentText = text;
      let quality = isUserPrompt ? "deterministic_preserved" : "deterministic_preserved";
      let providerMetadata: JsonObject | undefined;
      if (isUserPrompt && dependencies.smoothingProvider) {
        try {
          const smoothed = await dependencies.smoothingProvider.smoothUserPrompt({
            threadId: input.trigger.threadId,
            turnId: projectedTurnId(input.trigger.threadId, input.turnOrder),
            text,
          });
          componentText = smoothed.text;
          quality = "model_smoothed";
          providerMetadata = smoothed.metadata;
        } catch (error) {
          userPromptSmoothFailed = true;
          providerMetadata = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      components.push({
        componentId: `${message.messageId}:${block.blockId}`,
        kind: isUserPrompt ? "user_prompt" : "assistant_message",
        status: isUserPrompt && quality !== "model_smoothed" ? "degraded" : "ready",
        text: componentText,
        quality,
        sourceMessageIds: [message.messageId],
        sourceBlockIds: [block.blockId],
        generatedAt,
        providerMetadata,
      });
    }
  }

  const smoothText = components
    .filter((component) => typeof component.text === "string" && component.text.length > 0)
    .map((component) => component.text)
    .join("\n\n");
  const smooth = {
    schemaVersion: "canonical_smooth_turn.v1",
    status: userPromptSmoothFailed ? "degraded" : "ready",
    text: smoothText,
    generatedAt,
    sourceRevision: input.turnEndEvent.eventOrder,
    components,
    tokenCountMetadata: tokenMetadata("turn_smooth_materialized", smoothText, input.turnEndEvent.eventOrder, "heuristic"),
  } as JsonObject;

  const projectionText = buildLowerBandProjectionText(input.messages);
  let lowerBandProjection: JsonObject;
  let turnIsChunkEligible = false;
  if (!projectionText) {
    lowerBandProjection = {
      status: "invalid",
      generatedAt,
      errorCode: "LOWER_BAND_PROJECTION_EMPTY",
      errorMessage: "Turn has no user/assistant text for lower-band projection.",
    };
  } else if (!dependencies.lowerBandProjectionTokenCounter) {
    lowerBandProjection = {
      status: "failed",
      text: projectionText,
      generatedAt,
      sourceRevision: input.turnEndEvent.eventOrder,
      sourceFingerprint: textHash(projectionText),
      errorCode: "LOWER_BAND_PROJECTION_TOKEN_COUNT_MISSING",
      errorMessage: "Exact token counter is required before turn can be chunked.",
    };
  } else {
    try {
      const counted = await dependencies.lowerBandProjectionTokenCounter.countTurnLowerBandProjection({
        threadId: input.trigger.threadId,
        turnId: projectedTurnId(input.trigger.threadId, input.turnOrder),
        text: projectionText,
      });
      lowerBandProjection = {
        status: "ready",
        text: projectionText,
        generatedAt,
        sourceRevision: input.turnEndEvent.eventOrder,
        sourceFingerprint: textHash(projectionText),
        tokenCountMetadata: counted.metadata ?? tokenMetadata(
          "turn_lower_band_projection_materialized",
          projectionText,
          input.turnEndEvent.eventOrder,
          "exact",
          counted.count,
        ),
      };
      turnIsChunkEligible = true;
    } catch (error) {
      lowerBandProjection = {
        status: "failed",
        text: projectionText,
        generatedAt,
        sourceRevision: input.turnEndEvent.eventOrder,
        sourceFingerprint: textHash(projectionText),
        errorCode: "LOWER_BAND_PROJECTION_TOKEN_COUNT_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const turn: CanonicalTurn = {
    turnId: projectedTurnId(input.trigger.threadId, input.turnOrder),
    threadId: input.trigger.threadId,
    turnOrder: input.turnOrder,
    lifecycleStatus: "closed",
    processingStatus: turnIsChunkEligible ? "ready" : "non_ready",
    initiatingMessageId: userMessage.messageId,
    messageIds: input.messages.map((message) => message.messageId),
    fromMessageOrder: input.messages[0]!.messageOrder,
    toMessageOrder: input.messages.at(-1)!.messageOrder,
    fromEventOrder: input.messages[0]!.sourceEventOrder,
    turnEndEventOrder: input.turnEndEvent.eventOrder,
    openedAt: userMessage.createdAt,
    closedAt: input.turnEndEvent.occurredAt ?? input.turnEndEvent.recordedAt,
    sourceRevision: input.turnEndEvent.eventOrder,
    rawTokenCountMetadata: tokenMetadata(
      "raw_turn_materialized",
      input.messages.map(renderMessageForSmooth).join("\n\n"),
      input.turnEndEvent.eventOrder,
      "heuristic",
    ),
    smooth,
    lowerBandProjection,
  };
  return { turn, turnIsChunkEligible };
}

function persistComputedTurn(
  sql: Sql,
  trigger: TurnProcessingTrigger,
  computed: ComputedTurnProjection,
): EffectValue<{ trigger: TurnProcessingTrigger; turn: CanonicalTurn; turnIsChunkEligible: boolean }> {
  return Effect.gen(function*() {
    return yield* Effect.gen(function*() {
      const latestTrigger = yield* findTriggerForTurnEnd(sql, trigger.threadId, trigger.turnEndEventOrder);
      if (!latestTrigger || latestTrigger.status === "complete") {
        return {
          trigger: latestTrigger ?? trigger,
          turn: computed.turn,
          turnIsChunkEligible: computed.turnIsChunkEligible,
        };
      }
      yield* upsertTurn(sql, computed.turn);
      const rows = yield* sql<TurnSqlRow>`
        SELECT *
        FROM turns
        WHERE turn_id = ${computed.turn.turnId}
      `;
      const turn = rows[0] ? rowToTurn(rows[0]) : computed.turn;
      return {
        trigger: latestTrigger,
        turn,
        turnIsChunkEligible: computed.turnIsChunkEligible,
      };
    }).pipe(sql.withTransaction);
  });
}

function upsertTurn(
  sql: Sql,
  turn: CanonicalTurn,
): EffectValue<ReadonlyArray<TurnSqlRow>> {
  return sql<TurnSqlRow>`
    INSERT INTO turns (
      turn_id,
      thread_id,
      turn_order,
      lifecycle_status,
      processing_status,
      initiating_message_id,
      message_ids_json,
      from_message_order,
      to_message_order,
      from_event_order,
      turn_end_event_order,
      opened_at,
      closed_at,
      source_revision,
      raw_token_count_metadata_json,
      smooth_json,
      lower_band_projection_json,
      repair_metadata_json
    )
    VALUES (
      ${turn.turnId},
      ${turn.threadId},
      ${turn.turnOrder},
      ${turn.lifecycleStatus},
      ${turn.processingStatus},
      ${turn.initiatingMessageId},
      ${JSON.stringify(turn.messageIds)},
      ${turn.fromMessageOrder},
      ${turn.toMessageOrder},
      ${turn.fromEventOrder},
      ${turn.turnEndEventOrder},
      ${turn.openedAt},
      ${turn.closedAt},
      ${turn.sourceRevision},
      ${turn.rawTokenCountMetadata ? JSON.stringify(turn.rawTokenCountMetadata) : null},
      ${turn.smooth ? JSON.stringify(turn.smooth) : null},
      ${turn.lowerBandProjection ? JSON.stringify(turn.lowerBandProjection) : null},
      ${turn.repairMetadata ? JSON.stringify(turn.repairMetadata) : null}
    )
    ON CONFLICT(thread_id, turn_end_event_order) DO UPDATE SET
      lifecycle_status = excluded.lifecycle_status,
      processing_status = excluded.processing_status,
      initiating_message_id = excluded.initiating_message_id,
      message_ids_json = excluded.message_ids_json,
      from_message_order = excluded.from_message_order,
      to_message_order = excluded.to_message_order,
      from_event_order = excluded.from_event_order,
      opened_at = excluded.opened_at,
      closed_at = excluded.closed_at,
      source_revision = excluded.source_revision,
      raw_token_count_metadata_json = excluded.raw_token_count_metadata_json,
      smooth_json = excluded.smooth_json,
      lower_band_projection_json = excluded.lower_band_projection_json,
      repair_metadata_json = excluded.repair_metadata_json
    RETURNING *
  `;
}

function updateChunkForEligibleTurn(
  sql: Sql,
  turn: CanonicalTurn,
  settings: ChunkCloseSettings,
): EffectValue<{ updatedChunkIds: string[]; closedChunks: CanonicalChunk[] }> {
  return Effect.gen(function*() {
    return yield* Effect.gen(function*() {
      const existingChunks = (yield* sql<ChunkSqlRow>`
        SELECT *
        FROM chunks
        WHERE thread_id = ${turn.threadId}
        ORDER BY chunk_order ASC
      `).map(rowToChunk);
      if (existingChunks.some((chunk) => chunk.sourceTurnIds.includes(turn.turnId))) {
        return { updatedChunkIds: [], closedChunks: [] };
      }

      const updatedChunkIds = new Set<string>();
      const closedChunks: CanonicalChunk[] = [];
      let openChunk = existingChunks.find((chunk) => chunk.lifecycleStatus === "open");
      if (!openChunk) {
        openChunk = createOpenChunk(turn.threadId, nextChunkOrder(existingChunks), turn.closedAt);
        yield* upsertChunk(sql, openChunk);
        existingChunks.push(openChunk);
        updatedChunkIds.add(openChunk.chunkId);
      }

      const openProjectionCount = chunkProjectionTokenCount(openChunk);
      const turnProjectionCount = turnLowerBandProjectionTokenCount(turn);
      if (
        openChunk.sourceTurnIds.length > 0 &&
        openProjectionCount >= settings.targetMinSmoothTokens &&
        openProjectionCount + turnProjectionCount > settings.targetSoftMaxSmoothTokens
      ) {
        openChunk = {
          ...openChunk,
          lifecycleStatus: "closed",
          closedAt: turn.closedAt,
          closeReason: "soft_threshold",
        };
        yield* upsertChunk(sql, openChunk);
        updatedChunkIds.add(openChunk.chunkId);
        closedChunks.push(openChunk);
        const newChunk = createOpenChunk(turn.threadId, nextChunkOrder(existingChunks), turn.closedAt);
        existingChunks.push(newChunk);
        yield* upsertChunk(sql, newChunk);
        updatedChunkIds.add(newChunk.chunkId);
        openChunk = newChunk;
      }

      openChunk = appendTurnToChunkState(openChunk, turn);
      if (chunkProjectionTokenCount(openChunk) >= settings.hardMaxSmoothTokens) {
        openChunk = {
          ...openChunk,
          lifecycleStatus: "closed",
          closedAt: turn.closedAt,
          closeReason: "hard_max",
        };
        closedChunks.push(openChunk);
        const newChunk = createOpenChunk(turn.threadId, nextChunkOrder(existingChunks), turn.closedAt);
        existingChunks.push(newChunk);
        yield* upsertChunk(sql, newChunk);
        updatedChunkIds.add(newChunk.chunkId);
      }
      yield* upsertChunk(sql, openChunk);
      updatedChunkIds.add(openChunk.chunkId);
      return { updatedChunkIds: [...updatedChunkIds], closedChunks };
    }).pipe(sql.withTransaction);
  });
}

function readClosedChunkArtifactTargetsForTurn(
  sql: Sql,
  threadId: string,
  turnId: string,
): EffectValue<CanonicalChunk[]> {
  return Effect.map(
    sql<ChunkSqlRow>`
      SELECT *
      FROM chunks
      WHERE thread_id = ${threadId}
        AND lifecycle_status = 'closed'
      ORDER BY chunk_order ASC
    `,
    (rows) => rows
      .map(rowToChunk)
      .filter((chunk) => chunk.sourceTurnIds.includes(turnId) && closedChunkNeedsArtifacts(chunk)),
  );
}

function upsertChunk(
  sql: Sql,
  chunk: CanonicalChunk,
): EffectValue<ReadonlyArray<ChunkSqlRow>> {
  return sql<ChunkSqlRow>`
    INSERT INTO chunks (
      chunk_id,
      thread_id,
      chunk_order,
      lifecycle_status,
      opened_at,
      closed_at,
      close_reason,
      source_revision,
      source_turn_ids_json,
      smooth_text,
      smooth_token_count_metadata_json,
      conversation_transcript_json,
      lower_band_json
    )
    VALUES (
      ${chunk.chunkId},
      ${chunk.threadId},
      ${chunk.chunkOrder},
      ${chunk.lifecycleStatus},
      ${chunk.openedAt},
      ${chunk.closedAt ?? null},
      ${chunk.closeReason ?? null},
      ${chunk.sourceRevision ?? null},
      ${JSON.stringify(chunk.sourceTurnIds)},
      ${chunk.smoothText ?? null},
      ${chunk.smoothTokenCountMetadata ? JSON.stringify(chunk.smoothTokenCountMetadata) : null},
      ${chunk.conversationTranscript ? JSON.stringify(chunk.conversationTranscript) : null},
      ${chunk.lowerBand ? JSON.stringify(chunk.lowerBand) : null}
    )
    ON CONFLICT(thread_id, chunk_order) DO UPDATE SET
      lifecycle_status = excluded.lifecycle_status,
      opened_at = excluded.opened_at,
      closed_at = excluded.closed_at,
      close_reason = excluded.close_reason,
      source_revision = excluded.source_revision,
      source_turn_ids_json = excluded.source_turn_ids_json,
      smooth_text = excluded.smooth_text,
      smooth_token_count_metadata_json = excluded.smooth_token_count_metadata_json,
      conversation_transcript_json = excluded.conversation_transcript_json,
      lower_band_json = excluded.lower_band_json
    RETURNING *
  `;
}

async function computeClosedChunkArtifacts(
  chunks: readonly CanonicalChunk[],
  dependencies: TurnEndWorkerDependencies,
  now: () => Date,
): Promise<ComputedChunkArtifact[]> {
  const artifacts: ComputedChunkArtifact[] = [];
  for (const chunk of chunks) {
    if (chunk.lifecycleStatus !== "closed" || !chunk.conversationTranscript || typeof chunk.conversationTranscript.text !== "string") {
      continue;
    }
    const transcript = chunk.conversationTranscript.text;
    for (const band of ["detailed", "brief"] as const) {
      if (!dependencies.chunkCompressionProvider) {
        artifacts.push({
          threadId: chunk.threadId,
          chunkId: chunk.chunkId,
          band,
          record: {
            status: "failed",
            errorCode: "CHUNK_COMPRESSION_PROVIDER_MISSING",
            errorMessage: "Chunk compression provider is required for inline chunk-close projection.",
            updatedAt: now().toISOString(),
          },
        });
        continue;
      }
      try {
        const compressed = await dependencies.chunkCompressionProvider.compressChunk({
          threadId: chunk.threadId,
          chunkId: chunk.chunkId,
          band,
          transcript,
        });
        artifacts.push({
          threadId: chunk.threadId,
          chunkId: chunk.chunkId,
          band,
          record: {
            status: "ready",
            text: compressed.text,
            ...(compressed.metadata ? { providerMetadata: compressed.metadata } : {}),
            updatedAt: now().toISOString(),
          },
        });
      } catch (error) {
        artifacts.push({
          threadId: chunk.threadId,
          chunkId: chunk.chunkId,
          band,
          record: {
            status: "failed",
            errorCode: "CHUNK_COMPRESSION_FAILED",
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: now().toISOString(),
          },
        });
      }
    }
  }
  return artifacts;
}

function persistChunkArtifact(
  sql: Sql,
  artifact: ComputedChunkArtifact,
): EffectValue<ReadonlyArray<ChunkSqlRow>> {
  return Effect.gen(function*() {
    const rows = yield* sql<ChunkSqlRow>`
      SELECT *
      FROM chunks
      WHERE thread_id = ${artifact.threadId} AND chunk_id = ${artifact.chunkId}
    `;
    const chunk = rows[0] ? rowToChunk(rows[0]) : undefined;
    if (!chunk) {
      return [];
    }
    const lowerBand = {
      ...(chunk.lowerBand ?? {}),
      [artifact.band]: artifact.record,
    } as JsonObject;
    return yield* upsertChunk(sql, { ...chunk, lowerBand });
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

function rowToTrigger(row: TriggerSqlRow): TurnProcessingTrigger {
  return {
    triggerId: row.trigger_id,
    threadId: row.thread_id,
    turnEndEventOrder: row.turn_end_event_order,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
  };
}

function rowToTurn(row: TurnSqlRow): CanonicalTurn {
  return {
    turnId: row.turn_id,
    threadId: row.thread_id,
    turnOrder: row.turn_order,
    lifecycleStatus: row.lifecycle_status,
    processingStatus: row.processing_status,
    initiatingMessageId: row.initiating_message_id,
    messageIds: parseJson(row.message_ids_json) as string[],
    fromMessageOrder: row.from_message_order,
    toMessageOrder: row.to_message_order,
    fromEventOrder: row.from_event_order,
    turnEndEventOrder: row.turn_end_event_order,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    sourceRevision: row.source_revision,
    rawTokenCountMetadata: row.raw_token_count_metadata_json ? parseJson(row.raw_token_count_metadata_json) as JsonObject : undefined,
    smooth: row.smooth_json ? parseJson(row.smooth_json) as JsonObject : undefined,
    lowerBandProjection: row.lower_band_projection_json ? parseJson(row.lower_band_projection_json) as JsonObject : undefined,
    repairMetadata: row.repair_metadata_json ? parseJson(row.repair_metadata_json) as JsonObject : undefined,
  };
}

function rowToChunk(row: ChunkSqlRow): CanonicalChunk {
  return {
    chunkId: row.chunk_id,
    threadId: row.thread_id,
    chunkOrder: row.chunk_order,
    lifecycleStatus: row.lifecycle_status,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    closeReason: row.close_reason === "soft_threshold" || row.close_reason === "hard_max" ? row.close_reason : undefined,
    sourceRevision: row.source_revision ?? undefined,
    sourceTurnIds: parseJson(row.source_turn_ids_json) as string[],
    smoothText: row.smooth_text ?? undefined,
    smoothTokenCountMetadata: row.smooth_token_count_metadata_json
      ? parseJson(row.smooth_token_count_metadata_json) as JsonObject
      : undefined,
    conversationTranscript: row.conversation_transcript_json
      ? parseJson(row.conversation_transcript_json) as JsonObject
      : undefined,
    lowerBand: row.lower_band_json ? parseJson(row.lower_band_json) as JsonObject : undefined,
  };
}

function projectedMessageId(threadId: string, messageOrder: number): string {
  return `msg_${toIdSegment(threadId)}_${messageOrder}`;
}

function projectedTurnId(threadId: string, turnOrder: number): string {
  return `turn_${toIdSegment(threadId)}_${turnOrder}`;
}

function projectedChunkId(threadId: string, chunkOrder: number): string {
  return `chunk_${toIdSegment(threadId)}_${chunkOrder}`;
}

function turnProcessingTriggerId(threadId: string, turnEndEventOrder: number): string {
  return `turn_trg_${toIdSegment(threadId)}_${turnEndEventOrder}`;
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

function blockPayloadText(block: ProjectedMessageBlock): string {
  if (typeof block.payload.text === "string") {
    return block.payload.text;
  }
  if (typeof block.payload.outputText === "string") {
    return block.payload.outputText;
  }
  return stablePayloadText(block.payload);
}

function renderMessageForSmooth(message: ProjectedMessageWithBlocks): string {
  return message.blocks.map(blockPayloadText).filter((text) => text.length > 0).join("\n");
}

function buildLowerBandProjectionText(messages: readonly ProjectedMessageWithBlocks[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.messageKind !== "user" && message.messageKind !== "assistant") {
      continue;
    }
    const text = message.blocks
      .filter((block) => block.blockKind === "text")
      .map(blockPayloadText)
      .filter((part) => part.length > 0)
      .join("\n");
    if (!text) {
      continue;
    }
    parts.push(`${message.messageKind === "user" ? ">" : "●"} ${text}`);
  }
  return parts.join("\n\n");
}

function stablePayloadText(payload: JsonObject): string {
  return JSON.stringify(sortJsonValue(payload));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

function textHash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function tokenMetadata(
  scope: string,
  text: string,
  sourceRevision: number,
  trustClass: "exact" | "heuristic",
  count?: number,
): JsonObject {
  return {
    scope,
    count: count ?? estimateTokens(text),
    source: trustClass === "exact" ? "provider_input_count" : "deterministic_estimate",
    trustClass,
    sourceRevision,
    representationHash: textHash(text),
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function createOpenChunk(threadId: string, chunkOrder: number, openedAt: string): CanonicalChunk {
  return {
    chunkId: projectedChunkId(threadId, chunkOrder),
    threadId,
    chunkOrder,
    lifecycleStatus: "open",
    openedAt,
    sourceTurnIds: [],
  };
}

function nextChunkOrder(chunks: readonly CanonicalChunk[]): number {
  return chunks.reduce((highest, chunk) => Math.max(highest, chunk.chunkOrder), 0) + 1;
}

function appendTurnToChunkState(chunk: CanonicalChunk, turn: CanonicalTurn): CanonicalChunk {
  const smoothText = typeof turn.smooth?.text === "string" ? turn.smooth.text : "";
  const projectionText = typeof turn.lowerBandProjection?.text === "string" ? turn.lowerBandProjection.text : "";
  const nextSmoothText = [chunk.smoothText, smoothText].filter(Boolean).join("\n\n");
  const transcriptText = [
    typeof chunk.conversationTranscript?.text === "string" ? chunk.conversationTranscript.text : undefined,
    projectionText,
  ].filter(Boolean).join("\n\n");
  return {
    ...chunk,
    sourceTurnIds: [...chunk.sourceTurnIds, turn.turnId],
    smoothText: nextSmoothText,
    sourceRevision: Math.max(chunk.sourceRevision ?? 0, turn.sourceRevision),
    smoothTokenCountMetadata: tokenMetadata("chunk_smooth_materialized", nextSmoothText, turn.sourceRevision, "heuristic"),
    conversationTranscript: {
      status: "ready",
      text: transcriptText,
      sourceRevision: turn.sourceRevision,
      sourceFingerprint: textHash(transcriptText),
      updatedAt: turn.closedAt,
    },
  };
}

function turnLowerBandProjectionTokenCount(turn: CanonicalTurn): number {
  const metadata = turn.lowerBandProjection?.tokenCountMetadata;
  return isObject(metadata) && typeof metadata.count === "number" ? metadata.count : 0;
}

function chunkProjectionTokenCount(chunk: CanonicalChunk): number {
  const transcript = typeof chunk.conversationTranscript?.text === "string" ? chunk.conversationTranscript.text : "";
  return estimateTokens(transcript);
}

function uniqueChunksById(chunks: readonly CanonicalChunk[]): CanonicalChunk[] {
  const byChunkId = new Map<string, CanonicalChunk>();
  for (const chunk of chunks) {
    byChunkId.set(chunk.chunkId, chunk);
  }
  return [...byChunkId.values()];
}

function closedChunkNeedsArtifacts(chunk: CanonicalChunk): boolean {
  return chunk.lifecycleStatus === "closed" &&
    (!hasTerminalChunkArtifact(chunk.lowerBand?.detailed) || !hasTerminalChunkArtifact(chunk.lowerBand?.brief));
}

function hasTerminalChunkArtifact(value: unknown): boolean {
  return isObject(value) && (value.status === "ready" || value.status === "failed");
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserPromptAppendInput(value: unknown): boolean {
  return isObject(value) && value.eventKind === "user_prompt";
}
