import assert from "node:assert/strict";
import test from "node:test";

import {
  maintainAsyncThread,
  prepareAsyncThread,
} from "../../src/thread/async-thread/services/async-thread-run-service.js";
import { makeChunkState, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedPlaceholderThread,
} from "../thread-view/helpers.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  type BriefChunkMaterializedTokenCountRecord,
  type ChunkSmoothMaterializedTokenCountRecord,
  type DetailedChunkMaterializedTokenCountRecord,
  type RawTurnMaterializedTokenCountRecord,
  type SmoothTurnMaterializedTokenCountRecord,
  type TokenCountRecord,
} from "../../src/token-accounting/index.js";
import type { MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";

function exactFromExpected<TRecord extends TokenCountRecord>(
  expected: TRecord,
  count: number,
  model = "gpt-test-maintenance",
): TRecord {
  return assertTokenCountRecord({
    count,
    scope: expected.scope,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model,
    representationHash: expected.representationHash,
    sourceRevision: expected.sourceRevision,
    createdAt: "2026-05-13T12:00:00.000Z",
    provenance: "tests.thread.async-thread-run-service.exact-counter",
  }) as TRecord;
}

class FakeOpenAIInputTokenCounter {
  readonly calls: string[] = [];

  async countRawTurnMaterialized(input: { turn: TurnRecord; messages: readonly MessageRecord[]; model?: string }) {
    this.calls.push(`raw:${input.turn.turnId}`);
    return exactFromExpected(
      countRawTurnMaterialized({ turn: input.turn, messages: input.messages }),
      1_000 + this.calls.length,
      input.model,
    ) as RawTurnMaterializedTokenCountRecord;
  }

  async countSmoothTurnMaterialized(turn: TurnRecord, options: { model?: string } = {}) {
    this.calls.push(`smooth:${turn.turnId}`);
    return exactFromExpected(
      countSmoothTurnMaterialized(turn),
      2_000 + this.calls.length,
      options.model,
    ) as SmoothTurnMaterializedTokenCountRecord;
  }

  async countChunkSmoothMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`chunk:${chunk.chunkId}`);
    return exactFromExpected(
      countChunkSmoothMaterialized(chunk),
      3_000 + this.calls.length,
      options.model,
    ) as ChunkSmoothMaterializedTokenCountRecord;
  }

  async countDetailedChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`detailed:${chunk.chunkId}`);
    return exactFromExpected(
      countDetailedChunkMaterialized(chunk),
      4_000 + this.calls.length,
      options.model,
    ) as DetailedChunkMaterializedTokenCountRecord;
  }

  async countBriefChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`brief:${chunk.chunkId}`);
    return exactFromExpected(
      countBriefChunkMaterialized(chunk),
      5_000 + this.calls.length,
      options.model,
    ) as BriefChunkMaterializedTokenCountRecord;
  }
}

test("missing smooth output blocks dependent work explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.middleNewer.turnId
          ? {
              ...turn,
              smooth: undefined,
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.smoothReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "SMOOTH_MISSING"), true);
  });
});

test("incomplete component smooth state blocks dependent async work", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const target = snapshot.value.turns.find((turn) => turn.turnId === context.turns.middleNewer.turnId);
    assert.ok(target);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.middleNewer.turnId
          ? {
              ...turn,
              smooth: {
                ...turn.smooth,
                schemaVersion: "component_smooth_turn_v1",
                status: "ready",
                strategy: "component_smooth_turn_v1",
                components: turn.smooth?.components?.filter((component) => component.kind === "user_prompt"),
              },
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.smoothReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "SMOOTH_MISSING"), true);
  });
});

test("missing placeholder output blocks lower-band use explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedMissingDetailedPlaceholderThread(storeRootDir);

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.placeholdersReady, true);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), false);
  });
});

test("invalid chunk state is reported explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: "chunk-invalid-open-alpha",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.oldest.turnId],
          smoothText: "invalid open alpha",
          smoothTokenCountMetadata: { count: 3, scope: "chunk_smooth_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-chunk-3", createdAt: "2026-01-01T00:00:00.000Z" },
          placeholders: undefined,
        }),
        makeChunkState({
          chunkId: "chunk-invalid-open-beta",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.middleOlder.turnId],
          smoothText: "invalid open beta",
          smoothTokenCountMetadata: { count: 3, scope: "chunk_smooth_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-chunk-3", createdAt: "2026-01-01T00:00:00.000Z" },
          placeholders: undefined,
        }),
      ],
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.chunksReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_STATE_INVALID"), true);
  });
});

test("empty open chunk is valid while empty closed chunk is rejected", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: "chunk-valid-open-empty",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [],
          smoothText: undefined,
          smoothTokenCountMetadata: { count: 0, scope: "chunk_smooth_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-chunk-0", createdAt: "2026-01-01T00:00:00.000Z" },
          placeholders: undefined,
        }),
      ],
    });

    const openChunkResult = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(openChunkResult.blockers.some((issue) => issue.code === "CHUNK_STATE_INVALID"), false);

    const refreshed = await context.threadStore.openThread(context.threadId);
    assert.equal(refreshed.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: refreshed.value.thread.sourceRevision,
      expectedMessageHighWatermark: refreshed.value.thread.messageHighWatermark,
      expectedTurnsRevision: refreshed.value.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: "chunk-invalid-closed-empty",
          threadId: context.threadId,
          lifecycleStatus: "closed",
          sourceTurnIds: [],
          smoothText: "closed empty",
          smoothTokenCountMetadata: { count: 2, scope: "chunk_smooth_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-chunk-2", createdAt: "2026-01-01T00:00:00.000Z" },
          placeholders: undefined,
        }),
      ],
    });

    const closedChunkResult = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(closedChunkResult.blockers.some((issue) => issue.code === "CHUNK_STATE_INVALID"), true);
  });
});

