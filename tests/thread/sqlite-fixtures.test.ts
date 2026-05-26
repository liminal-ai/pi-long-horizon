import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import { makeChunkState } from "../../src/thread/async-thread/test/fixtures.js";
import {
  createTestThreadStore,
  withTempManagedThreadStore,
  withTempSqliteThreadStore,
} from "../../src/thread/async-thread/test/temp-thread-store.js";
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

test("test-store helpers can request file or SQLite backing explicitly", async () => {
  for (const backing of ["file", "sqlite"] as const) {
    await withTempManagedThreadStore({ backing }, async ({ storeRootDir, createStore, resolveThreadSqlitePath }) => {
      const store = createStore();
      const thread = expectOk(
        await store.createThread({
          thread: makeThreadRecord({
            threadId: `thread-helper-${backing}`,
            target: makeThreadTarget({ sessionId: `session-helper-${backing}` }),
          }),
          targetRef: {
            runtime: "pi",
            sessionId: `session-helper-${backing}`,
          },
        }),
      );
      expectOk(
        await store.appendMessage({
          threadId: thread.threadId,
          actor: makeActorRecord({ actorId: `actor-helper-${backing}` }),
          message: makePendingMessage({
            threadId: thread.threadId,
            messageId: `message-helper-${backing}`,
          }),
        }),
      );

      if (backing === "sqlite") {
        await stat(resolveThreadSqlitePath(thread.threadId));
        assert.equal(createTestThreadStore({ backing, storeRootDir }).constructor.name, "SqliteThreadStore");
      } else {
        await stat(`${storeRootDir}/threads/${thread.threadId}/thread.json`);
        assert.equal(createTestThreadStore({ backing, storeRootDir }).constructor.name, "FileThreadStore");
      }
    });
  }
});

test("SQLite helpers can persist realistic turn and chunk fixtures without inventing a separate fixture path", async () => {
  await withTempSqliteThreadStore(async ({ createStore }) => {
    const store = createStore();
    const thread = expectOk(
      await store.createThread({
        thread: makeThreadRecord({
          threadId: "thread-sqlite-fixtures-001",
          target: makeThreadTarget({ sessionId: "session-sqlite-fixtures-001" }),
        }),
        targetRef: {
          runtime: "pi",
          sessionId: "session-sqlite-fixtures-001",
        },
      }),
    );
    const message = expectOk(
      await store.appendMessage({
        threadId: thread.threadId,
        actor: makeActorRecord({ actorId: "actor-sqlite-fixtures-001" }),
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-fixtures-001",
        }),
      }),
    );

    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 0,
        turns: [
          makeTurnRecord({
            turnId: "turn-sqlite-fixtures-001",
            threadId: thread.threadId,
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
    expectOk(
      await store.writeChunks({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 1,
        chunks: [
          makeChunkState({
            threadId: thread.threadId,
            chunkId: "chunk-sqlite-fixtures-001",
            sourceTurnIds: ["turn-sqlite-fixtures-001"],
            sourceRevision: 1,
          }),
        ],
      }),
    );

    const reopened = expectOk(await createStore().openThread(thread.threadId));
    const chunks = expectOk(await createStore().readChunks(thread.threadId));

    assert.equal(reopened.turns.length, 1);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.chunkId, "chunk-sqlite-fixtures-001");
  });
});
