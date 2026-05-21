import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  repairThreadMaintenance,
  type ThreadMaintenanceRepairResult,
} from "../../src/thread/async-thread/services/thread-maintenance-repair-service.js";
import {
  LOWER_BAND_BRIEF_PROMPT_VERSION,
  LOWER_BAND_DETAIL_PROMPT_VERSION,
  type LowerBandCompressionProvider,
  type LowerBandCompressionProviderInput,
} from "../../src/thread/async-thread/services/lower-band-compression-service.js";
import {
  makeChunkLowerBandArtifacts,
  makeChunkState,
} from "../../src/thread/async-thread/test/fixtures.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import type { MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  countTurnLowerBandProjectionMaterialized,
  type TokenCountRecord,
} from "../../src/token-accounting/index.js";
import {
  seedDeterministicRebuildThreadWithOptions,
} from "../thread-view/helpers.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function exactFromExpected<TRecord extends TokenCountRecord>(expected: TRecord, count: number, model = "gpt-test-maintenance"): TRecord {
  return assertTokenCountRecord({
    ...expected,
    count,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model,
    createdAt: "2026-05-20T00:00:00.000Z",
    provenance: "tests.thread.thread-maintenance-repair-service.exact-counter",
  }) as TRecord;
}

class FakeOpenAIInputTokenCounter {
  readonly calls: string[] = [];

  async countRawTurnMaterialized(input: { turn: TurnRecord; messages: readonly MessageRecord[]; model?: string }) {
    this.calls.push(`raw:${input.turn.turnId}`);
    return exactFromExpected(countRawTurnMaterialized({ turn: input.turn, messages: input.messages }), 1_000 + this.calls.length, input.model);
  }

  async countSmoothTurnMaterialized(turn: TurnRecord, options: { model?: string } = {}) {
    this.calls.push(`smooth:${turn.turnId}`);
    return exactFromExpected(countSmoothTurnMaterialized(turn), 2_000 + this.calls.length, options.model);
  }

  async countTurnLowerBandProjectionMaterialized(input: { text: string; sourceRevision?: number; model?: string }) {
    this.calls.push(`projection:${input.sourceRevision ?? "unknown"}`);
    return exactFromExpected(countTurnLowerBandProjectionMaterialized(input), 6_000 + this.calls.length, input.model);
  }

  async countChunkSmoothMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`chunk:${chunk.chunkId}`);
    return exactFromExpected(countChunkSmoothMaterialized(chunk), 3_000 + this.calls.length, options.model);
  }

  async countDetailedChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`detailed:${chunk.chunkId}`);
    return exactFromExpected(countDetailedChunkMaterialized(chunk), 4_000 + this.calls.length, options.model);
  }

  async countBriefChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`brief:${chunk.chunkId}`);
    return exactFromExpected(countBriefChunkMaterialized(chunk), 5_000 + this.calls.length, options.model);
  }
}

class FakeLowerBandProvider implements LowerBandCompressionProvider {
  readonly calls: LowerBandCompressionProviderInput[] = [];
  fail = false;

  async compress(input: LowerBandCompressionProviderInput) {
    this.calls.push(input);
    if (this.fail) {
      throw new Error(`simulated lower-band failure for ${input.chunkId}/${input.band}`);
    }

    return {
      text: `${input.band} semantic repair for ${input.chunkId}`,
      providerId: "openai-codex" as const,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      promptVersion: input.band === "detailed" ? LOWER_BAND_DETAIL_PROMPT_VERSION : LOWER_BAND_BRIEF_PROMPT_VERSION,
      usage: { inputTokens: input.transcriptText.length },
      elapsedMs: 1,
      generatedAt: "2026-05-20T00:00:00.000Z",
    };
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("already-ready no-op returns useful report and does not write generated session output", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveThreadPath }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const provider = new FakeLowerBandProvider();
    const counter = new FakeOpenAIInputTokenCounter();

    const first = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: counter },
    );
    assert.equal(first.ok, true);
    provider.calls.length = 0;

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: counter },
    );

    assert.equal(result.ok, true);
    assert.equal(result.value.threadId, context.threadId);
    assert.equal(result.value.summary.failed, 0);
    assert.equal(result.value.summary.alreadyReady > 0, true);
    assert.equal(provider.calls.length, 0);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    assert.equal(snapshot.thread.threadViewOutputSummary?.generatedOutput, undefined);
    assert.equal(await pathExists(resolveThreadPath(context.threadId, "generated")), false);
  });
});

