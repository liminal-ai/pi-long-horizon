import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function makePendingMessage(overrides: Partial<ReturnType<typeof makeMessageRecord>> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

test("migration smoke imports core identity and message state into SQLite without runtime cutover", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const fileStore = new FileThreadStore(storeRootDir);
    const thread = expectOk(
      await fileStore.createThread({
        thread: makeThreadRecord({
          threadId: "thread-sqlite-migration-smoke-001",
          target: makeThreadTarget({ sessionId: "session-sqlite-migration-smoke-001" }),
        }),
        targetRef: {
          runtime: "pi",
          sessionId: "session-sqlite-migration-smoke-001",
        },
      }),
    );
    const message = expectOk(
      await fileStore.appendMessage({
        threadId: thread.threadId,
        actor: makeActorRecord({ actorId: "actor-sqlite-migration-smoke-001" }),
        message: makePendingMessage({
          threadId: thread.threadId,
          messageId: "message-sqlite-migration-smoke-001",
          parts: [{ partId: "part-sqlite-migration-smoke-001", partOrder: 1, partType: "text", content: "Legacy file-backed message." }],
        }),
      }),
    );
    expectOk(
      await fileStore.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: 1,
        expectedMessageHighWatermark: 1,
        expectedTurnsRevision: 0,
        turns: [
          makeTurnRecord({
            turnId: "turn-sqlite-migration-smoke-001",
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

    const imported = expectOk(
      await importFileBackedThread({
        rootDir: storeRootDir,
        threadId: thread.threadId,
        mode: "import",
      }),
    );
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const sqliteSnapshot = expectOk(await sqliteStore.openThread(thread.threadId));
    const sqliteTurns = expectOk(await sqliteStore.readTurns(thread.threadId));

    await stat(imported.dbPath);

    assert.equal(imported.importedCounts.threads, 1);
    assert.equal(imported.importedCounts.messages, 1);
    assert.equal(imported.skippedCounts.turns, 1);
    assert.equal(imported.warnings[0]?.code, "MIGRATION_VALIDATION_FAILED");
    assert.equal(sqliteSnapshot.thread.threadId, thread.threadId);
    assert.equal(sqliteSnapshot.messages.length, 1);
    assert.equal(sqliteSnapshot.messages[0]?.parts[0]?.content, "Legacy file-backed message.");
    assert.deepEqual(sqliteTurns, []);
  });
});
