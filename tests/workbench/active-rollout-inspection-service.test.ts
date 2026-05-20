import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { DEFAULT_TEST_TIMESTAMP, makePiThreadViewFile, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { serializePiThreadViewFileContent } from "../../src/thread-view/targets/pi/pi-thread-view-writer.js";
import { inspectActiveThreadView } from "../../src/workbench/services/active-rollout-inspection-service.js";
import {
  seedDeterministicRebuildThread,
  seedDeterministicRebuildThreadWithOptions,
} from "../thread-view/helpers.js";

test("inspectActiveThreadView resolves active generated rollout and reports band/live-tail/tool counts", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const threadViewId = "thread-view-active-inspect";
    const generatedFilePath = temp.resolveGeneratedPath(
      context.threadId,
      "projection-active-inspect-thread-view-active-inspect.jsonl",
    );
    const file = makePiThreadViewFile({
      threadId: context.threadId,
      threadViewId,
      cwd: temp.projectDir,
      fileName: "active.jsonl",
      entries: [
        { entryType: "message", role: "user", content: "raw prompt", generatedSource: "raw_turn_message" },
        { entryType: "message", role: "assistant", content: "smooth turn text", generatedSource: "smooth_turn" },
        { entryType: "message", role: "assistant", content: "detailed text", generatedSource: "detailed_chunk_summary" },
        { entryType: "message", role: "assistant", content: "brief text", generatedSource: "brief_chunk_summary" },
      ],
      entryCount: 4,
    });
    const projection = await context.threadStore.writeProjectionRevision({
      revisionId: "projection-active-inspect",
      threadId: context.threadId,
      threadViewId,
      targetRuntime: "pi",
      generatedFilePath,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      status: "available",
    });
    assert.equal(projection.ok, true);
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      serializePiThreadViewFileContent({ threadId: context.threadId, threadViewId, file }, DEFAULT_TEST_TIMESTAMP),
      "utf8",
    );
    await appendFile(
      generatedFilePath,
      `${JSON.stringify({
        type: "message",
        id: "live-tool-001",
        message: {
          role: "toolResult",
          toolCallId: "call-live",
          toolName: "read_file",
          content: [{ type: "text", text: "large live tool result with many useful words" }],
        },
      })}\n${JSON.stringify({
        type: "message",
        id: "live-tool-002",
        message: {
          role: "toolResult",
          toolCallId: "call-truncated",
          toolName: "search",
          content: [{ type: "text", text: "short truncated output..." }],
        },
      })}\n`,
      "utf8",
    );
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const updated = await context.threadStore.updateThreadMetadata({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      patch: {
        threadViewOutputSummary: {
          count: 1,
          currentProjectionRevisionId: "projection-active-inspect",
          currentThreadViewId: threadViewId,
          currentGeneratedFilePath: generatedFilePath,
          lastRevisionStatus: "available",
        },
      },
    });
    assert.equal(updated.ok, true);

    const report = await inspectActiveThreadView(
      { threadId: context.threadId },
      { threadStore: context.threadStore },
    );

    assert.equal(report.threadId, context.threadId);
    assert.equal(report.activeProjectionId, "projection-active-inspect");
    assert.equal(report.generatedFilePath, generatedFilePath);
    assert.equal(report.bands.full_fidelity.messageCount, 1);
    assert.equal(report.bands.smooth.messageCount, 1);
    assert.equal(report.bands.detailed.messageCount, 1);
    assert.equal(report.bands.brief.messageCount, 1);
    assert.equal(report.liveTail.messageCount, 2);
    assert.equal(report.liveTail.roleCounts.toolResult, 2);
    assert.equal(report.toolResults.truncatedCount, 1);
    assert.equal(report.toolResults.nonTruncatedCount, 1);
    assert.equal(report.toolResults.largestNonTruncated[0]?.toolCallId, "call-live");
    assert.ok(report.estimatedVisibleTokens > 0);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  });
});

test("inspectActiveThreadView returns warning JSON for stale metadata and unreadable generated file", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const missingPath = temp.resolveGeneratedPath(context.threadId, "missing.jsonl");
    const projection = await context.threadStore.writeProjectionRevision({
      revisionId: "projection-stale-missing",
      threadId: context.threadId,
      threadViewId: "thread-view-stale-missing",
      targetRuntime: "pi",
      generatedFilePath: missingPath,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      status: "available",
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
          currentProjectionRevisionId: "projection-stale-missing",
          currentThreadViewId: "thread-view-stale-missing",
          currentGeneratedFilePath: missingPath,
          lastRevisionStatus: "failed",
          generatedOutput: {
            threadId: context.threadId,
            threadViewId: "thread-view-stale-missing",
            generatedFilePath: missingPath,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            status: "reload_failed",
            generatedSource: "thread_view",
            placeholderExplicit: true,
          },
        },
      },
    });
    assert.equal(updated.ok, true);

    const report = await inspectActiveThreadView(
      { threadId: context.threadId },
      { threadStore: context.threadStore },
    );

    assert.equal(report.generatedFilePath, missingPath);
    assert.equal(report.estimatedVisibleTokens, 0);
    assert.equal(report.toolResults.totalCount, 0);
    assert.ok(report.warnings.some((warning) => warning.includes("failed")));
    assert.ok(report.warnings.some((warning) => warning.includes("unreadable")));
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  });
});

