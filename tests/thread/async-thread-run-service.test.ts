import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  maintainAsyncThread,
  prepareAsyncThread,
} from "../../src/thread/async-thread/services/async-thread-run-service.js";
import {
  LOWER_BAND_BRIEF_PROMPT_VERSION,
  LOWER_BAND_DETAIL_PROMPT_VERSION,
  type LowerBandCompressionProvider,
  type LowerBandCompressionProviderInput,
} from "../../src/thread/async-thread/services/lower-band-compression-service.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeChunkLowerBandArtifacts,
  makeChunkState,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedDeterministicRebuildThreadWithOptions,
  seedMissingDetailedLowerBandArtifactThread,
} from "../thread-view/helpers.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  countTurnLowerBandProjectionMaterialized,
  type BriefChunkMaterializedTokenCountRecord,
  type ChunkSmoothMaterializedTokenCountRecord,
  type DetailedChunkMaterializedTokenCountRecord,
  type RawTurnMaterializedTokenCountRecord,
  type SmoothTurnMaterializedTokenCountRecord,
  type TokenCountRecord,
  type TurnLowerBandProjectionMaterializedTokenCountRecord,
} from "../../src/token-accounting/index.js";
import type { MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";

async function waitForAssertion(
  assertion: () => Promise<void> | void,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(10);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${description}: ${lastError.message}`;
    throw lastError;
  }

  throw new Error(description);
}

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
  failProjectionCount = false;

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

  async countTurnLowerBandProjectionMaterialized(input: {
    text: string;
    sourceRevision?: number;
    model?: string;
  }) {
    this.calls.push(`projection:${input.sourceRevision ?? "unknown"}`);
    if (this.failProjectionCount) {
      throw new Error("simulated projection count outage");
    }

    return exactFromExpected(
      countTurnLowerBandProjectionMaterialized({
        text: input.text,
        sourceRevision: input.sourceRevision,
      }),
      6_000 + this.calls.length,
      input.model,
    ) as TurnLowerBandProjectionMaterializedTokenCountRecord;
  }
}

function toCanonicalSemanticChunk(chunk: ChunkState): ChunkState {
  return makeChunkState({
    chunkId: chunk.chunkId,
    threadId: chunk.threadId,
    lifecycleStatus: chunk.lifecycleStatus,
    sourceTurnIds: [...chunk.sourceTurnIds],
    smoothText: chunk.smoothText,
    smoothTokenCountMetadata: chunk.smoothTokenCountMetadata,
    openedAt: chunk.openedAt,
    closedAt: chunk.closedAt,
    closeReason: chunk.closeReason,
    sourceRevision: chunk.sourceRevision,
    conversationTranscript: {
      status: "ready",
      text: `> transcript ${chunk.chunkId}`,
      sourceFingerprint: `sha256:${chunk.chunkId}:conversation`,
      sourceRevision: chunk.sourceRevision ?? 1,
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: {
        band: "detailed",
        status: "ready",
        text: `semantic detailed ${chunk.chunkId}`,
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
      brief: {
        band: "brief",
        status: "ready",
        text: `semantic brief ${chunk.chunkId}`,
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
    }),
  });
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

test("missing lower-band output blocks lower-band use explicitly", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedMissingDetailedLowerBandArtifactThread(storeRootDir);

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

    assert.equal(result.lowerBandReady, true);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
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
        artifactRepairLimits: { maxSmoothTurns: Number.POSITIVE_INFINITY, maxProjectionTurns: Number.POSITIVE_INFINITY },
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
    const secondRunCalls = counter.calls.slice(callCountAfterFirstRun);
    assert.equal(
      secondRunCalls.length === 0 ||
        JSON.stringify(secondRunCalls) ===
          JSON.stringify([`chunk:${context.chunks.openRecent}`]),
      true,
    );
  });
});

test("background async maintenance bounds lower-band projection catch-up", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
        artifactRepairLimits: { maxProjectionTurns: 2 },
      },
    );

    assert.equal(result.artifactsReady, false);
    assert.equal(result.blockers.some((issue) => issue.message.includes("projection repair limit")), true);
    assert.equal(counter.calls.filter((call) => call.startsWith("projection:")).length, 2);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    assert.equal(
      snapshot.value.turns.filter((turn) => turn.smooth?.lowerBandProjection?.tokenCountMetadata?.source === "provider_input_count").length,
      2,
    );
  });
});

test("background async maintenance bounds smooth turn catch-up", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const initialSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(initialSnapshot.ok, true);
    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: initialSnapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: initialSnapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: initialSnapshot.value.thread.turnsRevision,
      turns: initialSnapshot.value.turns.map((turn) => ({ ...turn, smooth: undefined })),
      turnState: initialSnapshot.value.thread.status.turnState,
    });

    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        artifactRepairLimits: { maxSmoothTurns: 2, maxProjectionTurns: 0 },
      },
    );

    assert.equal(result.artifactsReady, false);
    assert.equal(result.blockers.some((issue) => issue.message.includes("smooth repair limit")), true);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.value.turns.filter((turn) => turn.smooth !== undefined).length, 2);
  });
});

test("prepare async thread remains full catch-up for dirty projections", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 10_000,
        requestedBandPercentages: { fullFidelity: 25, smooth: 25, detailed: 25, brief: 25 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        lowerBandCompressionEnabled: false,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.blockers.length, 0);
    assert.equal(counter.calls.filter((call) => call.startsWith("projection:")).length, 4);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    assert.equal(
      snapshot.value.turns.every((turn) => turn.smooth?.lowerBandProjection?.tokenCountMetadata?.source === "provider_input_count"),
      true,
    );
  });
});

test("default background async maintenance does not repair all historical projections", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    const projectionCalls = counter.calls.filter((call) => call.startsWith("projection:"));
    assert.equal(projectionCalls.length < 4, true);
    assert.equal(result.blockers.some((issue) => issue.message.includes("projection repair limit")), true);
  });
});

test("bounded projection maintenance is sequential and capped", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();

    await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        artifactRepairLimits: { maxProjectionTurns: 2 },
      },
    );

    assert.equal(counter.calls.filter((call) => call.startsWith("projection:")).length, 2);
  });
});

test("background exact token repair is bounded and leaves remaining debt visible", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
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
        smooth: turn.smooth ? { ...turn.smooth, tokenCountMetadata: undefined } : turn.smooth,
      })),
      turnState: initialSnapshot.value.thread.status.turnState,
    });
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        artifactRepairLimits: {
          maxSmoothTurns: Number.POSITIVE_INFINITY,
          maxProjectionTurns: Number.POSITIVE_INFINITY,
          maxTokenTurns: 2,
          maxTokenChunks: 0,
        },
      },
    );

    assert.equal(result.tokenCountsReady, false);
    assert.equal(result.blockers.some((issue) => issue.message.includes("exact token repair limit")), true);
    assert.equal(counter.calls.filter((call) => call.startsWith("raw:")).length, 2);
    assert.equal(counter.calls.filter((call) => call.startsWith("smooth:")).length, 2);
    const after = await context.threadStore.openThread(context.threadId);
    assert.equal(after.ok, true);
    assert.equal(after.value.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(after.value.turns.filter((turn) => turn.rawTokenCountMetadata?.source === "provider_input_count").length, 2);
  });
});

test("prepare async thread drains exact token-count repair without background bounds", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
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
        smooth: turn.smooth ? { ...turn.smooth, tokenCountMetadata: undefined } : turn.smooth,
      })),
      turnState: initialSnapshot.value.thread.status.turnState,
    });
    const counter = new FakeOpenAIInputTokenCounter();

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 10_000,
        requestedBandPercentages: { fullFidelity: 25, smooth: 25, detailed: 25, brief: 25 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        lowerBandCompressionEnabled: false,
      },
    );

    assert.equal(result.blockers.length, 0);
    assert.equal(counter.calls.filter((call) => call.startsWith("raw:")).length, 4);
    assert.equal(counter.calls.filter((call) => call.startsWith("smooth:")).length, 4);
    const after = await context.threadStore.openThread(context.threadId);
    assert.equal(after.ok, true);
    assert.equal(after.value.turns.every((turn) => turn.rawTokenCountMetadata?.source === "provider_input_count"), true);
  });
});

test("normal async maintenance schedules semantic lower-band compression on chunk close without waiting on model latency", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const counter = new FakeOpenAIInputTokenCounter();
    const providerCalls: LowerBandCompressionProviderInput[] = [];
    let providerReleased = false;
    let compressedChunkId: string | undefined;
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = () => {
        providerReleased = true;
        resolve();
      };
    });
    const provider: LowerBandCompressionProvider = {
      async compress(input) {
        providerCalls.push(input);
        await providerRelease;
        const outputText = input.band === "detailed"
          ? "D".repeat(Math.max(1, Math.ceil(input.transcriptText.length * 0.2)))
          : "B".repeat(Math.max(1, Math.ceil(input.transcriptText.length * 0.05)));
        return {
          text: outputText,
          providerId: "openai-codex",
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          promptVersion: input.promptVersion,
          elapsedMs: 75,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
        };
      },
    };

    const maintenance = maintainAsyncThread(
      { threadId: context.threadId },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
        lowerBandCompressionProvider: provider,
        artifactRepairLimits: { maxSmoothTurns: Number.POSITIVE_INFINITY, maxProjectionTurns: Number.POSITIVE_INFINITY },
      },
    );

    await waitForAssertion(() => {
      assert.equal(providerCalls.length, 1);
      assert.equal(providerCalls[0]?.band, "detailed");
      assert.equal(providerCalls[0]?.promptVersion, LOWER_BAND_DETAIL_PROMPT_VERSION);
    }, "async maintenance should schedule detailed lower-band generation");

    const race = await Promise.race([
      maintenance.then((result) => ({ completed: true as const, result })),
      sleep(2_000).then(() => ({ completed: false as const })),
    ]);
    assert.equal(race.completed, true);
    assert.equal(providerReleased, false);
    if (race.completed) {
      assert.equal(race.result.artifactsReady, true);
    }

    releaseProvider();

    await waitForAssertion(() => {
      assert.equal(providerCalls.length, 2);
    }, "async maintenance should call detailed and brief lower-band providers");

    await waitForAssertion(async () => {
      const chunks = await context.threadStore.readChunks(context.threadId);
      assert.equal(chunks.ok, true);
      const targetChunkId = providerCalls[0]?.chunkId;
      const compressedChunk = chunks.value.find((chunk) => chunk.chunkId === targetChunkId);
      compressedChunkId = compressedChunk?.chunkId;
      assert.equal(compressedChunk?.lowerBand?.detailed?.status, "ready");
      assert.equal(compressedChunk?.lowerBand?.brief?.status, "ready");
      assert.ok((compressedChunk?.lowerBand?.detailed?.text ?? "").length > 0);
      assert.ok((compressedChunk?.lowerBand?.brief?.text ?? "").length > 0);
      assert.equal(compressedChunk?.lowerBand?.detailed?.tokenCountMetadata?.source, "provider_input_count");
      assert.equal(compressedChunk?.lowerBand?.detailed?.tokenCountMetadata?.trustClass, "exact");
      assert.equal(compressedChunk?.lowerBand?.brief?.tokenCountMetadata?.source, "provider_input_count");
      assert.equal(compressedChunk?.lowerBand?.brief?.tokenCountMetadata?.trustClass, "exact");
    }, "async maintenance should persist detailed and brief lower-band artifacts");

    assert.deepEqual(
      providerCalls.map((call) => [call.band, call.promptVersion]),
      [
        ["detailed", LOWER_BAND_DETAIL_PROMPT_VERSION],
        ["brief", LOWER_BAND_BRIEF_PROMPT_VERSION],
      ],
    );
    assert.equal(providerCalls[0]?.transcriptText, providerCalls[1]?.transcriptText);
    assert.equal(typeof compressedChunkId, "string");
    assert.equal(counter.calls.some((call) => call === `detailed:${compressedChunkId}`), true);
    assert.equal(counter.calls.some((call) => call === `brief:${compressedChunkId}`), true);
  });
});

test("prepare mode materializes conversation-only turn projections through production readiness", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const initialSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(initialSnapshot.ok, true);
    assert.equal(
      initialSnapshot.value.turns.some((turn) => turn.smooth?.lowerBandProjection),
      false,
    );

    const counter = new FakeOpenAIInputTokenCounter();
    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.blockers.some((issue) => issue.message.includes("lower-band projection")), false);
    assert.equal(counter.calls.some((call) => call.startsWith("projection:")), true);

    const preparedSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(preparedSnapshot.ok, true);
    const projectedTurns = preparedSnapshot.value.turns.filter((turn) => turn.lifecycleStatus === "closed");
    assert.equal(projectedTurns.length > 0, true);
    assert.equal(
      projectedTurns.every(
        (turn) =>
          turn.smooth?.lowerBandProjection?.status === "ready" &&
          turn.smooth.lowerBandProjection.tokenCountMetadata?.scope === "turn_lower_band_projection_materialized" &&
          turn.smooth.lowerBandProjection.tokenCountMetadata.source === "provider_input_count",
      ),
      true,
    );
  });
});

test("prepare readiness blocks lower-band eligibility when projection exact token count fails", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const counter = new FakeOpenAIInputTokenCounter();
    counter.failProjectionCount = true;

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(counter.calls.some((call) => call.startsWith("projection:")), true);
    assert.equal(
      result.blockers.some(
        (issue) =>
          issue.code === "TOKEN_COUNT_BLOCKED" &&
          issue.message.includes("conversation-only lower-band projection token count"),
      ),
      true,
    );

    const preparedSnapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(preparedSnapshot.ok, true);
    assert.equal(
      preparedSnapshot.value.turns.some(
        (turn) =>
          turn.smooth?.lowerBandProjection?.status === "failed" &&
          turn.smooth.lowerBandProjection.errorCode === "LOWER_BAND_PROJECTION_TOKEN_COUNT_FAILED",
      ),
      true,
    );
  });
});

test("prepare readiness blocks legacy placeholder chunks unconditionally", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(
      result.blockers.some(
        (issue) =>
          issue.code === "CHUNK_STATE_INVALID" &&
          issue.cause === "legacy_placeholder_chunk_state" &&
          issue.message.includes("legacy placeholder-era"),
      ),
      true,
    );
  });
});

test("prepare-mode readiness accepts canonical semantic chunk artifacts without placeholder token metadata", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    const writeResult = await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk) =>
        chunk.lifecycleStatus === "closed" ? toCanonicalSemanticChunk(chunk) : chunk,
      ),
    });
    assert.equal(writeResult.ok, true);

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.lowerBandReady, true);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), false);
  });
});

test("strict readiness blocks canonical semantic chunks whose ready text lacks usable strict lower-band accounting", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    const writeResult = await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk) =>
        chunk.lifecycleStatus === "closed" ? toCanonicalSemanticChunk(chunk) : chunk,
      ),
    });
    assert.equal(writeResult.ok, true);

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "strict",
        requestedLowerBound: 1,
        requestedBandPercentages: { fullFidelity: 0, smooth: 0, detailed: 100, brief: 0 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.lowerBandReady, false);
    assert.equal(
      result.blockers.some((issue) =>
        issue.code === "TOKEN_COUNT_BLOCKED" &&
        issue.message.includes(`Chunk ${context.chunks.newerClosed} has ready detailed lower-band output`) &&
        issue.message.includes("strict smart compact cannot derive usable token accounting"),
      ),
      true,
    );
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

test("prepare-mode smooth catch-up writes visible stderr warnings", async () => {
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

    const counter = new FakeOpenAIInputTokenCounter();
    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await prepareAsyncThread(
        {
          threadId: context.threadId,
          mode: "prepare",
          requestedLowerBound: 30,
          requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        },
        {
          store: context.threadStore,
          openAIInputTokenCounter: counter,
          tokenCountModel: "gpt-test-maintenance",
        },
      );
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.equal(
      warnings.some((warning) =>
        warning.includes(`Smooth catch-up required for turn ${context.turns.middleNewer.turnId}`)),
      true,
    );
  });
});

test("prepare-mode lower-band catch-up regenerates selected semantic output with a visible chunk-and-band warning", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk): typeof chunk =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                detailed: undefined,
              },
            } as typeof chunk
          : chunk),
    });

    const providerCalls: LowerBandCompressionProviderInput[] = [];
    const provider: LowerBandCompressionProvider = {
      async compress(input) {
        providerCalls.push(input);
        return {
          text: "D".repeat(Math.max(1, Math.ceil(input.transcriptText.length * 0.2))),
          providerId: "openai-codex",
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          promptVersion: input.promptVersion,
          elapsedMs: 25,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
        };
      },
    };
    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const result = await prepareAsyncThread(
        {
          threadId: context.threadId,
          mode: "prepare",
          requestedLowerBound: 30,
          requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        },
        {
          store: context.threadStore,
          openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
          tokenCountModel: "gpt-test-maintenance",
          lowerBandCompressionProvider: provider,
        },
      );

      assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.equal(
      providerCalls.some(
        (call) => call.chunkId === context.chunks.newerClosed && call.band === "detailed",
      ),
      true,
    );
    assert.equal(
      warnings.some((warning) =>
        warning.includes(`Lower-band catch-up required for chunk ${context.chunks.newerClosed} (detailed)`)),
      true,
    );

    const repairedChunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(repairedChunks.ok, true);
    const repairedChunk = repairedChunks.value.find((chunk) => chunk.chunkId === context.chunks.newerClosed);
    assert.equal(repairedChunk?.lowerBand?.detailed?.status, "ready");
    assert.equal(typeof repairedChunk?.lowerBand?.detailed?.text, "string");
  });
});

test("prepare-mode lower-band catch-up regenerates selected brief semantic output with a visible chunk-and-band warning", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk): typeof chunk =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                brief: undefined,
              },
            } as typeof chunk
          : chunk),
    });

    const providerCalls: LowerBandCompressionProviderInput[] = [];
    const provider: LowerBandCompressionProvider = {
      async compress(input) {
        providerCalls.push(input);
        return {
          text: "B".repeat(Math.max(1, Math.ceil(input.transcriptText.length * 0.1))),
          providerId: "openai-codex",
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          promptVersion: input.promptVersion,
          elapsedMs: 25,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
        };
      },
    };
    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const result = await prepareAsyncThread(
        {
          threadId: context.threadId,
          mode: "prepare",
          requestedLowerBound: 30,
          requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 0, brief: 30 },
        },
        {
          store: context.threadStore,
          openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
          tokenCountModel: "gpt-test-maintenance",
          lowerBandCompressionProvider: provider,
        },
      );

      assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.equal(
      providerCalls.some(
        (call) => call.chunkId === context.chunks.newerClosed && call.band === "brief",
      ),
      true,
    );
    assert.equal(
      warnings.some((warning) =>
        warning.includes(`Lower-band catch-up required for chunk ${context.chunks.newerClosed} (brief)`)),
      true,
    );

    const repairedChunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(repairedChunks.ok, true);
    const repairedChunk = repairedChunks.value.find((chunk) => chunk.chunkId === context.chunks.newerClosed);
    assert.equal(repairedChunk?.lowerBand?.brief?.status, "ready");
    assert.equal(typeof repairedChunk?.lowerBand?.brief?.text, "string");
  });
});

test("prepare-mode reports a specific compact failure when smooth catch-up cannot repair a turn", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const target = context.turns.middleNewer;
    const assistantOnlyMessage = target.messages[1]!;

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === target.turnId
          ? {
              ...turn,
              messageIds: ["message-missing-prompt-for-catch-up", assistantOnlyMessage.messageId],
              initiatingMessageId: "message-missing-prompt-for-catch-up",
              sourceRange: {
                fromSourceOrder: assistantOnlyMessage.sourceOrder,
                toSourceOrder: assistantOnlyMessage.sourceOrder,
              },
              smooth: undefined,
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
      },
    );

    assert.equal(result.smoothReady, false);
    assert.equal(
      result.blockers.some((issue) =>
        issue.code === "SMOOTH_MISSING" &&
        issue.message.includes("Smooth catch-up failed during compact preparation:")),
      true,
    );
  });
});

test("prepare-mode lower-band catch-up failure blocks compact with a specific chunk-and-band error", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk): typeof chunk =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                detailed: undefined,
              },
            } as typeof chunk
          : chunk),
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
        lowerBandCompressionProvider: {
          async compress() {
            throw new Error("simulated selected-band catch-up outage");
          },
        },
      },
    );

    assert.equal(result.lowerBandReady, false);
    assert.equal(
      result.blockers.some((issue) =>
        issue.message.includes("Lower-band catch-up failed during compact preparation:") &&
        issue.message.includes(`Chunk ${context.chunks.newerClosed} failed detailed lower-band compression`)),
      true,
    );
  });
});

test("prepare-mode brief lower-band catch-up failure blocks compact with a specific chunk-and-band error", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, {
      canonicalClosedChunks: true,
    });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk): typeof chunk =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                brief: undefined,
              },
            } as typeof chunk
          : chunk),
    });

    const result = await prepareAsyncThread(
      {
        threadId: context.threadId,
        mode: "prepare",
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 0, brief: 30 },
      },
      {
        store: context.threadStore,
        openAIInputTokenCounter: new FakeOpenAIInputTokenCounter(),
        tokenCountModel: "gpt-test-maintenance",
        lowerBandCompressionProvider: {
          async compress() {
            throw new Error("simulated selected brief-band catch-up outage");
          },
        },
      },
    );

    assert.equal(result.lowerBandReady, false);
    assert.equal(
      result.blockers.some((issue) =>
        issue.message.includes("Lower-band catch-up failed during compact preparation:") &&
        issue.message.includes(`Chunk ${context.chunks.newerClosed} failed brief lower-band compression`)),
      true,
    );
  });
});
