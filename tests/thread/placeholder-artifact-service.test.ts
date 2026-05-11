import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getPlaceholderArtifactMarker,
  type PlaceholderArtifactKind,
} from "../../src/thread/async-thread/domain/placeholder-artifact-state.js";
import { estimateDeterministicTokenCount, normalizeDeterministicText } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { ensurePlaceholderArtifacts } from "../../src/thread/async-thread/services/placeholder-artifact-service.js";
import { ensureSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
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

const SECOND_TEST_TIMESTAMP = "2026-01-02T00:00:00.000Z";
const THIRD_TEST_TIMESTAMP = "2026-01-03T00:00:00.000Z";

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

function buildExpectedPlaceholder(chunk: ChunkState, kind: PlaceholderArtifactKind) {
  const normalizedSmoothText = normalizeDeterministicText(chunk.smoothText ?? "");
  const smoothTokens = normalizedSmoothText.length === 0 ? [] : normalizedSmoothText.split(" ");
  const marker = getPlaceholderArtifactMarker(kind);
  const markerTokenCount = estimateDeterministicTokenCount(marker);
  const ratio = kind === "detailed" ? 0.3 : 0.05;
  const targetArtifactTokenCount = Math.max(1, Math.round(smoothTokens.length * ratio));
  const preservedTokenCount =
    smoothTokens.length === 0
      ? 0
      : Math.min(smoothTokens.length, Math.max(1, targetArtifactTokenCount - markerTokenCount));
  const preservedText = smoothTokens.slice(0, preservedTokenCount).join(" ");
  const text = preservedText.length > 0 ? `${preservedText}\n\n${marker}` : marker;

  return {
    text,
    tokenCount: estimateDeterministicTokenCount(text),
  };
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

async function readTurns(store: FileThreadStore, threadId: string): Promise<TurnRecord[]> {
  return expectOk(await store.readTurns(threadId));
}

async function readChunks(store: FileThreadStore, threadId: string): Promise<ChunkState[]> {
  return expectOk(await store.readChunks(threadId));
}

async function readClosedChunk(store: FileThreadStore, threadId: string): Promise<ChunkState> {
  const chunk = (await readChunks(store, threadId)).find((candidate) => candidate.lifecycleStatus === "closed");
  assert.ok(chunk);
  return chunk;
}

async function appendTurn(
  store: FileThreadStore,
  input: {
    threadId: string;
    turnId: string;
    userText: string;
    assistantText: string;
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

  const existingTurns = await readTurns(store, input.threadId);
  await writeTurns(store, input.threadId, [
    ...existingTurns,
    makeTurnRecord({
      turnId: input.turnId,
      threadId: input.threadId,
      turnOrder: existingTurns.length + 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: prompt.messageId,
      messageIds: [prompt.messageId, response.messageId],
      sourceRange: {
        fromSourceOrder: prompt.sourceOrder,
        toSourceOrder: response.sourceOrder,
      },
      openedAt: prompt.createdAt ?? prompt.capturedAt,
      closedAt: response.createdAt ?? response.capturedAt,
      sourceRevision: response.sourceRevision,
    }),
  ]);

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

  const turn = (await readTurns(store, input.threadId)).find((candidate) => candidate.turnId === input.turnId);
  assert.ok(turn);
  return turn;
}

async function createClosedChunk(store: FileThreadStore, threadId: string): Promise<ChunkState> {
  await createThread(store, threadId);

  const firstTurn = await appendTurn(store, {
    threadId,
    turnId: `${threadId}-turn-a`,
    userText: repeatWords("first-user", 40),
    assistantText: repeatWords("first-assistant", 20),
  });
  const secondTurn = await appendTurn(store, {
    threadId,
    turnId: `${threadId}-turn-b`,
    userText: repeatWords("second-user", 40),
    assistantText: repeatWords("second-assistant", 20),
  });

  const hardMax = (firstTurn.smooth?.tokenCount ?? 0) + (secondTurn.smooth?.tokenCount ?? 0);
  await updateChunkState(
    { threadId },
    {
      store,
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      settings: {
        targetMinSmoothTokens: hardMax,
        targetSoftMaxSmoothTokens: hardMax,
        hardMaxSmoothTokens: hardMax,
      },
    },
  );

  return readClosedChunk(store, threadId);
}

test("closed chunk gets 30 percent placeholder", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-detailed");

    const result = await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-detailed",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readClosedChunk(store, "thread-placeholder-detailed");
    const expected = buildExpectedPlaceholder(persisted, "detailed");

    assert.equal(result.detailedReady, true);
    assert.equal(persisted.placeholders?.detailed?.text, expected.text);
    assert.equal(persisted.placeholders?.detailed?.tokenCount, expected.tokenCount);
    assert.equal(persisted.placeholders?.detailed?.strategy, "deterministic_truncate_30");
  });
});

