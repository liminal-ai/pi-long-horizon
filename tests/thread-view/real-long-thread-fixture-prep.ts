import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { materializeChunkSmoothTextFromTurns } from "../../src/thread/async-thread/services/chunk-service.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { ensurePlaceholderArtifacts } from "../../src/thread/async-thread/services/placeholder-artifact-service.js";
import { ensureSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ProjectionRevisionRecord, ThreadRecord } from "../../src/thread/domain/records.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import type { ThreadStore } from "../../src/thread/store/thread-store.js";
import type { ThreadViewRecord } from "../../src/thread-view/domain/thread-view-records.js";
import { countChunkSmoothMaterialized } from "../../src/token-accounting/index.js";

export const REAL_LONG_THREAD_FIXTURE = {
  threadId: "thread_2bbccbae-bf23-4a4c-a742-26528e6e5ab9",
  activeThreadViewId: "thread_view_67aa045a-2b34-45c5-ae0e-b43988ce3568",
  activeProjectionRevisionId: "projection_0a2ad4d0-49c4-4ea1-9268-e348a4d9ca23",
  activeGeneratedRolloutFileName:
    "projection_0a2ad4d0-49c4-4ea1-9268-e348a4d9ca23-thread_view_67aa045a-2b34-45c5-ae0e-b43988ce3568.jsonl",
} as const;

const PREP_TIMESTAMP = "2026-05-16T00:00:00.000Z";

export interface PreparedRealLongThreadFixture {
  storeRootDir: string;
  threadId: string;
  activeThreadViewId: string;
  activeProjectionRevisionId: string;
  activeGeneratedFilePath: string;
  selectedChunkIds: string[];
  repairedClosedTurnCount: number;
  normalizedChunkIds: string[];
  regeneratedPlaceholderChunkIds: string[];
  activatedGeneratedThreadView: boolean;
  previousGeneratedThreadViewState: ThreadViewRecord["state"];
  backupPath?: string;
  threadStore: ThreadStore;
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function threadDir(rootDir: string, threadId: string): string {
  return join(rootDir, "threads", threadId);
}

function threadViewPath(rootDir: string, threadId: string, threadViewId: string): string {
  return join(threadDir(rootDir, threadId), "thread-views", threadViewId, "thread-view.json");
}

function generatedPath(rootDir: string, threadId: string, fileName: string): string {
  return join(threadDir(rootDir, threadId), "generated", fileName);
}

function rewriteGeneratedPath(sourceThreadDir: string, targetThreadDir: string, filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const resolvedFilePath = resolve(filePath);
  const resolvedSourceThreadDir = resolve(sourceThreadDir);
  if (!resolvedFilePath.startsWith(resolvedSourceThreadDir)) {
    return filePath;
  }

  if (resolvedFilePath.includes(`${resolvedSourceThreadDir}/generated/`)) {
    return join(targetThreadDir, "generated", basename(filePath));
  }

  if (resolvedFilePath.includes(`${resolvedSourceThreadDir}/archives/pi-thread-views/`)) {
    return join(targetThreadDir, "archives", "pi-thread-views", basename(filePath));
  }

  return filePath;
}

function rewriteSourceTargetPath(sourceStoreRootDir: string, filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  if (filePath.startsWith("/")) {
    return filePath;
  }

  // Fixture clones often run from a temp cwd. The original thread target stored the source PI
  // session path relative to the repo root, while PI reports that source-session identity as an
  // absolute path when continuing a generated rollout. Keep the cloned identity anchored to the
  // source repo so current target-index reconciliation can find the prepared thread.
  return resolve(sourceStoreRootDir, "..", filePath);
}

async function rewriteClonedGeneratedMetadata(input: {
  sourceStoreRootDir: string;
  targetStoreRootDir: string;
  threadId: string;
}): Promise<void> {
  const sourceDir = threadDir(input.sourceStoreRootDir, input.threadId);
  const targetDir = threadDir(input.targetStoreRootDir, input.threadId);
  const targetProjectDir = resolve(input.targetStoreRootDir, "..");
  const threadPath = join(targetDir, "thread.json");
  const projectionsPath = join(targetDir, "projections.json");
  const thread = await readJson<ThreadRecord>(threadPath);
  const projections = await readJson<ProjectionRevisionRecord[]>(projectionsPath);
  const rewrite = (filePath: string | undefined) => rewriteGeneratedPath(sourceDir, targetDir, filePath);

  const rewrittenProjections = projections.map((projection) => ({
    ...projection,
    generatedFilePath: rewrite(projection.generatedFilePath) ?? projection.generatedFilePath,
    archivePath: rewrite(projection.archivePath),
  }));
  const currentProjection = rewrittenProjections.find(
    (projection) => projection.revisionId === REAL_LONG_THREAD_FIXTURE.activeProjectionRevisionId,
  );
  assert.ok(currentProjection?.generatedFilePath);

  const rewrittenThread: ThreadRecord = {
    ...thread,
    target: {
      ...thread.target,
      sessionFilePath: rewriteSourceTargetPath(input.sourceStoreRootDir, thread.target.sessionFilePath),
      currentGeneratedFilePath: rewrite(thread.target.currentGeneratedFilePath),
    },
    threadViewOutputSummary: {
      ...thread.threadViewOutputSummary,
      currentGeneratedFilePath: rewrite(thread.threadViewOutputSummary.currentGeneratedFilePath),
      generatedOutput: thread.threadViewOutputSummary.generatedOutput
        ? {
            ...thread.threadViewOutputSummary.generatedOutput,
            generatedFilePath: rewrite(thread.threadViewOutputSummary.generatedOutput.generatedFilePath),
          }
        : undefined,
    },
  };

  await writeJson(projectionsPath, rewrittenProjections);
  await writeJson(threadPath, rewrittenThread);

  for (const projection of rewrittenProjections) {
    if (!projection.generatedFilePath) {
      continue;
    }

    const content = await readFile(projection.generatedFilePath, "utf8");
    const lines = content.split("\n");
    const rewrittenLines = lines.map((line, index) => {
      if (index !== 0 || !line.trim()) {
        return line;
      }

      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type !== "session") {
        return line;
      }

      return JSON.stringify({
        ...entry,
        cwd: targetProjectDir,
      });
    });
    await writeFile(projection.generatedFilePath, rewrittenLines.join("\n"), "utf8");
  }
}

