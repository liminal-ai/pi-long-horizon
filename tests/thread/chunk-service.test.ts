import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { ensureLowerBandTurnProjection } from "../../src/thread/async-thread/services/lower-band-turn-projection-service.js";
import { ensureSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { getReadyChunkConversationTranscriptText } from "../../src/thread/async-thread/domain/chunk-state.js";
import { estimateCompactedTextTokenCount } from "../../src/thread-view/services/pi-token-estimator.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import { makeChunkLowerBandArtifacts, makeChunkState } from "../../src/thread/async-thread/test/fixtures.js";
import {
  assertTokenCountRecord,
  createMaterializedRepresentationHash,
  type TurnLowerBandProjectionMaterializedTokenCountRecord,
} from "../../src/token-accounting/index.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function toPendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

function repeatWords(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");
}

class FakeProjectionCounter {
  async countTurnLowerBandProjectionMaterialized(input: {
    text: string;
    sourceRevision?: number;
    model?: string;
  }): Promise<TurnLowerBandProjectionMaterializedTokenCountRecord> {
    return assertTokenCountRecord({
      count: estimateDeterministicTokenCount(input.text),
      scope: "turn_lower_band_projection_materialized",
      source: "provider_input_count",
      trustClass: "exact",
      provider: "openai",
      model: input.model ?? "gpt-test-chunk-service",
      representationHash: createMaterializedRepresentationHash(input.text),
      sourceRevision: input.sourceRevision,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      provenance: "tests.thread.chunk-service.fake-projection-counter",
    }) as TurnLowerBandProjectionMaterializedTokenCountRecord;
  }
}

const fakeProjectionCounter = new FakeProjectionCounter();

async function createThread(store: FileThreadStore, threadId: string) {
  const target = makeThreadTarget({
    sessionId: `${threadId}-session`,
    sessionFilePath: `/tmp/${threadId}.jsonl`,
  });

  expectOk(
    await store.createThread({
      thread: makeThreadRecord({
        threadId,
        target,
      }),
      targetRef: {
        runtime: "pi",
        sessionId: target.sessionId,
      },
    }),
  );
}

async function appendCanonicalMessage(
  store: FileThreadStore,
  threadId: string,
  actor: ActorRecord,
  message: ReturnType<typeof toPendingMessage>,
) {
  expectOk(await store.upsertActor(threadId, actor));
  return expectOk(
    await store.appendMessage({
      threadId,
      actor,
      message,
    }),
  );
}

async function writeTurns(store: FileThreadStore, threadId: string, turns: TurnRecord[]) {
  const thread = expectOk(await store.assertCanMutate(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      turns,
      turnState: "ready",
    }),
  );
}

async function readTurns(store: FileThreadStore, threadId: string): Promise<TurnRecord[]> {
  return expectOk(await store.readTurns(threadId));
}

async function readTurn(store: FileThreadStore, threadId: string, turnId: string): Promise<TurnRecord> {
  const turn = (await readTurns(store, threadId)).find((candidate) => candidate.turnId === turnId);
  assert.ok(turn);
  return turn;
}

async function readChunks(store: FileThreadStore, threadId: string): Promise<ChunkState[]> {
  return expectOk(await store.readChunks(threadId));
}

async function writeChunks(store: FileThreadStore, threadId: string, chunks: ChunkState[]) {
  const thread = expectOk(await store.assertCanMutate(threadId));
  expectOk(
    await store.writeChunks({
      threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      chunks,
    }),
  );
}

