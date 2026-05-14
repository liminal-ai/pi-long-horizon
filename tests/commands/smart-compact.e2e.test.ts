import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { WorkbenchQueryService } from "../../src/workbench/services/workbench-query-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { OpenAIInputTokenCounter } from "../../src/token-accounting/index.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedPlaceholderThread,
} from "../thread-view/helpers.js";

const STAGE8_WRITE_READY_LOWER_BOUND = 2_000;
const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 1;
  },
}, "gpt-test");

function createPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(
        input.threadId,
        `${stamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

async function normalizeClosedChunkTokenCounts(
  context: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>,
) {
  const chunks = await context.threadStore.readChunks(context.threadId);
  assert.equal(chunks.ok, true);

  const thread = await context.threadStore.openThread(context.threadId);
  assert.equal(thread.ok, true);

  await context.threadStore.writeChunks({
    threadId: context.threadId,
    expectedSourceRevision: thread.value.thread.sourceRevision,
    expectedMessageHighWatermark: thread.value.thread.messageHighWatermark,
    expectedTurnsRevision: thread.value.thread.turnsRevision,
    chunks: chunks.value.map((chunk) =>
      chunk.lifecycleStatus === "closed" && chunk.smoothText
        ? {
            ...chunk,
            smoothTokenCount: estimateDeterministicTokenCount(chunk.smoothText),
          }
        : chunk),
  });
}

async function removeSmoothFromTurn(
  context: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>,
  turnId: string,
) {
  const thread = await context.threadStore.openThread(context.threadId);
  assert.equal(thread.ok, true);

  await context.threadStore.writeTurns({
    threadId: context.threadId,
    expectedSourceRevision: thread.value.thread.sourceRevision,
    expectedMessageHighWatermark: thread.value.thread.messageHighWatermark,
    expectedTurnsRevision: thread.value.thread.turnsRevision,
    turns: thread.value.turns.map((turn) => (turn.turnId === turnId ? { ...turn, smooth: undefined } : turn)),
    turnState: thread.value.thread.status.turnState,
  });
}

async function runE2ESmartCompact(
  context: Parameters<typeof createPathResolver>[0],
  seeded: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>,
  overrides: Partial<Parameters<typeof runSmartCompact>[0]> = {},
  adapter = createPiCliHarnessAdapter({
    switchSession: async () => ({ cancelled: false }),
  }),
) {
  return runSmartCompact(
    {
      threadId: seeded.threadId,
      requestedLowerBound: STAGE8_WRITE_READY_LOWER_BOUND,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
      ...overrides,
    },
    {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
      piCliHarnessAdapter: adapter,
      openAIInputTokenCounter: fakeOpenAICounter,
      asyncThreadDependencies: {
        tokenCountModel: "gpt-test",
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  );
}

function assertExactGeneratedSessionWritten(result: Awaited<ReturnType<typeof runE2ESmartCompact>>) {
  assert.equal(result.compactStatus, "success");
  assert.ok(result.threadViewId);
  assert.ok(result.generatedFilePath);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.generatedSessionCountPolicy?.status, "usable");
  assert.equal(result.generatedSessionTokenCountMetadata?.source, "provider_input_count");
  assert.equal(result.generatedSessionTokenCountMetadata?.trustClass, "exact");
  assert.equal(
    result.blockers.some((issue) => issue.code === "GENERATED_SESSION_OVER_LOWER_BOUND"),
    false,
  );
}

test("smart compact E2E rejects invalid compaction inputs before state mutation", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const beforeThread = await seeded.threadStore.openThread(seeded.threadId);
    const beforeViews = await seeded.threadViewStore.listThreadViews(seeded.threadId);
    assert.equal(beforeThread.ok, true);
    assert.equal(beforeViews.ok, true);

    const result = await runE2ESmartCompact(context, seeded, {
      requestedLowerBound: 0,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 5 },
    });

    const afterThread = await seeded.threadStore.openThread(seeded.threadId);
    const afterViews = await seeded.threadViewStore.listThreadViews(seeded.threadId);
    assert.equal(afterThread.ok, true);
    assert.equal(afterViews.ok, true);

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.blockers.some((issue) => issue.code === "INVALID_COMMAND_ARGS"), true);
    assert.deepEqual(afterThread.value.thread.threadViewOutputSummary, beforeThread.value.thread.threadViewOutputSummary);
    assert.deepEqual(afterViews.value, beforeViews.value);
  });
});

test("smart compact E2E keeps open chunk out of lower bands during rebuild", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runE2ESmartCompact(context, seeded);
    assertExactGeneratedSessionWritten(result);

    const opened = await seeded.threadViewStore.openThreadView(seeded.threadId, result.threadViewId!);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.view.detailedBand.selectedIds.includes(seeded.chunks.openRecent), false);
    assert.equal(opened.value.view.briefBand.selectedIds.includes(seeded.chunks.openRecent), false);
  });
});

test("smart compact E2E writes a short generated session id", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runE2ESmartCompact(context, seeded);
    assertExactGeneratedSessionWritten(result);

    const firstLine = (await readFile(result.generatedFilePath!, "utf8")).split("\n")[0];
    assert.ok(firstLine);
    const sessionHeader = JSON.parse(firstLine) as { id: string };

    assert.equal(sessionHeader.id.startsWith("sc-"), true);
    assert.equal(sessionHeader.id.length <= 64, true);
  });
});

test("smart compact E2E writes degraded output when an unselected smooth artifact is missing", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    await removeSmoothFromTurn(seeded, seeded.turns.middleNewer.turnId);

    const result = await runE2ESmartCompact(context, seeded);

    assertExactGeneratedSessionWritten(result);
    assert.equal(result.blockers.some((issue) => issue.code === "SMOOTH_MISSING"), false);
  });
});

test("smart compact E2E writes degraded output when missing placeholder is not selected", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);

    const result = await runE2ESmartCompact(context, seeded);

    assertExactGeneratedSessionWritten(result);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), false);
  });
});

test("smart compact E2E reports explicit degraded threshold result for full-fidelity-only overage", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runE2ESmartCompact(context, seeded, {
      requestedLowerBound: 2,
      requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
    });

    assert.equal(result.compactStatus, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
    assert.equal(result.generatedFilePath, undefined);
    assert.equal(result.generatedSessionTokenCount, undefined);
    assert.equal((result.resultingTokenCount ?? 0) > 2, true);
  });
});

test("smart compact E2E reports PI load failure after successful target write", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runE2ESmartCompact(
      context,
      seeded,
      {},
      {
        loadThreadViewFile: async () => ({
          ok: false,
          issues: [
            {
              code: "PI_RELOAD_FAILED",
              message: "PI load failed after generated target write.",
              threadId: seeded.threadId,
            },
          ],
        }),
      },
    );

    assert.equal(result.compactStatus, "reload_failed");
    assert.ok(result.generatedFilePath);
    await access(result.generatedFilePath!);
    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.status, "reload_failed");
  });
});

test("smart compact E2E leaves degraded state inspectable after command return", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runE2ESmartCompact(context, seeded, {
      requestedLowerBound: 2,
      requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
    });
    const queryService = new WorkbenchQueryService(seeded.threadStore, seeded.threadViewStore);
    const opened = await queryService.openThread({ threadId: seeded.threadId });

    assert.equal(result.compactStatus, "degraded");
    assert.equal(opened.ok, true);
    assert.equal(opened.value.usableStatus, "degraded");
    assert.equal(opened.value.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
  });
});

test("smart compact E2E survives restart with persisted smooth chunk and placeholder state", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const restarted = {
      ...seeded,
      threadStore: new FileThreadStore(context.storeRootDir),
      threadViewStore: new FileThreadViewStore(context.storeRootDir, new FileThreadStore(context.storeRootDir)),
    };
    const chunks = await restarted.threadStore.readChunks(restarted.threadId);
    const thread = await restarted.threadStore.openThread(restarted.threadId);
    assert.equal(chunks.ok, true);
    assert.equal(thread.ok, true);

    assert.equal(
      thread.value.turns.every(
        (turn) => turn.lifecycleStatus !== "closed" || typeof turn.smooth?.text === "string",
      ),
      true,
    );
    assert.equal(chunks.value.some((chunk) => chunk.placeholders?.detailed?.status === "ready"), true);

    const result = await runE2ESmartCompact(context, restarted);
    assertExactGeneratedSessionWritten(result);
    await access(result.generatedFilePath!);
  });
});

test("smart compact E2E prepare flow repairs deterministic state and archives on replacement", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);
    await normalizeClosedChunkTokenCounts(seeded);
    const switchedTo: string[] = [];
    const input = {
      threadId: seeded.threadId,
      requestedLowerBound: STAGE8_WRITE_READY_LOWER_BOUND,
      requestedBandPercentages: { fullFidelity: 10, smooth: 5, detailed: 70, brief: 15 },
      mode: "prepare",
    } as const;

    const firstResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
      asyncThreadDependencies: {
        tokenCountModel: "gpt-test",
      },
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    assertExactGeneratedSessionWritten(firstResult);
    const repairedChunks = await seeded.threadStore.readChunks(seeded.threadId);
    assert.equal(repairedChunks.ok, true);
    assert.equal(repairedChunks.value.some((chunk) => chunk.placeholders?.detailed?.status === "ready"), true);

    const secondResult = await runSmartCompact(input, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
      asyncThreadDependencies: {
        tokenCountModel: "gpt-test",
      },
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(context),
        now: () => new Date("2026-01-01T00:05:00.000Z"),
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: () => new Date("2026-01-01T00:05:00.000Z"),
    });

    assertExactGeneratedSessionWritten(secondResult);
    assert.equal(secondResult.archivePath, undefined);
    assert.notEqual(secondResult.generatedFilePath, firstResult.generatedFilePath);
    assert.deepEqual(switchedTo, [firstResult.generatedFilePath!, secondResult.generatedFilePath!]);
  });
});
