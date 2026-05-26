import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makeImportRecord,
  makeMessageRecord,
  makeProjectionRevisionRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { makeChunkState, makeSmoothTurnState, makeTurnLowerBandProjection } from "../../src/thread/async-thread/test/fixtures.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { seedSqliteThreadSnapshot, SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { createLegacyThreadFixture, expectOk } from "./sqlite-migration-test-helpers.js";

test("full migration preserves canonical, derived, import, projection, and authoritative managed lookup state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-migration-001";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-migration-001",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-migration-001.jsonl"),
    });
    const projectionPath = join(storeRootDir, "generated", "projection-001.jsonl");
    const generatedTarget = makeThreadTarget({
      sessionId: "projection-session-001",
      sessionFilePath: projectionPath,
    });
    const thread = makeThreadRecord({
      threadId,
      target,
      status: {
        turnState: "ready",
        tokenCounting: {
          status: "repair_needed",
          updatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: 2,
          issueCount: 1,
          issues: [{ code: "TOKEN_COUNT_DEGRADED", message: "Heuristic token debt remains.", threadId }],
        },
      },
    });
    const actors = [
      makeActorRecord({ actorId: "user-001", actorType: "human", displayName: "Steward" }),
      makeActorRecord({ actorId: "assistant-001", actorType: "agent", displayName: "Assistant" }),
    ];
    const messages = [
      makeMessageRecord({
        threadId,
        messageId: "message-001",
        actorId: "user-001",
        actorType: "human",
        messageKind: "prompt",
        parts: [{ partId: "part-001", partOrder: 1, partType: "text", content: "Summarize the migration status." }],
      }),
      makeMessageRecord({
        threadId,
        messageId: "message-002",
        actorId: "assistant-001",
        actorType: "agent",
        sourceOrder: 2,
        sourceRevision: 2,
        messageKind: "tool_result",
        parts: [{
          partId: "part-002",
          partOrder: 1,
          partType: "tool_result",
          content: { stdout: "very large tool output that should stay canonical" },
        }],
      }),
    ];
    const turns = [
      makeTurnRecord({
        threadId,
        turnId: "turn-001",
        turnOrder: 1,
        lifecycleStatus: "closed",
        repairStatus: "ready",
        initiatingMessageId: "message-001",
        messageIds: ["message-001", "message-002"],
        sourceRange: { fromSourceOrder: 1, toSourceOrder: 2 },
        sourceRevision: 2,
        smooth: {
          ...makeSmoothTurnState({ threadId, turnId: "turn-001", sourceRevision: 2 }),
          text: "Deterministic smooth turn text",
          lowerBandProjection: makeTurnLowerBandProjection({ sourceRevision: 2 }),
        },
      }),
    ];
    const chunks = [
      makeChunkState({
        threadId,
        chunkId: "chunk-001",
        sourceTurnIds: ["turn-001"],
        sourceRevision: 2,
      }),
    ];
    const imports = [
      makeImportRecord({
        importId: "import-001",
        importedMessageCount: 2,
        importedSourceRange: { fromSourceOrder: 1, toSourceOrder: 2 },
      }),
    ];
    const projections = [
      makeProjectionRevisionRecord({
        revisionId: "projection-001",
        threadId,
        generatedFilePath: projectionPath,
        generatedSessionId: "projection-session-001",
        threadViewId: "thread-view-001",
        compactSnapshot: {
          schemaVersion: "projection.compact-snapshot.v1",
          bands: {
            full_fidelity: {
              bandType: "full_fidelity",
              sourceUnitType: "turn",
              selectedIds: ["turn-001"],
              renderedStatus: "ready",
            },
            smooth: {
              bandType: "smooth",
              sourceUnitType: "turn",
              selectedIds: ["turn-001"],
              renderedStatus: "ready",
            },
            detailed: {
              bandType: "detailed",
              sourceUnitType: "chunk",
              selectedIds: ["chunk-001"],
              renderedStatus: "ready",
            },
            brief: {
              bandType: "brief",
              sourceUnitType: "chunk",
              selectedIds: ["chunk-001"],
              renderedStatus: "ready",
            },
          },
          generatedEntries: [],
        },
      }),
    ];

    await createLegacyThreadFixture({
      storeRootDir,
      thread,
      actors,
      messages,
      turns,
      chunks,
      imports,
      projections,
      generatedFileContents: {
        [projectionPath]: "{\"type\":\"session\"}\n{\"message\":\"generated rollout\"}\n",
      },
    });

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const sqliteSnapshot = expectOk(await sqliteStore.openThread(threadId));
    const sqliteTurns = expectOk(await sqliteStore.readTurns(threadId));
    const sqliteChunks = expectOk(await sqliteStore.readChunks(threadId));
    const sqliteProjections = expectOk(await sqliteStore.readProjectionRevisions(threadId));

    await rm(join(storeRootDir, "threadId-map.json"), { force: true });
    await rm(join(storeRootDir, "index.json"), { force: true });
    const resolvedOriginal = expectOk(await sqliteStore.findManagedThread(target));
    const resolvedGenerated = expectOk(await sqliteStore.findManagedThread(generatedTarget));
    const resolvedProjectionRevisionId = expectOk(await sqliteStore.resolveProjectionRevisionIdMap(generatedTarget));

    assert.deepEqual(imported.importedCounts, {
      threads: 1,
      actors: 2,
      messages: 2,
      messageParts: 2,
      turns: 1,
      chunks: 1,
      imports: 1,
      projections: 1,
    });
    assert.equal(imported.partialStateHandling.status, "clean_import");
    assert.equal(imported.generatedRolloutPath, projectionPath);
    assert.equal(imported.warnings.length, 0);
    assert.equal(sqliteSnapshot.thread.threadId, threadId);
    assert.equal(sqliteSnapshot.thread.target.sessionId, target.sessionId);
    assert.equal(sqliteSnapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(sqliteSnapshot.messages[1]?.parts[0]?.partType, "tool_result");
    assert.deepEqual(sqliteSnapshot.messages[1]?.parts[0]?.content, { stdout: "very large tool output that should stay canonical" });
    assert.equal(sqliteTurns[0]?.smooth?.status, "ready");
    assert.equal(sqliteTurns[0]?.smooth?.lowerBandProjection?.status, "ready");
    assert.equal(sqliteChunks[0]?.chunkId, "chunk-001");
    assert.equal(sqliteSnapshot.imports[0]?.importId, "import-001");
    assert.equal(sqliteProjections[0]?.generatedSessionId, "projection-session-001");
    assert.equal(resolvedOriginal?.threadId, threadId);
    assert.equal(resolvedGenerated?.threadId, threadId);
    assert.equal(resolvedProjectionRevisionId, "projection-001");
  });
});

