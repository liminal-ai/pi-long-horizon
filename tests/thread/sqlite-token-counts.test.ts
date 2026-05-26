import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { makeActorRecord, makeMessageRecord, makeThreadRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";
import { assertTokenCountRecord } from "../../src/token-accounting/index.js";
import { makeChunkState, makeSmoothTurnState } from "../../src/thread/async-thread/test/fixtures.js";
import { importFileBackedThread } from "../../src/thread/migration/sqlite-thread-migration-service.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { createLegacyThreadFixture, expectOk } from "./sqlite-migration-test-helpers.js";

test("migration preserves exact and heuristic token metadata plus token-counting readiness", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-tokens-001";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-tokens-001",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-tokens-001.jsonl"),
    });
    const thread = makeThreadRecord({
      threadId,
      target,
      status: {
        turnState: "ready",
        tokenCounting: {
          status: "repair_needed",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sourceRevision: 1,
          issueCount: 1,
          issues: [{ code: "TOKEN_COUNT_DEGRADED", message: "A heuristic count remains.", threadId }],
        },
      },
    });

    await createLegacyThreadFixture({
      storeRootDir,
      thread,
      actors: [makeActorRecord({ actorId: "actor-001", actorType: "agent" })],
      messages: [makeMessageRecord({ threadId, actorId: "actor-001", actorType: "agent" })],
      turns: [
        makeTurnRecord({
          threadId,
          turnId: "turn-001",
          rawTokenCountMetadata: assertTokenCountRecord({
            count: 42,
            scope: "raw_turn_materialized",
            source: "provider_input_count",
            trustClass: "exact",
            provider: "openai",
            model: "gpt-5.4-mini",
            representationHash: "sha256:raw-turn-001",
            sourceRevision: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          smooth: {
            ...makeSmoothTurnState({ threadId, turnId: "turn-001", sourceRevision: 1 }),
            tokenCountMetadata: assertTokenCountRecord({
              count: 24,
              scope: "smooth_turn_materialized",
              source: "pi_heuristic",
              trustClass: "heuristic_estimate",
              representationHash: "sha256:smooth-turn-001",
              sourceRevision: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            }),
          },
        }),
      ],
      chunks: [
        makeChunkState({
          threadId,
          chunkId: "chunk-001",
          smoothTokenCountMetadata: assertTokenCountRecord({
            count: 30,
            scope: "chunk_smooth_materialized",
            source: "local_tokenizer",
            trustClass: "tokenizer_estimate",
            tokenizer: "cl100k_base",
            tokenizerVersion: "1",
            representationHash: "sha256:chunk-001",
            sourceRevision: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        }),
      ],
    });

    expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const snapshot = expectOk(await sqliteStore.openThread(threadId));
    const turns = expectOk(await sqliteStore.readTurns(threadId));
    const chunks = expectOk(await sqliteStore.readChunks(threadId));

    assert.equal(snapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(snapshot.thread.status.tokenCounting?.issues?.[0]?.code, "TOKEN_COUNT_DEGRADED");
    assert.equal(turns[0]?.rawTokenCountMetadata?.trustClass, "exact");
    assert.equal(turns[0]?.smooth?.tokenCountMetadata?.trustClass, "heuristic_estimate");
    assert.equal(chunks[0]?.smoothTokenCountMetadata?.trustClass, "tokenizer_estimate");
  });
});

test("invalid token metadata stays imported but is surfaced as repair-needed debt", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const threadId = "thread-sqlite-tokens-002";
    const target = makeThreadTarget({
      sessionId: "session-sqlite-tokens-002",
      sessionFilePath: join(storeRootDir, "generated", "session-sqlite-tokens-002.jsonl"),
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
          rawTokenCountMetadata: {
            count: 5,
            scope: "raw_turn_materialized",
            source: "provider_input_count",
            trustClass: "exact",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ],
    });

    const imported = expectOk(await importFileBackedThread({ rootDir: storeRootDir, threadId, mode: "import" }));
    const sqliteStore = new SqliteThreadStore(storeRootDir);
    const snapshot = expectOk(await sqliteStore.openThread(threadId));
    const turns = expectOk(await sqliteStore.readTurns(threadId));

    assert.ok(imported.warnings.some((issue) => issue.code === "TOKEN_COUNT_DEGRADED"));
    assert.equal(snapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(snapshot.thread.status.tokenCounting?.issueCount, 1);
    assert.equal(turns[0]?.rawTokenCountMetadata?.count, 5);
  });
});
