import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { LhxError } from "../errors/errors.js";
import type { InspectInput } from "../types/public.js";

type BetterSqlite3Constructor = typeof import("better-sqlite3");
type BetterSqlite3Database = import("better-sqlite3").Database;
type BetterSqlite3Namespace = { default: BetterSqlite3Constructor };

const SQLITE_THREAD_FILENAME = "thread.sqlite";
let betterSqlite3ModulePromise: Promise<BetterSqlite3Constructor> | undefined;
let betterSqlite3LoaderForTest: (() => Promise<BetterSqlite3Constructor>) | undefined;

export async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonl(filePath: string): Promise<unknown[]> {
  if (!(await exists(filePath))) return [];
  const text = await readFile(filePath, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function maybeReadJson<T = unknown>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) return undefined;
  return readJson<T>(filePath);
}

export interface LoadedThread {
  backing: "file" | "sqlite";
  rootDir: string;
  contextStewardDir: string;
  threadDir: string;
  threadId: string;
  thread: any;
  turns: any[];
  chunks: any[];
  messages: any[];
  generatedFilePath?: string;
  generatedRecords: any[];
  warnings: string[];
}

interface ThreadDirLoadResult {
  backing: LoadedThread["backing"];
  thread: any;
  turns: any[];
  chunks: any[];
  messages: any[];
  warnings: string[];
}

interface ThreadDirCandidate {
  dir: string;
  threadId: string;
  updatedAt: string;
  mtimeMs: number;
  hasGeneratedThreadView: boolean;
}

export async function loadThread(input: InspectInput, options: { preferGeneratedThreadView?: boolean } = {}): Promise<LoadedThread> {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const contextStewardDir = path.join(rootDir, ".context-steward");
  const threadDir = input.threadDir
    ? path.resolve(input.threadDir)
    : await resolveThreadDir(contextStewardDir, input.threadId, rootDir, input.backing ?? "auto", options);
  const loadedThread = await loadThreadDir(threadDir, input.backing ?? "auto");
  const threadId = input.threadId ?? loadedThread.thread.threadId ?? path.basename(threadDir);
  const { generatedFilePath, generatedRecords, warnings } = await resolveGeneratedThreadView({
    input,
    rootDir,
    threadDir,
    thread: loadedThread.thread,
  });
  return {
    backing: loadedThread.backing,
    rootDir,
    contextStewardDir,
    threadDir,
    threadId,
    thread: loadedThread.thread,
    turns: loadedThread.turns,
    chunks: loadedThread.chunks,
    messages: loadedThread.messages,
    generatedFilePath,
    generatedRecords,
    warnings: [...loadedThread.warnings, ...warnings],
  };
}

async function resolveThreadDir(
  contextStewardDir: string,
  threadId: string | undefined,
  rootDir: string,
  backing: NonNullable<InspectInput["backing"]>,
  options: { preferGeneratedThreadView?: boolean },
): Promise<string> {
  const threadsDir = path.join(contextStewardDir, "threads");
  if (threadId) return path.join(threadsDir, threadId);
  if (!(await exists(threadsDir))) throw new LhxError(`No Context Steward threads directory at ${threadsDir}`, "NO_THREADS_DIR");
  const entries = await readdir(threadsDir);
  const candidates: ThreadDirCandidate[] = [];
  let sqliteOnlyThreadDetected = false;
  let firstSqliteReadError: LhxError | undefined;
  for (const entry of entries.sort()) {
    const dir = path.join(threadsDir, entry);
    const s = await stat(dir).catch(() => undefined);
    if (!s?.isDirectory()) continue;
    const fileThread = await maybeReadJson<any>(path.join(dir, "thread.json"));
    const sqlitePath = path.join(dir, SQLITE_THREAD_FILENAME);
    const hasSqlite = await exists(sqlitePath);

    if (backing !== "file" && hasSqlite) {
      let sqliteThread: any;
      try {
        sqliteThread = await readThreadRecordFromSqlite(sqlitePath);
      } catch (error) {
        if (error instanceof LhxError) {
          firstSqliteReadError ??= error;
          sqliteOnlyThreadDetected = true;
          continue;
        }
        throw error;
      }
      sqliteOnlyThreadDetected = true;
      candidates.push({
        dir,
        threadId: sqliteThread.threadId ?? entry,
        updatedAt: sqliteThread.updatedAt ?? "",
        mtimeMs: s.mtimeMs,
        hasGeneratedThreadView: await generatedThreadViewExists(rootDir, sqliteThread),
      });
      continue;
    }

    if (!fileThread) {
      continue;
    }
    candidates.push({
      dir,
      threadId: fileThread.threadId ?? entry,
      updatedAt: fileThread.updatedAt ?? "",
      mtimeMs: s.mtimeMs,
      hasGeneratedThreadView: await generatedThreadViewExists(rootDir, fileThread),
    });
  }
  if (candidates.length === 0) {
    if (backing !== "file" && firstSqliteReadError) {
      throw firstSqliteReadError;
    }
    throw new LhxError(
      sqliteOnlyThreadDetected
        ? `No readable managed threads found under ${threadsDir}.`
        : `No thread.json or ${SQLITE_THREAD_FILENAME} files found under ${threadsDir}`,
      "NO_THREADS",
      {
        kind: "no_threads",
        threadsDir,
      },
    );
  }
  candidates.sort((a, b) => ((options.preferGeneratedThreadView ? Number(b.hasGeneratedThreadView) - Number(a.hasGeneratedThreadView) : 0) || b.updatedAt.localeCompare(a.updatedAt) || a.threadId.localeCompare(b.threadId) || b.mtimeMs - a.mtimeMs));
  return candidates[0]!.dir;
}