test("migration reports actor conflicts and imports inconsistent turns as repair-needed", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-migration-002";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-migration-002",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-migration-002.jsonl"),
    });
    const thread = makeThreadRecord({ threadId, target, status: { turnState: "ready" } });
    const actors = [makeActorRecord({ actorId: "actor-duplicate", actorType: "agent" })];
    const messages = [
      makeMessageRecord({
        threadId,
        messageId: "message-001",
        actorId: "actor-duplicate",
        actorType: "agent",
        parts: [{ partId: "part-001", partOrder: 1, partType: "text", content: "One message only." }],
      }),
    ];
    const turns = [
      makeTurnRecord({
        threadId,
        turnId: "turn-bad-001",
        initiatingMessageId: "message-missing",
        messageIds: ["message-001", "message-missing"],
        sourceRange: { fromSourceOrder: 1, toSourceOrder: 2 },
        smooth: {
          ...makeSmoothTurnState({ threadId, turnId: "turn-bad-001", sourceRevision: 1 }),
          strategy: undefined,
          sourceRevision: undefined,
        },
      }),
    ];

    const { threadDir } = await createLegacyThreadFixture({
      storeRootDir,
      thread,
      actors,
      messages,
      turns,
    });

    const actorsPath = join(threadDir, "actors.json");
    const originalActors = JSON.parse(await readFile(actorsPath, "utf8")) as unknown[];
    originalActors.push({ actorId: "actor-duplicate", actorType: "tool", displayName: "Conflicting Actor" });
    await writeFile(actorsPath, `${JSON.stringify(originalActors, null, 2)}\n`, "utf8");

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const sqliteSnapshot = expectOk(await sqliteStore.openThread(threadId));
    const sqliteTurns = expectOk(await sqliteStore.readTurns(threadId));

    assert.equal(imported.skippedCounts.actors, 1);
    assert.ok(imported.warnings.some((issue) => issue.code === "MIGRATION_VALIDATION_FAILED"));
    assert.ok(imported.warnings.some((issue) => issue.code === "TURN_STATE_INCOMPLETE"));
    assert.ok(imported.warnings.some((issue) => issue.code === "SMOOTH_INVALID"));
    assert.equal(sqliteSnapshot.actors.length, 1);
    assert.equal(sqliteSnapshot.thread.status.turnState, "repair_needed");
    assert.equal(sqliteTurns[0]?.repairStatus, "repair_needed");
    assert.equal(sqliteTurns[0]?.smooth?.status, "stale");
  });
});

