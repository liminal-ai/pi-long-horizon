import assert from "node:assert/strict";
import test from "node:test";

import { createStewardIssue } from "../../src/thread/domain/errors.js";
import { makeBandRecord, makeThreadView, makeThreadViewMessage, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { buildCompactionAuditReport } from "../../src/workbench/services/compaction-report-service.js";
import { seedDeterministicRebuildThread, seedDeterministicRebuildThreadWithOptions } from "../thread-view/helpers.js";

async function seedReportView(storeRootDir: string) {
  const context = await seedDeterministicRebuildThreadWithOptions(storeRootDir, { canonicalClosedChunks: true });
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

  const projection = await context.threadStore.writeProjectionRevision({
    revisionId: "projection-report",
    threadId: context.threadId,
    threadViewId,
    targetRuntime: "pi",
    generatedFilePath: "/tmp/generated.jsonl",
    archivePath: "/tmp/archive.jsonl",
    createdAt: "2026-05-11T00:00:00.000Z",
    sourceStateReference: view.sourceStateReference,
    status: "available",
    compactSnapshot: {
      schemaVersion: "projection.compact-snapshot.v1",
      sourceStateReference: view.sourceStateReference,
      resultingTokenCount: 0,
      bands: {
        full_fidelity: view.fullFidelityBand,
        smooth: view.smoothBand,
        detailed: view.detailedBand,
        brief: view.briefBand,
      },
      generatedEntries: [],
    },
  });
  assert.equal(projection.ok, true);

  const snapshot = await context.threadStore.openThread(context.threadId);
  assert.equal(snapshot.ok, true);
  const updated = await context.threadStore.updateThreadMetadata({
    threadId: context.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    patch: {
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
          placeholderExplicit: false,
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

test("buildCompactionAuditReport returns broad happy-path metadata, accounting, and selected source details", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const report = await buildCompactionAuditReport(
      {
        threadId: context.threadId,
        threadViewId: context.threadViewId,
      },
      {
        threadStore: context.threadStore,
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
    assert.equal(report.bands.full_fidelity.actualTokenCount, 127);
    assert.equal(report.bands.smooth.actualTokenCount, 6);
    assert.equal(report.bands.detailed.actualTokenCount, 10);
    assert.equal(report.bands.brief.actualTokenCount, 9);
    assert.equal(report.bands.full_fidelity.countPolicyStatus, "usable");
    assert.equal(report.resultingTokenCount, 152);
    assert.deepEqual(report.selectedTurns, [
      {
        turnId: context.turns.oldest.turnId,
        bandType: "full_fidelity",
        rawTokenCount: 127,
        smoothTokenCount: 6,
        smoothQuality: "ready",
        rawCountPolicyStatus: "usable",
        smoothCountPolicyStatus: "usable",
      },
      {
        turnId: context.turns.middleOlder.turnId,
        bandType: "smooth",
        rawTokenCount: 135,
        smoothTokenCount: 6,
        smoothQuality: "ready",
        rawCountPolicyStatus: "usable",
        smoothCountPolicyStatus: "usable",
      },
    ]);
    assert.deepEqual(report.selectedChunks, [
      {
        chunkId: context.chunks.oldestClosed,
        bandType: "detailed",
        smoothTokenCount: 6,
        detailedTokenCount: 10,
        briefTokenCount: 9,
        detailedCountPolicyStatus: "degraded",
        briefCountPolicyStatus: "degraded",
        lowerBandFreshness: {
          chunkId: context.chunks.oldestClosed,
          bandType: "detailed",
          status: "fresh",
          artifactStatus: "ready",
          currentSmoothSourceRevision: 1,
          currentSmoothSourceTokenCount: 6,
        },
      },
      {
        chunkId: context.chunks.newerClosed,
        bandType: "brief",
        smoothTokenCount: 6,
        detailedTokenCount: 9,
        briefTokenCount: 9,
        detailedCountPolicyStatus: "degraded",
        briefCountPolicyStatus: "degraded",
        lowerBandFreshness: {
          chunkId: context.chunks.newerClosed,
          bandType: "brief",
          status: "fresh",
          artifactStatus: "ready",
          currentSmoothSourceRevision: 1,
          currentSmoothSourceTokenCount: 6,
        },
      },
    ]);
    assert.equal(report.smoothingQuality.modelSmoothedCount, 0);
    assert.equal(report.smoothingQuality.deterministicPreservedCount, 4);
    assert.equal(report.smoothingQuality.degradedCount, 0);
    assert.equal(report.smoothingQuality.failedCount, 0);
    assert.equal(report.smoothingQuality.lowerBandFreshness.length, 2);
    assert.equal(report.smoothingQuality.lowerBandFreshness[0]?.status, "fresh");
  });
});

test("buildCompactionAuditReport marks missing semantic lower-band artifact blocked_or_stale", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedReportView(temp.storeRootDir);
    const chunksResult = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunksResult.ok, true);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = chunksResult.value.map((chunk) => {
      if (chunk.chunkId !== context.chunks.oldestClosed) {
        return chunk;
      }

      return {
        chunkId: chunk.chunkId,
        threadId: chunk.threadId,
        lifecycleStatus: chunk.lifecycleStatus,
        sourceTurnIds: [...chunk.sourceTurnIds],
        smoothText: chunk.smoothText,
        smoothTokenCountMetadata: chunk.smoothTokenCountMetadata,
        openedAt: chunk.openedAt,
        closedAt: chunk.closedAt,
        closeReason: chunk.closeReason,
        sourceRevision: chunk.sourceRevision,
        schemaVersion: chunk.schemaVersion,
        conversationTranscript: chunk.conversationTranscript,
        lowerBand: {
          ...chunk.lowerBand,
          detailed: {
            band: "detailed" as const,
            status: "failed" as const,
            errorCode: "test_missing_semantic_artifact",
            errorMessage: "simulated missing semantic lower-band output",
            updatedAt: "2026-05-11T00:00:00.000Z",
          },
        },
        placeholders: {
          chunkId: chunk.chunkId,
          threadId: chunk.threadId,
          detailed: {
            kind: "detailed",
            status: "ready",
            text: "legacy detailed placeholder [deterministic-placeholder:detailed]",
            strategy: "deterministic_truncate_30",
            generatedAt: "2026-05-11T00:00:00.000Z",
          },
        },
      } as unknown as typeof chunk;
    });
    const written = await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks,
    });
    assert.equal(written.ok, true);

    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: context.threadViewId },
      { threadStore: context.threadStore },
    );

    const freshness = report.smoothingQuality.lowerBandFreshness.find(
      (entry) => entry.chunkId === context.chunks.oldestClosed && entry.bandType === "detailed",
    );
    const selectedChunk = report.selectedChunks.find(
      (entry) => entry.chunkId === context.chunks.oldestClosed && entry.bandType === "detailed",
    );

    assert.equal(freshness?.status, "blocked_or_stale");
    assert.equal(selectedChunk?.detailedTokenCount, undefined);
    assert.equal(report.bands.detailed.actualTokenCount, 0);
  });
});

