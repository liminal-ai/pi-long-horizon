import assert from "node:assert/strict";
import test from "node:test";

import { appendSourceMessage, openOrCreateManagedThread } from "../../src/thread/services/thread-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import {
  buildDraftThreadView,
  estimateRawMessageTokenCount,
  resolveChunkSemanticArtifactAccounting,
} from "../../src/thread-view/services/thread-view-builder.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeChunkLowerBandArtifacts,
  makeChunkState,
  makeLegacyPlaceholderChunkState,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  type TokenCountRecord,
} from "../../src/token-accounting/index.js";
import type { CanonicalChunkState, ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedDeterministicRebuildThreadWithOptions,
  seedNoClosedChunkThread,
} from "./helpers.js";

const STAGE7_READY_LOWER_BOUND = 180;
const STAGE7_READY_BAND_PERCENTAGES = { fullFidelity: 50, smooth: 4, detailed: 13, brief: 33 } as const;

function toCanonicalSemanticChunk(chunk: ChunkState): CanonicalChunkState {
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

function withExactSemanticArtifactCounts(chunk: ChunkState): CanonicalChunkState {
  const semanticChunk = toCanonicalSemanticChunk(chunk);

  return {
    ...semanticChunk,
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: semanticChunk.lowerBand?.detailed
        ? {
            ...semanticChunk.lowerBand.detailed,
            tokenCountMetadata: providerInputCountFromExpected(countDetailedChunkMaterialized(semanticChunk)),
          }
        : undefined,
      brief: semanticChunk.lowerBand?.brief
        ? {
            ...semanticChunk.lowerBand.brief,
            tokenCountMetadata: providerInputCountFromExpected(countBriefChunkMaterialized(semanticChunk)),
          }
        : undefined,
    }),
  };
}

function providerInputCountFromExpected(expected: TokenCountRecord): TokenCountRecord {
  return assertTokenCountRecord({
    count: expected.count,
    scope: expected.scope,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: "gpt-test",
    representationHash: expected.representationHash,
    sourceRevision: expected.sourceRevision,
    createdAt: expected.createdAt,
    provenance: "tests.thread-view-builder.provider-input-count",
  });
}

test("rebuild accepts explicit run inputs", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "ready");
    assert.ok(result.resultingTokenCount !== undefined);
    assert.equal(result.resultingTokenCount! <= STAGE7_READY_LOWER_BOUND, true);

    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.status, "ready");
  });
});

test("rebuild rejects invalid run inputs", async () => {
  await assert.rejects(
    buildDraftThreadView({
      threadId: "thread-invalid",
      requestedLowerBound: 0,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
    }),
    /requestedLowerBound must be greater than 0/,
  );
});

test("full-fidelity selection starts from newest turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.fullFidelityBand.selectedIds, [context.turns.newest.turnId]);
  });
});

test("raw token estimates account for dense tool output characters", () => {
  const denseOutput = "x".repeat(2_000);
  const estimated = estimateRawMessageTokenCount(
    makeMessageRecord({
      actorType: "tool",
      messageKind: "tool_result",
      targetMetadata: {
        runtime: "pi",
        piRole: "toolResult",
        toolCallId: "tool-call-dense",
        toolName: "bash",
      },
      parts: [
        makePartRecord({
          partType: "tool_result",
          content: {
            output: denseOutput,
            toolCallId: "tool-call-dense",
            toolName: "bash",
          },
        }),
      ],
    }),
  );

  assert.equal(estimated >= 450, true);
});

