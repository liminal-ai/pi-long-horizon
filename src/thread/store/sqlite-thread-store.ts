import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import Database from "better-sqlite3";

import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import {
  deriveTargetSessionKeys,
  sourceRangeContains,
  type TargetSessionKeySet,
  type ThreadTargetRef,
} from "../domain/ids.js";
import {
  createStewardRootIndex,
  type ActorRecord,
  type FixtureRecord,
  type ImportRecord,
  type MessageRecord,
  type ProjectionRevisionRecord,
  type SourceRange,
  type StewardRootIndex,
  type ThreadRecord,
  type TurnRecord,
} from "../domain/records.js";
import type { ChunkState } from "../../thread/async-thread/domain/chunk-state.js";
import { assertSupportedThreadSchemaVersion } from "./schema-version.js";
import { FileThreadStore } from "./file-thread-store.js";
import type {
  AppendMessageInput,
  CreateFixtureInput,
  CreateThreadInput,
  FixtureSnapshot,
  RecordThreadIdMapInput,
  ThreadSnapshot,
  ThreadStore,
  UpdateThreadMetadataInput,
  WriteChunksInput,
  WriteTurnsInput,
} from "./thread-store.js";

interface ThreadIdMap {
  schemaVersion: 2;
  threadIdByPiIdentityKey: Record<string, string>;
  projectionRevisionIdByPiIdentityKey: Record<string, string>;
}

interface ThreadRow {
  thread_json: string;
}

interface ActorRow {
  actor_json: string;
}

interface MessageRow {
  message_json: string;
}

interface TurnRow {
  turn_json: string;
}

interface ChunkRow {
  chunk_json: string;
}

interface TurnOrderRow {
  turn_id: string;
}

interface ChunkPositionRow {
  chunk_id: string;
}

interface ImportRow {
  import_json: string;
}

interface ProjectionRow {
  projection_json: string;
}

interface ManagedThreadMatch {
  thread: ThreadRecord;
  projectionRevisionIds: string[];
}

interface SqliteSeedSnapshotInput {
  rootDir: string;
  thread: ThreadRecord;
  dbPath?: string;
  actors?: readonly ActorRecord[];
  messages?: readonly MessageRecord[];
  turns?: readonly TurnRecord[];
  chunks?: readonly ChunkState[];
  imports?: readonly ImportRecord[];
  projections?: readonly ProjectionRevisionRecord[];
}

interface SqliteThreadMigration {
  version: number;
  name: string;
  sql: string;
}

const SQLITE_THREAD_FILENAME = "thread.sqlite";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const THREAD_SQLITE_MIGRATIONS: readonly SqliteThreadMigration[] = [
  {
    version: 1,
    name: "sqlite-store-foundation",
    sql: readFileSync(new URL("./migrations/0001_sqlite_store_foundation.sql", import.meta.url), "utf8"),
  },
] as const;

type SerializedThreadRecord = Omit<ThreadRecord, "threadViewOutputSummary"> & {
  threadViewOutputSummary?: ThreadRecord["threadViewOutputSummary"];
} & Record<string, unknown>;

function createThreadIdMap(
  threadIdByPiIdentityKey: Record<string, string> = {},
  projectionRevisionIdByPiIdentityKey: Record<string, string> = {},
): ThreadIdMap {
  return {
    schemaVersion: 2,
    threadIdByPiIdentityKey: { ...threadIdByPiIdentityKey },
    projectionRevisionIdByPiIdentityKey: { ...projectionRevisionIdByPiIdentityKey },
  };
}

function deserializeThreadRecord(record: SerializedThreadRecord): ThreadRecord {
  const { threadViewOutputSummary, ...thread } = record;

  return {
    ...thread,
    threadViewOutputSummary: structuredClone(
      (threadViewOutputSummary ?? { count: 0 }) as ThreadRecord["threadViewOutputSummary"],
    ),
  };
}

function serializeThreadRecord(record: ThreadRecord): SerializedThreadRecord {
  const { threadViewOutputSummary, ...thread } = record;

  return {
    ...thread,
    threadViewOutputSummary: structuredClone(threadViewOutputSummary),
  };
}

function sqliteStoreUnavailableIssue(error: unknown, context: string, threadId?: string): StewardIssue {
  return {
    code: "SQLITE_STORE_UNAVAILABLE",
    message: `${context} failed.`,
    threadId,
    cause: error instanceof Error ? error.message : String(error),
  };
}

function sqliteMigrationFailedIssue(error: unknown, threadId?: string): StewardIssue {
  return {
    code: "SQLITE_MIGRATION_FAILED",
    message: "SQLite migrations failed.",
    threadId,
    cause: error instanceof Error ? error.message : String(error),
  };
}

function targetAssociationConflict(message: string): StewardIssue {
  return {
    code: "TARGET_ASSOCIATION_CONFLICT",
    message,
  };
}

function staleSourceRevisionIssue(thread: ThreadRecord, expectedSourceRevision: number): StewardIssue {
  return {
    code: "STALE_SOURCE_REVISION",
    message: `Thread ${thread.threadId} source revision ${thread.sourceRevision} does not match expected ${expectedSourceRevision}.`,
    threadId: thread.threadId,
  };
}

function staleTurnsRevisionIssue(thread: ThreadRecord, expectedTurnsRevision: number): StewardIssue {
  return {
    code: "STALE_SOURCE_REVISION",
    message: `Thread ${thread.threadId} turns revision ${thread.turnsRevision} does not match expected ${expectedTurnsRevision}.`,
    threadId: thread.threadId,
    cause: "turns_revision",
  };
}