async function cloneRealLongThreadToTempStore(input: {
  sourceStoreRootDir: string;
  targetStoreRootDir: string;
}): Promise<void> {
  const sourceThreadDir = threadDir(input.sourceStoreRootDir, REAL_LONG_THREAD_FIXTURE.threadId);
  const targetThreadDir = threadDir(input.targetStoreRootDir, REAL_LONG_THREAD_FIXTURE.threadId);

  await mkdir(join(input.targetStoreRootDir, "threads"), { recursive: true });
  await cp(sourceThreadDir, targetThreadDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
  });
  await rewriteClonedGeneratedMetadata({
    sourceStoreRootDir: input.sourceStoreRootDir,
    targetStoreRootDir: input.targetStoreRootDir,
    threadId: REAL_LONG_THREAD_FIXTURE.threadId,
  });
}

function selectedChunkIds(view: ThreadViewRecord): string[] {
  return [...new Set([...view.detailedBand.selectedIds, ...view.briefBand.selectedIds])];
}

async function normalizeSelectedChunkSmoothFreshnessBasis(input: {
  store: FileThreadStore;
  threadId: string;
  selectedChunkIds: readonly string[];
}): Promise<string[]> {
  const snapshot = expectOk(await input.store.openThread(input.threadId));
  const chunks = expectOk(await input.store.readChunks(input.threadId));
  const selected = new Set(input.selectedChunkIds);
  const turnsById = new Map(snapshot.turns.map((turn) => [turn.turnId, turn]));
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));
  const normalizedChunkIds: string[] = [];

  const nextChunks = chunks.map((chunk): ChunkState => {
    if (!selected.has(chunk.chunkId) || chunk.lifecycleStatus !== "closed") {
      return chunk;
    }

    const materialized = materializeChunkSmoothTextFromTurns({ chunk, turnsById, messagesById });
    assert.ok(materialized, `Expected selected chunk ${chunk.chunkId} to materialize from current component smooth turns.`);

    const chunkWithCurrentSmooth = {
      ...chunk,
      smoothText: materialized.text,
      sourceRevision: materialized.sourceRevision,
    };

    // Thread-prep normalization:
    // current Thread View materialization checks placeholder freshness against the deterministic
    // materialized chunk-smooth token count. Older real runs persisted exact provider counts here,
    // and those exact counts can differ from the deterministic freshness basis. Normalize the
    // prepared target store so regenerated placeholders match current deterministic materialization.
    const smoothTokenCountMetadata = countChunkSmoothMaterialized(chunkWithCurrentSmooth, {
      createdAt: PREP_TIMESTAMP,
    });

    normalizedChunkIds.push(chunk.chunkId);
    return {
      ...chunkWithCurrentSmooth,
      smoothTokenCountMetadata,
      placeholders: undefined,
    };
  });

  const mutableThread = expectOk(await input.store.assertCanMutate(input.threadId));
  expectOk(
    await input.store.writeChunks({
      threadId: input.threadId,
      expectedSourceRevision: mutableThread.sourceRevision,
      expectedMessageHighWatermark: mutableThread.messageHighWatermark,
      expectedTurnsRevision: mutableThread.turnsRevision,
      chunks: nextChunks,
    }),
  );

  return normalizedChunkIds;
}