function dualSourceWarning(threadDir: string, selectedBacking: LoadedThread["backing"]): string {
  const action =
    selectedBacking === "sqlite"
      ? "Treating thread.sqlite as authoritative; remove or quarantine the legacy JSON files before active runtime use."
      : "Forcing legacy JSON inspection because backing=file was requested; use backing=sqlite or backing=auto to inspect the authoritative post-cutover state.";
  return `Both legacy JSON and ${SQLITE_THREAD_FILENAME} are present under ${threadDir}. ${action}`;
}

async function loadFileThread(threadDir: string): Promise<Pick<LoadedThread, "thread" | "turns" | "chunks" | "messages">> {
  return {
    thread: await readJson<any>(path.join(threadDir, "thread.json")),
    turns: (await maybeReadJson<any[]>(path.join(threadDir, "turns.json"))) ?? [],
    chunks: (await maybeReadJson<any[]>(path.join(threadDir, "chunks.json"))) ?? [],
    messages: await readJsonl(path.join(threadDir, "messages.jsonl")),
  };
}

async function loadThreadDir(
  threadDir: string,
  backing: NonNullable<InspectInput["backing"]>,
): Promise<ThreadDirLoadResult> {
  const fileThreadPath = path.join(threadDir, "thread.json");
  const sqliteThreadPath = path.join(threadDir, SQLITE_THREAD_FILENAME);
  const hasLegacyFile = await exists(fileThreadPath);
  const hasSqlite = await exists(sqliteThreadPath);
  const warnings: string[] = [];

  if (backing === "file") {
    if (!hasLegacyFile) {
      throw new LhxError(`No thread.json found under ${threadDir}`, "NO_THREAD_DATA", {
        kind: "thread_missing",
        threadDir,
        backing,
      });
    }
    if (hasSqlite) {
      warnings.push(dualSourceWarning(threadDir, "file"));
    }
    return {
      backing: "file",
      ...(await loadFileThread(threadDir)),
      warnings,
    };
  }

  if (hasSqlite) {
    if (hasLegacyFile) {
      warnings.push(dualSourceWarning(threadDir, "sqlite"));
    }
    return {
      backing: "sqlite",
      ...(await loadSqliteThread(sqliteThreadPath)),
      warnings,
    };
  }

  if (hasLegacyFile) {
    return {
      backing: "file",
      ...(await loadFileThread(threadDir)),
      warnings,
    };
  }

  throw new LhxError(`No thread.json or ${SQLITE_THREAD_FILENAME} found under ${threadDir}`, "NO_THREAD_DATA", {
    kind: "thread_missing",
    threadDir,
    backing,
  });
}

async function generatedThreadViewExists(rootDir: string, thread: any): Promise<boolean> {
  const raw = thread?.target?.currentGeneratedFilePath;
  if (typeof raw !== "string" || raw.length === 0) return false;
  const filePath = path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
  return exists(filePath);
}