test("full-fidelity allocation stops before an older dense tool-heavy turn", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const threadStore = new FileThreadStore(storeRootDir);
    const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const thread = await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-dense-full-fidelity",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    );
    assert.equal(thread.ok, true);

    const human = makeActorRecord({ actorId: "actor-dense-human", actorType: "human" });
    const agent = makeActorRecord({ actorId: "actor-dense-agent", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-dense-tool", actorType: "tool" });
    const append = async (message: ReturnType<typeof makeMessageRecord>, actor = human) => {
      const result = await appendSourceMessage({
        store: threadStore,
        threadId: thread.value.threadId,
        actor,
        message,
      });
      assert.equal(result.ok, true);
      return result.value;
    };

    const olderPrompt = await append(
      makeMessageRecord({
        messageId: "dense-older-prompt",
        threadId: thread.value.threadId,
        actorId: human.actorId,
        actorType: "human",
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "dense-older-prompt-part", content: "inspect logs" })],
      }),
      human,
    );
    const olderTool = await append(
      makeMessageRecord({
        messageId: "dense-older-tool",
        threadId: thread.value.threadId,
        actorId: tool.actorId,
        actorType: "tool",
        messageKind: "tool_result",
        targetMetadata: {
          runtime: "pi",
          piRole: "toolResult",
          toolCallId: "dense-call",
          toolName: "bash",
        },
        parts: [
          makePartRecord({
            partId: "dense-older-tool-part",
            partType: "tool_result",
            content: {
              output: "a".repeat(2_000),
              toolCallId: "dense-call",
              toolName: "bash",
            },
          }),
        ],
      }),
      tool,
    );
    const newestPrompt = await append(
      makeMessageRecord({
        messageId: "dense-newest-prompt",
        threadId: thread.value.threadId,
        actorId: human.actorId,
        actorType: "human",
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "dense-newest-prompt-part", content: "continue" })],
      }),
      human,
    );
    const newestResponse = await append(
      makeMessageRecord({
        messageId: "dense-newest-response",
        threadId: thread.value.threadId,
        actorId: agent.actorId,
        actorType: "agent",
        messageKind: "response",
        parts: [makePartRecord({ partId: "dense-newest-response-part", content: "ok" })],
      }),
      agent,
    );

    const snapshot = await threadStore.openThread(thread.value.threadId);
    assert.equal(snapshot.ok, true);
    const sourceRevision = snapshot.value.thread.sourceRevision;
    const turns = [
      makeTurnRecord({
        threadId: thread.value.threadId,
        turnId: "turn-dense-older",
        turnOrder: 1,
        lifecycleStatus: "closed",
        repairStatus: "ready",
        initiatingMessageId: olderPrompt.messageId,
        messageIds: [olderPrompt.messageId, olderTool.messageId],
        sourceRange: { fromSourceOrder: olderPrompt.sourceOrder, toSourceOrder: olderTool.sourceOrder },
        sourceRevision,
      }),
      makeTurnRecord({
        threadId: thread.value.threadId,
        turnId: "turn-dense-newest",
        turnOrder: 2,
        lifecycleStatus: "closed",
        repairStatus: "ready",
        initiatingMessageId: newestPrompt.messageId,
        messageIds: [newestPrompt.messageId, newestResponse.messageId],
        sourceRange: { fromSourceOrder: newestPrompt.sourceOrder, toSourceOrder: newestResponse.sourceOrder },
        sourceRevision,
      }),
    ];
    const writeTurns = await threadStore.writeTurns({
      threadId: thread.value.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: turns.map((turn) => {
        const messages = turn.turnId === "turn-dense-older"
          ? [olderPrompt, olderTool]
          : [newestPrompt, newestResponse];
        return {
          ...turn,
          rawTokenCountMetadata: providerInputCountFromExpected(countRawTurnMaterialized({ turn, messages })),
        };
      }),
      turnState: "ready",
    });
    assert.equal(writeTurns.ok, true);

    const result = await buildDraftThreadView(
      {
        threadId: thread.value.threadId,
        requestedLowerBound: 120,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      { threadStore, threadViewStore },
    );
    const opened = await threadViewStore.openThreadView(thread.value.threadId, result.draftThreadViewId);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.fullFidelityBand.selectedIds, ["turn-dense-newest"]);
  });
});

test("full-fidelity does not split turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.fullFidelityBand.selectedIds, [context.turns.newest.turnId]);
    assert.deepEqual(
      opened.value.view.emittedMessages
        .filter((message) => message.bandType === "full_fidelity")
        .map((message) => message.sourceReference),
      [
        `${context.turns.newest.turnId}/${context.turns.newest.messages[0].messageId}`,
        `${context.turns.newest.turnId}/${context.turns.newest.messages[1].messageId}`,
      ],
    );
  });
});

test("full-fidelity-only overage is explicit", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
  });
});

test("smooth band begins after full-fidelity region by default", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.smoothBand.selectedIds, [context.turns.middleNewer.turnId]);
  });
});

