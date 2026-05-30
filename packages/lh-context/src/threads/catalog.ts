import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

type UnknownRecord = Record<string, unknown>;

export type CatalogNameSource = "user" | "fallback" | "unknown";
export type CatalogObservationSource = "manual" | "refresh";
export type CatalogObservationStatus = "ok" | "unreadable" | "missing";

export interface ThreadCatalogRow {
  id?: number;
  threadId: string;
  name?: string;
  nameSource: CatalogNameSource;
  projectRoot?: string;
  projectName?: string;
  storeRoot?: string;
  threadDbPath: string;
  sessionId?: string;
  sessionFilePath?: string;
  currentGeneratedFilePath?: string;
  currentProjectionRevisionId?: string;
  sourceRevision?: number;
  updatedAt?: string;
  observedAt: string;
  messageCount: number;
  turnCount: number;
  chunkCount: number;
  projectionCount: number;
  generatedTokenCount?: number;
  turnState?: string;
  tokenCountingState?: string;
  maintenanceState?: string;
  compactStatus?: string;
  observationSource: CatalogObservationSource;
  observationStatus: CatalogObservationStatus;
  notes?: string;
}

export interface ThreadCatalogOptions {
  catalogDbPath?: string;
  now?: () => Date;
}

export interface UpsertThreadCatalogInput {
  threadDbPath: string;
  name?: string;
}

export interface GenerateThreadResumeCommandOptions {
  executable?: string;
  additionalArgs?: string[];
}

export interface ThreadResumeCommand {
  id?: number;
  threadId: string;
  name?: string;
  projectRoot: string;
  sessionId: string;
  sessionFilePath: string;
  currentGeneratedFilePath?: string;
  threadDbPath: string;
  executable: string;
  argv: string[];
  cwd: string;
  shellCommand: string;
}

interface ThreadCatalogSqlRow {
  id: number;
  thread_id: string;
  name: string | null;
  name_source: CatalogNameSource;
  project_root: string | null;
  project_name: string | null;
  store_root: string | null;
  thread_db_path: string;
  session_id: string | null;
  session_file_path: string | null;
  current_generated_file_path: string | null;
  current_projection_revision_id: string | null;
  source_revision: number | null;
  updated_at: string | null;
  observed_at: string;
  message_count: number;
  turn_count: number;
  chunk_count: number;
  projection_count: number;
  generated_token_count: number | null;
  turn_state: string | null;
  token_counting_state: string | null;
  maintenance_state: string | null;
  compact_status: string | null;
  observation_source: CatalogObservationSource;
  observation_status: CatalogObservationStatus;
  notes: string | null;
}

interface CanonicalThreadRow {
  thread_id: string;
  updated_at: string | null;
  source_revision: number | null;
  target_session_id: string | null;
  target_session_file_path: string | null;
  current_generated_file_path: string | null;
  thread_json: string;
}

interface ProjectionRevisionRow {
  revision_id: string;
  status: string | null;
  generated_file_path: string | null;
  projection_json: string | null;
}

interface CanonicalSummary {
  threadId: string;
  fallbackName?: string;
  projectRoot?: string;
  projectName?: string;
  storeRoot?: string;
  threadDbPath: string;
  sessionId?: string;
  sessionFilePath?: string;
  currentGeneratedFilePath?: string;
  currentProjectionRevisionId?: string;
  sourceRevision?: number;
  updatedAt?: string;
  messageCount: number;
  turnCount: number;
  chunkCount: number;
  projectionCount: number;
  generatedTokenCount?: number;
  turnState?: string;
  tokenCountingState?: string;
  maintenanceState?: string;
  compactStatus?: string;
}

export class ThreadCatalogError extends Error {}

export class ThreadCatalogNotFoundError extends ThreadCatalogError {}

export class AmbiguousThreadCatalogReferenceError extends ThreadCatalogError {
  constructor(
    message: string,
    readonly matches: readonly ThreadCatalogRow[],
  ) {
    super(message);
  }
}

const CATALOG_SCHEMA_VERSION = 2;
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function defaultThreadCatalogPath(): string {
  return join(homedir(), ".pi-long-horizon", "catalog.sqlite");
}

export class ThreadCatalog {
  private readonly dbPath: string;
  private readonly now: () => Date;
  private db?: Database.Database;

