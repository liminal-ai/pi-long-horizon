import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";
import {
  makeChunkLowerBandArtifacts,
  makeChunkState,
  makeLegacyPlaceholderChunkState,
  makeSmoothTurnState,
  makeTurnLowerBandProjection,
} from "../../src/thread/async-thread/test/fixtures.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { createLegacyThreadFixture, expectOk } from "./sqlite-migration-test-helpers.js";

test("migration preserves valid smooth, lower-band, and chunk artifact provenance", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-derived-001";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-derived-001",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-derived-001.jsonl"),
    });

    await createLegacyThreadFixture({
      storeRootDir,
      thread: makeThreadRecord({ threadId, target, status: { turnState: "ready" } }),
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      turns: [
        makeTurnRecord({
          threadId,
          turnId: "turn-001",
          repairStatus: "ready",
          smooth: {
            ...makeSmoothTurnState({ threadId, turnId: "turn-001", sourceRevision: 1 }),
            text: "Deterministic smooth turn text",
            lowerBandProjection: makeTurnLowerBandProjection({ sourceRevision: 1 }),
          },
        }),
      ],
      chunks: [
        makeChunkState({
          threadId,
          chunkId: "chunk-001",
          sourceTurnIds: ["turn-001"],
          lowerBand: makeChunkLowerBandArtifacts(),
        }),
      ],
    });

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const turns = expectOk(await sqliteStore.readTurns(threadId));
    const chunks = expectOk(await sqliteStore.readChunks(threadId));

    assert.equal(imported.warnings.length, 0);
    assert.equal(turns[0]?.smooth?.status, "ready");
    assert.equal(turns[0]?.smooth?.lowerBandProjection?.status, "ready");
    assert.equal(chunks[0]?.lowerBand?.detailed?.status, "ready");
    assert.equal(chunks[0]?.lowerBand?.brief?.status, "ready");
  });
});

test("migration downgrades invalid derived provenance instead of importing it as ready", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-derived-002";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-derived-002",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-derived-002.jsonl"),
    });

    await createLegacyThreadFixture({
      storeRootDir,
      thread: makeThreadRecord({ threadId, target, status: { turnState: "ready" } }),
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      turns: [
        makeTurnRecord({
          threadId,
          turnId: "turn-001",
          smooth: {
            ...makeSmoothTurnState({ threadId, turnId: "turn-001", sourceRevision: 1 }),
            text: "Deterministic smooth turn text",
            lowerBandProjection: {
              status: "ready",
              text: "projection text",
              sourceFingerprint: undefined,
              sourceRevision: undefined,
              generatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      ],
      chunks: [
        makeChunkState({
          threadId,
          chunkId: "chunk-001",
          sourceTurnIds: ["turn-001"],
          conversationTranscript: {
            status: "ready",
            text: "transcript",
            sourceFingerprint: undefined,
            sourceRevision: undefined,
          },
          lowerBand: makeChunkLowerBandArtifacts({
            detailed: {
              band: "detailed",
              status: "ready",
              text: "bad detailed",
              providerMetadata: undefined,
              updatedAt: undefined,
            },
          }),
        }),
        makeLegacyPlaceholderChunkState({
          threadId,
          chunkId: "chunk-legacy-001",
          placeholders: {
            chunkId: "chunk-legacy-001",
            threadId,
            detailed: {
              kind: "detailed",
              status: "ready",
              text: "placeholder",
              strategy: "deterministic_truncate_30",
              smoothSourceFingerprint: undefined,
              smoothSourceRevision: undefined,
            },
          },
        }),
      ],
    });

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const turns = expectOk(await sqliteStore.readTurns(threadId));
    const chunks = expectOk(await sqliteStore.readChunks(threadId));

    assert.ok(imported.warnings.some((issue) => issue.code === "SMOOTH_INVALID"));
    assert.ok(imported.warnings.some((issue) => issue.code === "CHUNK_STATE_INVALID"));
    assert.ok(imported.warnings.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"));
    assert.equal(turns[0]?.smooth?.lowerBandProjection?.status, "invalid");
    assert.equal(chunks[0]?.conversationTranscript?.status, "invalid");
    assert.equal(chunks[0]?.lowerBand?.detailed?.status, "pending");
    assert.equal(chunks[1]?.placeholders?.detailed?.status, "invalid");
  });
});