async function appendTurn(
  store: FileThreadStore,
  input: {
    threadId: string;
    turnId: string;
    lifecycleStatus: "open" | "closed";
    userText: string;
    assistantText?: string;
    smooth?: boolean;
  },
): Promise<TurnRecord> {
  const user = makeActorRecord({ actorId: "actor-user", actorType: "human", displayName: "User" });
  const assistant = makeActorRecord({ actorId: "actor-assistant", actorType: "agent", displayName: "Assistant" });
  const prompt = await appendCanonicalMessage(
    store,
    input.threadId,
    user,
    toPendingMessage({
      messageId: `${input.turnId}-prompt`,
      actorId: user.actorId,
      actorType: user.actorType,
      messageKind: "prompt",
      createdAt: DEFAULT_TEST_TIMESTAMP,
      parts: [makePartRecord({ partId: `${input.turnId}-user-part`, content: input.userText })],
    }),
  );

  const messages = [prompt];
  if (input.assistantText) {
    const response = await appendCanonicalMessage(
      store,
      input.threadId,
      assistant,
      toPendingMessage({
        messageId: `${input.turnId}-response`,
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: `${input.turnId}-assistant-part`, content: input.assistantText })],
      }),
    );
    messages.push(response);
  }

  const existingTurns = await readTurns(store, input.threadId);
  const lastMessage = messages[messages.length - 1]!;
  await writeTurns(store, input.threadId, [
    ...existingTurns,
    makeTurnRecord({
      turnId: input.turnId,
      threadId: input.threadId,
      turnOrder: existingTurns.length + 1,
      lifecycleStatus: input.lifecycleStatus,
      repairStatus: input.lifecycleStatus === "closed" ? "ready" : "unknown",
      initiatingMessageId: prompt.messageId,
      messageIds: messages.map((message) => message.messageId),
      sourceRange: {
        fromSourceOrder: prompt.sourceOrder,
        toSourceOrder: lastMessage.sourceOrder,
      },
      openedAt: prompt.createdAt ?? prompt.capturedAt,
      closedAt: input.lifecycleStatus === "closed" ? lastMessage.createdAt ?? lastMessage.capturedAt : undefined,
      sourceRevision: lastMessage.sourceRevision,
    }),
  ]);

  if (input.smooth) {
    await ensureSmoothTurn(
      {
        threadId: input.threadId,
        turnId: input.turnId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );
    await ensureLowerBandTurnProjection(
      {
        threadId: input.threadId,
        turnId: input.turnId,
      },
      {
        store,
        openAIInputTokenCounter: fakeProjectionCounter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );
  }

  return readTurn(store, input.threadId, input.turnId);
}

function countOpenChunks(chunks: readonly ChunkState[]): number {
  return chunks.filter((chunk) => chunk.lifecycleStatus === "open").length;
}

function expectSingleOpenChunk(chunks: readonly ChunkState[]): ChunkState {
  const openChunks = chunks.filter((chunk) => chunk.lifecycleStatus === "open");
  assert.equal(openChunks.length, 1);
  return openChunks[0]!;
}

function projectionCount(turn: TurnRecord): number {
  return turn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 0;
}

test("open or unsmoothed turn is not eligible", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-ineligible");

    await appendTurn(store, {
      threadId: "thread-chunk-ineligible",
      turnId: "turn-open",
      lifecycleStatus: "open",
      userText: "This turn is still open.",
    });
    await appendTurn(store, {
      threadId: "thread-chunk-ineligible",
      turnId: "turn-unsmoothed",
      lifecycleStatus: "closed",
      userText: "This turn is closed but not smoothed yet.",
      assistantText: "No smoothing state exists yet.",
    });

    const result = await updateChunkState(
      { threadId: "thread-chunk-ineligible" },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-ineligible");
    assert.deepEqual(result.blockers, []);
    assert.equal(countOpenChunks(chunks), 1);
    assert.deepEqual(expectSingleOpenChunk(chunks).sourceTurnIds, []);
  });
});

test("stale open chunk with missing turn ids is reset and rebuilt from current turns", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-stale-open");

    await appendTurn(store, {
      threadId: "thread-chunk-stale-open",
      turnId: "turn-current",
      lifecycleStatus: "closed",
      userText: "Please include the current turn in a rebuilt open chunk.",
      assistantText: "This turn has ready projection state.",
      smooth: true,
    });
    await writeChunks(store, "thread-chunk-stale-open", [
      makeChunkState({
        chunkId: "chunk-116",
        threadId: "thread-chunk-stale-open",
        lifecycleStatus: "open",
        sourceTurnIds: ["turn-deleted-1", "turn-deleted-2"],
        smoothText: "stale smooth text",
      }),
    ]);

    const result = await updateChunkState(
      { threadId: "thread-chunk-stale-open" },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-stale-open");
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(expectSingleOpenChunk(chunks).sourceTurnIds, ["turn-current"]);
    assert.equal(expectSingleOpenChunk(chunks).smoothText?.includes("current turn"), true);
    assert.deepEqual((await readTurns(store, "thread-chunk-stale-open")).map((turn) => turn.turnId), ["turn-current"]);
  });
});

