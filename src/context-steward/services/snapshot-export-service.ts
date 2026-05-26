import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";

import { fail, ok, type StewardResult } from "../domain/errors.js";
import type { ThreadRecord } from "../domain/records.js";
import type { ThreadStore } from "../store/thread-store.js";
import { resolveThreadSqlitePath } from "../store/sqlite-thread-store.js";

export interface ManagedThreadSnapshotManifest {
  version: 1;
  exportKind: "sqlite_thread_snapshot" | "legacy_debug_export";
  createdAt: string;
  threadId: string;
  canonicalSource: {
    relativePath: "thread.sqlite";
    ownership: "authoritative_managed_source";
  };
  generatedArtifacts: Array<{
    relativePath: string;
    recordedPath?: string;
    status: "included" | "missing";
    ownership: "generated_projection";
  }>;
  legacyDebugArtifacts: Array<{
    relativePath: string;
    class: "canonical" | "derived" | "projection";
    ownership: "non_authoritative_legacy_export";
  }>;
  counts: {
    messages: number;
    turns: number;
    chunks: number;
    degradedCount: number;
    repairNeededCount: number;
  };
  sourceRevision: number;
  messageHighWatermark: number;
  warnings: string[];
}

export interface CreateManagedThreadSnapshotInput {
  store: ThreadStore;
  storeRootDir: string;
  threadId: string;
  outputDir: string;
  now?: () => Date;
}

export interface CreateManagedThreadSnapshotResult {
  snapshotDir: string;
  manifestPath: string;
  manifest: ManagedThreadSnapshotManifest;
}

export interface RestoreManagedThreadSnapshotInput {
  snapshotDir: string;
  targetStoreRootDir: string;
}

export interface RestoreManagedThreadSnapshotResult {
  threadId: string;
  threadDir: string;
  restoredFiles: string[];
}

export interface ExportLegacyThreadDebugBundleInput {
  store: ThreadStore;
  storeRootDir: string;
  threadId: string;
  outputDir: string;
  now?: () => Date;
}

export interface ExportLegacyThreadDebugBundleResult {
  exportDir: string;
  manifestPath: string;
  manifest: ManagedThreadSnapshotManifest;
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function summarizeStatuses(status: ThreadRecord["status"] | undefined): { degradedCount: number; repairNeededCount: number } {
  let degradedCount = 0;
  let repairNeededCount = 0;

  function walk(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }

    const statusValue = (value as { status?: unknown; state?: unknown }).status ?? (value as { state?: unknown }).state;
    if (statusValue === "degraded") {
      degradedCount += 1;
    }
    if (statusValue === "repair_needed") {
      repairNeededCount += 1;
    }

    for (const child of Object.values(value as Record<string, unknown>)) {
      walk(child);
    }
  }

  walk(status);
  return { degradedCount, repairNeededCount };
}

