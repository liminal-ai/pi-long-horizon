import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchQueryService } from "../../src/workbench/services/workbench-query-service.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { buildThreadViewProjection } from "../../src/thread-view/services/thread-view-builder.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

const STAGE7_READY_LOWER_BOUND = 180;
const STAGE7_READY_BAND_PERCENTAGES = { fullFidelity: 50, smooth: 4, detailed: 13, brief: 33 } as const;

function expectOk<T>(result: { ok: true; value: T } | { ok: false; issues: unknown[] }): T {
  assert.equal(result.ok, true);
  return result.value;
}

test("workbench lower-band inspection reads real persisted chunk-backed readiness", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const buildResult = await buildThreadViewProjection(
      {
        threadId: context.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
      },
    );
    assert.equal(buildResult.status, "ready");
    const projectionRevisionId = `projection_${buildResult.threadViewId}`;
    expectOk(
      await context.threadStore.writeProjectionRevision({
        revisionId: projectionRevisionId,
        threadId: context.threadId,
        threadViewId: buildResult.threadViewId,
        targetRuntime: "pi",
        generatedFilePath: `/tmp/${buildResult.threadViewId}.jsonl`,
        createdAt: "2026-05-17T00:00:00.000Z",
        sourceStateReference: buildResult.sourceStateReference,
        status: "available",
        compactSnapshot: buildResult.compactSnapshot,
      }),
    );

    const queryService = new WorkbenchQueryService(context.threadStore, context.threadViewStore);
    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: context.threadId,
        threadViewId: buildResult.threadViewId,
      }),
    );
    const openChunk = expectOk(
      await queryService.openChunkDetail({
        threadId: context.threadId,
        chunkId: context.chunks.openRecent,
      }),
    );

    assert.deepEqual(
      readiness.detailedBand.map((entry) => [entry.chunkId, entry.status]),
      [[context.chunks.newerClosed, "eligible"]],
    );
    assert.deepEqual(
      readiness.briefBand.map((entry) => [entry.chunkId, entry.status]),
      [[context.chunks.oldestClosed, "eligible"]],
    );
    assert.equal(openChunk.chunk.lifecycleStatus, "open");
    assert.equal(openChunk.chunk.placeholderExplicit, undefined);
    assert.equal(
      readiness.detailedBand.some((entry) => entry.chunkId === context.chunks.openRecent),
      false,
    );
    assert.equal(
      readiness.briefBand.some((entry) => entry.chunkId === context.chunks.openRecent),
      false,
    );
  });
});