async function reconcileGeneratedThreadViewAsActive(input: {
  storeRootDir: string;
  threadId: string;
  threadViewId: string;
}): Promise<{
  activatedGeneratedThreadView: boolean;
  previousGeneratedThreadViewState: ThreadViewRecord["state"];
}> {
  const threadPath = join(threadDir(input.storeRootDir, input.threadId), "thread.json");
  const thread = await readJson<ThreadRecord>(threadPath);
  const activeViewPath = threadViewPath(input.storeRootDir, input.threadId, input.threadViewId);
  const activeView = await readJson<ThreadViewRecord>(activeViewPath);
  const previousGeneratedThreadViewState = activeView.state;

  await writeJson(activeViewPath, {
    ...activeView,
    state: "active",
    updatedAt: PREP_TIMESTAMP,
  } satisfies ThreadViewRecord);
  await writeJson(threadPath, {
    ...thread,
    activeThreadViewId: input.threadViewId,
    updatedAt: PREP_TIMESTAMP,
  } satisfies ThreadRecord);

  return {
    activatedGeneratedThreadView: previousGeneratedThreadViewState !== "active" ||
      thread.activeThreadViewId !== input.threadViewId,
    previousGeneratedThreadViewState,
  };
}

async function prepareRealLongThreadStore(input: {
  storeRootDir: string;
  backupPath?: string;
}): Promise<PreparedRealLongThreadFixture> {
  const threadId = REAL_LONG_THREAD_FIXTURE.threadId;
  const activeThreadViewId = REAL_LONG_THREAD_FIXTURE.activeThreadViewId;
  const threadStore = new FileThreadStore(input.storeRootDir);
  const now = () => new Date(PREP_TIMESTAMP);
  const initialSnapshot = expectOk(await threadStore.openThread(threadId));
  const closedTurnIds = initialSnapshot.turns
    .filter((turn) => turn.lifecycleStatus === "closed")
    .map((turn) => turn.turnId);

  for (const turnId of closedTurnIds) {
    await ensureSmoothTurn({ threadId, turnId }, { store: threadStore, now });
  }

  await updateChunkState({ threadId }, { store: threadStore, now });

  const activeView = await readJson<ThreadViewRecord>(
    threadViewPath(input.storeRootDir, threadId, activeThreadViewId),
  );
  const selectedChunks = selectedChunkIds(activeView);
  const normalizedChunkIds = await normalizeSelectedChunkSmoothFreshnessBasis({
    store: threadStore,
    threadId,
    selectedChunkIds: selectedChunks,
  });

  const refreshedChunks = expectOk(await threadStore.readChunks(threadId));
  const closedChunkIds = refreshedChunks
    .filter((chunk) => chunk.lifecycleStatus === "closed")
    .map((chunk) => chunk.chunkId);
  const regeneratedPlaceholderChunkIds: string[] = [];
  for (const chunkId of closedChunkIds) {
    const result = await ensurePlaceholderArtifacts({ threadId, chunkId }, { store: threadStore, now });
    assert.equal(result.blockers.length, 0, result.blockers.map((issue) => issue.message).join("\n"));
    if (result.detailedReady && result.briefReady) {
      regeneratedPlaceholderChunkIds.push(chunkId);
    }
  }

  const activeViewReconciliation = await reconcileGeneratedThreadViewAsActive({
    storeRootDir: input.storeRootDir,
    threadId,
    threadViewId: activeThreadViewId,
  });

  const activeGeneratedFilePath = generatedPath(
    input.storeRootDir,
    threadId,
    REAL_LONG_THREAD_FIXTURE.activeGeneratedRolloutFileName,
  );
  const finalSnapshot = expectOk(await threadStore.openThread(threadId));
  const activeProjection = finalSnapshot.projections.find(
    (projection) => projection.revisionId === REAL_LONG_THREAD_FIXTURE.activeProjectionRevisionId,
  );
  assert.ok(activeProjection, `Expected active projection ${REAL_LONG_THREAD_FIXTURE.activeProjectionRevisionId}.`);
  expectOk(
    await threadStore.recordThreadIdMap({
      threadId,
      target: {
        runtime: "pi",
        sessionId: activeProjection.generatedSessionId,
        sessionFilePath: activeProjection.generatedFilePath,
      },
      projectionRevisionId: activeProjection.revisionId,
    }),
  );
  expectOk(
    await threadStore.recordThreadIdMap({
      threadId,
      target: {
        runtime: finalSnapshot.thread.target.runtime,
        sessionId: finalSnapshot.thread.target.sessionId,
        sessionFilePath: finalSnapshot.thread.target.sessionFilePath,
      },
    }),
  );

  return {
    storeRootDir: input.storeRootDir,
    threadId,
    activeThreadViewId,
    activeProjectionRevisionId: REAL_LONG_THREAD_FIXTURE.activeProjectionRevisionId,
    activeGeneratedFilePath,
    selectedChunkIds: selectedChunks,
    repairedClosedTurnCount: closedTurnIds.length,
    normalizedChunkIds,
    regeneratedPlaceholderChunkIds,
    activatedGeneratedThreadView: activeViewReconciliation.activatedGeneratedThreadView,
    previousGeneratedThreadViewState: activeViewReconciliation.previousGeneratedThreadViewState,
    backupPath: input.backupPath,
    threadStore,
  };
}

