import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { createLegacyThreadFixture, expectOk } from "./sqlite-migration-test-helpers.js";

test("migration preserves existing readiness issues and audit metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-readiness-001";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-readiness-001",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-readiness-001.jsonl"),
    });

    await createLegacyThreadFixture({
      storeRootDir,
      thread: makeThreadRecord({
        threadId,
        target,
        status: {
          turnState: "repair_needed",
          tokenCounting: {
            status: "repair_needed",
            updatedAt: "2026-01-01T00:00:00.000Z",
            sourceRevision: 1,
            issueCount: 2,
            issues: [
              {
                code: "TOKEN_COUNT_DEGRADED",
                message: "Lower-band token counts are heuristic.",
                threadId,
              },
              {
                code: "CHUNK_LOWER_BAND_MISSING",
                message: "Detailed chunk summary must be regenerated.",
                threadId,
              },
            ],
          },
        },
      }),
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
    });

    expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const snapshot = expectOk(await sqliteStore.openThread(threadId));

    assert.equal(snapshot.thread.status.turnState, "repair_needed");
    assert.equal(snapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(snapshot.thread.status.tokenCounting?.issueCount, 2);
    assert.equal(snapshot.thread.status.tokenCounting?.issues?.[0]?.code, "TOKEN_COUNT_DEGRADED");
    assert.equal(snapshot.thread.status.tokenCounting?.issues?.[1]?.code, "CHUNK_LOWER_BAND_MISSING");
  });
});

test("migration preserves resolved readiness state without inventing new blockers", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-readiness-002";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-readiness-002",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-readiness-002.jsonl"),
    });

    const imported = expectOk(await (async () => {
      await createLegacyThreadFixture({
        storeRootDir,
        thread: makeThreadRecord({
          threadId,
          target,
          status: {
            turnState: "ready",
            tokenCounting: {
              status: "ready",
              updatedAt: "2026-01-01T00:00:00.000Z",
              sourceRevision: 1,
              issueCount: 0,
              issues: [],
            },
          },
        }),
        actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
        messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      });

      return importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" });
    })());

    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const snapshot = expectOk(await sqliteStore.openThread(threadId));

    assert.equal(imported.warnings.length, 0);
    assert.equal(snapshot.thread.status.turnState, "ready");
    assert.equal(snapshot.thread.status.tokenCounting?.status, "ready");
    assert.equal(snapshot.thread.status.tokenCounting?.issueCount, 0);
  });
});
