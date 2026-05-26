import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import Database from "better-sqlite3";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempSqliteThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function makePendingMessage(overrides: Partial<ReturnType<typeof makeMessageRecord>> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

test("SQLite thread store creates, migrates, and reopens thread databases from disk", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, resolveThreadSqlitePath, createStore }) => {
    const store = createStore();
    const thread = expectOk(
      await store.createThread({
        thread: makeThreadRecord({
          threadId: "thread-sqlite-foundation-001",
          target: makeThreadTarget({ sessionId: "session-sqlite-foundation-001" }),
        }),
        targetRef: {
          runtime: "pi",
          sessionId: "session-sqlite-foundation-001",
        },
      }),
    );
    const message = expectOk(
      await store.appendMessage({
        threadId: thread.threadId,
        actor: makeActorRecord({ actorId: "actor-sqlite-001" }),
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-001",
          parts: [{ partId: "part-sqlite-001", partOrder: 1, partType: "text", content: "Persist me." }],
        }),
      }),
    );
    const dbPath = resolveThreadSqlitePath(thread.threadId);

    await stat(dbPath);

    const reopenedStore = new SqliteThreadStore(storeRootDir);
    const reopened = expectOk(await reopenedStore.openThread(thread.threadId));

    assert.equal(reopened.thread.threadId, thread.threadId);
    assert.equal(reopened.thread.messageHighWatermark, 1);
    assert.equal(reopened.thread.sourceRevision, 1);
    assert.deepEqual(reopened.messages.map((entry) => entry.messageId), [message.messageId]);
    assert.equal(reopened.messages[0]?.parts[0]?.content, "Persist me.");

    const db = new Database(dbPath, { readonly: true });
    const migrations = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC").all() as Array<{
      version: number;
      name: string;
    }>;
    db.close();

    assert.deepEqual(migrations, [{ version: 1, name: "sqlite-store-foundation" }]);
  });
});
