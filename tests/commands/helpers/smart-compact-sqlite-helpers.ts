import assert from "node:assert/strict";
import { basename } from "node:path";

import { OpenAIInputTokenCounter, type TokenCountRecord } from "../../../src/token-accounting/index.js";
import { importFileBackedThread } from "../../../src/thread/migration/sqlite-thread-migration-service.js";
import { SqliteThreadStore } from "../../../src/thread/store/sqlite-thread-store.js";
import type { StewardResult } from "../../../src/thread/domain/errors.js";
import type { ChunkState } from "../../../src/thread/async-thread/domain/chunk-state.js";
import type { TurnRecord } from "../../../src/thread/domain/records.js";
import type { TempFeature3StoreContext } from "../../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThreadWithOptions } from "../../thread-view/helpers.js";

export const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 1;
  },
}, "gpt-test");

export interface ImportedSqliteSmartCompactFixture {
  threadId: string;
  sqliteStore: SqliteThreadStore;
  legacyThreadStore: Awaited<ReturnType<typeof seedDeterministicRebuildThreadWithOptions>>["threadStore"];
  turns: Awaited<ReturnType<typeof seedDeterministicRebuildThreadWithOptions>>["turns"];
  chunks: Awaited<ReturnType<typeof seedDeterministicRebuildThreadWithOptions>>["chunks"];
}

export function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

export function createPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(
        input.threadId,
        `${stamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

export async function importDeterministicRebuildThreadToSqlite(
  context: TempFeature3StoreContext,
): Promise<ImportedSqliteSmartCompactFixture> {
  const seeded = await seedDeterministicRebuildThreadWithOptions(context.storeRootDir, {
    canonicalClosedChunks: true,
  });
  expectOk(await importFileBackedThread({ rootDir: context.storeRootDir, threadId: seeded.threadId, mode: "import" }));

  return {
    threadId: seeded.threadId,
    sqliteStore: new SqliteThreadStore(context.storeRootDir),
    legacyThreadStore: seeded.threadStore,
    turns: seeded.turns,
    chunks: seeded.chunks,
  };
}

function heuristicOnly(record: TokenCountRecord | undefined): TokenCountRecord | undefined {
  if (!record) {
    return undefined;
  }

  return {
    ...record,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    provider: undefined,
    model: undefined,
    tokenizer: undefined,
    tokenizerVersion: undefined,
  };
}

export async function forceHeuristicOnlyCounts(store: SqliteThreadStore, threadId: string): Promise<void> {
  const snapshot = expectOk(await store.openThread(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: snapshot.turns.map((turn) => ({
        ...turn,
        rawTokenCountMetadata: heuristicOnly(turn.rawTokenCountMetadata),
        smooth: turn.smooth
          ? {
              ...turn.smooth,
              tokenCountMetadata: heuristicOnly(turn.smooth.tokenCountMetadata),
              lowerBandProjection: turn.smooth.lowerBandProjection
                ? {
                    ...turn.smooth.lowerBandProjection,
                    tokenCountMetadata: heuristicOnly(turn.smooth.lowerBandProjection.tokenCountMetadata),
                  }
                : undefined,
            }
          : undefined,
      })),
      turnState: snapshot.thread.status.turnState,
    }),
  );

  const refreshed = expectOk(await store.openThread(threadId));
  const chunks = expectOk(await store.readChunks(threadId));
  expectOk(
    await store.writeChunks({
      threadId,
      expectedSourceRevision: refreshed.thread.sourceRevision,
      expectedMessageHighWatermark: refreshed.thread.messageHighWatermark,
      expectedTurnsRevision: refreshed.thread.turnsRevision,
      chunks: chunks.map((chunk) => downgradeChunkCountsToHeuristic(chunk)),
    }),
  );
}

function downgradeChunkCountsToHeuristic(chunk: ChunkState): ChunkState {
  if (!chunk.placeholders) {
    return {
      ...chunk,
      smoothTokenCountMetadata: heuristicOnly(chunk.smoothTokenCountMetadata),
    };
  }

  return {
    chunkId: chunk.chunkId,
    threadId: chunk.threadId,
    lifecycleStatus: chunk.lifecycleStatus,
    sourceTurnIds: [...chunk.sourceTurnIds],
    smoothText: chunk.smoothText,
    smoothTokenCountMetadata: heuristicOnly(chunk.smoothTokenCountMetadata),
    openedAt: chunk.openedAt,
    closedAt: chunk.closedAt,
    closeReason: chunk.closeReason,
    sourceRevision: chunk.sourceRevision,
    placeholders: {
      ...chunk.placeholders,
      detailed: chunk.placeholders.detailed
        ? {
            ...chunk.placeholders.detailed,
            tokenCountMetadata: heuristicOnly(chunk.placeholders.detailed.tokenCountMetadata),
          }
        : undefined,
      brief: chunk.placeholders.brief
        ? {
            ...chunk.placeholders.brief,
            tokenCountMetadata: heuristicOnly(chunk.placeholders.brief.tokenCountMetadata),
          }
        : undefined,
    },
  };
}

export async function rewriteSmoothTurnComponentText(input: {
  store: SqliteThreadStore;
  threadId: string;
  turnId: string;
  nextText: string;
}): Promise<void> {
  const snapshot = expectOk(await input.store.openThread(input.threadId));
  const targetTurn = snapshot.turns.find((turn) => turn.turnId === input.turnId);
  assert.ok(targetTurn?.smooth?.components?.length);

  const nextTurns = snapshot.turns.map((turn): TurnRecord => {
    if (turn.turnId !== input.turnId || !turn.smooth?.components) {
      return turn;
    }

    return {
      ...turn,
      smooth: {
        ...turn.smooth,
        components: turn.smooth.components.map((component, index) => ({
          ...component,
          text: index === 0 ? input.nextText : component.text,
        })),
      },
    };
  });

  expectOk(
    await input.store.writeTurns({
      threadId: input.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: nextTurns,
      turnState: snapshot.thread.status.turnState,
    }),
  );
}
