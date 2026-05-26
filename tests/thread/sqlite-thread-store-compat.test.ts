import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import { makeChunkState } from "../../src/thread/async-thread/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function makePendingMessage(overrides: Partial<ReturnType<typeof makeMessageRecord>> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

test("SQLite compatibility methods honor the existing ThreadStore result contract in simple cases", async () => {
  await withTempSqliteThreadStore(async ({ createStore }) => {
    const store = createStore();
    const thread = expectOk(
      await store.createThread({
        thread: makeThreadRecord({
          threadId: "thread-sqlite-compat-001",
          target: makeThreadTarget({ sessionId: "session-sqlite-compat-001" }),
        }),
        targetRef: {
          runtime: "pi",
          sessionId: "session-sqlite-compat-001",
        },
      }),
    );
    const message = expectOk(
      await store.appendMessage({
        threadId: thread.threadId,
        actor: makeActorRecord({ actorId: "actor-sqlite-compat-001" }),
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-compat-001",
        }),
      }),
    );
    const turns = [
      makeTurnRecord({
        turnId: "turn-sqlite-compat-001",
        threadId: thread.threadId,
        initiatingMessageId: message.messageId,
        messageIds: [message.messageId],
        sourceRange: { fromSourceOrder: 1, toSourceOrder: 1 },
        sourceRevision: 1,
        repairStatus: "ready",
      }),
    ];
    const writtenTurns = expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 0,
        turns,
        turnState: "ready",
      }),
    );
    const chunks = [
      makeChunkState({
        threadId: thread.threadId,
        chunkId: "chunk-sqlite-compat-001",
        sourceTurnIds: [turns[0]!.turnId],
        sourceRevision: 1,
      }),
    ];
    const writtenChunks = expectOk(
      await store.writeChunks({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 1,
        chunks,
      }),
    );

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const readChunks = expectOk(await store.readChunks(thread.threadId));

    assert.deepEqual(writtenTurns.map((turn) => turn.turnId), ["turn-sqlite-compat-001"]);
    assert.deepEqual(snapshot.turns.map((turn) => turn.turnId), ["turn-sqlite-compat-001"]);
    assert.deepEqual(writtenChunks.map((chunk) => chunk.chunkId), ["chunk-sqlite-compat-001"]);
    assert.deepEqual(readChunks.map((chunk) => chunk.chunkId), ["chunk-sqlite-compat-001"]);
    assert.equal(snapshot.thread.turnsRevision, 1);
    assert.equal(snapshot.thread.status.turnState, "ready");
  });
});
