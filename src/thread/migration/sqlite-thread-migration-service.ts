import { stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import Database from "better-sqlite3";

import {
  fail,
  ok,
  type StewardIssue,
  type StewardResult,
} from "../domain/errors.js";
import type {
  ActorRecord,
  ImportRecord,
  MessageRecord,
  ProjectionRevisionRecord,
  ThreadRecord,
  TurnRecord,
} from "../domain/records.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import {
  resolveThreadSqlitePath,
  seedSqliteThreadSnapshot,
} from "../store/sqlite-thread-store.js";
import type { ChunkState } from "../async-thread/domain/chunk-state.js";
import { isCanonicalChunkState } from "../async-thread/domain/chunk-state.js";
import { validateTokenCountRecord, type TokenCountRecord } from "../../token-accounting/token-count-metadata.js";

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
  partialStateHandling: MigrationPartialStateHandling;
  warnings: StewardIssue[];
  blockers: StewardIssue[];
  generatedRolloutPath?: string;
  readinessSummary: ThreadRecord["status"];
}

export interface MigrationPartialStateHandling {
  status: "clean_import" | "replaced_existing_import" | "replaced_partial_state";
  existingDbDetected: boolean;
  existingThreadPresent: boolean;
  existingCounts?: Record<string, number>;
  note: string;
}

interface MigrationSnapshot {
  thread: ThreadRecord;
  actors: ActorRecord[];
  messages: MessageRecord[];
  turns: TurnRecord[];
  chunks: ChunkState[];
  imports: ImportRecord[];
  projections: ProjectionRevisionRecord[];
}

function createIssue(
  code: StewardIssue["code"],
  message: string,
  input: Partial<StewardIssue> = {},
): StewardIssue {
  return {
    code,
    message,
    threadId: input.threadId,
    targetRuntime: input.targetRuntime,
    targetSessionId: input.targetSessionId,
    sourceRange: input.sourceRange ? { ...input.sourceRange } : undefined,
    cause: input.cause,
  };
}