export async function prepareRealLongThreadFixtureClone(input: {
  sourceStoreRootDir?: string;
  targetStoreRootDir: string;
}): Promise<PreparedRealLongThreadFixture> {
  const sourceStoreRootDir = input.sourceStoreRootDir ?? ".context-steward";
  await cloneRealLongThreadToTempStore({
    sourceStoreRootDir,
    targetStoreRootDir: input.targetStoreRootDir,
  });

  return prepareRealLongThreadStore({ storeRootDir: input.targetStoreRootDir });
}

export async function backupRealLongThread(input: {
  storeRootDir?: string;
  backupRootDir?: string;
  backupLabel?: string;
} = {}): Promise<string> {
  const storeRootDir = input.storeRootDir ?? ".context-steward";
  const sourceThreadDir = threadDir(storeRootDir, REAL_LONG_THREAD_FIXTURE.threadId);
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRootDir = input.backupRootDir ?? join(storeRootDir, "thread-backups");
  const backupPath = join(
    backupRootDir,
    `${REAL_LONG_THREAD_FIXTURE.threadId}-${input.backupLabel ?? "pre-current-standard-prep"}-${safeTimestamp}`,
  );

  await mkdir(backupRootDir, { recursive: true });
  await cp(sourceThreadDir, backupPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });

  return backupPath;
}

export async function prepareRealLongThreadInPlace(input: {
  storeRootDir?: string;
  backupRootDir?: string;
  backupLabel?: string;
} = {}): Promise<PreparedRealLongThreadFixture> {
  const storeRootDir = input.storeRootDir ?? ".context-steward";
  const backupPath = await backupRealLongThread({
    storeRootDir,
    backupRootDir: input.backupRootDir,
    backupLabel: input.backupLabel,
  });

  return prepareRealLongThreadStore({ storeRootDir, backupPath });
}