async function readThreadRecordFromSqlite(sqlitePath: string): Promise<any> {
  try {
    const db = await openSqliteDatabase(sqlitePath);
    try {
      return readRequiredJsonRow<any>(db, "SELECT thread_json AS json FROM threads LIMIT 1", sqlitePath, "thread");
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof LhxError) {
      throw error;
    }

    throw new LhxError(`Failed to inspect SQLite-backed thread at ${sqlitePath}`, "SQLITE_THREAD_READ_FAILED", {
      kind: "sqlite_thread_read_failed",
      sqlitePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadSqliteThread(sqlitePath: string): Promise<Pick<LoadedThread, "thread" | "turns" | "chunks" | "messages">> {
  const db = await openSqliteDatabase(sqlitePath);
  try {
    const thread = readRequiredJsonRow<any>(db, "SELECT thread_json AS json FROM threads LIMIT 1", sqlitePath, "thread");
    const turns = readJsonRows<any>(db, "SELECT turn_json AS json FROM turns ORDER BY turn_order ASC, turn_id ASC");
    const chunks = readJsonRows<any>(db, "SELECT chunk_json AS json FROM chunks ORDER BY chunk_position ASC, chunk_id ASC");
    const messages = readJsonRows<any>(db, "SELECT message_json AS json FROM messages ORDER BY source_order ASC, message_id ASC");
    return { thread, turns, chunks, messages };
  } finally {
    db.close();
  }
}

async function openSqliteDatabase(sqlitePath: string): Promise<BetterSqlite3Database> {
  const BetterSqlite3 = await loadBetterSqlite3();
  return new BetterSqlite3(sqlitePath, { readonly: true, fileMustExist: true });
}

async function loadBetterSqlite3(): Promise<BetterSqlite3Constructor> {
  if (!betterSqlite3ModulePromise) {
    const loader = betterSqlite3LoaderForTest
      ?? (() => import("better-sqlite3")
        .then((module) => {
          const candidate = module as BetterSqlite3Constructor | BetterSqlite3Namespace;
          return typeof candidate === "function" ? candidate : candidate.default;
        }));
    betterSqlite3ModulePromise = loader().catch((error) => {
      if (error instanceof LhxError) {
        throw error;
      }

      throw new LhxError(
        "SQLite-backed inspection requires the optional better-sqlite3 dependency.",
        "SQLITE_DRIVER_UNAVAILABLE",
        {
          kind: "sqlite_driver_unavailable",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    });
  }

  return betterSqlite3ModulePromise;
}

interface GeneratedThreadViewResolutionInput {
  input: InspectInput;
  rootDir: string;
  threadDir: string;
  thread: any;
}

async function resolveGeneratedThreadView(
  input: GeneratedThreadViewResolutionInput,
): Promise<Pick<LoadedThread, "generatedFilePath" | "generatedRecords" | "warnings">> {
  const warnings: string[] = [];
  const explicitPath = input.input.threadViewPath ? path.resolve(input.input.threadViewPath) : undefined;
  const recordedPath = firstGeneratedThreadViewPath(input.thread, input.rootDir);

  if (explicitPath) {
    if (await exists(explicitPath)) {
      return { generatedFilePath: explicitPath, generatedRecords: await readJsonl(explicitPath), warnings };
    }

    warnings.push(`Generated thread-view file not found: ${explicitPath}`);
    return { generatedFilePath: undefined, generatedRecords: [], warnings };
  }

  if (recordedPath) {
    if (await exists(recordedPath)) {
      return { generatedFilePath: recordedPath, generatedRecords: await readJsonl(recordedPath), warnings };
    }

    warnings.push(`Generated thread-view file not found: ${recordedPath}`);
  }

  const bundledPath = await findBundledGeneratedThreadView(input.threadDir, recordedPath ?? explicitPath);
  if (bundledPath) {
    if (recordedPath || explicitPath) {
      warnings.push(`Using bundled generated thread-view file at ${bundledPath} because the recorded path is unavailable.`);
    }
    return { generatedFilePath: bundledPath, generatedRecords: await readJsonl(bundledPath), warnings };
  }

  if (!recordedPath && !explicitPath) {
    warnings.push("No generated thread-view file path found on input or thread target metadata.");
  }

  return { generatedFilePath: undefined, generatedRecords: [], warnings };
}

function firstGeneratedThreadViewPath(thread: any, rootDir: string): string | undefined {
  const candidates = [
    thread?.threadViewOutputSummary?.generatedOutput?.generatedFilePath,
    thread?.threadViewOutputSummary?.currentGeneratedFilePath,
    thread?.target?.currentGeneratedFilePath,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) {
      continue;
    }

    return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
  }

  return undefined;
}

async function findBundledGeneratedThreadView(threadDir: string, preferredPath: string | undefined): Promise<string | undefined> {
  const generatedDir = path.join(threadDir, "generated");
  if (!(await exists(generatedDir))) {
    return undefined;
  }

  const jsonlFiles = (await readdir(generatedDir))
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort((left, right) => left.localeCompare(right));
  if (jsonlFiles.length === 0) {
    return undefined;
  }

  const preferredBasename = preferredPath ? path.basename(preferredPath) : undefined;
  if (preferredBasename && jsonlFiles.includes(preferredBasename)) {
    return path.join(generatedDir, preferredBasename);
  }

  return path.join(generatedDir, jsonlFiles[0]!);
}

export function setBetterSqlite3LoaderForTest(
  loader: (() => Promise<BetterSqlite3Constructor>) | undefined,
): void {
  betterSqlite3LoaderForTest = loader;
  betterSqlite3ModulePromise = undefined;
}

function readRequiredJsonRow<T>(
  db: BetterSqlite3Database,
  sql: string,
  sqlitePath: string,
  label: string,
): T {
  const row = db.prepare(sql).get() as { json?: string } | undefined;
  if (!row?.json) {
    throw new LhxError(`SQLite-backed thread at ${sqlitePath} is missing ${label} state.`, "SQLITE_THREAD_READ_FAILED", {
      kind: "sqlite_thread_read_failed",
      sqlitePath,
      label,
    });
  }

  return JSON.parse(row.json) as T;
}

function readJsonRows<T>(db: BetterSqlite3Database, sql: string): T[] {
  return (db.prepare(sql).all() as Array<{ json?: string }>)
    .flatMap((row) => (row?.json ? [JSON.parse(row.json) as T] : []));
}