test("deterministic artifact repair restores smooth turns, lower-band projections, and chunk state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    expectOk(await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: snapshot.turns.map((turn) =>
        turn.turnId === context.turns.middleNewer.turnId
          ? { ...turn, smooth: undefined, rawTokenCountMetadata: undefined }
          : { ...turn, smooth: turn.smooth ? { ...turn.smooth, lowerBandProjection: undefined } : turn.smooth },
      ),
      turnState: snapshot.thread.status.turnState,
    }));

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: new FakeLowerBandProvider(), openAIInputTokenCounter: new FakeOpenAIInputTokenCounter() },
    );

    assert.equal(result.ok, true);
    assert.equal(result.value.phases.smoothTurns.repaired > 0, true);
    assert.equal(result.value.phases.lowerBandTurnProjections.repaired > 0, true);
    assert.equal(result.value.phases.chunks.repaired > 0, true);
    const after = expectOk(await context.threadStore.openThread(context.threadId));
    assert.ok(after.turns.find((turn) => turn.turnId === context.turns.middleNewer.turnId)?.smooth);
    assert.ok(after.turns.every((turn) => turn.lifecycleStatus !== "closed" || turn.smooth?.lowerBandProjection?.status === "ready"));
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    assert.equal(chunks.some((chunk) => chunk.lifecycleStatus === "closed" && "lowerBand" in chunk), true);
  });
});

test("awaited lower-band repair persists detailed and brief artifacts before returning", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    expectOk(await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      chunks: chunks.map((chunk) =>
        chunk.chunkId === context.chunks.newerClosed
          ? makeChunkState({ ...(chunk as any), placeholders: undefined, lowerBand: makeChunkLowerBandArtifacts({ detailed: { band: "detailed", status: "pending" }, brief: { band: "brief", status: "pending" } }) })
          : chunk,
      ),
    }));
    const provider = new FakeLowerBandProvider();

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: new FakeOpenAIInputTokenCounter() },
    );

    assert.equal(result.ok, true);
    assert.equal(provider.calls.some((call) => call.chunkId === context.chunks.newerClosed && call.band === "detailed"), true);
    assert.equal(provider.calls.some((call) => call.chunkId === context.chunks.newerClosed && call.band === "brief"), true);
    assert.equal(result.value.phases.lowerBandChunks.repaired >= 2, true);
    const afterChunks = expectOk(await context.threadStore.readChunks(context.threadId));
    const repaired = afterChunks.find((chunk) => chunk.chunkId === context.chunks.newerClosed);
    assert.equal(repaired?.lowerBand?.detailed?.status, "ready");
    assert.equal(repaired?.lowerBand?.brief?.status, "ready");
  });
});