test("open chunk with present but non-ready turn blocks instead of resetting", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-open-not-ready");

    await appendTurn(store, {
      threadId: "thread-chunk-open-not-ready",
      turnId: "turn-present-not-ready",
      lifecycleStatus: "closed",
      userText: "This turn exists but has no smooth lower-band projection yet.",
      assistantText: "Chunk assembly should wait instead of discarding membership.",
    });
    await writeChunks(store, "thread-chunk-open-not-ready", [
      makeChunkState({
        chunkId: "chunk-116",
        threadId: "thread-chunk-open-not-ready",
        lifecycleStatus: "open",
        sourceTurnIds: ["turn-present-not-ready"],
        smoothText: "existing chunk text",
      }),
    ]);

    const result = await updateChunkState(
      { threadId: "thread-chunk-open-not-ready" },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-open-not-ready"));
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0]?.cause, "open_chunk_projection_not_ready");
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-present-not-ready"]);
    assert.equal(openChunk.smoothText, "existing chunk text");
  });
});

test("closed smoothed turn becomes eligible", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-eligible");

    const turn = await appendTurn(store, {
      threadId: "thread-chunk-eligible",
      turnId: "turn-ready",
      lifecycleStatus: "closed",
      userText: "Please include this turn in a chunk.",
      assistantText: "This smoothed turn should be eligible.",
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-eligible" },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-eligible"));
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-ready"]);
    assert.equal(openChunk.smoothTokenCountMetadata?.count, turn.smooth?.tokenCountMetadata?.count);
  });
});

test("exactly one open chunk exists", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveChunksPath }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-open-invariant");

    await appendTurn(store, {
      threadId: "thread-chunk-open-invariant",
      turnId: "turn-one",
      lifecycleStatus: "closed",
      userText: repeatWords("user", 4),
      assistantText: repeatWords("assistant", 4),
      smooth: true,
    });
    await appendTurn(store, {
      threadId: "thread-chunk-open-invariant",
      turnId: "turn-two",
      lifecycleStatus: "closed",
      userText: repeatWords("later", 4),
      assistantText: repeatWords("reply", 4),
      smooth: true,
    });

    const firstTurn = await readTurn(store, "thread-chunk-open-invariant", "turn-one");
    const secondTurn = await readTurn(store, "thread-chunk-open-invariant", "turn-two");
    await updateChunkState(
      { threadId: "thread-chunk-open-invariant" },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(firstTurn) || 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn) - 1,
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn) + 5,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-open-invariant");
    await access(resolveChunksPath("thread-chunk-open-invariant"));
    assert.equal(countOpenChunks(chunks), 1);
  });
});

test("closed chunk remains closed", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-closed-stable");

    await appendTurn(store, {
      threadId: "thread-chunk-closed-stable",
      turnId: "turn-one",
      lifecycleStatus: "closed",
      userText: repeatWords("alpha", 4),
      assistantText: repeatWords("beta", 4),
      smooth: true,
    });
    await appendTurn(store, {
      threadId: "thread-chunk-closed-stable",
      turnId: "turn-two",
      lifecycleStatus: "closed",
      userText: repeatWords("gamma", 4),
      assistantText: repeatWords("delta", 4),
      smooth: true,
    });

    const firstTurn = await readTurn(store, "thread-chunk-closed-stable", "turn-one");
    const secondTurn = await readTurn(store, "thread-chunk-closed-stable", "turn-two");
    await updateChunkState(
      { threadId: "thread-chunk-closed-stable" },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(firstTurn) || 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn) - 1,
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn) + 5,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const before = await readChunks(store, "thread-chunk-closed-stable");
    const closedChunk = before.find((chunk) => chunk.lifecycleStatus === "closed");
    assert.ok(closedChunk);

    await appendTurn(store, {
      threadId: "thread-chunk-closed-stable",
      turnId: "turn-three",
      lifecycleStatus: "closed",
      userText: repeatWords("epsilon", 3),
      assistantText: repeatWords("zeta", 3),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-closed-stable" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 1,
          targetSoftMaxSmoothTokens: 100,
          hardMaxSmoothTokens: 200,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const after = await readChunks(store, "thread-chunk-closed-stable");
    const closedAfter = after.find((chunk) => chunk.chunkId === closedChunk.chunkId);
    assert.ok(closedAfter);
    assert.equal(closedAfter.lifecycleStatus, "closed");
    assert.deepEqual(closedAfter.sourceTurnIds, closedChunk.sourceTurnIds);
    assert.equal(closedAfter.sourceTurnIds.includes("turn-three"), false);
  });
});