test("buildCompactionAuditReport handles missing and empty thread views", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    await assert.rejects(
      buildCompactionAuditReport(
        { threadId: context.threadId, threadViewId: "missing-view" },
        { threadStore: context.threadStore },
      ),
      /THREAD_VIEW_NOT_FOUND/,
    );

    const emptyView = makeThreadView({
      threadId: context.threadId,
      threadViewId: "empty-view",
    });
    const created = await context.threadStore.writeProjectionRevision({
      revisionId: "projection-empty",
      threadId: context.threadId,
      threadViewId: "empty-view",
      targetRuntime: "pi",
      generatedFilePath: "/tmp/empty-generated.jsonl",
      createdAt: "2026-05-11T00:00:00.000Z",
      sourceStateReference: emptyView.sourceStateReference,
      status: "available",
      compactSnapshot: {
        schemaVersion: "projection.compact-snapshot.v1",
        sourceStateReference: emptyView.sourceStateReference,
        resultingTokenCount: 0,
        bands: {
          full_fidelity: emptyView.fullFidelityBand,
          smooth: emptyView.smoothBand,
          detailed: emptyView.detailedBand,
          brief: emptyView.briefBand,
        },
        generatedEntries: [],
      },
    });
    assert.equal(created.ok, true);
    const report = await buildCompactionAuditReport(
      { threadId: context.threadId, threadViewId: "empty-view" },
      { threadStore: context.threadStore },
    );

    assert.equal(report.resultingTokenCount, 0);
    assert.equal(report.bands.full_fidelity.selectedCount, 0);
    assert.deepEqual(report.selectedTurns, []);
    assert.deepEqual(report.selectedChunks, []);
  });
});