function firstGeneratedFilePath(thread: ThreadRecord): string | undefined {
  return thread.threadViewOutputSummary.generatedOutput?.generatedFilePath
    ?? thread.threadViewOutputSummary.currentGeneratedFilePath
    ?? thread.target.currentGeneratedFilePath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanDirectory(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, values: readonly unknown[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

function legacyArtifactManifestEntries(): ManagedThreadSnapshotManifest["legacyDebugArtifacts"] {
  return [
    { relativePath: "legacy-debug/thread.json", class: "canonical", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/actors.json", class: "canonical", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/messages.jsonl", class: "canonical", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/turns.json", class: "derived", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/chunks.json", class: "derived", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/imports.json", class: "canonical", ownership: "non_authoritative_legacy_export" },
    { relativePath: "legacy-debug/projections.json", class: "projection", ownership: "non_authoritative_legacy_export" },
  ];
}

async function copyGeneratedArtifacts(
  thread: ThreadRecord,
  outputDir: string,
  warnings: string[],
): Promise<ManagedThreadSnapshotManifest["generatedArtifacts"]> {
  const recordedPath = firstGeneratedFilePath(thread);
  if (!recordedPath) {
    warnings.push("No generated rollout is recorded on the managed thread.");
    return [];
  }

  const destinationRelativePath = join("generated", basename(recordedPath));
  const destinationPath = join(outputDir, destinationRelativePath);
  if (!(await pathExists(recordedPath))) {
    warnings.push(`Generated rollout is missing from disk: ${recordedPath}`);
    return [{
      relativePath: destinationRelativePath,
      recordedPath,
      status: "missing",
      ownership: "generated_projection",
    }];
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(recordedPath, destinationPath);
  return [{
    relativePath: destinationRelativePath,
    recordedPath,
    status: "included",
    ownership: "generated_projection",
  }];
}

async function buildSnapshotManifest(input: {
  exportKind: ManagedThreadSnapshotManifest["exportKind"];
  thread: ThreadRecord;
  messages: number;
  turns: number;
  chunks: number;
  warnings: string[];
  generatedArtifacts: ManagedThreadSnapshotManifest["generatedArtifacts"];
  includeLegacyDebugArtifacts: boolean;
  now?: () => Date;
}): Promise<ManagedThreadSnapshotManifest> {
  const { degradedCount, repairNeededCount } = summarizeStatuses(input.thread.status);

  return {
    version: 1,
    exportKind: input.exportKind,
    createdAt: nowIso(input.now),
    threadId: input.thread.threadId,
    canonicalSource: {
      relativePath: "thread.sqlite",
      ownership: "authoritative_managed_source",
    },
    generatedArtifacts: input.generatedArtifacts,
    legacyDebugArtifacts: input.includeLegacyDebugArtifacts ? legacyArtifactManifestEntries() : [],
    counts: {
      messages: input.messages,
      turns: input.turns,
      chunks: input.chunks,
      degradedCount,
      repairNeededCount,
    },
    sourceRevision: input.thread.sourceRevision,
    messageHighWatermark: input.thread.messageHighWatermark,
    warnings: [...input.warnings],
  };
}

export async function createManagedThreadSnapshot(
  input: CreateManagedThreadSnapshotInput,
): Promise<StewardResult<CreateManagedThreadSnapshotResult>> {
  const compact = await input.store.readCompactSnapshot(input.threadId);
  if (!compact.ok) {
    return compact;
  }

  const sqlitePath = resolveThreadSqlitePath(input.storeRootDir, input.threadId);
  if (!(await pathExists(sqlitePath))) {
    return fail({
      code: "SQLITE_STORE_UNAVAILABLE",
      message: `Managed SQLite thread file is missing for ${input.threadId}.`,
      threadId: input.threadId,
    });
  }

  const snapshotDir = resolve(input.outputDir);
  const warnings: string[] = [];
  await ensureCleanDirectory(snapshotDir);
  await copyFile(sqlitePath, join(snapshotDir, "thread.sqlite"));
  const generatedArtifacts = await copyGeneratedArtifacts(compact.value.thread, snapshotDir, warnings);

  const manifest = await buildSnapshotManifest({
    exportKind: "sqlite_thread_snapshot",
    thread: compact.value.thread,
    messages: compact.value.messages.length,
    turns: compact.value.turns.length,
    chunks: compact.value.chunks.length,
    warnings,
    generatedArtifacts,
    includeLegacyDebugArtifacts: false,
    now: input.now,
  });
  const manifestPath = join(snapshotDir, "manifest.json");
  await writeJson(manifestPath, manifest);

  return ok({
    snapshotDir,
    manifestPath,
    manifest,
  });
}

export async function restoreManagedThreadSnapshot(
  input: RestoreManagedThreadSnapshotInput,
): Promise<StewardResult<RestoreManagedThreadSnapshotResult>> {
  const snapshotDir = resolve(input.snapshotDir);
  const manifestPath = join(snapshotDir, "manifest.json");
  let manifest: ManagedThreadSnapshotManifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ManagedThreadSnapshotManifest;
  } catch (error) {
    return fail({
      code: "STORE_UNAVAILABLE",
      message: `Failed to read snapshot manifest at ${manifestPath}.`,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const threadDir = join(resolve(input.targetStoreRootDir), "threads", manifest.threadId);
  const restoredFiles: string[] = [];
  await mkdir(threadDir, { recursive: true });

  const sqliteSourcePath = join(snapshotDir, "thread.sqlite");
  const sqliteTargetPath = join(threadDir, "thread.sqlite");
  await copyFile(sqliteSourcePath, sqliteTargetPath);
  restoredFiles.push(sqliteTargetPath);

  const generatedDir = join(snapshotDir, "generated");
  if (await pathExists(generatedDir)) {
    const generatedEntries = await readdir(generatedDir).catch(() => []);
    for (const entry of generatedEntries) {
      const sourcePath = join(generatedDir, entry);
      const targetPath = join(threadDir, "generated", entry);
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      restoredFiles.push(targetPath);
    }
  }

  return ok({
    threadId: manifest.threadId,
    threadDir,
    restoredFiles,
  });
}

export async function exportLegacyThreadDebugBundle(
  input: ExportLegacyThreadDebugBundleInput,
): Promise<StewardResult<ExportLegacyThreadDebugBundleResult>> {
  const compact = await input.store.readCompactSnapshot(input.threadId);
  if (!compact.ok) {
    return compact;
  }

  const sqlitePath = resolveThreadSqlitePath(input.storeRootDir, input.threadId);
  if (!(await pathExists(sqlitePath))) {
    return fail({
      code: "SQLITE_STORE_UNAVAILABLE",
      message: `Managed SQLite thread file is missing for ${input.threadId}.`,
      threadId: input.threadId,
    });
  }

  const exportDir = resolve(input.outputDir);
  const legacyDir = join(exportDir, "legacy-debug");
  const warnings: string[] = [];
  await ensureCleanDirectory(exportDir);
  await copyFile(sqlitePath, join(exportDir, "thread.sqlite"));
  const generatedArtifacts = await copyGeneratedArtifacts(compact.value.thread, exportDir, warnings);

  await writeJson(join(legacyDir, "thread.json"), compact.value.thread);
  await writeJson(join(legacyDir, "actors.json"), compact.value.actors);
  await writeJsonl(join(legacyDir, "messages.jsonl"), compact.value.messages);
  await writeJson(join(legacyDir, "turns.json"), compact.value.turns);
  await writeJson(join(legacyDir, "chunks.json"), compact.value.chunks);
  await writeJson(join(legacyDir, "imports.json"), compact.value.imports);
  await writeJson(join(legacyDir, "projections.json"), compact.value.projections);

  const manifest = await buildSnapshotManifest({
    exportKind: "legacy_debug_export",
    thread: compact.value.thread,
    messages: compact.value.messages.length,
    turns: compact.value.turns.length,
    chunks: compact.value.chunks.length,
    warnings,
    generatedArtifacts,
    includeLegacyDebugArtifacts: true,
    now: input.now,
  });
  const manifestPath = join(exportDir, "manifest.json");
  await writeJson(manifestPath, manifest);

  return ok({
    exportDir,
    manifestPath,
    manifest,
  });
}