test("eligible turn joins open chunk", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-append");

    await appendTurn(store, {
      threadId: "thread-chunk-append",
      turnId: "turn-one",
      lifecycleStatus: "closed",
      userText: "First chunk turn.",
      assistantText: "First chunk answer.",
      smooth: true,
    });
    await appendTurn(store, {
      threadId: "thread-chunk-append",
      turnId: "turn-two",
      lifecycleStatus: "closed",
      userText: "Second chunk turn.",
      assistantText: "Second chunk answer.",
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-append" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 100,
          targetSoftMaxSmoothTokens: 200,
          hardMaxSmoothTokens: 300,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-append"));
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-one", "turn-two"]);
  });
});

test("chunk order follows turn order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-order");

    await appendTurn(store, {
      threadId: "thread-chunk-order",
      turnId: "turn-a",
      lifecycleStatus: "closed",
      userText: "Older turn should stay first.",
      assistantText: "Older answer.",
      smooth: true,
    });
    await appendTurn(store, {
      threadId: "thread-chunk-order",
      turnId: "turn-b",
      lifecycleStatus: "closed",
      userText: "Middle turn should stay second.",
      assistantText: "Middle answer.",
      smooth: true,
    });
    await appendTurn(store, {
      threadId: "thread-chunk-order",
      turnId: "turn-c",
      lifecycleStatus: "closed",
      userText: "Newest eligible turn should stay third.",
      assistantText: "Newest answer.",
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-order" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 100,
          targetSoftMaxSmoothTokens: 200,
          hardMaxSmoothTokens: 300,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-order"));
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-a", "turn-b", "turn-c"]);
  });
});

test("conversation-only projection counts drive chunk boundary decisions", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-chunk-projection-count-authority";
    await createThread(store, threadId);

    const firstTurn = await appendTurn(store, {
      threadId,
      turnId: "turn-count-a",
      lifecycleStatus: "closed",
      userText: repeatWords("alpha", 4),
      assistantText: repeatWords("beta", 4),
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId,
      turnId: "turn-count-b",
      lifecycleStatus: "closed",
      userText: repeatWords("gamma", 4),
      assistantText: repeatWords("delta", 4),
      smooth: true,
    });

    const snapshot = expectOk(await store.openThread(threadId));
    expectOk(
      await store.writeTurns({
        threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        turns: snapshot.turns.map((turn) =>
          turn.turnId === secondTurn.turnId && turn.smooth?.tokenCountMetadata
            ? {
                ...turn,
                smooth: {
                  ...turn.smooth,
                  tokenCountMetadata: {
                    ...turn.smooth.tokenCountMetadata,
                    count: turn.smooth.tokenCountMetadata.count + 500,
                  },
                },
              }
            : turn,
        ),
        turnState: snapshot.thread.status.turnState,
      }),
    );
    await updateChunkState(
      { threadId },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(firstTurn) || 1,
          targetSoftMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn),
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn) + 20,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, threadId));
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-count-a", "turn-count-b"]);
  });
});

test("chunk transcript assembles ready turn projections in order and supports user-only turns", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-chunk-transcript";
    await createThread(store, threadId);

    const firstTurn = await appendTurn(store, {
      threadId,
      turnId: "turn-transcript-a",
      lifecycleStatus: "closed",
      userText: "First user request.",
      assistantText: "First assistant response.",
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId,
      turnId: "turn-transcript-b",
      lifecycleStatus: "closed",
      userText: "Second user request only.",
      smooth: true,
    });

    await updateChunkState(
      { threadId },
      {
        store,
        settings: {
          targetMinSmoothTokens: 100,
          targetSoftMaxSmoothTokens: 200,
          hardMaxSmoothTokens: 300,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, threadId));
    const expectedTranscript = [
      firstTurn.smooth?.lowerBandProjection?.text,
      secondTurn.smooth?.lowerBandProjection?.text,
    ].join("\n\n");

    assert.equal(openChunk.schemaVersion, "conversation_only_chunk_v1");
    assert.equal(openChunk.conversationTranscript?.status, "ready");
    assert.equal(openChunk.conversationTranscript?.text, expectedTranscript);
    assert.match(openChunk.conversationTranscript?.text ?? "", /^> First user request\./);
    assert.match(openChunk.conversationTranscript?.text ?? "", /> Second user request only\./);
    assert.equal(openChunk.conversationTranscript?.text?.includes("[tool]"), false);
    assert.equal(openChunk.smoothText?.includes("[user]"), true);
  });
});