function sortMessages(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function openDatabase(input: {
  dbPath: string;
  createIfMissing: boolean;
  threadId?: string;
}): Database.Database {
  const db = new Database(input.dbPath, {
    fileMustExist: !input.createIfMissing,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    runThreadMigrations(db, input.threadId);
    return db;
  } catch (error) {
    db.close();
    const issue = (error as { issue?: StewardIssue }).issue;
    throw issue ? error : Object.assign(error instanceof Error ? error : new Error(String(error)), {
      issue: sqliteMigrationFailedIssue(error, input.threadId),
    });
  }
}

function runThreadMigrations(db: Database.Database, threadId?: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedVersions = new Set<number>(
    db.prepare<[], { version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC")
      .all()
      .map((row) => row.version),
  );
  const latestKnownVersion = THREAD_SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
  for (const version of appliedVersions) {
    if (version > latestKnownVersion) {
      throw Object.assign(
        new Error(`SQLite schema version ${version} is newer than supported version ${latestKnownVersion}.`),
        { issue: <StewardIssue>{
          code: "SQLITE_SCHEMA_UNSUPPORTED",
          message: `SQLite schema version ${version} is newer than supported version ${latestKnownVersion}.`,
          threadId,
        } },
      );
    }
  }

  const insertMigration = db.prepare<[number, string, string]>(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of THREAD_SQLITE_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    });
    transaction.immediate();
  }
}

function closeDatabase(db: Database.Database | undefined): void {
  if (!db) {
    return;
  }

  try {
    db.close();
  } catch {
    return;
  }
}

function normalizeTargetValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveTargetSessionKeySet(target: ThreadTargetRef): StewardResult<TargetSessionKeySet> {
  try {
    return ok(deriveTargetSessionKeys(target));
  } catch (error) {
    return fail(sqliteStoreUnavailableIssue(error, "derive target session keys"));
  }
}

function findMappedThreadIds(index: StewardRootIndex, keySet: TargetSessionKeySet): Set<string> {
  const mappedThreadIds = new Set<string>();
  for (const key of [keySet.canonicalKey, ...keySet.aliasKeys]) {
    const threadId = index.threadByTargetKey[key];
    if (threadId) {
      mappedThreadIds.add(threadId);
    }
  }

  return mappedThreadIds;
}

function assignTargetKeys(index: StewardRootIndex, keySet: TargetSessionKeySet, threadId: string): void {
  index.threadByTargetKey[keySet.canonicalKey] = threadId;
  for (const aliasKey of keySet.aliasKeys) {
    index.threadByTargetKey[aliasKey] = threadId;
  }
}

function getSessionFileKey(target: ThreadTargetRef): StewardResult<string | undefined> {
  const sessionFilePath = normalizeTargetValue(target.sessionFilePath);
  if (!sessionFilePath) {
    return ok(undefined);
  }

  const keySet = resolveTargetSessionKeySet({
    runtime: target.runtime,
    sessionFilePath,
  });
  if (!keySet.ok) {
    return keySet;
  }

  return ok(keySet.value.canonicalKey);
}

function assertCompatibleTargetIdentity(stored: ThreadTargetRef, incoming: ThreadTargetRef): StewardResult<void> {
  if (stored.runtime !== incoming.runtime) {
    return fail(
      targetAssociationConflict(
        `Stored target runtime ${stored.runtime} does not match incoming runtime ${incoming.runtime}.`,
      ),
    );
  }

  const storedSessionId = normalizeTargetValue(stored.sessionId);
  const incomingSessionId = normalizeTargetValue(incoming.sessionId);
  if (storedSessionId && incomingSessionId && storedSessionId !== incomingSessionId) {
    return fail(
      targetAssociationConflict(
        `Stored target session id ${storedSessionId} does not match incoming session id ${incomingSessionId}.`,
      ),
    );
  }

  const storedSessionFileKey = getSessionFileKey(stored);
  if (!storedSessionFileKey.ok) {
    return storedSessionFileKey;
  }
  const incomingSessionFileKey = getSessionFileKey(incoming);
  if (!incomingSessionFileKey.ok) {
    return incomingSessionFileKey;
  }

  if (
    storedSessionFileKey.value &&
    incomingSessionFileKey.value &&
    storedSessionFileKey.value !== incomingSessionFileKey.value
  ) {
    return fail(
      targetAssociationConflict(
        `Stored target session file ${storedSessionFileKey.value} does not match incoming session file ${incomingSessionFileKey.value}.`,
      ),
    );
  }

  return ok(undefined);
}

function assertTargetIdentityPreserved(current: ThreadTargetRef, next: ThreadTargetRef): StewardResult<void> {
  const compatibility = assertCompatibleTargetIdentity(current, next);
  if (!compatibility.ok) {
    return compatibility;
  }

  const currentSessionId = normalizeTargetValue(current.sessionId);
  const nextSessionId = normalizeTargetValue(next.sessionId);
  if (currentSessionId && nextSessionId !== currentSessionId) {
    return fail(
      targetAssociationConflict(`Thread target session id ${currentSessionId} cannot be removed or reassigned.`),
    );
  }

  const currentSessionFileKey = getSessionFileKey(current);
  if (!currentSessionFileKey.ok) {
    return currentSessionFileKey;
  }
  const nextSessionFileKey = getSessionFileKey(next);
  if (!nextSessionFileKey.ok) {
    return nextSessionFileKey;
  }

  if (currentSessionFileKey.value && nextSessionFileKey.value !== currentSessionFileKey.value) {
    return fail(
      targetAssociationConflict(
        `Thread target session file ${currentSessionFileKey.value} cannot be removed or reassigned.`,
      ),
    );
  }

  return ok(undefined);
}

function targetsShareIdentity(left: ThreadTargetRef, right: ThreadTargetRef): StewardResult<boolean> {
  if (left.runtime !== right.runtime) {
    return ok(false);
  }

  const leftKeySet = resolveTargetSessionKeySet(left);
  if (!leftKeySet.ok) {
    return leftKeySet;
  }
  const rightKeySet = resolveTargetSessionKeySet(right);
  if (!rightKeySet.ok) {
    return rightKeySet;
  }

  const leftKeys = new Set([leftKeySet.value.canonicalKey, ...leftKeySet.value.aliasKeys]);
  for (const key of [rightKeySet.value.canonicalKey, ...rightKeySet.value.aliasKeys]) {
    if (leftKeys.has(key)) {
      return ok(true);
    }
  }

  return ok(false);
}

function selectCurrentProjection(
  projections: readonly ProjectionRevisionRecord[],
  preferredRevisionId?: string,
): ProjectionRevisionRecord | undefined {
  const preferred = preferredRevisionId
    ? projections.find((projection) => projection.revisionId === preferredRevisionId)
    : undefined;
  if (preferred && preferred.status === "available") {
    return preferred;
  }

  return [...projections]
    .filter((projection) => projection.status === "available")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
}

function hydrateThreadRecord(
  thread: ThreadRecord,
  messages: readonly MessageRecord[],
  imports: readonly ImportRecord[],
  projections: readonly ProjectionRevisionRecord[],
): ThreadRecord {
  const nextThread = structuredClone(thread);
  const lastMessage = messages.at(-1);
  nextThread.sourceRevision = Math.max(nextThread.sourceRevision, lastMessage?.sourceRevision ?? 0);
  nextThread.messageHighWatermark = Math.max(nextThread.messageHighWatermark, lastMessage?.sourceOrder ?? 0);
  nextThread.turnsRevision = Math.max(nextThread.turnsRevision ?? 0, 0);

  nextThread.indexes.targetEventKeys = {};
  for (const message of messages) {
    const targetEventKey = message.targetMetadata?.targetEventKey;
    if (targetEventKey) {
      nextThread.indexes.targetEventKeys[targetEventKey] = message.messageId;
    }
  }

  if (imports.length > 0) {
    const lastImport = [...imports].sort((left, right) => left.importedAt.localeCompare(right.importedAt)).at(-1);
    nextThread.importSummary = {
      count: imports.length,
      lastImportedAt: lastImport?.importedAt,
      lastImportStatus: lastImport?.status,
    };
  }

  if (projections.length > 0) {
    const latestProjection = selectCurrentProjection(
      projections,
      nextThread.threadViewOutputSummary.currentProjectionRevisionId,
    );
    nextThread.threadViewOutputSummary = {
      ...nextThread.threadViewOutputSummary,
      count: projections.length,
      currentProjectionRevisionId: latestProjection?.revisionId,
      currentThreadViewId: latestProjection?.threadViewId,
      currentGeneratedSessionId: latestProjection?.generatedSessionId,
      currentGeneratedFilePath: latestProjection?.generatedFilePath,
      lastRevisionStatus: latestProjection?.status,
    };
    if (latestProjection?.generatedFilePath) {
      nextThread.target = {
        ...nextThread.target,
        currentGeneratedFilePath: latestProjection.generatedFilePath,
      };
    }
  }

  return nextThread;
}

export function resolveThreadSqlitePath(rootDir: string, threadId: string): string {
  return join(rootDir, "threads", threadId, SQLITE_THREAD_FILENAME);
}

export async function seedSqliteThreadSnapshot(input: SqliteSeedSnapshotInput): Promise<StewardResult<void>> {
  let db: Database.Database | undefined;
  const dbPath = input.dbPath ?? resolveThreadSqlitePath(input.rootDir, input.thread.threadId);

  try {
    await mkdir(dirname(dbPath), { recursive: true });
    db = openDatabase({
      dbPath,
      createIfMissing: true,
      threadId: input.thread.threadId,
    });

    const transaction = db.transaction(() => {
      db!.prepare("DELETE FROM projection_revisions WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM imports WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM chunks WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM turns WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM messages WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM actors WHERE thread_id = ?").run(input.thread.threadId);
      db!.prepare("DELETE FROM threads WHERE thread_id = ?").run(input.thread.threadId);

      writeThreadRow(db!, input.thread);
      for (const actor of input.actors ?? []) {
        writeActorRow(db!, input.thread.threadId, actor);
      }
      for (const message of sortMessages(input.messages ?? [])) {
        writeMessageRow(db!, message);
      }
      for (const [index, turn] of (input.turns ?? []).entries()) {
        writeTurnRow(db!, turn, index);
      }
      for (const [index, chunk] of (input.chunks ?? []).entries()) {
        writeChunkRow(db!, input.thread.threadId, chunk, index);
      }
      for (const record of input.imports ?? []) {
        writeImportRow(db!, input.thread.threadId, record);
      }
      for (const record of input.projections ?? []) {
        writeProjectionRow(db!, record);
      }
    });
    transaction.immediate();

    return ok(undefined);
  } catch (error) {
    const issue = (error as { issue?: StewardIssue }).issue;
    return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "seedSqliteThreadSnapshot", input.thread.threadId));
  } finally {
    closeDatabase(db);
  }
}

