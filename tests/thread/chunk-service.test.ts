import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { ensureSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
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
    assert.equal(openChunk.smoothTokenCount, turn.smooth?.tokenCount);
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
          targetMinSmoothTokens: firstTurn.smooth?.tokenCount ?? 1,
          targetSoftMaxSmoothTokens:
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) - 1,
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) + 5,
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
          targetMinSmoothTokens: firstTurn.smooth?.tokenCount ?? 1,
          targetSoftMaxSmoothTokens:
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) - 1,
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) + 5,
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
          targetMinSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 1,
          targetSoftMaxSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 10,
          hardMaxSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 20,
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
          targetMinSmoothTokens: firstTurn.smooth?.tokenCount ?? 1,
          targetSoftMaxSmoothTokens:
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) - 1,
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0) + 10,
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
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
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
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
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
    assert.ok((closedChunk.smoothTokenCount ?? 0) > 0);
    assert.equal(closedChunk.smoothTokenCount, estimateDeterministicTokenCount(closedChunk.smoothText ?? ""));
    assert.equal(persistedJson[0]?.smoothTokenCount, closedChunk.smoothTokenCount);
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
          targetMinSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 10,
          targetSoftMaxSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 20,
          hardMaxSmoothTokens: (turn.smooth?.tokenCount ?? 0) + 30,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const openChunk = expectSingleOpenChunk(await readChunks(store, "thread-chunk-inspect-open"));
    assert.equal(openChunk.lifecycleStatus, "open");
    assert.equal(openChunk.closedAt, undefined);
    assert.equal(openChunk.closeReason, undefined);
    assert.equal(openChunk.smoothTokenCount, turn.smooth?.tokenCount);
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
            (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
          hardMaxSmoothTokens: (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0),
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
