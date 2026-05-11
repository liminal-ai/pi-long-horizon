import assert from "node:assert/strict";
import test from "node:test";

import { buildDraftThreadView } from "../../src/thread-view/services/thread-view-builder.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedPlaceholderThread,
  seedNoClosedChunkThread,
} from "./helpers.js";

test("rebuild accepts explicit run inputs", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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

    assert.equal(result.status, "ready");
    assert.ok(result.resultingTokenCount !== undefined);
    assert.equal(result.resultingTokenCount! <= 30, true);

    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.status, "ready");
  });
});

test("rebuild rejects invalid run inputs", async () => {
  await assert.rejects(
    buildDraftThreadView({
      threadId: "thread-invalid",
      requestedLowerBound: 0,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
    }),
    /requestedLowerBound must be greater than 0/,
  );
});

test("full-fidelity selection starts from newest turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.fullFidelityBand.selectedIds, [context.turns.newest.turnId]);
  });
});

test("full-fidelity does not split turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.fullFidelityBand.selectedIds, [context.turns.newest.turnId]);
    assert.deepEqual(
      opened.value.view.emittedMessages
        .filter((message) => message.bandType === "full_fidelity")
        .map((message) => message.sourceReference),
      [
        `${context.turns.newest.turnId}/${context.turns.newest.messages[0].messageId}`,
        `${context.turns.newest.turnId}/${context.turns.newest.messages[1].messageId}`,
      ],
    );
  });
});

test("full-fidelity-only overage is explicit", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
  });
});

test("smooth band begins after full-fidelity region by default", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.smoothBand.selectedIds, [context.turns.middleNewer.turnId]);
  });
});

test("smooth band does not split turns", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 0, smooth: 100, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.smoothBand.selectedIds, [context.turns.newest.turnId]);
    assert.deepEqual(
      opened.value.view.emittedMessages
        .filter((message) => message.bandType === "smooth")
        .map((message) => message.sourceReference),
      [context.turns.newest.turnId],
    );
  });
});

test("closed chunk can enter lower band", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.detailedBand.selectedIds, [context.chunks.newerClosed]);
    assert.deepEqual(opened.value.view.briefBand.selectedIds, [context.chunks.oldestClosed]);
  });
});

test("open chunk cannot enter lower band", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(context.chunks.openRecent), false);
    assert.equal(opened.value.view.briefBand.selectedIds.includes(context.chunks.openRecent), false);
  });
});

test("no closed chunks leaves lower bands empty", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedNoClosedChunkThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.detailedBand.selectedIds, []);
    assert.deepEqual(opened.value.view.briefBand.selectedIds, []);
  });
});

test("rebuild lands at or below lower bound", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
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

    assert.equal(result.status, "ready");
    assert.equal((result.resultingTokenCount ?? Number.MAX_SAFE_INTEGER) <= 30, true);
  });
});

test("rebuild failure to reach lower bound is explicit", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);

    const result = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 14,
        requestedBandPercentages: { fullFidelity: 20, smooth: 20, detailed: 40, brief: 20 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(result.status, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
    assert.equal((result.resultingTokenCount ?? 0) > 14, true);
  });
});

test("invalid band percentages rejected before allocation", async () => {
  await assert.rejects(
    buildDraftThreadView({
      threadId: "thread-invalid-band-mix",
      requestedLowerBound: 40,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 5 },
      mode: "strict",
    }),
    /requestedBandPercentages must sum to 100/,
  );
});

test("lower-band selection rejects closed-chunk ids missing required persisted artifacts", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedMissingDetailedPlaceholderThread(storeRootDir);

    const result = await buildDraftThreadView(
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
    const opened = await context.threadViewStore.openThreadView(context.threadId, result.draftThreadViewId);

    assert.equal(result.status, "blocked");
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), true);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.view.detailedBand.selectedIds, []);
  });
});