function writeThreadRow(db: Database.Database, thread: ThreadRecord): void {
  db.prepare(
    `INSERT INTO threads (
      thread_id,
      created_at,
      updated_at,
      source_revision,
      message_high_watermark,
      turns_revision,
      target_runtime,
      target_session_id,
      target_session_file_path,
      current_generated_file_path,
      thread_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      source_revision = excluded.source_revision,
      message_high_watermark = excluded.message_high_watermark,
      turns_revision = excluded.turns_revision,
      target_runtime = excluded.target_runtime,
      target_session_id = excluded.target_session_id,
      target_session_file_path = excluded.target_session_file_path,
      current_generated_file_path = excluded.current_generated_file_path,
      thread_json = excluded.thread_json`,
  ).run(
    thread.threadId,
    thread.createdAt,
    thread.updatedAt,
    thread.sourceRevision,
    thread.messageHighWatermark,
    thread.turnsRevision,
    thread.target.runtime,
    thread.target.sessionId ?? null,
    thread.target.sessionFilePath ?? null,
    thread.target.currentGeneratedFilePath ?? null,
    JSON.stringify(serializeThreadRecord(thread)),
  );
}

function writeActorRow(db: Database.Database, threadId: string, actor: ActorRecord): void {
  db.prepare(
    `INSERT INTO actors (thread_id, actor_id, actor_type, display_name, actor_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, actor_id) DO UPDATE SET
       actor_type = excluded.actor_type,
       display_name = excluded.display_name,
       actor_json = excluded.actor_json`,
  ).run(
    threadId,
    actor.actorId,
    actor.actorType,
    actor.displayName ?? null,
    JSON.stringify(structuredClone(actor)),
  );
}

function writeMessageRow(db: Database.Database, message: MessageRecord): void {
  db.prepare(
    `INSERT INTO messages (
      thread_id,
      message_id,
      source_order,
      source_revision,
      actor_id,
      message_kind,
      captured_at,
      target_event_key,
      message_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, message_id) DO UPDATE SET
      source_order = excluded.source_order,
      source_revision = excluded.source_revision,
      actor_id = excluded.actor_id,
      message_kind = excluded.message_kind,
      captured_at = excluded.captured_at,
      target_event_key = excluded.target_event_key,
      message_json = excluded.message_json`,
  ).run(
    message.threadId,
    message.messageId,
    message.sourceOrder,
    message.sourceRevision,
    message.actorId,
    message.messageKind,
    message.capturedAt,
    message.targetMetadata?.targetEventKey ?? null,
    JSON.stringify(structuredClone(message)),
  );
}

function writeTurnRow(db: Database.Database, turn: TurnRecord, index: number): void {
  db.prepare(
    `INSERT INTO turns (thread_id, turn_id, turn_order, lifecycle_status, source_revision, turn_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, turn_id) DO UPDATE SET
       turn_order = excluded.turn_order,
       lifecycle_status = excluded.lifecycle_status,
       source_revision = excluded.source_revision,
       turn_json = excluded.turn_json`,
  ).run(
    turn.threadId,
    turn.turnId,
    turn.turnOrder ?? index + 1,
    turn.lifecycleStatus,
    turn.sourceRevision,
    JSON.stringify(structuredClone(turn)),
  );
}

function writeChunkRow(db: Database.Database, threadId: string, chunk: ChunkState, index: number): void {
  db.prepare(
    `INSERT INTO chunks (thread_id, chunk_id, chunk_position, lifecycle_status, source_revision, chunk_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, chunk_id) DO UPDATE SET
       chunk_position = excluded.chunk_position,
       lifecycle_status = excluded.lifecycle_status,
       source_revision = excluded.source_revision,
       chunk_json = excluded.chunk_json`,
  ).run(
    threadId,
    chunk.chunkId,
    index,
    chunk.lifecycleStatus,
    chunk.sourceRevision ?? null,
    JSON.stringify(structuredClone(chunk)),
  );
}

function syncTurnRows(db: Database.Database, threadId: string, turns: readonly TurnRecord[]): void {
  const existingRows = db.prepare<[{ threadId: string }], TurnOrderRow>(
    "SELECT turn_id FROM turns WHERE thread_id = @threadId",
  ).all({ threadId });
  const existingIds = new Set(existingRows.map((row) => row.turn_id));
  const nextIds = new Set(turns.map((turn) => turn.turnId));
  const deleteTurn = db.prepare<[string, string]>("DELETE FROM turns WHERE thread_id = ? AND turn_id = ?");
  const stageTurnOrder = db.prepare<[number, string, string]>(
    "UPDATE turns SET turn_order = ? WHERE thread_id = ? AND turn_id = ?",
  );

  for (const row of existingRows) {
    if (!nextIds.has(row.turn_id)) {
      deleteTurn.run(threadId, row.turn_id);
    }
  }

  for (const [index, turn] of turns.entries()) {
    if (existingIds.has(turn.turnId)) {
      stageTurnOrder.run(-(index + 1), threadId, turn.turnId);
    }
  }

  for (const [index, turn] of turns.entries()) {
    writeTurnRow(db, turn, index);
  }
}

