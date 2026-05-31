import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  countBriefChunkMaterialized,
  countDetailedChunkMaterialized,
  createMaterializedRepresentationHash,
  evaluateTokenCountRecordForScope,
} from "../../src/token-accounting/index.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import {
  FileThreadMutationCoordinator,
  StaleThreadMutationError,
} from "../../src/thread/store/mutation-coordinator.js";
import {
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
} from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import {
  makeChunkLowerBandArtifacts,
  makeChunkState,
  makeLegacyPlaceholderChunkState,
  makeTurnLowerBandProjection,
} from "../../src/thread/async-thread/test/fixtures.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";

test("deterministic token-count helpers are stable across reruns", () => {
  const text = "  Alpha\n\n beta\tgamma  ";
  const firstNormalized = normalizeDeterministicText(text);
  const secondNormalized = normalizeDeterministicText(text);
  const firstCount = estimateDeterministicTokenCount(text);
  const secondCount = estimateDeterministicTokenCount(` ${text} `);

  assert.equal(firstNormalized, secondNormalized);
  assert.equal(firstNormalized, "Alpha beta gamma");
  assert.equal(firstCount, secondCount);
  assert.equal(firstCount, 3);
});

test("thread-scoped mutation coordinator rejects stale revision writes cleanly", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const created = await store.createThread({
      thread: makeThreadRecord({
        threadId: "thread-stale",
        target: makeThreadTarget({ sessionId: "session-stale" }),
      }),
      targetRef: {
        runtime: "pi",
        sessionId: "session-stale",
      },
    });
    assert.equal(created.ok, true);

    const coordinator = new FileThreadMutationCoordinator(store);

    await assert.rejects(
      coordinator.acquireThreadLease({
        threadId: "thread-stale",
        expectedSourceRevision: 1,
      }),
      (error: unknown) => {
        assert.equal(error instanceof StaleThreadMutationError, true);
        assert.equal((error as StaleThreadMutationError).issue.code, "STALE_SOURCE_REVISION");
        return true;
      },
    );

    const lease = await coordinator.acquireThreadLease({
      threadId: "thread-stale",
      expectedSourceRevision: 0,
    });
    assert.equal(lease.threadId, "thread-stale");
    await lease.release();
  });
});

test("Story 0 lower-band fixtures default to valid new-schema records", () => {
  const projection = makeTurnLowerBandProjection();
  const closedChunk = makeChunkState();
  const openChunk = makeChunkState({ lifecycleStatus: "open" });
  const legacyChunk = makeLegacyPlaceholderChunkState();

  assert.equal(projection.status, "ready");
  assert.equal(projection.tokenCountMetadata?.scope, "turn_lower_band_projection_materialized");
  assert.equal(projection.tokenCountMetadata?.source, "provider_input_count");

  assert.equal(closedChunk.schemaVersion, "conversation_only_chunk_v1");
  assert.equal(closedChunk.conversationTranscript?.status, "ready");
  assert.equal(closedChunk.lowerBand?.detailed?.band, "detailed");
  assert.equal(closedChunk.lowerBand?.brief?.band, "brief");
  assert.equal(closedChunk.placeholders, undefined);
  assert.equal("placeholders" in closedChunk, false);

  assert.equal(openChunk.closedAt, undefined);
  assert.equal(openChunk.closeReason, undefined);
  assert.equal(openChunk.conversationTranscript, undefined);
  assert.equal(openChunk.lowerBand, undefined);

  assert.equal(legacyChunk.schemaVersion, undefined);
  assert.equal(legacyChunk.conversationTranscript, undefined);
  assert.equal(legacyChunk.lowerBand, undefined);
  assert.equal(typeof legacyChunk.placeholders?.detailed?.text, "string");
});

test("canonical chunk fixtures cannot become placeholder hybrids through default builders", () => {
  const canonical = makeChunkState({
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: {
        band: "detailed",
        status: "ready",
        text: "semantic detailed text",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    }),
  });
  const legacy = makeLegacyPlaceholderChunkState();

  assert.equal(canonical.schemaVersion, "conversation_only_chunk_v1");
  assert.equal(canonical.lowerBand?.detailed?.text, "semantic detailed text");
  assert.equal("placeholders" in canonical, false);
  assert.equal(legacy.schemaVersion, undefined);
  assert.equal(legacy.lowerBand, undefined);
  assert.equal("placeholders" in legacy, true);
});

test("semantic lower-band artifacts are authoritative for detailed and brief token accounting", () => {
  const chunk = {
    ...makeLegacyPlaceholderChunkState(),
    schemaVersion: "conversation_only_chunk_v1",
    lowerBand: makeChunkLowerBandArtifacts({
      detailed: {
        band: "detailed",
        status: "ready",
        text: "semantic detailed wins",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
      brief: {
        band: "brief",
        status: "ready",
        text: "semantic brief wins",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    }),
  } as unknown as ChunkState;
  const detailed = countDetailedChunkMaterialized(chunk, {
    createdAt: "2026-05-17T00:00:00.000Z",
  });
  const brief = countBriefChunkMaterialized(chunk, {
    createdAt: "2026-05-17T00:00:00.000Z",
  });

  assert.equal(detailed.representationHash, createMaterializedRepresentationHash("semantic detailed wins"));
  assert.equal(brief.representationHash, createMaterializedRepresentationHash("semantic brief wins"));
});

test("lower-band artifact fixtures stay lean and projection counts are policy-usable", () => {
  const artifacts = makeChunkLowerBandArtifacts({
    detailed: {
      band: "detailed",
      status: "failed",
      errorCode: "LOWER_BAND_FAILED",
      errorMessage: "provider unavailable",
      updatedAt: "2026-05-17T00:00:00.000Z",
    },
  });
  const projection = makeTurnLowerBandProjection();
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "turn_lower_band_projection_materialized",
    record: projection.tokenCountMetadata!,
  });

  assert.equal(artifacts.detailed?.status, "failed");
  assert.equal(artifacts.detailed?.tokenCountMetadata, undefined);
  assert.equal(decision.status, "usable");
  assert.equal(decision.reasonCode, "COUNT_SOURCE_PROVIDER_INPUT_USABLE");
});

test("verification command truth stays on verify plus verify-all without an integration runner", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const runner = await readFile(resolve(projectRoot, "scripts/run-node-tests.mjs"), "utf8");

  assert.equal(packageJson.scripts["test"], "node scripts/run-node-tests.mjs service");
  assert.equal(packageJson.scripts["typecheck:lh-context"], "npm --prefix packages/lh-context run typecheck");
  assert.equal(packageJson.scripts["test:lh-context"], "npm --prefix packages/lh-context test");
  assert.equal(
    packageJson.scripts["verify"],
    "npm run typecheck && npm run typecheck:lh-context && npm run test && npm run test:lh-context",
  );
  assert.equal(packageJson.scripts["verify-all"], "npm run verify && npm run test:e2e");
  assert.equal("test:integration" in packageJson.scripts, false);
  assert.match(runner, /supportedModes = new Set\(\["service", "e2e"\]\)/);
  assert.match(
    runner,
    /return filePath\.endsWith\("\.test\.ts"\) && !filePath\.endsWith\("\.e2e\.test\.ts"\);/,
  );
});
