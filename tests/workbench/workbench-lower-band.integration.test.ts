import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchQueryService } from "../../src/workbench/services/workbench-query-service.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { buildDraftThreadView } from "../../src/thread-view/services/thread-view-builder.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

function expectOk<T>(result: { ok: true; value: T } | { ok: false; issues: unknown[] }): T {
  assert.equal(result.ok, true);
  return result.value;
}

test("workbench lower-band inspection reads real persisted chunk-backed readiness", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const buildResult = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    assert.equal(buildResult.status, "ready");

    const queryService = new WorkbenchQueryService(context.threadStore, context.threadViewStore);
    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: context.threadId,
        threadViewId: buildResult.draftThreadViewId,
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