test("invalid Thread View materialization state is reported explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.newest.turnId
          ? {
              ...turn,
              messageIds: [...turn.messageIds, "message-missing-materialization"],
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
      },
      {
        store: context.threadStore,
      },
    );

    assert.equal(result.chunksReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT"), true);
  });
});

test("normal async maintenance writes exact counts for new deterministic artifacts", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const initialSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(initialSnapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: initialSnapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: initialSnapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: initialSnapshot.value.thread.turnsRevision,
      turns: initialSnapshot.value.turns.map((turn) => ({
        ...turn,
        rawTokenCountMetadata: undefined,
        smooth: undefined,
      })),
      turnState: initialSnapshot.value.thread.status.turnState,
    });

    const postTurnsSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(postTurnsSnapshot.ok, true);
    const initialChunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(initialChunks.ok, true);
    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: postTurnsSnapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: postTurnsSnapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: postTurnsSnapshot.value.thread.turnsRevision,
      chunks: initialChunks.value.map((chunk) =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              smoothTokenCountMetadata: countChunkSmoothMaterialized(chunk),
              placeholders: undefined,
            }
          : chunk,
      ),
    });

    const counter = new FakeOpenAIInputTokenCounter();
    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.artifactsReady, true);
    assert.equal(result.tokenCountsReady, true);
    assert.deepEqual(result.blockers, []);

    const maintainedSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(maintainedSnapshot.ok, true);
    assert.equal(maintainedSnapshot.value.thread.status.tokenCounting?.status, "ready");
    assert.equal(maintainedSnapshot.value.thread.status.tokenCounting?.issueCount, 0);
    const maintainedTurn = maintainedSnapshot.value.turns.find((turn) => turn.turnId === context.turns.oldest.turnId);
    assert.equal(maintainedTurn?.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(maintainedTurn?.rawTokenCountMetadata?.trustClass, "exact");
    assert.equal(maintainedTurn?.rawTokenCountMetadata?.model, "gpt-test-maintenance");
    assert.equal(maintainedTurn?.smooth?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(maintainedTurn?.smooth?.tokenCountMetadata?.trustClass, "exact");

    const maintainedChunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(maintainedChunks.ok, true);
    const maintainedChunk = maintainedChunks.value.find((chunk) => chunk.chunkId === context.chunks.newerClosed);
    assert.equal(maintainedChunk?.smoothTokenCountMetadata?.source, "provider_input_count");
    assert.equal(maintainedChunk?.placeholders?.detailed?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(maintainedChunk?.placeholders?.brief?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(typeof maintainedChunk?.placeholders?.detailed?.text, "string");
    assert.equal(typeof maintainedChunk?.placeholders?.brief?.text, "string");

    const callCountAfterFirstRun = counter.calls.length;
    const secondResult = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(secondResult.tokenCountsReady, true);
    assert.equal(counter.calls.length, callCountAfterFirstRun);
  });
});

test("normal async maintenance leaves repair-needed token metadata when exact counting fails", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const initialSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(initialSnapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: initialSnapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: initialSnapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: initialSnapshot.value.thread.turnsRevision,
      turns: initialSnapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.oldest.turnId
          ? {
              ...turn,
              rawTokenCountMetadata: undefined,
              smooth: undefined,
            }
          : turn,
      ),
      turnState: initialSnapshot.value.thread.status.turnState,
    });

    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: {
          async countRawTurnMaterialized() {
            throw new Error("simulated count outage");
          },
          async countSmoothTurnMaterialized() {
            throw new Error("simulated count outage");
          },
          async countChunkSmoothMaterialized() {
            throw new Error("simulated count outage");
          },
          async countDetailedChunkMaterialized() {
            throw new Error("simulated count outage");
          },
          async countBriefChunkMaterialized() {
            throw new Error("simulated count outage");
          },
        },
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.artifactsReady, true);
    assert.equal(result.tokenCountsReady, false);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);

    const maintainedSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(maintainedSnapshot.ok, true);
    assert.equal(maintainedSnapshot.value.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(maintainedSnapshot.value.thread.status.tokenCounting?.issueCount, 1);
    assert.equal(
      maintainedSnapshot.value.thread.status.tokenCounting?.issues?.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"),
      true,
    );
    const maintainedTurn = maintainedSnapshot.value.turns.find((turn) => turn.turnId === context.turns.oldest.turnId);
    assert.equal(maintainedTurn?.rawTokenCountMetadata?.source, "pi_heuristic");
    assert.notEqual(maintainedTurn?.rawTokenCountMetadata?.trustClass, "exact");
    assert.equal(maintainedTurn?.smooth?.tokenCountMetadata?.source, "pi_heuristic");
    assert.notEqual(maintainedTurn?.smooth?.tokenCountMetadata?.trustClass, "exact");
  });
});