test("zero-percent smooth allocation preserves an explicitly empty smooth band", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.smoothBand.selectedIds, []);
    assert.deepEqual(
      opened.value.view.emittedMessages.filter((message) => message.bandType === "smooth"),
      [],
    );
  });
});

test("smooth band does not split turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 0, smooth: 100, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.smoothBand.selectedIds, [context.turns.newest.turnId]);
    assert.deepEqual(
      opened.value.view.emittedMessages
        .filter((message) => message.bandType === "smooth")
        .map((message) => message.sourceReference),
      [context.turns.newest.turnId],
    );
  });
});

test("closed canonical chunks can enter lower band in prepare mode", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "prepare",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(result.status, "degraded");
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.length > 0, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(context.chunks.openRecent), false);
    assert.deepEqual(opened.value.view.briefBand.selectedIds, []);
  });
});

test("strict lower-band selection chooses canonical semantic chunks when exact semantic counts are persisted", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
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
        chunk.lifecycleStatus === "closed" ? withExactSemanticArtifactCounts(chunk) : chunk,
      ),
    });
    assert.equal(writeResult.ok, true);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(result.status, "ready");
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_STATE_INVALID"), false);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.length > 0, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(context.chunks.newerClosed), true);
    assert.equal(
      opened.value.view.detailedBand.selectedIds.length + opened.value.view.briefBand.selectedIds.length > 0,
      true,
    );
  });
});

test("strict lower-band selection blocks legacy placeholder chunks unconditionally", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "blocked");
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

test("semantic lower-band accounting rejects placeholder-only chunk state", () => {
  const chunk = makeLegacyPlaceholderChunkState({
    chunkId: "chunk-placeholder-only",
    sourceRevision: 7,
  });

  assert.equal(
    resolveChunkSemanticArtifactAccounting({
      chunk,
      bandType: "detailed",
      policyMode: "prepare",
    }),
    undefined,
  );
  assert.equal(
    resolveChunkSemanticArtifactAccounting({
      chunk,
      bandType: "brief",
      policyMode: "prepare",
    }),
    undefined,
  );
});

test("prepare-mode lower-band selection accepts canonical semantic chunk artifacts without placeholder state", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
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

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "prepare",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_DEGRADED"), true);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(context.chunks.newerClosed), true);
    assert.equal(
      opened.value.view.emittedMessages.some(
        (message) =>
          message.bandType === "detailed" &&
          message.sourceReference === context.chunks.newerClosed &&
          message.content === `semantic detailed ${context.chunks.newerClosed}`,
      ),
      true,
    );
    assert.equal(
      opened.value.view.emittedMessages.some(
        (message) =>
          (message.bandType === "detailed" || message.bandType === "brief") &&
          typeof message.content === "string" &&
          message.content.startsWith("semantic "),
      ),
      true,
    );
  });
});

test("open chunk cannot enter lower band", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(context.chunks.openRecent), false);
    assert.equal(opened.value.view.briefBand.selectedIds.includes(context.chunks.openRecent), false);
  });
});

test("no closed chunks leaves lower bands empty", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedNoClosedChunkThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.detailedBand.selectedIds, []);
    assert.deepEqual(opened.value.view.briefBand.selectedIds, []);
  });
});

test("rebuild lands at or below lower bound", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "ready");
    assert.equal((result.resultingTokenCount ?? Number.MAX_SAFE_INTEGER) <= STAGE7_READY_LOWER_BOUND, true);
  });
});

test("rebuild failure to reach lower bound is explicit", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 14,
        requestedBandPercentages: { fullFidelity: 20, smooth: 20, detailed: 40, brief: 20 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
    assert.equal((result.resultingTokenCount ?? 0) > 14, true);
  });
});

test("invalid band percentages rejected before allocation", async () => {
  await assert.rejects(
    buildDraftThreadView({
      threadId: "thread-invalid-band-mix",
      requestedLowerBound: 40,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 5 },
      mode: "strict",
    }),
    /requestedBandPercentages must sum to 100/,
  );
});

test("lower-band selection rejects closed-chunk ids missing required persisted artifacts", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);

    const writeResult = await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk): ChunkState =>
        chunk.chunkId === context.chunks.newerClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                detailed: undefined,
              },
            } as ChunkState
          : chunk),
    });
    assert.equal(writeResult.ok, true);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "prepare",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.detailedBand.selectedIds, []);
  });
});