function incrementCount(counts: Record<string, number>, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

function addTokenCountingIssue(thread: ThreadRecord, issue: StewardIssue): void {
  const existingIssues = thread.status.tokenCounting?.issues?.map((candidate) => ({ ...candidate })) ?? [];
  existingIssues.push(issue);
  thread.status.tokenCounting = {
    status: "repair_needed",
    updatedAt: thread.status.tokenCounting?.updatedAt ?? thread.updatedAt,
    sourceRevision: thread.status.tokenCounting?.sourceRevision ?? thread.sourceRevision,
    issueCount: existingIssues.length,
    issues: existingIssues,
  };
}

function validateTokenMetadata(
  thread: ThreadRecord,
  warnings: StewardIssue[],
  record: TokenCountRecord | undefined,
  context: string,
): void {
  if (!record) {
    return;
  }

  const validation = validateTokenCountRecord(record);
  if (validation.ok) {
    return;
  }

  const issue = createIssue(
    "TOKEN_COUNT_DEGRADED",
    `${context} imported with invalid token metadata: ${
      validation.issues.map((candidate) => candidate.code).join(", ")
    }.`,
    { threadId: thread.threadId, cause: context },
  );
  warnings.push(issue);
  addTokenCountingIssue(thread, issue);
}

function dedupeActors(
  threadId: string,
  actors: readonly ActorRecord[],
  warnings: StewardIssue[],
  skippedCounts: Record<string, number>,
): ActorRecord[] {
  const uniqueActors = new Map<string, ActorRecord>();
  for (const actor of actors) {
    const existing = uniqueActors.get(actor.actorId);
    if (!existing) {
      uniqueActors.set(actor.actorId, structuredClone(actor));
      continue;
    }

    incrementCount(skippedCounts, "actors");
    if (!isDeepStrictEqual(existing, actor)) {
      warnings.push(
        createIssue(
          "MIGRATION_VALIDATION_FAILED",
          `Actor ${actor.actorId} appeared multiple times with conflicting metadata; keeping the first record.`,
          { threadId, cause: actor.actorId },
        ),
      );
    }
  }

  return [...uniqueActors.values()].sort((left, right) => left.actorId.localeCompare(right.actorId));
}

function normalizeTurns(
  thread: ThreadRecord,
  turns: readonly TurnRecord[],
  messageIds: ReadonlySet<string>,
  warnings: StewardIssue[],
): TurnRecord[] {
  return [...turns]
    .sort((left, right) => left.turnOrder - right.turnOrder)
    .map((turn) => {
      const nextTurn = structuredClone(turn);
      const reasons: string[] = [];

      if (!messageIds.has(nextTurn.initiatingMessageId)) {
        reasons.push(`missing initiating message ${nextTurn.initiatingMessageId}`);
      }
      for (const messageId of nextTurn.messageIds) {
        if (!messageIds.has(messageId)) {
          reasons.push(`missing member message ${messageId}`);
        }
      }
      if (nextTurn.sourceRange.fromSourceOrder > nextTurn.sourceRange.toSourceOrder) {
        reasons.push("invalid source range ordering");
      }

      validateTokenMetadata(thread, warnings, nextTurn.rawTokenCountMetadata, `turn ${nextTurn.turnId} raw token count`);
      validateTokenMetadata(thread, warnings, nextTurn.smooth?.tokenCountMetadata, `turn ${nextTurn.turnId} smooth token count`);
      validateTokenMetadata(
        thread,
        warnings,
        nextTurn.smooth?.materialized?.tokenCountMetadata,
        `turn ${nextTurn.turnId} smooth materialized token count`,
      );
      validateTokenMetadata(
        thread,
        warnings,
        nextTurn.smooth?.lowerBandProjection?.tokenCountMetadata,
        `turn ${nextTurn.turnId} lower-band token count`,
      );

      if (nextTurn.smooth?.status === "ready") {
        if (!nextTurn.smooth.text || !nextTurn.smooth.sourceRevision || !nextTurn.smooth.strategy) {
          nextTurn.smooth.status = "stale";
          reasons.push("smooth artifact missing provenance");
          warnings.push(
            createIssue(
              "SMOOTH_INVALID",
              `Turn ${nextTurn.turnId} smooth artifact is missing provenance and was downgraded to stale.`,
              { threadId: thread.threadId, sourceRange: nextTurn.sourceRange, cause: nextTurn.turnId },
            ),
          );
        }
      }

      if (nextTurn.smooth?.lowerBandProjection?.status === "ready") {
        const projection = nextTurn.smooth.lowerBandProjection;
        if (!projection.text || !projection.sourceFingerprint || !projection.sourceRevision) {
          projection.status = "invalid";
          reasons.push("lower-band projection missing provenance");
          warnings.push(
            createIssue(
              "SMOOTH_INVALID",
              `Turn ${nextTurn.turnId} lower-band projection is missing provenance and was downgraded to invalid.`,
              { threadId: thread.threadId, sourceRange: nextTurn.sourceRange, cause: nextTurn.turnId },
            ),
          );
        }
      }

      if (reasons.length > 0) {
        nextTurn.repairStatus = "repair_needed";
        nextTurn.repairMetadata = {
          ...nextTurn.repairMetadata,
          sourceRevisionChecked: nextTurn.sourceRevision,
          sourceRange: { ...nextTurn.sourceRange },
          failureCode: "TURN_STATE_INCOMPLETE",
          failureReason: reasons.join("; "),
        };
        thread.status.turnState = "repair_needed";
        warnings.push(
          createIssue(
            "TURN_STATE_INCOMPLETE",
            `Turn ${nextTurn.turnId} imported as repair-needed: ${reasons.join("; ")}.`,
            { threadId: thread.threadId, sourceRange: nextTurn.sourceRange, cause: nextTurn.turnId },
          ),
        );
      }

      return nextTurn;
    });
}

function normalizeChunks(
  thread: ThreadRecord,
  chunks: readonly ChunkState[],
  warnings: StewardIssue[],
): ChunkState[] {
  return [...chunks].map((chunk) => {
    const nextChunk = structuredClone(chunk);

    validateTokenMetadata(thread, warnings, nextChunk.smoothTokenCountMetadata, `chunk ${nextChunk.chunkId} smooth token count`);

    if (isCanonicalChunkState(nextChunk)) {
      const transcript = nextChunk.conversationTranscript;
      if (transcript?.status === "ready" && (!transcript.text || !transcript.sourceFingerprint || !transcript.sourceRevision)) {
        transcript.status = "invalid";
        warnings.push(
          createIssue(
            "CHUNK_STATE_INVALID",
            `Chunk ${nextChunk.chunkId} transcript is missing provenance and was downgraded to invalid.`,
            { threadId: thread.threadId, cause: nextChunk.chunkId },
          ),
        );
      }

      for (const band of ["detailed", "brief"] as const) {
        const artifact = nextChunk.lowerBand?.[band];
        validateTokenMetadata(thread, warnings, artifact?.tokenCountMetadata, `chunk ${nextChunk.chunkId} ${band} token count`);
        if (artifact?.status === "ready" && (!artifact.text || !artifact.providerMetadata || !artifact.updatedAt)) {
          artifact.status = "pending";
          warnings.push(
            createIssue(
              "CHUNK_LOWER_BAND_MISSING",
              `Chunk ${nextChunk.chunkId} ${band} artifact is missing provenance and was downgraded to pending.`,
              { threadId: thread.threadId, cause: `${nextChunk.chunkId}:${band}` },
            ),
          );
        }
      }
      return nextChunk;
    }

    for (const kind of ["detailed", "brief"] as const) {
      const artifact = nextChunk.placeholders?.[kind];
      validateTokenMetadata(thread, warnings, artifact?.tokenCountMetadata, `chunk ${nextChunk.chunkId} ${kind} placeholder token count`);
      if (artifact?.status === "ready" && (!artifact.smoothSourceFingerprint || !artifact.smoothSourceRevision)) {
        artifact.status = "invalid";
        warnings.push(
          createIssue(
            "CHUNK_STATE_INVALID",
            `Legacy placeholder ${nextChunk.chunkId} ${kind} artifact is missing provenance and was downgraded to invalid.`,
            { threadId: thread.threadId, cause: `${nextChunk.chunkId}:${kind}` },
          ),
        );
      }
    }

    return nextChunk;
  });
}

async function buildMigrationSnapshot(
  input: ImportFileBackedThreadInput,
  warnings: StewardIssue[],
  skippedCounts: Record<string, number>,
): Promise<StewardResult<MigrationSnapshot>> {
  const fileStore = new FileThreadStore(input.rootDir);
  const snapshot = await fileStore.openThread(input.threadId);
  if (!snapshot.ok) {
    return fail(...snapshot.issues);
  }

  const chunksResult = await fileStore.readChunks(input.threadId);
  if (!chunksResult.ok) {
    return fail(...chunksResult.issues);
  }

  const thread = structuredClone(snapshot.value.thread);
  const actors = dedupeActors(thread.threadId, snapshot.value.actors, warnings, skippedCounts);
  const messages = [...snapshot.value.messages].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const messageIds = new Set(messages.map((message) => message.messageId));
  const turns = normalizeTurns(thread, snapshot.value.turns, messageIds, warnings);
  const chunks = normalizeChunks(thread, chunksResult.value, warnings);
  const imports = snapshot.value.imports.map((record) => structuredClone(record));
  const projections = await (async () => {
    const next: ProjectionRevisionRecord[] = [];
    for (const projection of snapshot.value.projections) {
      next.push(structuredClone(projection));
      try {
        await stat(projection.generatedFilePath);
      } catch {
        warnings.push(
          createIssue(
            "GENERATED_ROLLOUT_MISSING",
            `Projection ${projection.revisionId} points at missing generated rollout ${projection.generatedFilePath}.`,
            { threadId: thread.threadId, cause: projection.revisionId },
          ),
        );
      }
    }
    return next;
  })();

  validateTokenMetadata(
    thread,
    warnings,
    thread.threadViewOutputSummary.generatedOutput?.generatedSessionTokenCountMetadata,
    "generated output token count",
  );

  return ok({
    thread,
    actors,
    messages,
    turns,
    chunks,
    imports,
    projections,
  });
}

function buildImportedCounts(snapshot: MigrationSnapshot): Record<string, number> {
  return {
    threads: 1,
    actors: snapshot.actors.length,
    messages: snapshot.messages.length,
    messageParts: snapshot.messages.reduce((total, message) => total + message.parts.length, 0),
    turns: snapshot.turns.length,
    chunks: snapshot.chunks.length,
    imports: snapshot.imports.length,
    projections: snapshot.projections.length,
  };
}

async function targetDbAlreadyExists(dbPath: string): Promise<boolean> {
  try {
    await stat(dbPath);
    return true;
  } catch {
    return false;
  }
}

function closeInspectionDb(db: Database.Database | undefined): void {
  if (!db) {
    return;
  }

  try {
    db.close();
  } catch {
    return;
  }
}

function countsMatch(
  left: Readonly<Record<string, number>> | undefined,
  right: Readonly<Record<string, number>>,
): boolean {
  if (!left) {
    return false;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) {
      return false;
    }
  }

  return true;
}