  constructor(options: ThreadCatalogOptions = {}) {
    this.dbPath = resolve(options.catalogDbPath ?? defaultThreadCatalogPath());
    this.now = options.now ?? (() => new Date());
  }

  get catalogDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = undefined;
  }

  initialize(): void {
    this.database();
  }

  upsertFromThreadDb(input: UpsertThreadCatalogInput): ThreadCatalogRow {
    const summary = readCanonicalThreadSummary(resolve(input.threadDbPath));
    const previous = this.findByThreadId(summary.threadId);
    const nextRow = this.mergeSummary(summary, previous, "manual", input.name);
    this.writeRow(nextRow);
    return this.findByThreadId(summary.threadId) ?? nextRow;
  }

  refreshFromThreadDb(input: Pick<UpsertThreadCatalogInput, "threadDbPath">): ThreadCatalogRow {
    const summary = readCanonicalThreadSummary(resolve(input.threadDbPath));
    const previous = this.findByThreadId(summary.threadId);
    const nextRow = this.mergeSummary(summary, previous, "refresh");
    this.writeRow(nextRow);
    return this.findByThreadId(summary.threadId) ?? nextRow;
  }

  list(): ThreadCatalogRow[] {
    return this.database()
      .prepare<[], ThreadCatalogSqlRow>(
        `SELECT * FROM threads
         ORDER BY COALESCE(updated_at, observed_at) DESC, observed_at DESC, thread_id ASC`,
      )
      .all()
      .map(mapSqlRow);
  }

  show(reference: string): ThreadCatalogRow {
    return this.resolve(reference);
  }

  refresh(reference: string): ThreadCatalogRow {
    const current = this.resolve(reference);
    return this.refreshRow(current);
  }

  refreshAll(): ThreadCatalogRow[] {
    return this.list().map((row) => this.refreshRow(row));
  }

  generateResumeCommand(
    reference: string,
    options: GenerateThreadResumeCommandOptions = {},
  ): ThreadResumeCommand {
    const row = this.resolve(reference);
    const missingFacts = [
      row.projectRoot ? undefined : "projectRoot",
      row.sessionId ? undefined : "sessionId",
      row.sessionFilePath ? undefined : "sessionFilePath",
    ].filter((fact): fact is string => Boolean(fact));

    if (missingFacts.length > 0) {
      throw new ThreadCatalogError(
        `Cannot generate resume command for ${row.threadId}; missing ${missingFacts.join(", ")}.`,
      );
    }

    const executable = options.executable ?? "pi-lh";
    const argv = [
      executable,
      "--session",
      row.sessionFilePath!,
      ...(options.additionalArgs ?? []),
    ];

    return {
      id: row.id,
      threadId: row.threadId,
      name: row.name,
      projectRoot: row.projectRoot!,
      sessionId: row.sessionId!,
      sessionFilePath: row.sessionFilePath!,
      currentGeneratedFilePath: row.currentGeneratedFilePath,
      threadDbPath: row.threadDbPath,
      executable,
      argv,
      cwd: row.projectRoot!,
      shellCommand: `cd ${shellQuote(row.projectRoot!)} && ${argv.map(shellQuote).join(" ")}`,
    };
  }

  private refreshRow(current: ThreadCatalogRow): ThreadCatalogRow {
    if (!existsSync(current.threadDbPath)) {
      const missing = {
        ...current,
        observedAt: this.now().toISOString(),
        observationSource: "refresh" as const,
        observationStatus: "missing" as const,
        notes: undefined,
      };
      this.writeRow(missing);
      return this.findByThreadId(missing.threadId) ?? missing;
    }

    try {
      const summary = readCanonicalThreadSummary(current.threadDbPath);
      const nextRow = this.mergeSummary(summary, current, "refresh");
      this.writeRow(nextRow);
      return this.findByThreadId(nextRow.threadId) ?? nextRow;
    } catch (error) {
      const unreadable = {
        ...current,
        observedAt: this.now().toISOString(),
        observationSource: "refresh" as const,
        observationStatus: "unreadable" as const,
        notes: error instanceof Error ? error.message : String(error),
      };
      this.writeRow(unreadable);
      return this.findByThreadId(unreadable.threadId) ?? unreadable;
    }
  }

  private resolve(reference: string): ThreadCatalogRow {
    const needle = reference.trim();
    if (!needle) {
      throw new ThreadCatalogNotFoundError("Thread reference is required.");
    }

    const rows = this.list();
    if (/^\d+$/.test(needle)) {
      const catalogId = Number.parseInt(needle, 10);
      const catalogIdMatch = rows.find((row) => row.id === catalogId);
      if (catalogIdMatch) {
        return catalogIdMatch;
      }
    }

    const exactId = rows.find((row) => row.threadId === needle);
    if (exactId) {
      return exactId;
    }

    const idPrefixMatches = rows.filter((row) => row.threadId.startsWith(needle));
    if (idPrefixMatches.length === 1) {
      return idPrefixMatches[0]!;
    }
    if (idPrefixMatches.length > 1) {
      throw new AmbiguousThreadCatalogReferenceError(`Thread id prefix "${needle}" is ambiguous.`, idPrefixMatches);
    }

    const sessionPrefixMatches = rows.filter((row) => row.sessionId?.startsWith(needle));
    if (sessionPrefixMatches.length === 1) {
      return sessionPrefixMatches[0]!;
    }
    if (sessionPrefixMatches.length > 1) {
      throw new AmbiguousThreadCatalogReferenceError(
        `Session id prefix "${needle}" is ambiguous.`,
        sessionPrefixMatches,
      );
    }

    const exactNameMatches = rows.filter((row) => row.name === needle);
    if (exactNameMatches.length === 1) {
      return exactNameMatches[0]!;
    }
    if (exactNameMatches.length > 1) {
      throw new AmbiguousThreadCatalogReferenceError(`Thread name "${needle}" is ambiguous.`, exactNameMatches);
    }

    const normalizedNeedle = needle.toLowerCase();
    const substringMatches = rows.filter((row) => row.name?.toLowerCase().includes(normalizedNeedle));
    if (substringMatches.length === 1) {
      return substringMatches[0]!;
    }
    if (substringMatches.length > 1) {
      throw new AmbiguousThreadCatalogReferenceError(`Thread name substring "${needle}" is ambiguous.`, substringMatches);
    }

    throw new ThreadCatalogNotFoundError(`No cataloged thread matches "${needle}".`);
  }

  private findByThreadId(threadId: string): ThreadCatalogRow | undefined {
    const row = this.database()
      .prepare<[string], ThreadCatalogSqlRow>("SELECT * FROM threads WHERE thread_id = ?")
      .get(threadId);
    return row ? mapSqlRow(row) : undefined;
  }

  private mergeSummary(
    summary: CanonicalSummary,
    previous: ThreadCatalogRow | undefined,
    observationSource: CatalogObservationSource,
    requestedName?: string,
  ): ThreadCatalogRow {
    const trimmedRequestedName = normalizeText(requestedName);
    const name = trimmedRequestedName ?? (previous?.nameSource === "user" ? previous.name : summary.fallbackName);
    const nameSource: CatalogNameSource = trimmedRequestedName ? "user" : previous?.nameSource === "user" ? "user" : name
      ? "fallback"
      : "unknown";

    return {
      id: previous?.id,
      threadId: summary.threadId,
      name,
      nameSource,
      projectRoot: summary.projectRoot,
      projectName: summary.projectName,
      storeRoot: summary.storeRoot,
      threadDbPath: summary.threadDbPath,
      sessionId: summary.sessionId,
      sessionFilePath: summary.sessionFilePath,
      currentGeneratedFilePath: summary.currentGeneratedFilePath,
      currentProjectionRevisionId: summary.currentProjectionRevisionId,
      sourceRevision: summary.sourceRevision,
      updatedAt: summary.updatedAt,
      observedAt: this.now().toISOString(),
      messageCount: summary.messageCount,
      turnCount: summary.turnCount,
      chunkCount: summary.chunkCount,
      projectionCount: summary.projectionCount,
      generatedTokenCount: summary.generatedTokenCount,
      turnState: summary.turnState,
      tokenCountingState: summary.tokenCountingState,
      maintenanceState: summary.maintenanceState,
      compactStatus: summary.compactStatus,
      observationSource,
      observationStatus: "ok",
      notes: undefined,
    };
  }

  private writeRow(row: ThreadCatalogRow): void {
    this.database()
      .prepare(
        `INSERT INTO threads (
          id,
          thread_id,
          name,
          name_source,
          project_root,
          project_name,
          store_root,
          thread_db_path,
          session_id,
          session_file_path,
          current_generated_file_path,
          current_projection_revision_id,
          source_revision,
          updated_at,
          observed_at,
          message_count,
          turn_count,
          chunk_count,
          projection_count,
          generated_token_count,
          turn_state,
          token_counting_state,
          maintenance_state,
          compact_status,
          observation_source,
          observation_status,
          notes
        ) VALUES (
          @id,
          @threadId,
          @name,
          @nameSource,
          @projectRoot,
          @projectName,
          @storeRoot,
          @threadDbPath,
          @sessionId,
          @sessionFilePath,
          @currentGeneratedFilePath,
          @currentProjectionRevisionId,
          @sourceRevision,
          @updatedAt,
          @observedAt,
          @messageCount,
          @turnCount,
          @chunkCount,
          @projectionCount,
          @generatedTokenCount,
          @turnState,
          @tokenCountingState,
          @maintenanceState,
          @compactStatus,
          @observationSource,
          @observationStatus,
          @notes
        )
        ON CONFLICT(thread_id) DO UPDATE SET
          name = excluded.name,
          name_source = excluded.name_source,
          project_root = excluded.project_root,
          project_name = excluded.project_name,
          store_root = excluded.store_root,
          thread_db_path = excluded.thread_db_path,
          session_id = excluded.session_id,
          session_file_path = excluded.session_file_path,
          current_generated_file_path = excluded.current_generated_file_path,
          current_projection_revision_id = excluded.current_projection_revision_id,
          source_revision = excluded.source_revision,
          updated_at = excluded.updated_at,
          observed_at = excluded.observed_at,
          message_count = excluded.message_count,
          turn_count = excluded.turn_count,
          chunk_count = excluded.chunk_count,
          projection_count = excluded.projection_count,
          generated_token_count = excluded.generated_token_count,
          turn_state = excluded.turn_state,
          token_counting_state = excluded.token_counting_state,
          maintenance_state = excluded.maintenance_state,
          compact_status = excluded.compact_status,
          observation_source = excluded.observation_source,
          observation_status = excluded.observation_status,
          notes = excluded.notes`,
      )
      .run(toSqlParams(row));
  }

  private database(): Database.Database {
    if (this.db) {
      return this.db;
    }

    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new Database(this.dbPath, { timeout: SQLITE_BUSY_TIMEOUT_MS });
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    runCatalogMigrations(db);
    this.db = db;
    return db;
  }
}

