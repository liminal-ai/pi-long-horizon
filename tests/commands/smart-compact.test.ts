import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread, seedMissingDetailedPlaceholderThread } from "../thread-view/helpers.js";

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

async function stripDerivedState(context: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>) {
  const snapshot = await context.threadStore.openThread(context.threadId);
  assert.equal(snapshot.ok, true);

  await context.threadStore.writeTurns({
    threadId: context.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    turns: snapshot.value.turns.map((turn) => ({
      ...turn,
      smooth: undefined,
    })),
    turnState: snapshot.value.thread.status.turnState,
  });

  const updated = await context.threadStore.openThread(context.threadId);
  assert.equal(updated.ok, true);
  await context.threadStore.writeChunks({
    threadId: context.threadId,
    expectedSourceRevision: updated.value.thread.sourceRevision,
    expectedMessageHighWatermark: updated.value.thread.messageHighWatermark,
    expectedTurnsRevision: updated.value.thread.turnsRevision,
    chunks: [],
  });
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

test("command accepts explicit per-run inputs, writes a generated PI file, and reloads PI", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const before = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(before.ok, true);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
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
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.ok(result.threadViewId);
    assert.ok(result.generatedFilePath);
    assert.deepEqual(switchedTo, [result.generatedFilePath!]);

    const fileContent = await readFile(result.generatedFilePath!, "utf8");
    assert.match(fileContent, /pi-long-horizon\.thread-view\.projection/);
    assert.match(fileContent, /\[deterministic-placeholder:detailed\]/);

    const after = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(after.ok, true);
    assert.deepEqual(after.value.messages, before.value.messages);
    assert.deepEqual(after.value.turns, before.value.turns);
    assert.equal(after.value.thread.target.currentGeneratedFilePath, result.generatedFilePath);
    assert.equal(after.value.projections.at(-1)?.status, "available");
  });
});

test("command default reload path uses the configured PI session switch dependency", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
        piSessionSwitch: {
          switchSession: async (sessionPath) => {
            switchedTo.push(sessionPath);
            return { cancelled: false };
          },
        },
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.deepEqual(switchedTo, [result.generatedFilePath!]);
  });
});

test("default command path roots generated and archived output under the active store tree", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const seededSnapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(seededSnapshot.ok, true);
    const targetUpdate = await seeded.threadStore.updateThreadMetadata({
      threadId: seeded.threadId,
      expectedSourceRevision: seededSnapshot.value.thread.sourceRevision,
      patch: {
        target: {
          ...seededSnapshot.value.thread.target,
          cwd: context.projectDir,
        },
      },
    });
    assert.equal(targetUpdate.ok, true);

    const switchedTo: string[] = [];
    const firstNow = () => new Date("2026-01-01T00:00:00.000Z");
    const secondNow = () => new Date("2026-01-01T00:05:00.000Z");
    const commandInput = {
      threadId: seeded.threadId,
      requestedLowerBound: 30,
      requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
      mode: "strict",
    } as const;

    const firstResult = await runSmartCompact(commandInput, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      piThreadViewWriterOptions: {
        now: firstNow,
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: firstNow,
    });

    assert.equal(firstResult.compactStatus, "success");
    assert.ok(firstResult.threadViewId);
    const expectedFileName = `${seeded.threadId}-${firstResult.threadViewId}.jsonl`;
    const expectedGeneratedPath = context.resolveGeneratedPath(seeded.threadId, expectedFileName);
    assert.equal(firstResult.generatedFilePath, expectedGeneratedPath);
    assert.equal(firstResult.archivePath, undefined);
    assert.equal(firstResult.generatedFilePath.startsWith(context.storeRootDir), true);
    const firstContent = await readFile(firstResult.generatedFilePath!, "utf8");

    const secondResult = await runSmartCompact(commandInput, {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      piThreadViewWriterOptions: {
        now: secondNow,
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async (sessionPath) => {
          switchedTo.push(sessionPath);
          return { cancelled: false };
        },
      }),
      now: secondNow,
    });

    assert.equal(secondResult.compactStatus, "success");
    assert.equal(secondResult.threadViewId, firstResult.threadViewId);
    assert.equal(secondResult.generatedFilePath, expectedGeneratedPath);
    const archiveStamp = secondNow().toISOString().replace(/[:.]/g, "-");
    const expectedArchivePath = context.resolveGeneratedArchivePath(
      seeded.threadId,
      `${archiveStamp}-${basename(expectedGeneratedPath)}`,
    );
    assert.equal(secondResult.archivePath, expectedArchivePath);
    assert.equal(await readFile(secondResult.archivePath!, "utf8"), firstContent);
    assert.deepEqual(switchedTo, [expectedGeneratedPath, expectedGeneratedPath]);
  });
});