test("closed chunks expose one conversation transcript source for detailed and brief lower-band generation", () => {
  const transcriptText = "> Shared transcript request\n● Shared transcript answer";
  const chunk = makeChunkState({
    smoothText: "[user] Smooth request\n[assistant] Smooth answer",
    conversationTranscript: {
      status: "ready",
      text: transcriptText,
      sourceFingerprint: "sha256:test-shared-transcript",
      sourceRevision: 7,
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: {
        band: "detailed",
        status: "ready",
        text: "Detailed semantic artifact output",
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
      brief: {
        band: "brief",
        status: "ready",
        text: "Brief semantic artifact output",
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
    }),
  });

  const detailedSource = getReadyChunkConversationTranscriptText(chunk);
  const briefSource = getReadyChunkConversationTranscriptText(chunk);

  assert.equal(detailedSource, transcriptText);
  assert.equal(briefSource, transcriptText);
  assert.notEqual(detailedSource, chunk.smoothText);
  assert.notEqual(briefSource, chunk.smoothText);
});

test("brief lower-band generation source is chunk conversationTranscript rather than detailed artifact text", () => {
  const transcriptText = "> Brief source transcript request\n● Brief source transcript answer";
  const chunk = makeChunkState({
    conversationTranscript: {
      status: "ready",
      text: transcriptText,
      sourceFingerprint: "sha256:test-brief-source",
      sourceRevision: 11,
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: {
        band: "detailed",
        status: "ready",
        text: "Detailed artifact text must not become brief input",
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
      brief: {
        band: "brief",
        status: "ready",
        text: "Brief artifact output",
        updatedAt: DEFAULT_TEST_TIMESTAMP,
      },
    }),
  });

  const briefSource = getReadyChunkConversationTranscriptText(chunk);

  assert.equal(briefSource, transcriptText);
  assert.notEqual(briefSource, chunk.lowerBand?.detailed?.text);
  assert.equal(chunk.lowerBand?.brief?.text, "Brief artifact output");
});

test("lower-band generation input stays on conversationTranscript when smooth text is also present", () => {
  const transcriptText = "> Conversation transcript only request\n● Conversation transcript only answer";
  const chunk = makeChunkState({
    smoothText: "[user] Smooth representation request\n[assistant] Smooth representation answer",
    conversationTranscript: {
      status: "ready",
      text: transcriptText,
      sourceFingerprint: "sha256:test-transcript-vs-smooth",
      sourceRevision: 13,
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
  });

  const lowerBandSource = getReadyChunkConversationTranscriptText(chunk);

  assert.equal(lowerBandSource, transcriptText);
  assert.notEqual(lowerBandSource, chunk.smoothText);
  assert.match(chunk.smoothText ?? "", /\[user\] Smooth representation request/);
});

test("chunk stays open below threshold", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-below-threshold");

    const turn = await appendTurn(store, {
      threadId: "thread-chunk-below-threshold",
      turnId: "turn-threshold",
      lifecycleStatus: "closed",
      userText: repeatWords("threshold", 3),
      assistantText: repeatWords("reply", 3),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-below-threshold" },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(turn) + 1,
          targetSoftMaxSmoothTokens: projectionCount(turn) + 10,
          hardMaxSmoothTokens: projectionCount(turn) + 20,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-below-threshold"));
    assert.equal(openChunk.lifecycleStatus, "open");
    assert.deepEqual(openChunk.sourceTurnIds, ["turn-threshold"]);
  });
});

test("chunk closes on soft threshold condition", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-soft-close");

    const firstTurn = await appendTurn(store, {
      threadId: "thread-chunk-soft-close",
      turnId: "turn-soft-a",
      lifecycleStatus: "closed",
      userText: repeatWords("first", 5),
      assistantText: repeatWords("reply", 5),
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId: "thread-chunk-soft-close",
      turnId: "turn-soft-b",
      lifecycleStatus: "closed",
      userText: repeatWords("second", 4),
      assistantText: repeatWords("answer", 4),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-soft-close" },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(firstTurn) || 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn) - 1,
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn) + 10,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-soft-close");
    assert.equal(countOpenChunks(chunks), 1);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.lifecycleStatus, "closed");
    assert.equal(chunks[0]?.closeReason, "soft_threshold");
    assert.deepEqual(chunks[0]?.sourceTurnIds, ["turn-soft-a"]);
    assert.equal(chunks[1]?.lifecycleStatus, "open");
    assert.deepEqual(chunks[1]?.sourceTurnIds, ["turn-soft-b"]);
  });
});

