import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { makeActorRecord, makeMessageRecord, makeProjectionRevisionRecord, makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { createLegacyThreadFixture, expectOk } from "./sqlite-migration-test-helpers.js";

test("projection metadata imports separately from generated rollout content", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-projection-001";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-projection-001",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-projection-001.jsonl"),
    });
    const projectionPath = join(storeRootDir, "generated", "projection-001.jsonl");

    await createLegacyThreadFixture({
      storeRootDir,
      thread: makeThreadRecord({ threadId, target, status: { turnState: "ready" } }),
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      projections: [
        makeProjectionRevisionRecord({
          revisionId: "projection-001",
          threadId,
          generatedSessionId: "generated-session-001",
          generatedFilePath: projectionPath,
          status: "available",
        }),
      ],
      generatedFileContents: {
        [projectionPath]: "{\"message\":\"projection text that does not match canonical message text\"}\n",
      },
    });

    expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const snapshot = expectOk(await sqliteStore.openThread(threadId));
    const projections = expectOk(await sqliteStore.readProjectionRevisions(threadId));

    assert.equal(snapshot.messages[0]?.parts[0]?.content, "hello world");
    assert.equal(projections[0]?.generatedSessionId, "generated-session-001");
    assert.equal(snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath, projectionPath);
  });
});

test("missing generated rollout is warned while projection metadata remains readable", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-projection-002";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-projection-002",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-projection-002.jsonl"),
    });
    const missingProjectionPath = join(storeRootDir, "generated", "missing-projection-002.jsonl");

    await createLegacyThreadFixture({
      storeRootDir,
      thread: makeThreadRecord({ threadId, target, status: { turnState: "ready" } }),
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      projections: [
        makeProjectionRevisionRecord({
          revisionId: "projection-002",
          threadId,
          generatedFilePath: missingProjectionPath,
          generatedSessionId: "generated-session-002",
        }),
      ],
    });

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const projections = expectOk(await sqliteStore.readProjectionRevisions(threadId));

    assert.ok(imported.warnings.some((issue) => issue.code === "GENERATED_ROLLOUT_MISSING"));
    assert.equal(projections[0]?.generatedFilePath, missingProjectionPath);
    assert.equal(projections[0]?.generatedSessionId, "generated-session-002");
  });
});