test("detailed placeholder explicitly marked", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-detailed-marker");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-detailed-marker",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const detailedText = (await readClosedChunk(store, "thread-placeholder-detailed-marker")).placeholders?.detailed?.text;
    assert.match(detailedText ?? "", /\[deterministic-placeholder:detailed\]/);
    assert.match(detailedText ?? "", /\[not-semantic-summary\]/);
  });
});

test("closed chunk gets 5 percent placeholder", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-brief");

    const result = await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-brief",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readClosedChunk(store, "thread-placeholder-brief");
    const expected = buildExpectedPlaceholder(persisted, "brief");

    assert.equal(result.briefReady, true);
    assert.equal(persisted.placeholders?.brief?.text, expected.text);
    assert.equal(persisted.placeholders?.brief?.tokenCount, expected.tokenCount);
    assert.equal(persisted.placeholders?.brief?.strategy, "deterministic_truncate_5");
  });
});

test("brief placeholder explicitly marked", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-brief-marker");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-brief-marker",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const briefText = (await readClosedChunk(store, "thread-placeholder-brief-marker")).placeholders?.brief?.text;
    assert.match(briefText ?? "", /\[deterministic-placeholder:brief\]/);
    assert.match(briefText ?? "", /\[not-semantic-summary\]/);
  });
});

test("placeholder output deterministic for same source state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-deterministic");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-deterministic",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );
    const first = await readClosedChunk(store, "thread-placeholder-deterministic");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-deterministic",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(SECOND_TEST_TIMESTAMP),
      },
    );
    const second = await readClosedChunk(store, "thread-placeholder-deterministic");

    assert.deepEqual(second.placeholders?.detailed, first.placeholders?.detailed);
    assert.deepEqual(second.placeholders?.brief, first.placeholders?.brief);
  });
});

test("placeholder output can regenerate after deletion", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-regenerate");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-regenerate",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );
    const originalChunk = await readClosedChunk(store, "thread-placeholder-regenerate");

    const deletedPlaceholdersChunk: ChunkState = {
      ...originalChunk,
      sourceTurnIds: [...originalChunk.sourceTurnIds],
      placeholders: undefined,
    };
    const chunks = await readChunks(store, "thread-placeholder-regenerate");
    await writeChunks(
      store,
      "thread-placeholder-regenerate",
      chunks.map((candidate) => (candidate.chunkId === deletedPlaceholdersChunk.chunkId ? deletedPlaceholdersChunk : candidate)),
    );

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-regenerate",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(SECOND_TEST_TIMESTAMP),
      },
    );
    const regenerated = await readClosedChunk(store, "thread-placeholder-regenerate");

    assert.equal(regenerated.placeholders?.detailed?.text, originalChunk.placeholders?.detailed?.text);
    assert.equal(regenerated.placeholders?.brief?.text, originalChunk.placeholders?.brief?.text);
    assert.equal(regenerated.placeholders?.detailed?.generatedAt, SECOND_TEST_TIMESTAMP);
    assert.equal(regenerated.placeholders?.brief?.generatedAt, SECOND_TEST_TIMESTAMP);
  });
});