test("command rejects invalid per-run inputs", async () => {
  await assert.rejects(
    runSmartCompact(
      {
        threadId: "thread-invalid-smart-compact",
        requestedLowerBound: 0,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: {} as never,
        threadViewStore: {} as never,
      },
    ),
    /requestedLowerBound must be greater than 0/,
  );
});

test("strict mode reports missing smooth output explicitly", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const snapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(snapshot.ok, true);

    await seeded.threadStore.writeTurns({
      threadId: seeded.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === seeded.turns.middleNewer.turnId
          ? {
              ...turn,
              smooth: undefined,
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
      },
    );

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.blockers.some((issue) => issue.code === "SMOOTH_MISSING"), true);
  });
});

test("strict mode ignores missing smooth output on older turns the selected projection does not use", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];
    const snapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(snapshot.ok, true);

    await seeded.threadStore.writeTurns({
      threadId: seeded.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === seeded.turns.oldest.turnId
          ? {
              ...turn,
              smooth: undefined,
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async (sessionPath) => {
            switchedTo.push(sessionPath);
            return { cancelled: false };
          },
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.deepEqual(
      result.blockers.filter((issue) => issue.code === "SMOOTH_MISSING"),
      [],
    );
    assert.equal(switchedTo.length, 1);
  });
});

test("strict mode reports blockers without mutating draft or output state", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
      },
    );

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), true);

    const views = await seeded.threadViewStore.listThreadViews(seeded.threadId);
    assert.equal(views.ok, true);
    assert.deepEqual(views.value, []);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, undefined);
  });
});

test("strict mode ignores missing detailed placeholders on chunks only selected for brief output", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];
    const snapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(snapshot.ok, true);
    const chunks = await seeded.threadStore.readChunks(seeded.threadId);
    assert.equal(chunks.ok, true);

    await seeded.threadStore.writeChunks({
      threadId: seeded.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: chunks.value.map((chunk) =>
        chunk.chunkId === seeded.chunks.oldestClosed
          ? {
              ...chunk,
              placeholders: {
                chunkId: chunk.chunkId,
                threadId: chunk.threadId,
                detailed: {
                  kind: "detailed",
                  status: "missing",
                  strategy: "deterministic_truncate_30",
                },
                brief: chunk.placeholders?.brief,
              },
            }
          : chunk),
    });

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async (sessionPath) => {
            switchedTo.push(sessionPath);
            return { cancelled: false };
          },
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.deepEqual(
      result.blockers.filter((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"),
      [],
    );
    assert.equal(switchedTo.length, 1);
  });
});

test("strict mode ignores missing placeholders when lower bands are not requested", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 120,
        requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async (sessionPath) => {
            switchedTo.push(sessionPath);
            return { cancelled: false };
          },
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.deepEqual(
      result.blockers.filter((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"),
      [],
    );
    assert.equal(switchedTo.length, 1);
  });
});

test("prepare mode repairs missing deterministic artifacts then continues", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedPlaceholderThread(context.storeRootDir);
    await normalizeClosedChunkTokenCounts(seeded);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 100,
        requestedBandPercentages: { fullFidelity: 10, smooth: 5, detailed: 70, brief: 15 },
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async (sessionPath) => {
            switchedTo.push(sessionPath);
            return { cancelled: false };
          },
        }),
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.equal(switchedTo.length, 1);

    const chunks = await seeded.threadStore.readChunks(seeded.threadId);
    assert.equal(chunks.ok, true);
    const repairedChunk = chunks.value.find((chunk) => chunk.chunkId === seeded.chunks.newerClosed);
    assert.equal(repairedChunk?.placeholders?.detailed?.status, "ready");
    assert.equal(typeof repairedChunk?.placeholders?.detailed?.text, "string");
  });
});

test("first smart compact can bootstrap deterministic artifacts", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    await stripDerivedState(seeded);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 120,
        requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async () => ({ cancelled: false }),
        }),
      },
    );

    assert.equal(result.compactStatus, "success");

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.turns.every((turn) => turn.smooth?.status === "ready"), true);
  });
});

test("reload failure is explicit while preserving the generated output", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        threadViewStore: seeded.threadViewStore,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async () => {
            throw new Error("reload failed");
          },
        }),
      },
    );

    assert.equal(result.compactStatus, "reload_failed");
    assert.ok(result.generatedFilePath);
    assert.equal(result.blockers[0]?.code, "PI_RELOAD_FAILED");

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, result.generatedFilePath);
    assert.equal(thread.value.projections.at(-1)?.status, "failed");
  });
});
