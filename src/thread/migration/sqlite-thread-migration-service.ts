import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import type { ThreadRecord } from "../domain/records.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import {
  resolveThreadSqlitePath,
  seedSqliteThreadSnapshot,
} from "../store/sqlite-thread-store.js";

export interface ImportFileBackedThreadInput {
  rootDir: string;
  threadId: string;
  sourceThreadDir?: string;
  targetDbPath?: string;
  mode: "validate_only" | "import";
}

export interface ImportFileBackedThreadResult {
  threadId: string;
  dbPath: string;
  importedCounts: Record<string, number>;
  skippedCounts: Record<string, number>;
  warnings: StewardIssue[];
  blockers: StewardIssue[];
  generatedRolloutPath?: string;
  readinessSummary: ThreadRecord["status"];
}

export async function importFileBackedThread(
  input: ImportFileBackedThreadInput,
): Promise<StewardResult<ImportFileBackedThreadResult>> {
  const fileStore = new FileThreadStore(input.rootDir);
  const snapshot = await fileStore.openThread(input.threadId);
  if (!snapshot.ok) {
    return fail(...snapshot.issues);
  }

  const warnings: StewardIssue[] = [];
  const skippedCounts: Record<string, number> = {};
  const importedCounts: Record<string, number> = {
    threads: 1,
    actors: snapshot.value.actors.length,
    messages: snapshot.value.messages.length,
  };
  if (snapshot.value.turns.length > 0) {
    skippedCounts.turns = snapshot.value.turns.length;
    warnings.push({
      code: "MIGRATION_VALIDATION_FAILED",
      message: `Skipped ${snapshot.value.turns.length} turn record(s) during Story 0 smoke import.`,
      threadId: input.threadId,
    });
  }
  if (snapshot.value.imports.length > 0) {
    skippedCounts.imports = snapshot.value.imports.length;
    warnings.push({
      code: "MIGRATION_VALIDATION_FAILED",
      message: `Skipped ${snapshot.value.imports.length} import audit record(s) during Story 0 smoke import.`,
      threadId: input.threadId,
    });
  }
  if (snapshot.value.projections.length > 0) {
    skippedCounts.projections = snapshot.value.projections.length;
    warnings.push({
      code: "MIGRATION_VALIDATION_FAILED",
      message: `Skipped ${snapshot.value.projections.length} projection record(s) during Story 0 smoke import.`,
      threadId: input.threadId,
    });
  }

  const dbPath = input.targetDbPath ?? resolveThreadSqlitePath(input.rootDir, input.threadId);

  if (input.mode === "import") {
    const seeded = await seedSqliteThreadSnapshot({
      rootDir: input.rootDir,
      dbPath,
      thread: snapshot.value.thread,
      actors: snapshot.value.actors,
      messages: snapshot.value.messages,
    });
    if (!seeded.ok) {
      return seeded;
    }
  }

  return ok({
    threadId: input.threadId,
    dbPath,
    importedCounts,
    skippedCounts,
    warnings,
    blockers: [],
    generatedRolloutPath: snapshot.value.thread.threadViewOutputSummary.currentGeneratedFilePath,
    readinessSummary: snapshot.value.thread.status,
  }, warnings);
}