function syncChunkRows(db: Database.Database, threadId: string, chunks: readonly ChunkState[]): void {
  const existingRows = db.prepare<[{ threadId: string }], ChunkPositionRow>(
    "SELECT chunk_id FROM chunks WHERE thread_id = @threadId",
  ).all({ threadId });
  const existingIds = new Set(existingRows.map((row) => row.chunk_id));
  const nextIds = new Set(chunks.map((chunk) => chunk.chunkId));
  const deleteChunk = db.prepare<[string, string]>("DELETE FROM chunks WHERE thread_id = ? AND chunk_id = ?");
  const stageChunkPosition = db.prepare<[number, string, string]>(
    "UPDATE chunks SET chunk_position = ? WHERE thread_id = ? AND chunk_id = ?",
  );

  for (const row of existingRows) {
    if (!nextIds.has(row.chunk_id)) {
      deleteChunk.run(threadId, row.chunk_id);
    }
  }

  for (const [index, chunk] of chunks.entries()) {
    if (existingIds.has(chunk.chunkId)) {
      stageChunkPosition.run(-(index + 1), threadId, chunk.chunkId);
    }
  }

  for (const [index, chunk] of chunks.entries()) {
    writeChunkRow(db, threadId, chunk, index);
  }
}

function writeImportRow(db: Database.Database, threadId: string, record: ImportRecord): void {
  db.prepare(
    `INSERT INTO imports (thread_id, import_id, imported_at, status, import_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, import_id) DO UPDATE SET
       imported_at = excluded.imported_at,
       status = excluded.status,
       import_json = excluded.import_json`,
  ).run(
    threadId,
    record.importId,
    record.importedAt,
    record.status,
    JSON.stringify(structuredClone(record)),
  );
}

function writeProjectionRow(db: Database.Database, record: ProjectionRevisionRecord): void {
  db.prepare(
    `INSERT INTO projection_revisions (
      thread_id,
      revision_id,
      created_at,
      status,
      generated_file_path,
      generated_session_id,
      thread_view_id,
      projection_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, revision_id) DO UPDATE SET
      created_at = excluded.created_at,
      status = excluded.status,
      generated_file_path = excluded.generated_file_path,
      generated_session_id = excluded.generated_session_id,
      thread_view_id = excluded.thread_view_id,
      projection_json = excluded.projection_json`,
  ).run(
    record.threadId,
    record.revisionId,
    record.createdAt,
    record.status,
    record.generatedFilePath,
    record.generatedSessionId ?? null,
    record.threadViewId ?? null,
    JSON.stringify(structuredClone(record)),
  );
}

export class SqliteThreadStore implements ThreadStore {
  private static readonly globalThreadQueues = new Map<string, Promise<void>>();

  private readonly threadsDir: string;
  private readonly fixturesDelegate: FileThreadStore;
  private readonly indexPath: string;
  private readonly threadIdMapPath: string;

  constructor(private readonly rootDir: string) {
    this.threadsDir = join(rootDir, "threads");
    this.fixturesDelegate = new FileThreadStore(rootDir);
    this.indexPath = join(rootDir, "index.json");
    this.threadIdMapPath = join(rootDir, "threadId-map.json");
  }

