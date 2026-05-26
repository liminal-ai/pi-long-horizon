import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import { makeChunkState } from "../../src/thread/async-thread/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { resolveThreadSqlitePath } from "../../src/thread/store/sqlite-thread-store.js";

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
  await withTempSqliteThreadStore(async ({ createStore, storeRootDir }) => {
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
    const db = new Database(resolveThreadSqlitePath(storeRootDir, thread.threadId), { readonly: true });
    const initialTurnRowId = db.prepare<
      [{ threadId: string; turnId: string }],
      { rowid: number }
    >("SELECT rowid FROM turns WHERE thread_id = @threadId AND turn_id = @turnId")
      .get({ threadId: thread.threadId, turnId: turns[0]!.turnId })?.rowid;
    const initialChunkRowId = db.prepare<
      [{ threadId: string; chunkId: string }],
      { rowid: number }
    >("SELECT rowid FROM chunks WHERE thread_id = @threadId AND chunk_id = @chunkId")
      .get({ threadId: thread.threadId, chunkId: chunks[0]!.chunkId })?.rowid;
    db.close();

    assert.equal(typeof initialTurnRowId, "number");
    assert.equal(typeof initialChunkRowId, "number");

    const rewrittenTurns = expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 1,
        turns: [
          turns[0]!,
          makeTurnRecord({
            turnId: "turn-sqlite-compat-002",
            threadId: thread.threadId,
            turnOrder: 2,
            initiatingMessageId: message.messageId,
            messageIds: [message.messageId],
            sourceRange: { fromSourceOrder: 1, toSourceOrder: 1 },
            sourceRevision: 1,
            repairStatus: "ready",
          }),
        ],
        turnState: "ready",
      }),
    );
    const rewrittenChunks = expectOk(
      await store.writeChunks({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 2,
        chunks: [
          chunks[0]!,
          makeChunkState({
            threadId: thread.threadId,
            chunkId: "chunk-sqlite-compat-002",
            sourceTurnIds: [rewrittenTurns[1]!.turnId],
            sourceRevision: 1,
          }),
        ],
      }),
    );

    const reopenedDb = new Database(resolveThreadSqlitePath(storeRootDir, thread.threadId), { readonly: true });
    const preservedTurnRowId = reopenedDb.prepare<
      [{ threadId: string; turnId: string }],
      { rowid: number }
    >("SELECT rowid FROM turns WHERE thread_id = @threadId AND turn_id = @turnId")
      .get({ threadId: thread.threadId, turnId: turns[0]!.turnId })?.rowid;
    const preservedChunkRowId = reopenedDb.prepare<
      [{ threadId: string; chunkId: string }],
      { rowid: number }
    >("SELECT rowid FROM chunks WHERE thread_id = @threadId AND chunk_id = @chunkId")
      .get({ threadId: thread.threadId, chunkId: chunks[0]!.chunkId })?.rowid;
    reopenedDb.close();

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const readChunks = expectOk(await store.readChunks(thread.threadId));

    assert.deepEqual(writtenTurns.map((turn) => turn.turnId), ["turn-sqlite-compat-001"]);
    assert.deepEqual(snapshot.turns.map((turn) => turn.turnId), ["turn-sqlite-compat-001", "turn-sqlite-compat-002"]);
    assert.deepEqual(writtenChunks.map((chunk) => chunk.chunkId), ["chunk-sqlite-compat-001"]);
    assert.deepEqual(readChunks.map((chunk) => chunk.chunkId), ["chunk-sqlite-compat-001", "chunk-sqlite-compat-002"]);
    assert.deepEqual(rewrittenChunks.map((chunk) => chunk.chunkId), ["chunk-sqlite-compat-001", "chunk-sqlite-compat-002"]);
    assert.equal(snapshot.thread.turnsRevision, 2);
    assert.equal(snapshot.thread.status.turnState, "ready");
    assert.equal(preservedTurnRowId, initialTurnRowId);
    assert.equal(preservedChunkRowId, initialChunkRowId);
  });
});

test("stale derived turn rewrites are rejected without rolling back newer canonical messages", async () => {
  await withTempSqliteThreadStore(async ({ createStore }) => {
    const store = createStore();
    const thread = expectOk(
      await store.createThread({
        thread: makeThreadRecord({
          threadId: "thread-sqlite-compat-stale-001",
          target: makeThreadTarget({ sessionId: "session-sqlite-compat-stale-001" }),
        }),
        targetRef: {
          runtime: "pi",
          sessionId: "session-sqlite-compat-stale-001",
        },
      }),
    );
    const actor = makeActorRecord({ actorId: "actor-sqlite-compat-stale-001" });
    const firstMessage = expectOk(
      await store.appendMessage({
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-compat-stale-001",
          parts: [makePartRecord({ partId: "part-sqlite-compat-stale-001", content: "older canonical message" })],
        }),
      }),
    );
    const initialTurns = [
      makeTurnRecord({
        turnId: "turn-sqlite-compat-stale-001",
        threadId: thread.threadId,
        initiatingMessageId: firstMessage.messageId,
        messageIds: [firstMessage.messageId],
        sourceRange: { fromSourceOrder: 1, toSourceOrder: 1 },
        sourceRevision: 1,
        repairStatus: "ready",
      }),
    ];
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 0,
        turns: initialTurns,
        turnState: "ready",
      }),
    );

    const secondMessage = expectOk(
      await store.appendMessage({
        threadId: thread.threadId,
        actor,
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-compat-stale-002",
          parts: [makePartRecord({ partId: "part-sqlite-compat-stale-002", content: "newer canonical message" })],
        }),
      }),
    );

    const staleRewrite = await store.writeTurns({
      threadId: thread.threadId,
      expectedSourceRevision: 1,
      expectedMessageHighWatermark: 1,
      expectedTurnsRevision: 1,
      turns: initialTurns.map((turn) => structuredClone(turn)),
      turnState: "ready",
    });

    assert.equal(staleRewrite.ok, false);
    assert.equal(staleRewrite.ok ? undefined : staleRewrite.issues[0]?.code, "STALE_SOURCE_REVISION");

    const snapshot = expectOk(await store.openThread(thread.threadId));
    assert.equal(snapshot.thread.sourceRevision, 2);
    assert.deepEqual(
      snapshot.messages.map((message) => [message.messageId, message.parts[0]?.content]),
      [
        [firstMessage.messageId, "older canonical message"],
        [secondMessage.messageId, "newer canonical message"],
      ],
    );
    assert.deepEqual(snapshot.turns.map((turn) => turn.turnId), ["turn-sqlite-compat-stale-001"]);
  });
});