test("inspectActiveThreadView warns from semantic lower-band state instead of generated-output placeholder flags", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThreadWithOptions(temp.storeRootDir, {
      canonicalClosedChunks: true,
    });
    const threadViewId = "thread-view-semantic-warning";
    const generatedFilePath = temp.resolveGeneratedPath(
      context.threadId,
      "projection-semantic-warning-thread-view-semantic-warning.jsonl",
    );
    const file = makePiThreadViewFile({
      threadId: context.threadId,
      threadViewId,
      cwd: temp.projectDir,
      fileName: "semantic-warning.jsonl",
      entries: [
        { entryType: "message", role: "assistant", content: "semantic detailed output", generatedSource: "detailed_chunk_summary" },
        { entryType: "message", role: "assistant", content: "semantic brief output", generatedSource: "brief_chunk_summary" },
      ],
      entryCount: 2,
    });
    const projection = await context.threadStore.writeProjectionRevision({
      revisionId: "projection-semantic-warning",
      threadId: context.threadId,
      threadViewId,
      targetRuntime: "pi",
      generatedFilePath,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      sourceStateReference: "1:1",
      status: "available",
      compactSnapshot: {
        schemaVersion: "projection.compact-snapshot.v1",
        sourceStateReference: "1:1",
        bands: {
          full_fidelity: { bandType: "full_fidelity", sourceUnitType: "turn", selectedIds: [], renderedStatus: "ready" },
          smooth: { bandType: "smooth", sourceUnitType: "turn", selectedIds: [], renderedStatus: "ready" },
          detailed: {
            bandType: "detailed",
            sourceUnitType: "chunk",
            selectedIds: [context.chunks.oldestClosed],
            renderedStatus: "ready",
          },
          brief: {
            bandType: "brief",
            sourceUnitType: "chunk",
            selectedIds: [context.chunks.newerClosed],
            renderedStatus: "ready",
          },
        },
        generatedEntries: [],
      },
    });
    assert.equal(projection.ok, true);
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      serializePiThreadViewFileContent({ threadId: context.threadId, threadViewId, file }, DEFAULT_TEST_TIMESTAMP),
      "utf8",
    );

    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await context.threadStore.readChunks(context.threadId);
    assert.equal(chunks.ok, true);
    const writeChunks = await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk) =>
        chunk.chunkId === context.chunks.oldestClosed
          ? {
              ...chunk,
              lowerBand: {
                ...chunk.lowerBand,
                detailed: undefined,
              },
            } as typeof chunk
          : chunk),
    });
    assert.equal(writeChunks.ok, true);

    const refreshed = await context.threadStore.openThread(context.threadId);
    assert.equal(refreshed.ok, true);
    const updated = await context.threadStore.updateThreadMetadata({
      threadId: context.threadId,
      expectedSourceRevision: refreshed.value.thread.sourceRevision,
      patch: {
        threadViewOutputSummary: {
          count: 1,
          currentProjectionRevisionId: "projection-semantic-warning",
          currentThreadViewId: threadViewId,
          currentGeneratedFilePath: generatedFilePath,
          lastRevisionStatus: "available",
          generatedOutput: {
            threadId: context.threadId,
            threadViewId,
            generatedFilePath,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            status: "available",
            generatedSource: "thread_view",
            placeholderExplicit: false,
          },
        },
      },
    });
    assert.equal(updated.ok, true);

    const report = await inspectActiveThreadView(
      { threadId: context.threadId },
      { threadStore: context.threadStore },
    );

    assert.ok(
      report.warnings.some((warning) =>
        warning.includes(`Active projection detailed chunk ${context.chunks.oldestClosed} is missing ready semantic lower-band output`)),
    );
  });
});

test("inspectActiveThreadView surfaces recent lower-band catch-up events from operational logs", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThreadWithOptions(temp.storeRootDir, {
      canonicalClosedChunks: true,
    });
    const logPath = `${temp.storeRootDir}/debug/lower-band-compression.log`;
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(
      logPath,
      `${JSON.stringify({
        at: DEFAULT_TEST_TIMESTAMP,
        level: "debug",
        message: "Lower-band compression completed.",
        threadId: context.threadId,
        chunkId: context.chunks.oldestClosed,
        band: "detailed",
        mode: "prepare_catch_up",
      })}\n`,
      "utf8",
    );

    const report = await inspectActiveThreadView(
      { threadId: context.threadId },
      { threadStore: context.threadStore },
    );

    assert.deepEqual(report.catchUpEvents, [
      {
        at: DEFAULT_TEST_TIMESTAMP,
        chunkId: context.chunks.oldestClosed,
        band: "detailed",
        event: "completed",
        message: "Lower-band compression completed.",
      },
    ]);
    assert.ok(
      report.warnings.some((warning) =>
        warning.includes(`Recent lower-band catch-up completed for chunk ${context.chunks.oldestClosed} (detailed)`)),
    );
  });
});