async function inspectExistingPartialState(input: {
  dbPath: string;
  threadId: string;
  importedCounts: Record<string, number>;
}): Promise<MigrationPartialStateHandling> {
  if (!(await targetDbAlreadyExists(input.dbPath))) {
    return {
      status: "clean_import",
      existingDbDetected: false,
      existingThreadPresent: false,
      note: "No existing SQLite database was detected before migration.",
    };
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(input.dbPath, {
      fileMustExist: true,
      timeout: 5_000,
    });

    const tables = new Set(
      db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    const countRows = (table: string): number => {
      if (!tables.has(table)) {
        return 0;
      }

      const row = db!.prepare<[{ threadId: string }], { count: number }>(
        `SELECT COUNT(*) AS count FROM ${table} WHERE thread_id = @threadId`,
      ).get({ threadId: input.threadId });
      return row?.count ?? 0;
    };

    const messageParts = tables.has("messages")
      ? db.prepare<[{ threadId: string }], { message_json: string }>(
        "SELECT message_json FROM messages WHERE thread_id = @threadId",
      ).all({ threadId: input.threadId }).reduce((total, row) => {
        const message = JSON.parse(row.message_json) as MessageRecord;
        return total + message.parts.length;
      }, 0)
      : 0;

    const existingCounts = {
      threads: countRows("threads"),
      actors: countRows("actors"),
      messages: countRows("messages"),
      messageParts,
      turns: countRows("turns"),
      chunks: countRows("chunks"),
      imports: countRows("imports"),
      projections: countRows("projection_revisions"),
    };
    const existingThreadPresent = existingCounts.threads > 0;
    const status = countsMatch(existingCounts, input.importedCounts)
      ? "replaced_existing_import"
      : "replaced_partial_state";

    return {
      status,
      existingDbDetected: true,
      existingThreadPresent,
      existingCounts,
      note: status === "replaced_existing_import"
        ? `Existing SQLite state for thread ${input.threadId} already matched the migration entity counts and will be replaced idempotently.`
        : `Existing SQLite state for thread ${input.threadId} was partial or mismatched and will be fully replaced during migration retry.`,
    };
  } catch (error) {
    return {
      status: "replaced_partial_state",
      existingDbDetected: true,
      existingThreadPresent: false,
      note:
        `Existing SQLite database ${input.dbPath} could not be inspected cleanly before retry and will be treated as partial state: ${
          error instanceof Error ? error.message : String(error)
        }.`,
    };
  } finally {
    closeInspectionDb(db);
  }
}

export async function importFileBackedThread(
  input: ImportFileBackedThreadInput,
): Promise<StewardResult<ImportFileBackedThreadResult>> {
  const warnings: StewardIssue[] = [];
  const skippedCounts: Record<string, number> = {};

  const snapshotResult = await buildMigrationSnapshot(input, warnings, skippedCounts);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }

  const snapshot = snapshotResult.value;
  const dbPath = input.targetDbPath ?? resolveThreadSqlitePath(input.rootDir, input.threadId);
  const importedCounts = buildImportedCounts(snapshot);
  const partialStateHandling = await inspectExistingPartialState({
    dbPath,
    threadId: input.threadId,
    importedCounts,
  });

  if (partialStateHandling.existingDbDetected) {
    warnings.push(
      createIssue(
        "MIGRATION_VALIDATION_FAILED",
        partialStateHandling.status === "replaced_existing_import"
          ? `Target SQLite database ${dbPath} already contained imported state; replacing it idempotently for thread ${input.threadId}.`
          : `Target SQLite database ${dbPath} already existed with partial or mismatched state; replacing it for thread ${input.threadId}.`,
        { threadId: input.threadId, cause: dbPath },
      ),
    );
  }

  if (input.mode === "import") {
    const seeded = await seedSqliteThreadSnapshot({
      rootDir: input.rootDir,
      dbPath,
      thread: snapshot.thread,
      actors: snapshot.actors,
      messages: snapshot.messages,
      turns: snapshot.turns,
      chunks: snapshot.chunks,
      imports: snapshot.imports,
      projections: snapshot.projections,
    });
    if (!seeded.ok) {
      return seeded;
    }
  }

  const latestProjection = [...snapshot.projections]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);

  return ok(
    {
      threadId: input.threadId,
      dbPath,
      importedCounts,
      skippedCounts,
      partialStateHandling,
      warnings,
      blockers: [],
      generatedRolloutPath:
        snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath ??
        latestProjection?.generatedFilePath,
      readinessSummary: snapshot.thread.status,
    },
    warnings,
  );
}
