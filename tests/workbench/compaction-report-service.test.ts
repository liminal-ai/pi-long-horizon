import assert from "node:assert/strict";
import test from "node:test";

import { createStewardIssue } from "../../src/thread/domain/errors.js";
import { makeBandRecord, makeThreadView, makeThreadViewMessage, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { buildCompactionAuditReport } from "../../src/workbench/services/compaction-report-service.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

async function seedReportView(storeRootDir: string) {
  const context = await seedDeterministicRebuildThread(storeRootDir);
  const threadViewId = "thread-view-report";
  const view = makeThreadView({
    threadId: context.threadId,
    threadViewId,
    state: "active",
    status: "ready",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      targetTokenBudget: 10,
      selectedIds: [context.turns.oldest.turnId],
      renderedStatus: "ready",
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      targetTokenBudget: 20,
      selectedIds: [context.turns.middleOlder.turnId],
      renderedStatus: "ready",
    }),
    detailedBand: makeBandRecord({
      bandType: "detailed",
      targetTokenBudget: 30,
      selectedIds: [context.chunks.oldestClosed],
      sourceUnitType: "chunk",
      renderedStatus: "ready",
    }),
    briefBand: makeBandRecord({
      bandType: "brief",
      targetTokenBudget: 40,
      selectedIds: [context.chunks.newerClosed],
      sourceUnitType: "chunk",
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId,
        bandType: "full_fidelity",
        sourceReference: `${context.turns.oldest.turnId}/${context.turns.oldest.messages[0]!.messageId}`,
        messageOrder: 1,
        content: {
          messageId: context.turns.oldest.messages[0]!.messageId,
          actorId: context.turns.oldest.messages[0]!.actorId,
          actorType: context.turns.oldest.messages[0]!.actorType,
          messageKind: context.turns.oldest.messages[0]!.messageKind,
          capturedAt: context.turns.oldest.messages[0]!.capturedAt,
          parts: structuredClone(context.turns.oldest.messages[0]!.parts),
          targetMetadata: context.turns.oldest.messages[0]!.targetMetadata,
        },
      }),
      makeThreadViewMessage({
        threadViewId,
        bandType: "full_fidelity",
        sourceReference: `${context.turns.oldest.turnId}/${context.turns.oldest.messages[1]!.messageId}`,
        messageOrder: 2,
        content: {
          messageId: context.turns.oldest.messages[1]!.messageId,
          actorId: context.turns.oldest.messages[1]!.actorId,
          actorType: context.turns.oldest.messages[1]!.actorType,
          messageKind: context.turns.oldest.messages[1]!.messageKind,
          capturedAt: context.turns.oldest.messages[1]!.capturedAt,
          parts: structuredClone(context.turns.oldest.messages[1]!.parts),
          targetMetadata: context.turns.oldest.messages[1]!.targetMetadata,
        },
      }),
      makeThreadViewMessage({
        threadViewId,
        bandType: "smooth",
        sourceReference: context.turns.middleOlder.turnId,
        messageOrder: 3,
        content: "smooth one two",
      }),
      makeThreadViewMessage({
        threadViewId,
        bandType: "detailed",
        sourceReference: context.chunks.oldestClosed,
        messageOrder: 4,
        content: "detailed one two three four",
      }),
      makeThreadViewMessage({
        threadViewId,
        bandType: "brief",
        sourceReference: context.chunks.newerClosed,
        messageOrder: 5,
        content: "brief one",
      }),
    ],
  });

  const created = await context.threadViewStore.createThreadView({ view });
  assert.equal(created.ok, true);

  const snapshot = await context.threadStore.openThread(context.threadId);
  assert.equal(snapshot.ok, true);
  const updated = await context.threadStore.updateThreadMetadata({
    threadId: context.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    patch: {
      activeThreadViewId: threadViewId,
      threadViewOutputSummary: {
        count: 1,
        currentGeneratedFilePath: "/tmp/generated.jsonl",
        lastRevisionStatus: "available",
        generatedOutput: {
          threadId: context.threadId,
          threadViewId,
          generatedFilePath: "/tmp/generated.jsonl",
          archivePath: "/tmp/archive.jsonl",
          generatedAt: "2026-05-11T00:00:00.000Z",
          status: "reload_failed",
          generatedSource: "thread_view",
          placeholderExplicit: true,
          requestedLowerBound: 500,
          generatedSessionTokenCount: 612,
          generatedSessionTokenCountMetadata: {
            count: 612,
            scope: "generated_session",
            source: "provider_input_count",
            trustClass: "exact",
            provider: "openai",
            model: "gpt-test",
            representationHash: "sha256:test",
            createdAt: "2026-05-11T00:00:00.000Z",
            provenance: "test",
          },
          generatedSessionCountPolicy: {
            status: "usable",
            mode: "strict",
            requestedScope: "generated_session",
            recordScope: "generated_session",
            source: "provider_input_count",
            count: 612,
            usableForSmartCompact: true,
            precedence: 100,
            reasonCode: "COUNT_SOURCE_PROVIDER_INPUT_USABLE",
            reason: "Provider input count is exact for generated-session decisions.",
          },
          issues: [
            createStewardIssue({
              code: "PI_RELOAD_FAILED",
              message: "Reload failed in test.",
              threadId: context.threadId,
            }),
          ],
        },
      },
    },
  });
  assert.equal(updated.ok, true);

  return { ...context, threadViewId };
}