test("exact token repair replaces heuristic metadata and clears tokenCounting repair status", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const heuristicRaw = { ...snapshot.turns[0]!.rawTokenCountMetadata!, source: "pi_heuristic", trustClass: "heuristic", provider: undefined, model: undefined };
    const heuristicSmooth = { ...snapshot.turns[0]!.smooth!.tokenCountMetadata!, source: "pi_heuristic", trustClass: "heuristic", provider: undefined, model: undefined };
    expectOk(await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: snapshot.turns.map((turn, index) => index === 0 ? { ...turn, rawTokenCountMetadata: heuristicRaw as any, smooth: { ...turn.smooth!, tokenCountMetadata: heuristicSmooth as any } } : turn),
      turnState: snapshot.thread.status.turnState,
    }));
    const statusSnapshot = expectOk(await context.threadStore.openThread(context.threadId));
    expectOk(await context.threadStore.updateThreadMetadata({
      threadId: context.threadId,
      expectedSourceRevision: statusSnapshot.thread.sourceRevision,
      patch: { status: { ...statusSnapshot.thread.status, tokenCounting: { status: "repair_needed", issueCount: 1, updatedAt: "2026-05-20T00:00:00.000Z" } } },
    }));

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: new FakeLowerBandProvider(), openAIInputTokenCounter: new FakeOpenAIInputTokenCounter() },
    );

    assert.equal(result.ok, true);
    assert.equal(result.value.phases.tokenCounts.repaired > 0, true);
    const after = expectOk(await context.threadStore.openThread(context.threadId));
    assert.equal(after.thread.status.tokenCounting?.status, "ready");
    assert.equal(after.turns[0]?.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(after.turns[0]?.smooth?.tokenCountMetadata?.trustClass, "exact");
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    assert.equal(chunks.every((chunk) => chunk.lifecycleStatus !== "closed" || chunk.smoothTokenCountMetadata?.source === "provider_input_count"), true);
    assert.equal(chunks.every((chunk) => chunk.lifecycleStatus !== "closed" || chunk.lowerBand?.detailed?.tokenCountMetadata?.source === "provider_input_count"), true);
    assert.equal(chunks.every((chunk) => chunk.lifecycleStatus !== "closed" || chunk.lowerBand?.brief?.tokenCountMetadata?.trustClass === "exact"), true);
  });
});

test("lower-band provider failure is persisted and reported explicitly", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    expectOk(await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      chunks: chunks.map((chunk) =>
        chunk.chunkId === context.chunks.newerClosed
          ? makeChunkState({ ...(chunk as any), placeholders: undefined, lowerBand: makeChunkLowerBandArtifacts({ detailed: { band: "detailed", status: "pending" } }) })
          : chunk,
      ),
    }));
    const provider = new FakeLowerBandProvider();
    provider.fail = true;

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: new FakeOpenAIInputTokenCounter() },
    );

    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.message.includes(context.chunks.newerClosed)), true);
    const chunksAfter = expectOk(await context.threadStore.readChunks(context.threadId));
    const failed = chunksAfter.find((chunk) => chunk.chunkId === context.chunks.newerClosed);
    assert.equal(failed?.lowerBand?.detailed?.status, "failed");
  });
});

test("15-16k char chunk transcript is not truncated below estimated-token cap", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    const text = "x".repeat(15_500);
    expectOk(await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      chunks: chunks.map((chunk) =>
        chunk.chunkId === context.chunks.newerClosed
          ? makeChunkState({
              ...(chunk as any),
              placeholders: undefined,
              conversationTranscript: { status: "ready", text, sourceFingerprint: "sha256:long", sourceRevision: 1, updatedAt: "2026-05-20T00:00:00.000Z" },
              lowerBand: makeChunkLowerBandArtifacts({ detailed: { band: "detailed", status: "pending" } }),
            })
          : chunk,
      ),
    }));
    const provider = new FakeLowerBandProvider();

    const result = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: new FakeOpenAIInputTokenCounter() },
    );

    assert.equal(result.ok, true);
    const detailedCall = provider.calls.find((call) => call.chunkId === context.chunks.newerClosed && call.band === "detailed");
    assert.equal(detailedCall?.transcriptText.length, text.length);
    assert.equal(result.value.warnings.some((warning) => warning.includes("truncat")), false);
  });
});

test("second repair run is idempotent and reports already-ready/skipped work", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveThreadPath }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const provider = new FakeLowerBandProvider();
    const counter = new FakeOpenAIInputTokenCounter();
    const first = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: counter },
    );
    assert.equal(first.ok, true);
    const callsAfterFirst = provider.calls.length;

    const second = await repairThreadMaintenance(
      { threadId: context.threadId },
      { store: context.threadStore, lowerBandCompressionProvider: provider, openAIInputTokenCounter: counter },
    );

    assert.equal(second.ok, true);
    assert.equal(second.value.summary.failed, 0);
    assert.equal(second.value.summary.alreadyReady >= second.value.summary.repaired, true);
    assert.equal(provider.calls.length, callsAfterFirst);
    assert.equal(await pathExists(resolveThreadPath(context.threadId, "generated")), false);
  });
});