  async createThread(input: CreateThreadInput): Promise<StewardResult<ThreadRecord>> {
    let db: Database.Database | undefined;

    try {
      await this.ensureStoreReady();

      const keySet = resolveTargetSessionKeySet(input.targetRef);
      if (!keySet.ok) {
        return keySet;
      }

      const sqliteMatches = await this.scanThreadsByTarget(input.targetRef);
      if (!sqliteMatches.ok) {
        return sqliteMatches;
      }

      if (sqliteMatches.value.length > 0) {
        return fail(
          targetAssociationConflict(
            `Target ${keySet.value.canonicalKey} is already associated with thread ${sqliteMatches.value[0]!.threadId}.`,
          ),
        );
      }

      const index = await this.readRootIndex();
      const mappedThreadIds = findMappedThreadIds(index, keySet.value);
      if (mappedThreadIds.size > 0) {
        return fail(
          targetAssociationConflict(
            `Target ${keySet.value.canonicalKey} is already associated with thread ${[...mappedThreadIds][0]}.`,
          ),
        );
      }

      await mkdir(dirname(resolveThreadSqlitePath(this.rootDir, input.thread.threadId)), { recursive: true });
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, input.thread.threadId),
        createIfMissing: true,
        threadId: input.thread.threadId,
      });

      const transaction = db.transaction(() => {
        writeThreadRow(db!, input.thread);
      });
      transaction.immediate();

      const nextIndex = createStewardRootIndex(index.threadByTargetKey);
      assignTargetKeys(nextIndex, keySet.value, input.thread.threadId);
      await this.writeJsonAtomic(this.indexPath, nextIndex);

      return ok(structuredClone(input.thread));
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "createThread", input.thread.threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async openThread(threadId: string): Promise<StewardResult<ThreadSnapshot>> {
    let db: Database.Database | undefined;

    try {
      await this.ensureStoreReady();
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      return ok(this.readSnapshot(db, threadId));
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "openThread", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async openFixture(fixtureId: string): Promise<StewardResult<FixtureSnapshot>> {
    return this.fixturesDelegate.openFixture(fixtureId);
  }

  async recordThreadIdMap(input: RecordThreadIdMapInput): Promise<StewardResult<void>> {
    try {
      await this.ensureStoreReady();
      const thread = await this.openThread(input.threadId);
      if (!thread.ok) {
        return fail(...thread.issues);
      }

      const keySet = resolveTargetSessionKeySet(input.target);
      if (!keySet.ok) {
        return keySet;
      }

      const map = await this.readThreadIdMap();
      const nextMap = createThreadIdMap(map.threadIdByPiIdentityKey, map.projectionRevisionIdByPiIdentityKey);
      for (const key of [keySet.value.canonicalKey, ...keySet.value.aliasKeys]) {
        const mappedThreadId = nextMap.threadIdByPiIdentityKey[key];
        if (mappedThreadId && mappedThreadId !== input.threadId) {
          return fail(
            targetAssociationConflict(`PI identity ${key} is already mapped to thread ${mappedThreadId} in threadId-map.json.`),
          );
        }

        nextMap.threadIdByPiIdentityKey[key] = thread.value.thread.threadId;
        if (input.projectionRevisionId) {
          nextMap.projectionRevisionIdByPiIdentityKey[key] = input.projectionRevisionId;
        }
      }

      await this.writeJsonAtomic(this.threadIdMapPath, nextMap);
      return ok(undefined);
    } catch (error) {
      return fail(sqliteStoreUnavailableIssue(error, "recordThreadIdMap", input.threadId));
    }
  }

  async resolveThreadIdMap(target: ThreadTargetRef): Promise<StewardResult<string | undefined>> {
    try {
      const keySet = resolveTargetSessionKeySet(target);
      if (!keySet.ok) {
        return keySet;
      }

      const map = await this.readThreadIdMap();
      const mappedThreadIds = new Set<string>();
      for (const key of [keySet.value.canonicalKey, ...keySet.value.aliasKeys]) {
        const threadId = map.threadIdByPiIdentityKey[key];
        if (threadId) {
          mappedThreadIds.add(threadId);
        }
      }

      if (mappedThreadIds.size === 0) {
        return ok(undefined);
      }

      if (mappedThreadIds.size > 1) {
        return fail(
          targetAssociationConflict(
            `PI identities for ${keySet.value.canonicalKey} map to multiple threads in threadId-map.json: ${[
              ...mappedThreadIds,
            ].join(", ")}.`,
          ),
        );
      }

      return ok([...mappedThreadIds][0]);
    } catch (error) {
      return fail(sqliteStoreUnavailableIssue(error, "resolveThreadIdMap"));
    }
  }

  async resolveProjectionRevisionIdMap(target: ThreadTargetRef): Promise<StewardResult<string | undefined>> {
    try {
      const scanned = await this.scanManagedThreadMatches(target);
      if (!scanned.ok) {
        return scanned;
      }

      const matchedProjectionRevisionIds = new Set(
        scanned.value.flatMap((match) => match.projectionRevisionIds),
      );
      if (matchedProjectionRevisionIds.size > 1) {
        const keySet = resolveTargetSessionKeySet(target);
        if (!keySet.ok) {
          return keySet;
        }

        return fail(
          targetAssociationConflict(
            `PI identities for ${keySet.value.canonicalKey} map to multiple generated projections in SQLite storage: ${[
              ...matchedProjectionRevisionIds,
            ].join(", ")}.`,
          ),
        );
      }

      if (matchedProjectionRevisionIds.size === 1) {
        return ok([...matchedProjectionRevisionIds][0]);
      }

      const map = await this.readThreadIdMap();
      const mappedProjectionRevisionIds = new Set<string>();
      const keySet = resolveTargetSessionKeySet(target);
      if (!keySet.ok) {
        return keySet;
      }

      for (const key of [keySet.value.canonicalKey, ...keySet.value.aliasKeys]) {
        const revisionId = map.projectionRevisionIdByPiIdentityKey[key];
        if (revisionId) {
          mappedProjectionRevisionIds.add(revisionId);
        }
      }

      if (mappedProjectionRevisionIds.size === 0) {
        return ok(undefined);
      }

      if (mappedProjectionRevisionIds.size > 1) {
        return fail(
          targetAssociationConflict(
            `PI identities for ${keySet.value.canonicalKey} map to multiple generated projections in threadId-map.json: ${[
              ...mappedProjectionRevisionIds,
            ].join(", ")}.`,
          ),
        );
      }

      return ok([...mappedProjectionRevisionIds][0]);
    } catch (error) {
      return fail(sqliteStoreUnavailableIssue(error, "resolveProjectionRevisionIdMap"));
    }
  }

  async findThreadByTarget(target: ThreadTargetRef): Promise<StewardResult<ThreadRecord | undefined>> {
    try {
      await this.ensureStoreReady();
      const keySet = resolveTargetSessionKeySet(target);
      if (!keySet.ok) {
        return keySet;
      }

      const sqliteMatches = await this.scanThreadsByTarget(target);
      if (!sqliteMatches.ok) {
        return sqliteMatches;
      }

      if (sqliteMatches.value.length > 1) {
        return fail(
          targetAssociationConflict(
            `Target ${keySet.value.canonicalKey} is associated with multiple SQLite threads: ${
              sqliteMatches.value.map((thread) => thread.threadId).join(", ")
            }.`,
          ),
        );
      }

      if (sqliteMatches.value.length === 1) {
        return ok(sqliteMatches.value[0]);
      }

      const index = await this.readRootIndex();
      const mappedThreadIds = findMappedThreadIds(index, keySet.value);
      if (mappedThreadIds.size === 0) {
        return ok(undefined);
      }

      if (mappedThreadIds.size > 1) {
        return fail(
          targetAssociationConflict(
            `Target ${keySet.value.canonicalKey} is associated with multiple threads: ${[...mappedThreadIds].join(", ")}.`,
          ),
        );
      }

      const [threadId] = mappedThreadIds;
      const snapshot = await this.openThread(threadId);
      if (!snapshot.ok) {
        return fail(...snapshot.issues);
      }

      const compatibility = assertCompatibleTargetIdentity(snapshot.value.thread.target, target);
      if (!compatibility.ok) {
        return compatibility;
      }

      return ok(snapshot.value.thread);
    } catch (error) {
      return fail(sqliteStoreUnavailableIssue(error, "findThreadByTarget"));
    }
  }

  async findManagedThread(target: ThreadRecord["target"]): Promise<StewardResult<ThreadRecord | undefined>> {
    const scanned = await this.scanThreadsByTarget({
      runtime: target.runtime,
      sessionId: target.sessionId,
      sessionFilePath: target.sessionFilePath,
    });
    if (!scanned.ok) {
      return scanned;
    }

    if (scanned.value.length > 0) {
      if (scanned.value.length > 1) {
        return fail(
          targetAssociationConflict(
            `Target ${target.runtime}:${target.sessionId ?? "-"} is associated with multiple SQLite threads: ${
              scanned.value.map((thread) => thread.threadId).join(", ")
            }.`,
          ),
        );
      }

      return ok(scanned.value[0]);
    }

    const mappedThreadId = await this.resolveThreadIdMap({
      runtime: target.runtime,
      sessionId: target.sessionId,
      sessionFilePath: target.sessionFilePath,
    });
    if (!mappedThreadId.ok) {
      return mappedThreadId;
    }

    if (!mappedThreadId.value) {
      return ok(undefined);
    }

    const snapshot = await this.openThread(mappedThreadId.value);
    if (!snapshot.ok) {
      return fail(...snapshot.issues);
    }

    return ok(snapshot.value.thread);
  }

  async assertCanMutate(threadId: string): Promise<StewardResult<ThreadRecord>> {
    const snapshot = await this.openThread(threadId);
    if (!snapshot.ok) {
      return fail(...snapshot.issues);
    }

    const schemaCheck = assertSupportedThreadSchemaVersion(snapshot.value.thread);
    if (!schemaCheck.ok) {
      return fail(...schemaCheck.issues);
    }

    return ok(snapshot.value.thread);
  }

  async upsertActor(threadId: string, actor: ActorRecord): Promise<StewardResult<ActorRecord>> {
    return this.withThreadMutation(threadId, () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
          createIfMissing: false,
          threadId,
        });
        const transaction = db.transaction(() => {
          this.requireMutableThread(db!, threadId);
          writeActorRow(db!, threadId, actor);
        });
        transaction.immediate();
        return ok(structuredClone(actor));
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "upsertActor", threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async listActors(threadId: string): Promise<StewardResult<ActorRecord[]>> {
    let db: Database.Database | undefined;

    try {
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      this.requireMutableThread(db, threadId);
      return ok(
        db.prepare<[{ threadId: string }], ActorRow>(
          "SELECT actor_json FROM actors WHERE thread_id = @threadId ORDER BY actor_id ASC",
        ).all({ threadId }).map((row) => JSON.parse(row.actor_json) as ActorRecord),
      );
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "listActors", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<StewardResult<MessageRecord>> {
    return this.withThreadMutation(input.threadId, () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, input.threadId),
          createIfMissing: false,
          threadId: input.threadId,
        });
        const appended = db.transaction(() => {
          const thread = this.requireMutableThread(db!, input.threadId);
          writeActorRow(db!, input.threadId, input.actor);

          const targetEventKey = input.targetEventKey ?? input.message.targetMetadata?.targetEventKey;
          if (targetEventKey) {
            const duplicate = db!.prepare<
              [{ threadId: string; targetEventKey: string }],
              { message_id: string }
            >(
              "SELECT message_id FROM messages WHERE thread_id = @threadId AND target_event_key = @targetEventKey",
            ).get({ threadId: input.threadId, targetEventKey });
            if (duplicate) {
              throw Object.assign(
                new Error(`Target event ${targetEventKey} is already recorded for thread ${input.threadId}.`),
                { issue: <StewardIssue>{
                  code: "CAPTURE_DUPLICATE_EVENT",
                  message: `Target event ${targetEventKey} is already recorded for thread ${input.threadId}.`,
                  threadId: input.threadId,
                } },
              );
            }
          }

          const capturedAt = input.message.capturedAt ?? new Date().toISOString();
          const nextSourceOrder = thread.messageHighWatermark + 1;
          const nextSourceRevision = thread.sourceRevision + 1;
          const message: MessageRecord = {
            ...structuredClone(input.message),
            threadId: input.threadId,
            actorId: input.actor.actorId,
            actorType: input.actor.actorType,
            sourceOrder: nextSourceOrder,
            sourceRevision: nextSourceRevision,
            capturedAt,
          };

          writeMessageRow(db!, message);

          const nextThread = structuredClone(thread);
          nextThread.sourceRevision = nextSourceRevision;
          nextThread.messageHighWatermark = nextSourceOrder;
          nextThread.updatedAt = capturedAt;
          if (targetEventKey) {
            nextThread.indexes.targetEventKeys[targetEventKey] = message.messageId;
          }
          writeThreadRow(db!, nextThread);

          return message;
        }).immediate();

        return ok(appended);
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "appendMessage", input.threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async readMessages(threadId: string, range?: SourceRange): Promise<StewardResult<MessageRecord[]>> {
    let db: Database.Database | undefined;

    try {
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      this.requireMutableThread(db, threadId);

      const messages = db.prepare<[{ threadId: string }], MessageRow>(
        "SELECT message_json FROM messages WHERE thread_id = @threadId ORDER BY source_order ASC",
      ).all({ threadId }).map((row) => JSON.parse(row.message_json) as MessageRecord);
      const filtered = range ? messages.filter((message) => sourceRangeContains(range, message.sourceOrder)) : messages;
      return ok(filtered);
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "readMessages", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async readTurns(threadId: string): Promise<StewardResult<TurnRecord[]>> {
    let db: Database.Database | undefined;

    try {
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      this.requireMutableThread(db, threadId);
      return ok(
        db.prepare<[{ threadId: string }], TurnRow>(
          "SELECT turn_json FROM turns WHERE thread_id = @threadId ORDER BY turn_order ASC",
        ).all({ threadId }).map((row) => JSON.parse(row.turn_json) as TurnRecord),
      );
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "readTurns", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>> {
    return this.withThreadMutation(input.threadId, () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, input.threadId),
          createIfMissing: false,
          threadId: input.threadId,
        });
        const turns = db.transaction(() => {
          const thread = this.requireMutableThread(db!, input.threadId);
          if (thread.sourceRevision !== input.expectedSourceRevision) {
            throw Object.assign(new Error("stale source revision"), {
              issue: staleSourceRevisionIssue(thread, input.expectedSourceRevision),
            });
          }

          if (thread.messageHighWatermark !== input.expectedMessageHighWatermark) {
            throw Object.assign(new Error("stale message watermark"), {
              issue: <StewardIssue>{
                code: "STALE_SOURCE_REVISION",
                message:
                  `Thread ${input.threadId} message high watermark ${thread.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
                threadId: input.threadId,
              },
            });
          }

          if (thread.turnsRevision !== input.expectedTurnsRevision) {
            throw Object.assign(new Error("stale turns revision"), {
              issue: staleTurnsRevisionIssue(thread, input.expectedTurnsRevision),
            });
          }

          syncTurnRows(db!, input.threadId, input.turns);

          const nextThread = structuredClone(thread);
          nextThread.turnsRevision = thread.turnsRevision + 1;
          nextThread.status.turnState = input.turnState;
          nextThread.updatedAt = new Date().toISOString();
          writeThreadRow(db!, nextThread);

          return structuredClone(input.turns);
        }).immediate();

        return ok(turns);
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "writeTurns", input.threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async readChunks(threadId: string): Promise<StewardResult<ChunkState[]>> {
    let db: Database.Database | undefined;

    try {
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      this.requireMutableThread(db, threadId);
      return ok(
        db.prepare<[{ threadId: string }], ChunkRow>(
          "SELECT chunk_json FROM chunks WHERE thread_id = @threadId ORDER BY chunk_position ASC",
        ).all({ threadId }).map((row) => JSON.parse(row.chunk_json) as ChunkState),
      );
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "readChunks", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async writeChunks(input: WriteChunksInput): Promise<StewardResult<ChunkState[]>> {
    return this.withThreadMutation(input.threadId, () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, input.threadId),
          createIfMissing: false,
          threadId: input.threadId,
        });
        const chunks = db.transaction(() => {
          const thread = this.requireMutableThread(db!, input.threadId);
          if (thread.sourceRevision !== input.expectedSourceRevision) {
            throw Object.assign(new Error("stale source revision"), {
              issue: staleSourceRevisionIssue(thread, input.expectedSourceRevision),
            });
          }

          if (thread.messageHighWatermark !== input.expectedMessageHighWatermark) {
            throw Object.assign(new Error("stale message watermark"), {
              issue: <StewardIssue>{
                code: "STALE_SOURCE_REVISION",
                message:
                  `Thread ${input.threadId} message high watermark ${thread.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
                threadId: input.threadId,
              },
            });
          }

          if (thread.turnsRevision !== input.expectedTurnsRevision) {
            throw Object.assign(new Error("stale turns revision"), {
              issue: staleTurnsRevisionIssue(thread, input.expectedTurnsRevision),
            });
          }

          syncChunkRows(db!, input.threadId, input.chunks);

          const nextThread = structuredClone(thread);
          nextThread.updatedAt = new Date().toISOString();
          writeThreadRow(db!, nextThread);

          return structuredClone(input.chunks);
        }).immediate();

        return ok(chunks);
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "writeChunks", input.threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async updateThreadMetadata(input: UpdateThreadMetadataInput): Promise<StewardResult<ThreadRecord>> {
    return this.withThreadMutation(input.threadId, async () => {
      let db: Database.Database | undefined;
      const rootIndex = await this.readRootIndex();
      let nextIndex: StewardRootIndex | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, input.threadId),
          createIfMissing: false,
          threadId: input.threadId,
        });
        const updatedThread = db.transaction(() => {
          const thread = this.requireMutableThread(db!, input.threadId);
          if (
            input.expectedSourceRevision !== undefined &&
            thread.sourceRevision !== input.expectedSourceRevision
          ) {
            throw Object.assign(new Error("stale source revision"), {
              issue: staleSourceRevisionIssue(thread, input.expectedSourceRevision),
            });
          }

          const nextThread = structuredClone(thread);
          if (input.patch.target) {
            nextThread.target = structuredClone(input.patch.target);
          }

          if (input.patch.status) {
            nextThread.status = {
              ...nextThread.status,
              ...structuredClone(input.patch.status),
            };
          }

          if (input.patch.importSummary) {
            nextThread.importSummary = {
              ...nextThread.importSummary,
              ...structuredClone(input.patch.importSummary),
            };
          }

          if (input.patch.threadViewOutputSummary) {
            nextThread.threadViewOutputSummary = {
              ...nextThread.threadViewOutputSummary,
              ...structuredClone(input.patch.threadViewOutputSummary),
            };
          }

          nextThread.updatedAt = input.patch.updatedAt ?? new Date().toISOString();

          const targetIdentityPreserved = assertTargetIdentityPreserved(thread.target, nextThread.target);
          if (!targetIdentityPreserved.ok) {
            throw Object.assign(new Error("target association conflict"), { issue: targetIdentityPreserved.issues[0] });
          }

          const currentKeySet = resolveTargetSessionKeySet({
            runtime: thread.target.runtime,
            sessionId: thread.target.sessionId,
            sessionFilePath: thread.target.sessionFilePath,
          });
          if (!currentKeySet.ok) {
            throw Object.assign(new Error("derive target keys"), { issue: currentKeySet.issues[0] });
          }

          const nextKeySet = resolveTargetSessionKeySet({
            runtime: nextThread.target.runtime,
            sessionId: nextThread.target.sessionId,
            sessionFilePath: nextThread.target.sessionFilePath,
          });
          if (!nextKeySet.ok) {
            throw Object.assign(new Error("derive target keys"), { issue: nextKeySet.issues[0] });
          }

          const keySetsChanged =
            currentKeySet.value.canonicalKey !== nextKeySet.value.canonicalKey ||
            currentKeySet.value.aliasKeys.join("\n") !== nextKeySet.value.aliasKeys.join("\n");
          if (keySetsChanged) {
            const mappedThreadIds = findMappedThreadIds(rootIndex, nextKeySet.value);
            const conflictingThreadId = [...mappedThreadIds].find((threadId) => threadId !== input.threadId);
            if (conflictingThreadId) {
              throw Object.assign(new Error("target association conflict"), {
                issue: targetAssociationConflict(
                  `Target ${nextKeySet.value.canonicalKey} is already associated with thread ${conflictingThreadId}.`,
                ),
              });
            }

            nextIndex = createStewardRootIndex(rootIndex.threadByTargetKey);
            for (const key of [currentKeySet.value.canonicalKey, ...currentKeySet.value.aliasKeys]) {
              if (nextIndex.threadByTargetKey[key] === input.threadId) {
                delete nextIndex.threadByTargetKey[key];
              }
            }
            assignTargetKeys(nextIndex, nextKeySet.value, input.threadId);
          }

          writeThreadRow(db!, nextThread);
          return nextThread;
        }).immediate();

        if (nextIndex) {
          await this.writeJsonAtomic(this.indexPath, nextIndex);
        }

        return ok(updatedThread);
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "updateThreadMetadata", input.threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async recordImport(threadId: string, record: ImportRecord): Promise<StewardResult<ThreadRecord>> {
    return this.withThreadMutation(threadId, () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
          createIfMissing: false,
          threadId,
        });
        const thread = db.transaction(() => {
          const currentThread = this.requireMutableThread(db!, threadId);
          writeImportRow(db!, threadId, record);
          const importCount = db!.prepare<[{ threadId: string }], { count: number }>(
            "SELECT COUNT(*) AS count FROM imports WHERE thread_id = @threadId",
          ).get({ threadId })?.count ?? 0;

          const nextThread = structuredClone(currentThread);
          nextThread.importSummary = {
            count: importCount,
            lastImportedAt: record.importedAt,
            lastImportStatus: record.status,
          };
          nextThread.updatedAt = new Date().toISOString();
          writeThreadRow(db!, nextThread);
          return nextThread;
        }).immediate();

        return ok(thread);
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "recordImport", threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async readProjectionRevisions(threadId: string): Promise<StewardResult<ProjectionRevisionRecord[]>> {
    let db: Database.Database | undefined;

    try {
      db = openDatabase({
        dbPath: resolveThreadSqlitePath(this.rootDir, threadId),
        createIfMissing: false,
        threadId,
      });
      this.requireMutableThread(db, threadId);
      return ok(
        db.prepare<[{ threadId: string }], ProjectionRow>(
          "SELECT projection_json FROM projection_revisions WHERE thread_id = @threadId ORDER BY created_at ASC",
        ).all({ threadId }).map((row) => JSON.parse(row.projection_json) as ProjectionRevisionRecord),
      );
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "readProjectionRevisions", threadId));
    } finally {
      closeDatabase(db);
    }
  }

  async writeProjectionRevision(record: ProjectionRevisionRecord): Promise<StewardResult<ProjectionRevisionRecord>> {
    return this.withThreadMutation(record.threadId, async () => {
      let db: Database.Database | undefined;

      try {
        db = openDatabase({
          dbPath: resolveThreadSqlitePath(this.rootDir, record.threadId),
          createIfMissing: false,
          threadId: record.threadId,
        });
        const nextThread = db.transaction(() => {
          const thread = this.requireMutableThread(db!, record.threadId);
          writeProjectionRow(db!, record);

          const projections = db!.prepare<[{ threadId: string }], ProjectionRow>(
            "SELECT projection_json FROM projection_revisions WHERE thread_id = @threadId ORDER BY created_at ASC",
          ).all({ threadId: record.threadId }).map((row) => JSON.parse(row.projection_json) as ProjectionRevisionRecord);
          const latest = selectCurrentProjection(projections, record.revisionId);

          const updatedThread = structuredClone(thread);
          updatedThread.threadViewOutputSummary = {
            ...updatedThread.threadViewOutputSummary,
            count: projections.length,
            currentProjectionRevisionId: latest?.revisionId,
            currentThreadViewId: latest?.threadViewId,
            currentGeneratedSessionId: latest?.generatedSessionId,
            currentGeneratedFilePath: latest?.generatedFilePath,
            lastRevisionStatus: latest?.status,
          };
          if (latest?.generatedFilePath) {
            updatedThread.target = {
              ...updatedThread.target,
              currentGeneratedFilePath: latest.generatedFilePath,
            };
          }
          updatedThread.updatedAt = new Date().toISOString();
          writeThreadRow(db!, updatedThread);
          return updatedThread;
        }).immediate();

        if (record.generatedSessionId || record.generatedFilePath) {
          const mapped = await this.recordThreadIdMap({
            threadId: record.threadId,
            target: {
              runtime: record.targetRuntime,
              sessionId: record.generatedSessionId,
              sessionFilePath: record.generatedFilePath,
            },
            projectionRevisionId: record.revisionId,
          });
          if (!mapped.ok) {
            return fail(...mapped.issues);
          }
        }

        return ok(structuredClone(record));
      } catch (error) {
        const issue = (error as { issue?: StewardIssue }).issue;
        return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "writeProjectionRevision", record.threadId));
      } finally {
        closeDatabase(db);
      }
    });
  }

  async createFixture(input: CreateFixtureInput): Promise<StewardResult<FixtureRecord>> {
    return this.fixturesDelegate.createFixture(input);
  }

  private async ensureStoreReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.threadsDir, { recursive: true });
  }

  private async readRootIndex(): Promise<StewardRootIndex> {
    return this.readJsonFile<StewardRootIndex>(this.indexPath, createStewardRootIndex());
  }

  private async scanThreadsByTarget(target: ThreadTargetRef): Promise<StewardResult<ThreadRecord[]>> {
    const matches = await this.scanManagedThreadMatches(target);
    if (!matches.ok) {
      return matches;
    }

    return ok(matches.value.map((match) => match.thread));
  }

  private async scanManagedThreadMatches(target: ThreadTargetRef): Promise<StewardResult<ManagedThreadMatch[]>> {
    try {
      await this.ensureStoreReady();
      const entries = await readdir(this.threadsDir, { withFileTypes: true });
      const matches: ManagedThreadMatch[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const dbPath = join(this.threadsDir, entry.name, SQLITE_THREAD_FILENAME);
        try {
          await stat(dbPath);
        } catch {
          continue;
        }

        let db: Database.Database | undefined;
        try {
          db = openDatabase({
            dbPath,
            createIfMissing: false,
            threadId: entry.name,
          });
          const thread = this.readThreadRecord(db, entry.name);
          const projections = this.readProjectionRecords(db, entry.name);
          const threadMatch = targetsShareIdentity(thread.target, target);
          if (!threadMatch.ok) {
            return threadMatch;
          }

          const projectionRevisionIds: string[] = [];
          for (const projection of projections) {
            if (!projection.generatedSessionId && !projection.generatedFilePath) {
              continue;
            }

            const projectionMatch = targetsShareIdentity(
              {
                runtime: projection.targetRuntime,
                sessionId: projection.generatedSessionId,
                sessionFilePath: projection.generatedFilePath,
              },
              target,
            );
            if (!projectionMatch.ok) {
              return projectionMatch;
            }

            if (projectionMatch.value) {
              projectionRevisionIds.push(projection.revisionId);
            }
          }

          if (threadMatch.value || projectionRevisionIds.length > 0) {
            matches.push({
              thread,
              projectionRevisionIds: [...new Set(projectionRevisionIds)],
            });
          }
        } finally {
          closeDatabase(db);
        }
      }

      return ok(matches);
    } catch (error) {
      const issue = (error as { issue?: StewardIssue }).issue;
      return issue ? fail(issue) : fail(sqliteStoreUnavailableIssue(error, "scanThreadsByTarget"));
    }
  }

  private async readThreadIdMap(): Promise<ThreadIdMap> {
    const map = await this.readJsonFile<ThreadIdMap>(this.threadIdMapPath, createThreadIdMap());
    return createThreadIdMap(
      map.threadIdByPiIdentityKey ?? {},
      map.projectionRevisionIdByPiIdentityKey ?? {},
    );
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.sqlite.tmp`);
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  }

  private async readJsonFile<T>(filePath: string, fallback?: T): Promise<T> {
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) {
        return structuredClone(fallback);
      }

      throw error;
    }
  }

  private readThreadRecord(db: Database.Database, threadId: string): ThreadRecord {
    const row = db.prepare<[{ threadId: string }], ThreadRow>(
      "SELECT thread_json FROM threads WHERE thread_id = @threadId",
    ).get({ threadId });
    if (!row) {
      throw Object.assign(new Error(`Missing thread ${threadId}.`), {
        issue: <StewardIssue>{
          code: "SQLITE_STORE_UNAVAILABLE",
          message: `Thread ${threadId} does not exist in SQLite storage.`,
          threadId,
        },
      });
    }

    return deserializeThreadRecord(JSON.parse(row.thread_json) as SerializedThreadRecord);
  }

  private readProjectionRecords(db: Database.Database, threadId: string): ProjectionRevisionRecord[] {
    return db.prepare<[{ threadId: string }], ProjectionRow>(
      "SELECT projection_json FROM projection_revisions WHERE thread_id = @threadId ORDER BY created_at ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.projection_json) as ProjectionRevisionRecord);
  }

  private readSnapshot(db: Database.Database, threadId: string): ThreadSnapshot {
    const thread = this.readThreadRecord(db, threadId);
    const actors = db.prepare<[{ threadId: string }], ActorRow>(
      "SELECT actor_json FROM actors WHERE thread_id = @threadId ORDER BY actor_id ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.actor_json) as ActorRecord);
    const messages = db.prepare<[{ threadId: string }], MessageRow>(
      "SELECT message_json FROM messages WHERE thread_id = @threadId ORDER BY source_order ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.message_json) as MessageRecord);
    const turns = db.prepare<[{ threadId: string }], TurnRow>(
      "SELECT turn_json FROM turns WHERE thread_id = @threadId ORDER BY turn_order ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.turn_json) as TurnRecord);
    const imports = db.prepare<[{ threadId: string }], ImportRow>(
      "SELECT import_json FROM imports WHERE thread_id = @threadId ORDER BY imported_at ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.import_json) as ImportRecord);
    const projections = db.prepare<[{ threadId: string }], ProjectionRow>(
      "SELECT projection_json FROM projection_revisions WHERE thread_id = @threadId ORDER BY created_at ASC",
    ).all({ threadId }).map((row) => JSON.parse(row.projection_json) as ProjectionRevisionRecord);

    return {
      thread: hydrateThreadRecord(thread, messages, imports, projections),
      actors,
      messages,
      turns,
      imports,
      projections,
    };
  }

  private requireMutableThread(db: Database.Database, threadId: string): ThreadRecord {
    const thread = this.readThreadRecord(db, threadId);
    const schemaCheck = assertSupportedThreadSchemaVersion(thread);
    if (!schemaCheck.ok) {
      throw Object.assign(new Error(schemaCheck.issues[0].message), { issue: schemaCheck.issues[0] });
    }

    return thread;
  }

  private async withThreadMutation<T>(
    threadId: string,
    run: () => Promise<StewardResult<T>> | StewardResult<T>,
  ): Promise<StewardResult<T>> {
    const previous = SqliteThreadStore.globalThreadQueues.get(threadId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => current);
    SqliteThreadStore.globalThreadQueues.set(threadId, chain);

    await previous.catch(() => undefined);

    try {
      return await run();
    } finally {
      releaseQueue();
      if (SqliteThreadStore.globalThreadQueues.get(threadId) === chain) {
        SqliteThreadStore.globalThreadQueues.delete(threadId);
      }
    }
  }
}

export {
  SQLITE_THREAD_FILENAME,
};