test("hard-cap closure is explicit", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-hard-close");

    const firstTurn = await appendTurn(store, {
      threadId: "thread-chunk-hard-close",
      turnId: "turn-hard-a",
      lifecycleStatus: "closed",
      userText: repeatWords("first", 4),
      assistantText: repeatWords("reply", 4),
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId: "thread-chunk-hard-close",
      turnId: "turn-hard-b",
      lifecycleStatus: "closed",
      userText: repeatWords("second", 4),
      assistantText: repeatWords("answer", 4),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-hard-close" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn),
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn),
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-hard-close");
    assert.equal(chunks[0]?.lifecycleStatus, "closed");
    assert.equal(chunks[0]?.closeReason, "hard_max");
    assert.deepEqual(chunks[0]?.sourceTurnIds, ["turn-hard-a", "turn-hard-b"]);
  });
});

test("closed chunk reports closed state and token size", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveChunksPath }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-inspect-closed");

    const firstTurn = await appendTurn(store, {
      threadId: "thread-chunk-inspect-closed",
      turnId: "turn-closed-a",
      lifecycleStatus: "closed",
      userText: repeatWords("first", 4),
      assistantText: repeatWords("reply", 4),
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId: "thread-chunk-inspect-closed",
      turnId: "turn-closed-b",
      lifecycleStatus: "closed",
      userText: repeatWords("second", 4),
      assistantText: repeatWords("answer", 4),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-inspect-closed" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn),
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn),
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persistedJson = JSON.parse(
      await readFile(resolveChunksPath("thread-chunk-inspect-closed"), "utf8"),
    ) as ChunkState[];
    const reopenedStore = new FileThreadStore(storeRootDir);
    const closedChunk = (await readChunks(reopenedStore, "thread-chunk-inspect-closed"))[0]!;

    assert.equal(closedChunk.lifecycleStatus, "closed");
    assert.ok((closedChunk.smoothTokenCountMetadata?.count ?? 0) > 0);
    assert.equal(closedChunk.smoothTokenCountMetadata?.count, estimateCompactedTextTokenCount(closedChunk.smoothText ?? ""));
    assert.equal(closedChunk.smoothTokenCountMetadata?.scope, "chunk_smooth_materialized");
    assert.equal(closedChunk.smoothTokenCountMetadata?.sourceRevision, closedChunk.sourceRevision);
    assert.match(closedChunk.smoothTokenCountMetadata?.representationHash ?? "", /^sha256:/);
    assert.equal(persistedJson[0]?.smoothTokenCountMetadata?.count, closedChunk.smoothTokenCountMetadata?.count);
    assert.deepEqual(persistedJson[0]?.smoothTokenCountMetadata, closedChunk.smoothTokenCountMetadata);
  });
});

test("open chunk reports partial state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-inspect-open");

    const turn = await appendTurn(store, {
      threadId: "thread-chunk-inspect-open",
      turnId: "turn-open-state",
      lifecycleStatus: "closed",
      userText: repeatWords("partial", 3),
      assistantText: repeatWords("state", 3),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-inspect-open" },
      {
        store,
        settings: {
          targetMinSmoothTokens: projectionCount(turn) + 10,
          targetSoftMaxSmoothTokens: projectionCount(turn) + 20,
          hardMaxSmoothTokens: projectionCount(turn) + 30,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-inspect-open"));
    assert.equal(openChunk.lifecycleStatus, "open");
    assert.equal(openChunk.closedAt, undefined);
    assert.equal(openChunk.closeReason, undefined);
    assert.equal(openChunk.smoothTokenCountMetadata?.count, turn.smooth?.tokenCountMetadata?.count);
  });
});

