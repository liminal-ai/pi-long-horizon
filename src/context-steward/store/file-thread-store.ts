import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import {
  deriveTargetSessionKeys,
  sourceRangeContains,
  type TargetSessionKeySet,
  type ThreadTargetRef,
} from "../domain/ids.js";
import {
  THREAD_SCHEMA_VERSION,
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
import type {
  AppendMessageInput,
  CreateFixtureInput,
  CreateThreadInput,
  ThreadSnapshot,
  ThreadStore,
  UpdateThreadMetadataInput,
  WriteChunksInput,
  WriteTurnsInput,
} from "./thread-store.js";

interface ThreadFilePaths {
  threadDir: string;
  thread: string;
  actors: string;
  messages: string;
  turns: string;
  chunks: string;
  imports: string;
  projections: string;
}

interface FixtureFilePaths {
  fixtureDir: string;
  fixture: string;
  thread: string;
  actors: string;
  messages: string;
  turns: string;
  imports: string;
  projections: string;
}

interface ReconciledIndex {
  index: StewardRootIndex;
  changed: boolean;
}

interface ThreadMutationLeaseFile {
  token: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
}

function cloneIssue(issue: StewardIssue): StewardIssue {
  return {
    ...issue,
    sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
  };
}

function storeUnavailableIssue(error: unknown, context: string, threadId?: string): StewardIssue {
  const cause = error instanceof Error ? error.message : String(error);

  return {
    code: "STORE_UNAVAILABLE",
    message: `${context} failed.`,
    threadId,
    cause,
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

export class FileThreadStore implements ThreadStore {
  private static readonly globalThreadQueues = new Map<string, Promise<void>>();
  private static readonly mutationLeaseTimeoutMs = 30_000;
  private static readonly mutationLeaseRetryMs = 10;

  private readonly threadsDir: string;
  private readonly fixturesDir: string;
  private readonly indexPath: string;
  private readonly mutationLocksDir: string;

  constructor(private readonly rootDir: string) {
    this.threadsDir = join(rootDir, "threads");
    this.fixturesDir = join(rootDir, "fixtures");
    this.indexPath = join(rootDir, "index.json");
    this.mutationLocksDir = join(rootDir, ".thread-mutation-locks");
  }

  async createThread(input: CreateThreadInput): Promise<StewardResult<ThreadRecord>> {
    try {
      const indexResult = await this.ensureStoreReady();
      if (!indexResult.ok) {
        return indexResult;
      }

      const keySet = this.deriveKeys(input.targetRef);
      if (!keySet.ok) {
        return keySet;
      }

      const mappedThreadIds = this.findMappedThreadIds(indexResult.value, keySet.value);
      if (mappedThreadIds.size > 0) {
        return fail(
          targetAssociationConflict(
            `Target ${keySet.value.canonicalKey} is already associated with thread ${[...mappedThreadIds][0]}.`,
          ),
        );
      }

      try {
        const paths = this.getThreadPaths(input.thread.threadId);
        await mkdir(paths.threadDir, { recursive: false });
        await this.writeThreadSnapshotFiles(paths, input.thread, [], [], [], [], []);

        const nextIndex = createStewardRootIndex(indexResult.value.threadByTargetKey);
        this.assignTargetKeys(nextIndex, keySet.value, input.thread.threadId);
        await this.writeJsonAtomic(this.indexPath, nextIndex);
      } catch (error) {
        await this.cleanupThreadDirectory(this.getThreadPaths(input.thread.threadId).threadDir);
        throw error;
      }

      return ok(structuredClone(input.thread));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "createThread", input.thread.threadId));
    }
  }

  async openThread(threadId: string): Promise<StewardResult<ThreadSnapshot>> {
    try {
      await this.ensureStoreReady();
      return ok(await this.readSnapshotFromPaths(this.getThreadPaths(threadId)));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "openThread", threadId));
    }
  }

  async openFixture(fixtureId: string): Promise<StewardResult<{ fixture: FixtureRecord; snapshot: ThreadSnapshot }>> {
    try {
      await this.ensureStoreReady();
      const paths = this.getFixturePaths(fixtureId);
      const fixture = await this.readJsonFile<FixtureRecord>(paths.fixture);

      return ok({
        fixture: structuredClone(fixture),
        snapshot: await this.readSnapshotFromPaths(paths),
      });
    } catch (error) {
      return fail(storeUnavailableIssue(error, "openFixture", fixtureId));
    }
  }

  async findThreadByTarget(target: ThreadTargetRef): Promise<StewardResult<ThreadRecord | undefined>> {
    try {
      const indexResult = await this.ensureStoreReady();
      if (!indexResult.ok) {
        return indexResult;
      }

      const keySet = this.deriveKeys(target);
      if (!keySet.ok) {
        return keySet;
      }

      const mappedThreadIds = this.findMappedThreadIds(indexResult.value, keySet.value);
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
      const thread = await this.readThreadRecord(threadId);
      const compatibility = this.assertCompatibleTargetIdentity(thread.target, target);
      if (!compatibility.ok) {
        return compatibility;
      }

      return ok(thread);
    } catch (error) {
      return fail(storeUnavailableIssue(error, "findThreadByTarget"));
    }
  }

  async findManagedThread(target: ThreadRecord["target"]): Promise<StewardResult<ThreadRecord | undefined>> {
    return this.findThreadByTarget({
      runtime: target.runtime,
      sessionId: target.sessionId,
      sessionFilePath: target.sessionFilePath,
    });
  }

  async assertCanMutate(threadId: string): Promise<StewardResult<ThreadRecord>> {
    try {
      await this.ensureStoreReady();
      const thread = await this.readThreadRecord(threadId);
      const schemaCheck = assertSupportedThreadSchemaVersion(thread);
      if (!schemaCheck.ok) {
        return schemaCheck;
      }

      return ok(thread);
    } catch (error) {
      return fail(storeUnavailableIssue(error, "assertCanMutate", threadId));
    }
  }

  async upsertActor(threadId: string, actor: ActorRecord): Promise<StewardResult<ActorRecord>> {
    return this.withThreadMutation(threadId, async () => {
      const thread = await this.requireMutableThread(threadId);
      if (!thread.ok) {
        return thread;
      }

      const paths = this.getThreadPaths(threadId);
      const actors = await this.readJsonFile<ActorRecord[]>(paths.actors, []);
      const nextActors = actors.filter((candidate) => candidate.actorId !== actor.actorId);
      nextActors.push(structuredClone(actor));
      await this.writeJsonAtomic(paths.actors, nextActors);

      return ok(structuredClone(actor));
    });
  }

  async listActors(threadId: string): Promise<StewardResult<ActorRecord[]>> {
    try {
      await this.ensureStoreReady();
      const actors = await this.readJsonFile<ActorRecord[]>(this.getThreadPaths(threadId).actors, []);
      return ok(structuredClone(actors));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "listActors", threadId));
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<StewardResult<MessageRecord>> {
    return this.withThreadMutation(input.threadId, async () => {
      const thread = await this.requireMutableThread(input.threadId);
      if (!thread.ok) {
        return thread;
      }

      const paths = this.getThreadPaths(input.threadId);
      const actors = await this.readJsonFile<ActorRecord[]>(paths.actors, []);
      if (!actors.some((candidate) => candidate.actorId === input.actor.actorId)) {
        actors.push(structuredClone(input.actor));
        await this.writeJsonAtomic(paths.actors, actors);
      }

      const targetEventKey = input.targetEventKey ?? input.message.targetMetadata?.targetEventKey;
      if (targetEventKey && thread.value.indexes.targetEventKeys[targetEventKey]) {
        return fail({
          code: "CAPTURE_DUPLICATE_EVENT",
          message: `Target event ${targetEventKey} is already recorded for thread ${input.threadId}.`,
          threadId: input.threadId,
        });
      }

      const capturedAt = input.message.capturedAt ?? new Date().toISOString();
      const nextSourceOrder = thread.value.messageHighWatermark + 1;
      const nextSourceRevision = thread.value.sourceRevision + 1;
      const message: MessageRecord = {
        ...structuredClone(input.message),
        threadId: input.threadId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        sourceOrder: nextSourceOrder,
        sourceRevision: nextSourceRevision,
        capturedAt,
      };

      await this.appendJsonLine(paths.messages, message);

      const nextThread = structuredClone(thread.value);
      nextThread.sourceRevision = nextSourceRevision;
      nextThread.messageHighWatermark = nextSourceOrder;
      nextThread.updatedAt = capturedAt;

      if (targetEventKey) {
        nextThread.indexes.targetEventKeys[targetEventKey] = message.messageId;
      }

      await this.writeJsonAtomic(paths.thread, nextThread);

      return ok(message);
    });
  }

  async readMessages(threadId: string, range?: SourceRange): Promise<StewardResult<MessageRecord[]>> {
    try {
      await this.ensureStoreReady();
      const messages = await this.readMessagesFile(this.getThreadPaths(threadId).messages);
      const filtered = range ? messages.filter((message) => sourceRangeContains(range, message.sourceOrder)) : messages;
      return ok(filtered);
    } catch (error) {
      return fail(storeUnavailableIssue(error, "readMessages", threadId));
    }
  }

  async readTurns(threadId: string): Promise<StewardResult<TurnRecord[]>> {
    try {
      await this.ensureStoreReady();
      const turns = await this.readJsonFile<TurnRecord[]>(this.getThreadPaths(threadId).turns, []);
      return ok(structuredClone(turns));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "readTurns", threadId));
    }
  }

  async writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>> {
    return this.withThreadMutation(input.threadId, async () => {
      const thread = await this.requireMutableThread(input.threadId);
      if (!thread.ok) {
        return thread;
      }

      if (thread.value.sourceRevision !== input.expectedSourceRevision) {
        return fail(staleSourceRevisionIssue(thread.value, input.expectedSourceRevision));
      }

      if (thread.value.messageHighWatermark !== input.expectedMessageHighWatermark) {
        return fail({
          code: "STALE_SOURCE_REVISION",
          message: `Thread ${input.threadId} message high watermark ${thread.value.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
          threadId: input.threadId,
        });
      }

      if (thread.value.turnsRevision !== input.expectedTurnsRevision) {
        return fail(staleTurnsRevisionIssue(thread.value, input.expectedTurnsRevision));
      }

      const paths = this.getThreadPaths(input.threadId);
      await this.writeJsonAtomic(paths.turns, structuredClone(input.turns));

      const nextThread = structuredClone(thread.value);
      nextThread.turnsRevision = thread.value.turnsRevision + 1;
      nextThread.status.turnState = input.turnState;
      nextThread.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(paths.thread, nextThread);

      return ok(structuredClone(input.turns));
    });
  }

  async readChunks(threadId: string): Promise<StewardResult<ChunkState[]>> {
    try {
      await this.ensureStoreReady();
      const chunks = await this.readJsonFile<ChunkState[]>(this.getThreadPaths(threadId).chunks, []);
      return ok(structuredClone(chunks));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "readChunks", threadId));
    }
  }

  async writeChunks(input: WriteChunksInput): Promise<StewardResult<ChunkState[]>> {
    return this.withThreadMutation(input.threadId, async () => {
      const thread = await this.requireMutableThread(input.threadId);
      if (!thread.ok) {
        return thread;
      }

      if (thread.value.sourceRevision !== input.expectedSourceRevision) {
        return fail(staleSourceRevisionIssue(thread.value, input.expectedSourceRevision));
      }

      if (thread.value.messageHighWatermark !== input.expectedMessageHighWatermark) {
        return fail({
          code: "STALE_SOURCE_REVISION",
          message: `Thread ${input.threadId} message high watermark ${thread.value.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
          threadId: input.threadId,
        });
      }

      if (thread.value.turnsRevision !== input.expectedTurnsRevision) {
        return fail(staleTurnsRevisionIssue(thread.value, input.expectedTurnsRevision));
      }

      const paths = this.getThreadPaths(input.threadId);
      await this.writeJsonAtomic(paths.chunks, structuredClone(input.chunks));

      const nextThread = structuredClone(thread.value);
      nextThread.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(paths.thread, nextThread);

      return ok(structuredClone(input.chunks));
    });
  }

  async updateThreadMetadata(input: UpdateThreadMetadataInput): Promise<StewardResult<ThreadRecord>> {
    return this.withThreadMutation(input.threadId, async () => {
      const thread = await this.requireMutableThread(input.threadId);
      if (!thread.ok) {
        return thread;
      }

      if (
        input.expectedSourceRevision !== undefined &&
        thread.value.sourceRevision !== input.expectedSourceRevision
      ) {
        return fail(staleSourceRevisionIssue(thread.value, input.expectedSourceRevision));
      }

      const nextThread = structuredClone(thread.value);
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

      if (input.patch.projectionSummary) {
        nextThread.projectionSummary = {
          ...nextThread.projectionSummary,
          ...structuredClone(input.patch.projectionSummary),
        };
      }

      if (Object.prototype.hasOwnProperty.call(input.patch, "activeThreadViewId")) {
        if (input.patch.activeThreadViewId) {
          nextThread.activeThreadViewId = input.patch.activeThreadViewId;
        } else {
          delete nextThread.activeThreadViewId;
        }
      }

      nextThread.updatedAt = input.patch.updatedAt ?? new Date().toISOString();

      const targetIdentityPreserved = this.assertTargetIdentityPreserved(thread.value.target, nextThread.target);
      if (!targetIdentityPreserved.ok) {
        return targetIdentityPreserved;
      }

      const currentKeySet = this.deriveKeys({
        runtime: thread.value.target.runtime,
        sessionId: thread.value.target.sessionId,
        sessionFilePath: thread.value.target.sessionFilePath,
      });
      if (!currentKeySet.ok) {
        return currentKeySet;
      }

      const nextKeySet = this.deriveKeys({
        runtime: nextThread.target.runtime,
        sessionId: nextThread.target.sessionId,
        sessionFilePath: nextThread.target.sessionFilePath,
      });
      if (!nextKeySet.ok) {
        return nextKeySet;
      }

      const keySetsChanged =
        currentKeySet.value.canonicalKey !== nextKeySet.value.canonicalKey ||
        currentKeySet.value.aliasKeys.join("\n") !== nextKeySet.value.aliasKeys.join("\n");

      let nextIndex: StewardRootIndex | undefined;
      if (keySetsChanged) {
        const index = await this.readJsonFile<StewardRootIndex>(this.indexPath, createStewardRootIndex());
        const mappedThreadIds = this.findMappedThreadIds(index, nextKeySet.value);
        const conflictingThreadId = [...mappedThreadIds].find((threadId) => threadId !== input.threadId);
        if (conflictingThreadId) {
          return fail(
            targetAssociationConflict(
              `Target ${nextKeySet.value.canonicalKey} is already associated with thread ${conflictingThreadId}.`,
            ),
          );
        }

        nextIndex = createStewardRootIndex(index.threadByTargetKey);
        for (const key of [currentKeySet.value.canonicalKey, ...currentKeySet.value.aliasKeys]) {
          if (nextIndex.threadByTargetKey[key] === input.threadId) {
            delete nextIndex.threadByTargetKey[key];
          }
        }

        this.assignTargetKeys(nextIndex, nextKeySet.value, input.threadId);
      }

      await this.writeJsonAtomic(this.getThreadPaths(input.threadId).thread, nextThread);

      if (nextIndex) {
        await this.writeJsonAtomic(this.indexPath, nextIndex);
      }

      return ok(nextThread);
    });
  }

  async recordImport(threadId: string, record: ImportRecord): Promise<StewardResult<ThreadRecord>> {
    return this.withThreadMutation(threadId, async () => {
      const thread = await this.requireMutableThread(threadId);
      if (!thread.ok) {
        return thread;
      }

      const paths = this.getThreadPaths(threadId);
      const imports = await this.readJsonFile<ImportRecord[]>(paths.imports, []);
      imports.push(structuredClone(record));
      await this.writeJsonAtomic(paths.imports, imports);

      const nextThread = structuredClone(thread.value);
      nextThread.importSummary = {
        count: imports.length,
        lastImportedAt: record.importedAt,
        lastImportStatus: record.status,
      };
      nextThread.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(paths.thread, nextThread);

      return ok(nextThread);
    });
  }

  async readProjectionRevisions(threadId: string): Promise<StewardResult<ProjectionRevisionRecord[]>> {
    try {
      await this.ensureStoreReady();
      const projections = await this.readJsonFile<ProjectionRevisionRecord[]>(
        this.getThreadPaths(threadId).projections,
        [],
      );
      return ok(structuredClone(projections));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "readProjectionRevisions", threadId));
    }
  }

  async writeProjectionRevision(record: ProjectionRevisionRecord): Promise<StewardResult<ProjectionRevisionRecord>> {
    return this.withThreadMutation(record.threadId, async () => {
      const thread = await this.requireMutableThread(record.threadId);
      if (!thread.ok) {
        return thread;
      }

      const paths = this.getThreadPaths(record.threadId);
      const projections = await this.readJsonFile<ProjectionRevisionRecord[]>(paths.projections, []);
      const nextProjections = projections.filter((candidate) => candidate.revisionId !== record.revisionId);
      nextProjections.push(structuredClone(record));
      nextProjections.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      await this.writeJsonAtomic(paths.projections, nextProjections);

      const latest = nextProjections[nextProjections.length - 1];
      const nextThread = structuredClone(thread.value);
      nextThread.projectionSummary = {
        count: nextProjections.length,
        currentGeneratedFilePath: latest?.generatedFilePath,
        lastRevisionStatus: latest?.status,
      };
      nextThread.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(paths.thread, nextThread);

      return ok(structuredClone(record));
    });
  }

  async createFixture(input: CreateFixtureInput): Promise<StewardResult<FixtureRecord>> {
    try {
      await this.ensureStoreReady();

      const paths = this.getFixturePaths(input.fixture.fixtureId);
      await mkdir(paths.fixtureDir, { recursive: false });
      await this.writeFixtureSnapshotFiles(paths, input.fixture, input.snapshot);

      return ok(structuredClone(input.fixture));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "createFixture", input.fixture.fixtureId));
    }
  }

  protected async writeTemporaryFile(filePath: string, content: string): Promise<string> {
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tempPath, content, "utf8");
    return tempPath;
  }

  protected async commitTemporaryFile(tempPath: string, filePath: string): Promise<void> {
    await rename(tempPath, filePath);
  }

  protected async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = await this.writeTemporaryFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    await this.commitTemporaryFile(tempPath, filePath);
  }

  protected async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
  }

  private async withThreadMutation<T>(
    threadId: string,
    run: () => Promise<StewardResult<T>>,
  ): Promise<StewardResult<T>> {
    const ready = await this.ensureStoreReady();
    if (!ready.ok) {
      return ready;
    }

    const previous = FileThreadStore.globalThreadQueues.get(threadId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => current);
    FileThreadStore.globalThreadQueues.set(threadId, chain);

    await previous.catch(() => undefined);
    const releaseLease = await this.acquireThreadMutationLease(threadId);

    try {
      if (!releaseLease.ok) {
        return releaseLease;
      }

      return await run();
    } catch (error) {
      return fail(storeUnavailableIssue(error, "thread mutation", threadId));
    } finally {
      if (releaseLease.ok) {
        await releaseLease.value();
      }
      releaseQueue();
      if (FileThreadStore.globalThreadQueues.get(threadId) === chain) {
        FileThreadStore.globalThreadQueues.delete(threadId);
      }
    }
  }

  private async ensureStoreReady(): Promise<StewardResult<StewardRootIndex>> {
    try {
      await mkdir(this.rootDir, { recursive: true });
      await mkdir(this.threadsDir, { recursive: true });
      await mkdir(this.fixturesDir, { recursive: true });
      await mkdir(this.mutationLocksDir, { recursive: true });
      await this.cleanupStaleTempFiles(this.rootDir);
      await this.cleanupNestedTempFiles(this.threadsDir);
      await this.cleanupNestedTempFiles(this.fixturesDir);
      await this.cleanupExpiredThreadMutationLeases();

      const reconciled = await this.reconcileRootIndex();
      if (!reconciled.ok) {
        return reconciled;
      }

      if (reconciled.value.changed || !(await this.fileExists(this.indexPath))) {
        await this.writeJsonAtomic(this.indexPath, reconciled.value.index);
      }

      return ok(reconciled.value.index);
    } catch (error) {
      return fail(storeUnavailableIssue(error, "ensureStoreReady"));
    }
  }

  private async reconcileRootIndex(): Promise<StewardResult<ReconciledIndex>> {
    const currentIndex = await this.readJsonFile<StewardRootIndex>(this.indexPath, createStewardRootIndex());
    const scannedThreadTargets = new Map<string, string>();
    const entries = await readdir(this.threadsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const threadId = entry.name;
      if (!(await this.fileExists(this.getThreadPaths(threadId).thread))) {
        continue;
      }

      const thread = await this.readThreadRecord(threadId);
      const keys = this.deriveKeys({
        runtime: thread.target.runtime,
        sessionId: thread.target.sessionId,
        sessionFilePath: thread.target.sessionFilePath,
      });

      if (!keys.ok) {
        return keys;
      }

      for (const key of [keys.value.canonicalKey, ...keys.value.aliasKeys]) {
        const existingThreadId = scannedThreadTargets.get(key);
        if (existingThreadId && existingThreadId !== thread.threadId) {
          return fail(
            targetAssociationConflict(
              `Target key ${key} is claimed by both thread ${existingThreadId} and ${thread.threadId}.`,
            ),
          );
        }

        scannedThreadTargets.set(key, thread.threadId);
      }
    }

    for (const [key, threadId] of Object.entries(currentIndex.threadByTargetKey)) {
      const expectedThreadId = scannedThreadTargets.get(key);
      if (expectedThreadId !== undefined && expectedThreadId !== threadId) {
        return fail(
          targetAssociationConflict(
            `Target key ${key} points to thread ${threadId} in index.json but thread ${expectedThreadId} on disk.`,
          ),
        );
      }

      if (expectedThreadId === undefined) {
        return fail(
          targetAssociationConflict(`Target key ${key} points to missing or stale thread ${threadId} in index.json.`),
        );
      }
    }

    const nextIndex = createStewardRootIndex(Object.fromEntries(scannedThreadTargets.entries()));

    return ok({
      index: nextIndex,
      changed: JSON.stringify(currentIndex.threadByTargetKey) !== JSON.stringify(nextIndex.threadByTargetKey),
    });
  }

  private async requireMutableThread(threadId: string): Promise<StewardResult<ThreadRecord>> {
    const thread = await this.readThreadRecord(threadId);
    const schemaCheck = assertSupportedThreadSchemaVersion(thread);
    if (!schemaCheck.ok) {
      return schemaCheck;
    }

    return ok(thread);
  }

  private async readThreadRecord(threadId: string): Promise<ThreadRecord> {
    const thread = await this.readJsonFile<ThreadRecord>(this.getThreadPaths(threadId).thread);
    const messages = await this.readMessagesFile(this.getThreadPaths(threadId).messages);
    const imports = await this.readJsonFile<ImportRecord[]>(this.getThreadPaths(threadId).imports, []);
    const projections = await this.readJsonFile<ProjectionRevisionRecord[]>(
      this.getThreadPaths(threadId).projections,
      [],
    );

    return this.hydrateThreadRecord(thread, messages, imports, projections);
  }

  private async readSnapshotFromPaths(
    paths: Pick<ThreadFilePaths, "thread" | "actors" | "messages" | "turns" | "imports" | "projections">,
  ): Promise<ThreadSnapshot> {
    const [thread, actors, messages, turns, imports, projections] = await Promise.all([
      this.readJsonFile<ThreadRecord>(paths.thread),
      this.readJsonFile<ActorRecord[]>(paths.actors, []),
      this.readMessagesFile(paths.messages),
      this.readJsonFile<TurnRecord[]>(paths.turns, []),
      this.readJsonFile<ImportRecord[]>(paths.imports, []),
      this.readJsonFile<ProjectionRevisionRecord[]>(paths.projections, []),
    ]);

    return {
      thread: this.hydrateThreadRecord(thread, messages, imports, projections),
      actors: structuredClone(actors),
      messages,
      turns: structuredClone(turns),
      imports: structuredClone(imports),
      projections: structuredClone(projections),
    };
  }

  private hydrateThreadRecord(
    thread: ThreadRecord,
    messages: readonly MessageRecord[],
    imports: readonly ImportRecord[],
    projections: readonly ProjectionRevisionRecord[],
  ): ThreadRecord {
    const nextThread = structuredClone(thread);
    const lastMessage = messages[messages.length - 1];
    nextThread.sourceRevision = Math.max(nextThread.sourceRevision, lastMessage?.sourceRevision ?? 0);
    nextThread.messageHighWatermark = Math.max(nextThread.messageHighWatermark, lastMessage?.sourceOrder ?? 0);
    nextThread.turnsRevision = Math.max(nextThread.turnsRevision ?? 0, 0);

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
      const latestProjection = [...projections]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      nextThread.projectionSummary = {
        count: projections.length,
        currentGeneratedFilePath: latestProjection?.generatedFilePath,
        lastRevisionStatus: latestProjection?.status,
      };
    }

    return nextThread;
  }

  private threadMutationLockPath(threadId: string): string {
    return join(this.mutationLocksDir, `${threadId}.lock`);
  }

  private async acquireThreadMutationLease(threadId: string): Promise<StewardResult<() => Promise<void>>> {
    const lockPath = this.threadMutationLockPath(threadId);
    const deadline = Date.now() + FileThreadStore.mutationLeaseTimeoutMs;
    const token = randomUUID();
    let released = false;

    while (Date.now() <= deadline) {
      const lease: ThreadMutationLeaseFile = {
        token,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + FileThreadStore.mutationLeaseTimeoutMs).toISOString(),
      };

      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8");
        } finally {
          await handle.close();
        }

        return ok(async () => {
          if (released) {
            return;
          }

          released = true;

          try {
            const current = await this.readThreadMutationLeaseFile(lockPath);
            if (!current || current.token !== token) {
              return;
            }
          } catch {
            return;
          }

          await rm(lockPath, { force: true });
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          return fail(storeUnavailableIssue(error, "thread mutation lease", threadId));
        }
      }

      await this.releaseExpiredThreadMutationLease(lockPath);
      await sleep(FileThreadStore.mutationLeaseRetryMs);
    }

    return fail({
      code: "STORE_UNAVAILABLE",
      message: `Timed out acquiring thread mutation lease for ${threadId}.`,
      threadId,
    });
  }

  private async cleanupExpiredThreadMutationLeases(): Promise<void> {
    const entries = await readdir(this.mutationLocksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) {
        continue;
      }

      await this.releaseExpiredThreadMutationLease(join(this.mutationLocksDir, entry.name));
    }
  }

  private async releaseExpiredThreadMutationLease(lockPath: string): Promise<void> {
    try {
      const lease = await this.readThreadMutationLeaseFile(lockPath);
      const expired = lease ? Date.parse(lease.expiresAt) <= Date.now() : true;

      if (!expired) {
        return;
      }

      await rm(lockPath, { force: true });
    } catch (error) {
      const fileStat = await stat(lockPath).catch(() => undefined);
      if (!fileStat) {
        return;
      }

      if (Date.now() - fileStat.mtimeMs > FileThreadStore.mutationLeaseTimeoutMs) {
        await rm(lockPath, { force: true });
      }
    }
  }

  private async readThreadMutationLeaseFile(lockPath: string): Promise<ThreadMutationLeaseFile | undefined> {
    const content = await readFile(lockPath, "utf8").catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (!content) {
      return undefined;
    }

    return JSON.parse(content) as ThreadMutationLeaseFile;
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

  private async readMessagesFile(filePath: string): Promise<MessageRecord[]> {
    try {
      const content = await readFile(filePath, "utf8");
      if (content.trim().length === 0) {
        return [];
      }

      return sortMessages(
        content
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as MessageRecord),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async writeThreadSnapshotFiles(
    paths: ThreadFilePaths,
    thread: ThreadRecord,
    actors: readonly ActorRecord[],
    turns: readonly TurnRecord[],
    chunks: readonly ChunkState[],
    imports: readonly ImportRecord[],
    projections: readonly ProjectionRevisionRecord[],
  ): Promise<void> {
    await this.writeJsonAtomic(paths.actors, structuredClone(actors));
    await this.writeJsonAtomic(paths.turns, structuredClone(turns));
    await this.writeJsonAtomic(paths.chunks, structuredClone(chunks));
    await this.writeJsonAtomic(paths.imports, structuredClone(imports));
    await this.writeJsonAtomic(paths.projections, structuredClone(projections));
    await writeFile(paths.messages, "", "utf8");
    await this.writeJsonAtomic(paths.thread, structuredClone(thread));
  }

  private async writeFixtureSnapshotFiles(
    paths: FixtureFilePaths,
    fixture: FixtureRecord,
    snapshot: ThreadSnapshot,
  ): Promise<void> {
    await this.writeJsonAtomic(paths.fixture, structuredClone(fixture));
    await this.writeJsonAtomic(paths.actors, structuredClone(snapshot.actors));
    await this.writeJsonAtomic(paths.turns, structuredClone(snapshot.turns));
    await this.writeJsonAtomic(paths.imports, structuredClone(snapshot.imports));
    await this.writeJsonAtomic(paths.projections, structuredClone(snapshot.projections));

    await writeFile(paths.messages, "", "utf8");
    for (const message of snapshot.messages) {
      await this.appendJsonLine(paths.messages, message);
    }
    await this.writeJsonAtomic(paths.thread, structuredClone(snapshot.thread));
  }

  private getThreadPaths(threadId: string): ThreadFilePaths {
    const threadDir = join(this.threadsDir, threadId);

    return {
      threadDir,
      thread: join(threadDir, "thread.json"),
      actors: join(threadDir, "actors.json"),
      messages: join(threadDir, "messages.jsonl"),
      turns: join(threadDir, "turns.json"),
      chunks: join(threadDir, "chunks.json"),
      imports: join(threadDir, "imports.json"),
      projections: join(threadDir, "projections.json"),
    };
  }

  private getFixturePaths(fixtureId: string): FixtureFilePaths {
    const fixtureDir = join(this.fixturesDir, fixtureId);

    return {
      fixtureDir,
      fixture: join(fixtureDir, "fixture.json"),
      thread: join(fixtureDir, "thread.json"),
      actors: join(fixtureDir, "actors.json"),
      messages: join(fixtureDir, "messages.jsonl"),
      turns: join(fixtureDir, "turns.json"),
      imports: join(fixtureDir, "imports.json"),
      projections: join(fixtureDir, "projections.json"),
    };
  }

  private deriveKeys(target: ThreadTargetRef): StewardResult<TargetSessionKeySet> {
    try {
      return ok(deriveTargetSessionKeys(target));
    } catch (error) {
      return fail(storeUnavailableIssue(error, "derive target session keys"));
    }
  }

  private findMappedThreadIds(index: StewardRootIndex, keySet: TargetSessionKeySet): Set<string> {
    const threadIds = new Set<string>();
    for (const key of [keySet.canonicalKey, ...keySet.aliasKeys]) {
      const threadId = index.threadByTargetKey[key];
      if (threadId) {
        threadIds.add(threadId);
      }
    }
    return threadIds;
  }

  private assignTargetKeys(index: StewardRootIndex, keySet: TargetSessionKeySet, threadId: string): void {
    index.threadByTargetKey[keySet.canonicalKey] = threadId;
    for (const aliasKey of keySet.aliasKeys) {
      index.threadByTargetKey[aliasKey] = threadId;
    }
  }

  private normalizeTargetValue(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private getSessionFileKey(target: ThreadTargetRef): StewardResult<string | undefined> {
    const sessionFilePath = this.normalizeTargetValue(target.sessionFilePath);
    if (!sessionFilePath) {
      return ok(undefined);
    }

    const keySet = this.deriveKeys({
      runtime: target.runtime,
      sessionFilePath,
    });
    if (!keySet.ok) {
      return keySet;
    }

    return ok(keySet.value.canonicalKey);
  }

  private assertCompatibleTargetIdentity(
    stored: ThreadTargetRef,
    incoming: ThreadTargetRef,
  ): StewardResult<void> {
    if (stored.runtime !== incoming.runtime) {
      return fail(
        targetAssociationConflict(
          `Stored target runtime ${stored.runtime} does not match incoming runtime ${incoming.runtime}.`,
        ),
      );
    }

    const storedSessionId = this.normalizeTargetValue(stored.sessionId);
    const incomingSessionId = this.normalizeTargetValue(incoming.sessionId);
    if (storedSessionId && incomingSessionId && storedSessionId !== incomingSessionId) {
      return fail(
        targetAssociationConflict(
          `Stored target session id ${storedSessionId} does not match incoming session id ${incomingSessionId}.`,
        ),
      );
    }

    const storedSessionFileKey = this.getSessionFileKey(stored);
    if (!storedSessionFileKey.ok) {
      return storedSessionFileKey;
    }
    const incomingSessionFileKey = this.getSessionFileKey(incoming);
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

  private assertTargetIdentityPreserved(
    current: ThreadTargetRef,
    next: ThreadTargetRef,
  ): StewardResult<void> {
    const compatibility = this.assertCompatibleTargetIdentity(current, next);
    if (!compatibility.ok) {
      return compatibility;
    }

    const currentSessionId = this.normalizeTargetValue(current.sessionId);
    const nextSessionId = this.normalizeTargetValue(next.sessionId);
    if (currentSessionId && nextSessionId !== currentSessionId) {
      return fail(
        targetAssociationConflict(`Thread target session id ${currentSessionId} cannot be removed or reassigned.`),
      );
    }

    const currentSessionFileKey = this.getSessionFileKey(current);
    if (!currentSessionFileKey.ok) {
      return currentSessionFileKey;
    }
    const nextSessionFileKey = this.getSessionFileKey(next);
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

  private async cleanupThreadDirectory(threadDir: string): Promise<void> {
    try {
      await rm(threadDir, { recursive: true, force: true });
    } catch {
      return;
    }
  }

  private async cleanupStaleTempFiles(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".tmp")) {
        await rm(join(dir, entry.name), { force: true });
      }
    }
  }

  private async cleanupNestedTempFiles(rootDir: string): Promise<void> {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      await this.cleanupStaleTempFiles(join(rootDir, entry.name));
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }
}