test("buildCompactionAuditReport reads band data from a seeded thread", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const report = await buildCompactionAuditReport(
      {
        threadId: context.threadId,
        threadViewId: context.threadViewId,
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );

    assert.equal(report.threadId, context.threadId);
    assert.equal(report.threadViewId, context.threadViewId);
    assert.equal(report.compactStatus, "reload_failed");
    assert.equal(report.generatedSessionTokenCount, 612);
    assert.equal(report.generatedSessionCountSource, "provider_input_count");
    assert.equal(report.generatedSessionCountTrustClass, "exact");
    assert.equal(report.generatedSessionCountPolicyStatus, "usable");
    assert.equal(report.generatedFilePath, "/tmp/generated.jsonl");
    assert.equal(report.archivePath, "/tmp/archive.jsonl");
    assert.deepEqual(report.bands.full_fidelity.selectedIds, [context.turns.oldest.turnId]);
    assert.equal(report.bands.detailed.targetTokenBudget, 30);
    assert.equal(report.bands.brief.renderedStatus, "ready");
    assert.equal(report.blockers[0]?.code, "PI_RELOAD_FAILED");
    assert.equal(report.reloadResult, "reload_failed");
  });
});

test("buildCompactionAuditReport computes per-band token accounting", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: context.threadViewId },
      { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
    );
    assert.equal(report.bands.full_fidelity.actualTokenCount, 127);
    assert.equal(report.bands.smooth.actualTokenCount, 7);
    assert.equal(report.bands.detailed.actualTokenCount, 22);
    assert.equal(report.bands.brief.actualTokenCount, 17);
    assert.equal(report.bands.full_fidelity.countPolicyStatus, "usable");
    assert.equal(report.resultingTokenCount, 173);
  });
});

test("buildCompactionAuditReport includes turn-level detail for upper bands", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: context.threadViewId },
      { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
    );

    assert.deepEqual(report.selectedTurns, [
      {
        turnId: context.turns.oldest.turnId,
        bandType: "full_fidelity",
        rawTokenCount: 127,
        smoothTokenCount: 7,
        rawCountPolicyStatus: "usable",
        smoothCountPolicyStatus: "usable",
      },
      {
        turnId: context.turns.middleOlder.turnId,
        bandType: "smooth",
        rawTokenCount: 135,
        smoothTokenCount: 7,
        rawCountPolicyStatus: "usable",
        smoothCountPolicyStatus: "usable",
      },
    ]);
  });
});

test("buildCompactionAuditReport includes chunk-level detail for lower bands", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: context.threadViewId },
      { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
    );

    assert.deepEqual(report.selectedChunks, [
      {
        chunkId: context.chunks.oldestClosed,
        bandType: "detailed",
        smoothTokenCount: 8,
        detailedTokenCount: 22,
        briefTokenCount: 18,
        detailedCountPolicyStatus: "usable",
        briefCountPolicyStatus: "usable",
      },
      {
        chunkId: context.chunks.newerClosed,
        bandType: "brief",
        smoothTokenCount: 8,
        detailedTokenCount: 22,
        briefTokenCount: 17,
        detailedCountPolicyStatus: "usable",
        briefCountPolicyStatus: "usable",
      },
    ]);
  });
});

test("buildCompactionAuditReport handles missing and empty thread views", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    await assert.rejects(
      buildCompactionAuditReport(
        { threadId: context.threadId, threadViewId: "missing-view" },
        { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
      ),
      /THREAD_VIEW_NOT_FOUND/,
    );

    const emptyView = makeThreadView({
      threadId: context.threadId,
      threadViewId: "empty-view",
    });
    const created = await context.threadViewStore.createThreadView({ view: emptyView });
    assert.equal(created.ok, true);
    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: "empty-view" },
      { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
    );

    assert.equal(report.resultingTokenCount, 0);
    assert.equal(report.bands.full_fidelity.selectedCount, 0);
    assert.deepEqual(report.selectedTurns, []);
    assert.deepEqual(report.selectedChunks, []);
  });
});

test("buildCompactionAuditReport hides generated output from a different thread view", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const updated = await context.threadStore.updateThreadMetadata({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      patch: {
        threadViewOutputSummary: {
          ...snapshot.value.thread.threadViewOutputSummary,
          generatedOutput: {
            threadId: context.threadId,
            threadViewId: "different-view",
            generatedFilePath: "/tmp/other-generated.jsonl",
            archivePath: "/tmp/other-archive.jsonl",
            status: "available",
            generatedSource: "thread_view",
            placeholderExplicit: true,
          },
        },
      },
    });
    assert.equal(updated.ok, true);

    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: context.threadViewId },
      { threadStore: context.threadStore, threadViewStore: context.threadViewStore },
    );

    assert.equal(report.compactStatus, undefined);
    assert.equal(report.generatedFilePath, undefined);
    assert.equal(report.archivePath, undefined);
    assert.equal(report.reloadResult, undefined);
    assert.deepEqual(report.blockers, []);
  });
});