test("detailed placeholder records token count", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveChunksPath }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-detailed-token");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-detailed-token",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopenedChunk = await readClosedChunk(reopenedStore, "thread-placeholder-detailed-token");
    const persistedJson = JSON.parse(
      await readFile(resolveChunksPath("thread-placeholder-detailed-token"), "utf8"),
    ) as ChunkState[];

    assert.equal(
      reopenedChunk.placeholders?.detailed?.tokenCount,
      estimateDeterministicTokenCount(reopenedChunk.placeholders?.detailed?.text ?? ""),
    );
    assert.equal(persistedJson[0]?.placeholders?.detailed?.tokenCount, reopenedChunk.placeholders?.detailed?.tokenCount);
  });
});

test("brief placeholder records token count and strategy", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-brief-token");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-brief-token",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopenedChunk = await readClosedChunk(reopenedStore, "thread-placeholder-brief-token");

    assert.equal(
      reopenedChunk.placeholders?.brief?.tokenCount,
      estimateDeterministicTokenCount(reopenedChunk.placeholders?.brief?.text ?? ""),
    );
    assert.equal(reopenedChunk.placeholders?.brief?.strategy, "deterministic_truncate_5");
  });
});

test("repeated regeneration preserves explicit placeholder markers", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const chunk = await createClosedChunk(store, "thread-placeholder-markers-regenerate");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-markers-regenerate",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const invalidChunk = await readClosedChunk(store, "thread-placeholder-markers-regenerate");
    const chunks = await readChunks(store, "thread-placeholder-markers-regenerate");
    await writeChunks(
      store,
      "thread-placeholder-markers-regenerate",
      chunks.map((candidate) =>
        candidate.chunkId === invalidChunk.chunkId
          ? {
              ...candidate,
              sourceTurnIds: [...candidate.sourceTurnIds],
              placeholders: {
                chunkId: candidate.chunkId,
                threadId: candidate.threadId,
                detailed: {
                  kind: "detailed",
                  status: "invalid",
                  text: "old detailed placeholder",
                  tokenCount: estimateDeterministicTokenCount("old detailed placeholder"),
                  strategy: "deterministic_truncate_30",
                  generatedAt: DEFAULT_TEST_TIMESTAMP,
                },
                brief: {
                  kind: "brief",
                  status: "invalid",
                  text: "old brief placeholder",
                  tokenCount: estimateDeterministicTokenCount("old brief placeholder"),
                  strategy: "deterministic_truncate_5",
                  generatedAt: DEFAULT_TEST_TIMESTAMP,
                },
              },
            }
          : candidate,
      ),
    );

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-markers-regenerate",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(SECOND_TEST_TIMESTAMP),
      },
    );
    const repaired = await readClosedChunk(store, "thread-placeholder-markers-regenerate");

    await ensurePlaceholderArtifacts(
      {
        threadId: "thread-placeholder-markers-regenerate",
        chunkId: chunk.chunkId,
      },
      {
        store,
        now: () => new Date(THIRD_TEST_TIMESTAMP),
      },
    );
    const repeated = await readClosedChunk(store, "thread-placeholder-markers-regenerate");

    assert.match(repaired.placeholders?.detailed?.text ?? "", /\[deterministic-placeholder:detailed\]/);
    assert.match(repaired.placeholders?.brief?.text ?? "", /\[deterministic-placeholder:brief\]/);
    assert.match(repaired.placeholders?.detailed?.text ?? "", /\[not-semantic-summary\]/);
    assert.match(repaired.placeholders?.brief?.text ?? "", /\[not-semantic-summary\]/);
    assert.deepEqual(repeated.placeholders?.detailed, repaired.placeholders?.detailed);
    assert.deepEqual(repeated.placeholders?.brief, repaired.placeholders?.brief);
  });
});