test("repeat migration safely replaces prior complete SQLite state without duplicating rows", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-migration-003";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-migration-003",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-migration-003.jsonl"),
    });
    const thread = makeThreadRecord({ threadId, target, status: { turnState: "ready" } });
    const actors = [makeActorRecord({ actorId: "actor-001", actorType: "agent" })];
    const messages = [
      makeMessageRecord({
        threadId,
        messageId: "message-001",
        actorId: "actor-001",
        actorType: "agent",
        parts: [{ partId: "part-001", partOrder: 1, partType: "text", content: "First message." }],
      }),
      makeMessageRecord({
        threadId,
        messageId: "message-002",
        actorId: "actor-001",
        actorType: "agent",
        sourceOrder: 2,
        sourceRevision: 2,
        parts: [{ partId: "part-002", partOrder: 1, partType: "text", content: "Second message." }],
      }),
    ];

    await createLegacyThreadFixture({
      storeRootDir,
      thread,
      actors,
      messages,
      turns: [
        makeTurnRecord({
          threadId,
          turnId: "turn-001",
          turnOrder: 1,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: "message-001",
          messageIds: ["message-001", "message-002"],
          sourceRange: { fromSourceOrder: 1, toSourceOrder: 2 },
          sourceRevision: 2,
        }),
      ],
      chunks: [makeChunkState({ threadId, chunkId: "chunk-001", sourceTurnIds: ["turn-001"], sourceRevision: 2 })],
    });

    expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));

    const rerun = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const sqliteSnapshot = expectOk(await sqliteStore.openThread(threadId));
    const sqliteTurns = expectOk(await sqliteStore.readTurns(threadId));
    const sqliteChunks = expectOk(await sqliteStore.readChunks(threadId));

    assert.equal(rerun.partialStateHandling.status, "replaced_existing_import");
    assert.deepEqual(rerun.partialStateHandling.existingCounts, {
      threads: 1,
      actors: 1,
      messages: 2,
      messageParts: 2,
      turns: 1,
      chunks: 1,
      imports: 0,
      projections: 0,
    });
    assert.ok(rerun.warnings.some((issue) => issue.message.includes("already contained imported state")));
    assert.equal(sqliteSnapshot.actors.length, 1);
    assert.equal(sqliteSnapshot.messages.length, 2);
    assert.equal(sqliteTurns.length, 1);
    assert.equal(sqliteChunks.length, 1);
  });
});

test("interrupted migration retry reports partial-state handling before replacing incomplete SQLite rows", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-migration-004";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-migration-004",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-migration-004.jsonl"),
    });
    const thread = makeThreadRecord({ threadId, target, status: { turnState: "ready" } });
    const actors = [makeActorRecord({ actorId: "actor-001", actorType: "agent" })];
    const messages = [
      makeMessageRecord({
        threadId,
        messageId: "message-001",
        actorId: "actor-001",
        actorType: "agent",
        parts: [{ partId: "part-001", partOrder: 1, partType: "text", content: "First message." }],
      }),
      makeMessageRecord({
        threadId,
        messageId: "message-002",
        actorId: "actor-001",
        actorType: "agent",
        sourceOrder: 2,
        sourceRevision: 2,
        parts: [{ partId: "part-002", partOrder: 1, partType: "text", content: "Second message." }],
      }),
    ];

    await createLegacyThreadFixture({
      storeRootDir,
      thread,
      actors,
      messages,
      turns: [
        makeTurnRecord({
          threadId,
          turnId: "turn-001",
          turnOrder: 1,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: "message-001",
          messageIds: ["message-001", "message-002"],
          sourceRange: { fromSourceOrder: 1, toSourceOrder: 2 },
          sourceRevision: 2,
        }),
      ],
      chunks: [makeChunkState({ threadId, chunkId: "chunk-001", sourceTurnIds: ["turn-001"], sourceRevision: 2 })],
    });

    await seedSqliteThreadSnapshot({
      rootDir: storeRootDir,
      thread: makeThreadRecord({ threadId, target, sourceRevision: 1, messageHighWatermark: 1 }),
      actors: [makeActorRecord({ actorId: "partial-actor", actorType: "system" })],
      messages: [messages[0]],
    });

    const rerun = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const sqliteSnapshot = expectOk(await sqliteStore.openThread(threadId));
    const sqliteTurns = expectOk(await sqliteStore.readTurns(threadId));
    const sqliteChunks = expectOk(await sqliteStore.readChunks(threadId));

    assert.equal(rerun.partialStateHandling.status, "replaced_partial_state");
    assert.deepEqual(rerun.partialStateHandling.existingCounts, {
      threads: 1,
      actors: 1,
      messages: 1,
      messageParts: 1,
      turns: 0,
      chunks: 0,
      imports: 0,
      projections: 0,
    });
    assert.match(rerun.partialStateHandling.note, /partial or mismatched/i);
    assert.ok(rerun.warnings.some((issue) => issue.message.includes("partial or mismatched state")));
    assert.equal(sqliteSnapshot.actors.length, 1);
    assert.equal(sqliteSnapshot.messages.length, 2);
    assert.equal(sqliteTurns.length, 1);
    assert.equal(sqliteChunks.length, 1);
  });
});