test("hard-max closure creates the next open chunk in the same update pass", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-chunk-hard-next-open");

    const firstTurn = await appendTurn(store, {
      threadId: "thread-chunk-hard-next-open",
      turnId: "turn-next-a",
      lifecycleStatus: "closed",
      userText: repeatWords("first", 4),
      assistantText: repeatWords("reply", 4),
      smooth: true,
    });
    const secondTurn = await appendTurn(store, {
      threadId: "thread-chunk-hard-next-open",
      turnId: "turn-next-b",
      lifecycleStatus: "closed",
      userText: repeatWords("second", 4),
      assistantText: repeatWords("answer", 4),
      smooth: true,
    });

    await updateChunkState(
      { threadId: "thread-chunk-hard-next-open" },
      {
        store,
        settings: {
          targetMinSmoothTokens: 1,
          targetSoftMaxSmoothTokens:
            projectionCount(firstTurn) + projectionCount(secondTurn),
          hardMaxSmoothTokens: projectionCount(firstTurn) + projectionCount(secondTurn),
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const chunks = await readChunks(store, "thread-chunk-hard-next-open");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.lifecycleStatus, "closed");
    assert.equal(chunks[1]?.lifecycleStatus, "open");
    assert.deepEqual(chunks[1]?.sourceTurnIds, []);
    assert.equal(countOpenChunks(chunks), 1);
  });
});

test("closed chunk refreshes transcript and smooth text from changed component source without changing membership", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-chunk-refresh-component-source";
    await createThread(store, threadId);

    const turn = await appendTurn(store, {
      threadId,
      turnId: "turn-refresh-source",
      lifecycleStatus: "closed",
      userText: "Refresh the chunk from component source.",
      assistantText: "Original assistant component text.",
      smooth: true,
    });

    await updateChunkState(
      { threadId },
      {
        store,
        settings: {
          targetMinSmoothTokens: 1,
          targetSoftMaxSmoothTokens: 1,
          hardMaxSmoothTokens: 1,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const closedChunk = (await readChunks(store, threadId)).find((chunk) => chunk.lifecycleStatus === "closed");
    assert.ok(closedChunk);
    const originalSourceTurnIds = [...closedChunk.sourceTurnIds];

    const snapshot = expectOk(await store.openThread(threadId));
    const nextTurns = snapshot.turns.map((candidate) =>
      candidate.turnId === turn.turnId && candidate.smooth?.components
        ? {
            ...candidate,
            sourceRevision: candidate.sourceRevision + 1,
            smooth: {
              ...candidate.smooth,
              sourceRevision: candidate.sourceRevision + 1,
              tokenCountMetadata: undefined,
              materialized: undefined,
              lowerBandProjection: undefined,
              components: candidate.smooth.components.map((component) =>
                component.kind === "assistant_message"
                  ? {
                      ...component,
                      text: "Updated assistant component text.",
                      sourceRevision: candidate.sourceRevision + 1,
                    }
                  : {
                      ...component,
                      sourceRevision: candidate.sourceRevision + 1,
                    }),
            },
          }
        : candidate);
    expectOk(
      await store.writeTurns({
        threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        turns: nextTurns,
        turnState: snapshot.thread.status.turnState,
      }),
    );
    await ensureLowerBandTurnProjection(
      {
        threadId,
        turnId: turn.turnId,
      },
      {
        store,
        openAIInputTokenCounter: fakeProjectionCounter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    await updateChunkState(
      { threadId },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const refreshed = (await readChunks(store, threadId)).find((chunk) => chunk.chunkId === closedChunk.chunkId);
    assert.ok(refreshed);
    assert.match(refreshed.smoothText ?? "", /Updated assistant component text\./);
    assert.match(refreshed.conversationTranscript?.text ?? "", /● Updated assistant component text\./);
    assert.equal(refreshed.sourceRevision, turn.sourceRevision + 1);
    assert.deepEqual(refreshed.sourceTurnIds, originalSourceTurnIds);
  });
});