function runCatalogMigrations(db: Database.Database): void {
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

  for (const version of appliedVersions) {
    if (version > CATALOG_SCHEMA_VERSION) {
      throw new ThreadCatalogError(
        `Thread catalog schema version ${version} is newer than supported version ${CATALOG_SCHEMA_VERSION}.`,
      );
    }
  }

  if (!appliedVersions.has(1)) {
    const transaction = db.transaction(() => {
      if (hasCatalogMigration(db, 1)) {
        return;
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          thread_id TEXT PRIMARY KEY,
          name TEXT,
          name_source TEXT NOT NULL CHECK (name_source IN ('user', 'fallback', 'unknown')),
          project_root TEXT,
          project_name TEXT,
          store_root TEXT,
          thread_db_path TEXT NOT NULL,
          session_id TEXT,
          session_file_path TEXT,
          current_generated_file_path TEXT,
          current_projection_revision_id TEXT,
          source_revision INTEGER,
          updated_at TEXT,
          observed_at TEXT NOT NULL,
          message_count INTEGER NOT NULL,
          turn_count INTEGER NOT NULL,
          chunk_count INTEGER NOT NULL,
          projection_count INTEGER NOT NULL,
          generated_token_count INTEGER,
          turn_state TEXT,
          token_counting_state TEXT,
          maintenance_state TEXT,
          compact_status TEXT,
          observation_source TEXT NOT NULL CHECK (observation_source IN ('manual', 'refresh')),
          observation_status TEXT NOT NULL CHECK (observation_status IN ('ok', 'unreadable', 'missing')),
          notes TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_thread_catalog_observed_at
          ON threads(observed_at);

        CREATE INDEX IF NOT EXISTS idx_thread_catalog_name
          ON threads(name);

        CREATE INDEX IF NOT EXISTS idx_thread_catalog_session_id
          ON threads(session_id);
      `);

      db.prepare<[number, string, string]>(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(1, "manual-thread-catalog-v1", new Date().toISOString());
    });

    transaction.immediate();
    appliedVersions.add(1);
  }

  if (appliedVersions.has(2)) {
    return;
  }

  const transaction = db.transaction(() => {
    if (hasCatalogMigration(db, 2)) {
      return;
    }

    db.exec(`
      DROP INDEX IF EXISTS idx_thread_catalog_observed_at;
      DROP INDEX IF EXISTS idx_thread_catalog_name;
      DROP INDEX IF EXISTS idx_thread_catalog_session_id;

      CREATE TABLE threads_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL UNIQUE,
        name TEXT,
        name_source TEXT NOT NULL CHECK (name_source IN ('user', 'fallback', 'unknown')),
        project_root TEXT,
        project_name TEXT,
        store_root TEXT,
        thread_db_path TEXT NOT NULL,
        session_id TEXT,
        session_file_path TEXT,
        current_generated_file_path TEXT,
        current_projection_revision_id TEXT,
        source_revision INTEGER,
        updated_at TEXT,
        observed_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        turn_count INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        projection_count INTEGER NOT NULL,
        generated_token_count INTEGER,
        turn_state TEXT,
        token_counting_state TEXT,
        maintenance_state TEXT,
        compact_status TEXT,
        observation_source TEXT NOT NULL CHECK (observation_source IN ('manual', 'refresh')),
        observation_status TEXT NOT NULL CHECK (observation_status IN ('ok', 'unreadable', 'missing')),
        notes TEXT
      ) STRICT;
    `);

    db.exec(`
      INSERT INTO threads_v2 (
        thread_id,
        name,
        name_source,
        project_root,
        project_name,
        store_root,
        thread_db_path,
        session_id,
        session_file_path,
        current_generated_file_path,
        current_projection_revision_id,
        source_revision,
        updated_at,
        observed_at,
        message_count,
        turn_count,
        chunk_count,
        projection_count,
        generated_token_count,
        turn_state,
        token_counting_state,
        maintenance_state,
        compact_status,
        observation_source,
        observation_status,
        notes
      )
      SELECT
        thread_id,
        name,
        name_source,
        project_root,
        project_name,
        store_root,
        thread_db_path,
        session_id,
        session_file_path,
        current_generated_file_path,
        current_projection_revision_id,
        source_revision,
        updated_at,
        observed_at,
        message_count,
        turn_count,
        chunk_count,
        projection_count,
        generated_token_count,
        turn_state,
        token_counting_state,
        maintenance_state,
        compact_status,
        observation_source,
        observation_status,
        notes
      FROM threads
      ORDER BY COALESCE(updated_at, observed_at) DESC, observed_at DESC, thread_id ASC;

      DROP TABLE threads;
      ALTER TABLE threads_v2 RENAME TO threads;

      CREATE INDEX IF NOT EXISTS idx_thread_catalog_observed_at
        ON threads(observed_at);

      CREATE INDEX IF NOT EXISTS idx_thread_catalog_name
        ON threads(name);

      CREATE INDEX IF NOT EXISTS idx_thread_catalog_session_id
        ON threads(session_id);
    `);

    db.prepare<[number, string, string]>(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(2, "manual-thread-catalog-row-ids", new Date().toISOString());
  });

  transaction.immediate();
}

function hasCatalogMigration(db: Database.Database, version: number): boolean {
  return Boolean(
    db.prepare<[number], { version: number }>("SELECT version FROM schema_migrations WHERE version = ?").get(version),
  );
}

function readCanonicalThreadSummary(threadDbPath: string): CanonicalSummary {
  const db = new Database(threadDbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });

  try {
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.pragma("query_only = ON");

    const row = db.prepare<[], CanonicalThreadRow>(
      `SELECT
        thread_id,
        updated_at,
        source_revision,
        target_session_id,
        target_session_file_path,
        current_generated_file_path,
        thread_json
      FROM threads
      ORDER BY updated_at DESC, thread_id ASC
      LIMIT 1`,
    ).get();

    if (!row) {
      throw new ThreadCatalogError(`No thread row found in ${threadDbPath}.`);
    }

    const thread = parseJsonRecord(row.thread_json, "threads.thread_json");
    const target = asRecord(thread.target);
    const outputSummary = asRecord(thread.threadViewOutputSummary);
    const generatedOutput = asRecord(outputSummary?.generatedOutput);
    const status = asRecord(thread.status);
    const tokenCounting = asRecord(status?.tokenCounting);
    const maintenance = asRecord(status?.maintenance);
    const latestProjection = readCurrentProjection(db, row.thread_id, asString(outputSummary?.currentProjectionRevisionId));
    const storeRoot = inferStoreRoot(threadDbPath, row.thread_id);
    const projectRoot = asString(target?.cwd) ?? (storeRoot ? dirname(storeRoot) : undefined);
    const projectName = projectRoot ? basename(projectRoot) : undefined;
    const firstPrompt = readFirstPromptSnippet(db, row.thread_id);
    const currentGeneratedFilePath =
      asString(outputSummary?.currentGeneratedFilePath) ??
      asString(generatedOutput?.generatedFilePath) ??
      row.current_generated_file_path ??
      asString(target?.currentGeneratedFilePath) ??
      latestProjection?.generated_file_path ??
      undefined;

    return {
      threadId: row.thread_id,
      fallbackName: buildFallbackName({ projectName, threadId: row.thread_id, firstPrompt }),
      projectRoot,
      projectName,
      storeRoot,
      threadDbPath,
      sessionId:
        row.target_session_id ??
        asString(target?.sessionId) ??
        asString(outputSummary?.currentGeneratedSessionId) ??
        asString(generatedOutput?.generatedSessionId),
      sessionFilePath: row.target_session_file_path ?? asString(target?.sessionFilePath),
      currentGeneratedFilePath,
      currentProjectionRevisionId:
        asString(outputSummary?.currentProjectionRevisionId) ??
        asString(generatedOutput?.projectionRevisionId) ??
        latestProjection?.revision_id,
      sourceRevision: row.source_revision ?? asNumber(thread.sourceRevision),
      updatedAt: row.updated_at ?? asString(thread.updatedAt),
      messageCount: countRows(db, "messages", row.thread_id),
      turnCount: countRows(db, "turns", row.thread_id),
      chunkCount: countRows(db, "chunks", row.thread_id),
      projectionCount: countRows(db, "projection_revisions", row.thread_id),
      generatedTokenCount: asNumber(generatedOutput?.generatedSessionTokenCount),
      turnState: asString(status?.turnState),
      tokenCountingState: asString(tokenCounting?.status),
      maintenanceState: summarizeMaintenanceState(maintenance),
      compactStatus:
        asString(generatedOutput?.status) ??
        asString(outputSummary?.lastRevisionStatus) ??
        latestProjection?.status ??
        undefined,
    };
  } finally {
    db.close();
  }
}

function readCurrentProjection(
  db: Database.Database,
  threadId: string,
  currentProjectionRevisionId: string | undefined,
): ProjectionRevisionRow | undefined {
  if (currentProjectionRevisionId) {
    const current = db.prepare<[string, string], ProjectionRevisionRow>(
      `SELECT revision_id, status, generated_file_path, projection_json
       FROM projection_revisions
       WHERE thread_id = ? AND revision_id = ?`,
    ).get(threadId, currentProjectionRevisionId);
    if (current) {
      return current;
    }
  }

  return db.prepare<[string], ProjectionRevisionRow>(
    `SELECT revision_id, status, generated_file_path, projection_json
     FROM projection_revisions
     WHERE thread_id = ?
     ORDER BY created_at DESC, revision_id DESC
     LIMIT 1`,
  ).get(threadId);
}

function countRows(db: Database.Database, tableName: string, threadId: string): number {
  const row = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE thread_id = ?`,
  ).get(threadId);
  return row?.count ?? 0;
}

function readFirstPromptSnippet(db: Database.Database, threadId: string): string | undefined {
  const row = db.prepare<[string], { message_json: string }>(
    `SELECT message_json
     FROM messages
     WHERE thread_id = ? AND message_kind = 'prompt'
     ORDER BY source_order ASC
     LIMIT 1`,
  ).get(threadId);

  if (!row) {
    return undefined;
  }

  const message = parseJsonRecord(row.message_json, "messages.message_json");
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const textParts = parts
    .map((part) => asRecord(part))
    .map((part) => part?.content)
    .filter((content): content is string => typeof content === "string");
  return truncateNameComponent(textParts.join(" "));
}

function buildFallbackName(input: {
  projectName: string | undefined;
  threadId: string;
  firstPrompt: string | undefined;
}): string {
  const prefix = input.projectName ?? "Long Horizon";
  return input.firstPrompt ? `${prefix}: ${input.firstPrompt}` : `${prefix} (${input.threadId.slice(0, 12)})`;
}

function summarizeMaintenanceState(record: UnknownRecord | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const manualRepair = asRecord(record.manualRepair);
  if (asString(manualRepair?.status) === "ready" && asNumber(manualRepair?.remainingDebtCount) === 0) {
    return "ready";
  }

  const statuses = ["prepare", "manualRepair", "background"]
    .map((key) => asRecord(record[key]))
    .map((entry) => asString(entry?.status))
    .filter((status): status is string => Boolean(status));
  return statuses.length > 0 ? statuses.join(",") : undefined;
}

function inferStoreRoot(threadDbPath: string, threadId: string): string | undefined {
  const threadDir = dirname(threadDbPath);
  if (basename(threadDir) !== threadId) {
    return undefined;
  }

  const threadsDir = dirname(threadDir);
  if (basename(threadsDir) !== "threads") {
    return undefined;
  }

  return dirname(threadsDir);
}

function parseJsonRecord(json: string, label: string): UnknownRecord {
  const parsed = JSON.parse(json) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new ThreadCatalogError(`${label} is not a JSON object.`);
  }
  return record;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function truncateNameComponent(value: string | undefined): string | undefined {
  const normalized = normalizeText(value?.replace(/\s+/g, " "));
  if (!normalized) {
    return undefined;
  }

  return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toSqlParams(row: ThreadCatalogRow): Record<string, string | number | null> {
  return {
    id: row.id ?? null,
    threadId: row.threadId,
    name: row.name ?? null,
    nameSource: row.nameSource,
    projectRoot: row.projectRoot ?? null,
    projectName: row.projectName ?? null,
    storeRoot: row.storeRoot ?? null,
    threadDbPath: row.threadDbPath,
    sessionId: row.sessionId ?? null,
    sessionFilePath: row.sessionFilePath ?? null,
    currentGeneratedFilePath: row.currentGeneratedFilePath ?? null,
    currentProjectionRevisionId: row.currentProjectionRevisionId ?? null,
    sourceRevision: row.sourceRevision ?? null,
    updatedAt: row.updatedAt ?? null,
    observedAt: row.observedAt,
    messageCount: row.messageCount,
    turnCount: row.turnCount,
    chunkCount: row.chunkCount,
    projectionCount: row.projectionCount,
    generatedTokenCount: row.generatedTokenCount ?? null,
    turnState: row.turnState ?? null,
    tokenCountingState: row.tokenCountingState ?? null,
    maintenanceState: row.maintenanceState ?? null,
    compactStatus: row.compactStatus ?? null,
    observationSource: row.observationSource,
    observationStatus: row.observationStatus,
    notes: row.notes ?? null,
  };
}

function mapSqlRow(row: ThreadCatalogSqlRow): ThreadCatalogRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    name: row.name ?? undefined,
    nameSource: row.name_source,
    projectRoot: row.project_root ?? undefined,
    projectName: row.project_name ?? undefined,
    storeRoot: row.store_root ?? undefined,
    threadDbPath: row.thread_db_path,
    sessionId: row.session_id ?? undefined,
    sessionFilePath: row.session_file_path ?? undefined,
    currentGeneratedFilePath: row.current_generated_file_path ?? undefined,
    currentProjectionRevisionId: row.current_projection_revision_id ?? undefined,
    sourceRevision: row.source_revision ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    observedAt: row.observed_at,
    messageCount: row.message_count,
    turnCount: row.turn_count,
    chunkCount: row.chunk_count,
    projectionCount: row.projection_count,
    generatedTokenCount: row.generated_token_count ?? undefined,
    turnState: row.turn_state ?? undefined,
    tokenCountingState: row.token_counting_state ?? undefined,
    maintenanceState: row.maintenance_state ?? undefined,
    compactStatus: row.compact_status ?? undefined,
    observationSource: row.observation_source,
    observationStatus: row.observation_status,
    notes: row.notes ?? undefined,
  };
}
