import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import { isOpenAIInputTokenCountProvider, runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { OpenAIInputTokenCounter, type TokenCountRecord } from "../../src/token-accounting/index.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedDeterministicRebuildThreadWithOptions,
  seedMissingDetailedLowerBandArtifactThread,
} from "../thread-view/helpers.js";

const STAGE7_READY_LOWER_BOUND = 2_000;
const STAGE7_READY_BAND_PERCENTAGES = { fullFidelity: 50, smooth: 4, detailed: 13, brief: 33 } as const;
const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 1;
  },
}, "gpt-test");
const fakeOverTargetOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens(request) {
    return request.input.length === 1 ? 1 : 1_500;
  },
}, "gpt-test");
const failingFinalOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens(request) {
    if (request.input.length === 1) {
      return 1;
    }

    throw new Error("final count failed");
  },
}, "gpt-test");

test("openai-codex provider is eligible for OpenAI input token counting", () => {
  assert.equal(isOpenAIInputTokenCountProvider("openai"), true);
  assert.equal(isOpenAIInputTokenCountProvider("openai-codex"), true);
  assert.equal(isOpenAIInputTokenCountProvider("anthropic"), false);
  assert.equal(isOpenAIInputTokenCountProvider(undefined), false);
});

function createRetryingGeneratedSessionCounter(counts: number[]): OpenAIInputTokenCounter {
  const generatedCounts = [...counts];
  return new OpenAIInputTokenCounter({
    async countInputTokens(request) {
      if (request.input.length === 1) {
        return 1;
      }

      return generatedCounts.shift() ?? counts.at(-1) ?? 1;
    },
  }, "gpt-test");
}

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

function countGeneratedSourceEntries(fileContent: string, generatedSource: string): number {
  const threadViewOutputMetadata = fileContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { customType?: string; data?: { entries?: Array<{ generatedSource?: string }> } })
    .find((entry) => entry.customType === "pi-long-horizon.thread-view.output");

  return (
    threadViewOutputMetadata?.data?.entries?.filter((entry) => entry.generatedSource === generatedSource).length ?? 0
  );
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

async function removeDetailedSemanticArtifact(
  context: Awaited<ReturnType<typeof seedDeterministicRebuildThreadWithOptions>>,
  chunkId: string,
) {
  const snapshot = await context.threadStore.openThread(context.threadId);
  assert.equal(snapshot.ok, true);
  const chunks = await context.threadStore.readChunks(context.threadId);
  assert.equal(chunks.ok, true);

  await context.threadStore.writeChunks({
    threadId: context.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    chunks: chunks.value.map((chunk): typeof chunk =>
      chunk.chunkId === chunkId
        ? {
            ...chunk,
            lowerBand: {
              ...chunk.lowerBand,
              detailed: undefined,
            },
          } as typeof chunk
        : chunk),
  });
}

function heuristicOnly(record: TokenCountRecord | undefined): TokenCountRecord | undefined {
  if (!record) {
    return undefined;
  }

  return {
    ...record,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    provider: undefined,
    model: undefined,
  };
}

async function forceHeuristicOnlyCounts(context: Awaited<ReturnType<typeof seedDeterministicRebuildThread>>) {
  const snapshot = await context.threadStore.openThread(context.threadId);
  assert.equal(snapshot.ok, true);
  await context.threadStore.writeTurns({
    threadId: context.threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    turns: snapshot.value.turns.map((turn) => ({
      ...turn,
      rawTokenCountMetadata: heuristicOnly(turn.rawTokenCountMetadata),
      smooth: turn.smooth
        ? {
            ...turn.smooth,
            tokenCountMetadata: heuristicOnly(turn.smooth.tokenCountMetadata),
          }
        : undefined,
    })),
    turnState: snapshot.value.thread.status.turnState,
  });

  const updated = await context.threadStore.openThread(context.threadId);
  assert.equal(updated.ok, true);
  const chunks = await context.threadStore.readChunks(context.threadId);
  assert.equal(chunks.ok, true);
  await context.threadStore.writeChunks({
    threadId: context.threadId,
    expectedSourceRevision: updated.value.thread.sourceRevision,
    expectedMessageHighWatermark: updated.value.thread.messageHighWatermark,
    expectedTurnsRevision: updated.value.thread.turnsRevision,
    chunks: chunks.value.map((chunk) => {
      const smoothTokenCountMetadata = heuristicOnly(chunk.smoothTokenCountMetadata);
      if (!chunk.placeholders) {
        return { ...chunk, smoothTokenCountMetadata };
      }

      return {
        chunkId: chunk.chunkId,
        threadId: chunk.threadId,
        lifecycleStatus: chunk.lifecycleStatus,
        sourceTurnIds: [...chunk.sourceTurnIds],
        smoothText: chunk.smoothText,
        smoothTokenCountMetadata,
        openedAt: chunk.openedAt,
        closedAt: chunk.closedAt,
        closeReason: chunk.closeReason,
        sourceRevision: chunk.sourceRevision,
        placeholders: {
          ...chunk.placeholders,
          detailed: chunk.placeholders.detailed
            ? {
                ...chunk.placeholders.detailed,
                tokenCountMetadata: heuristicOnly(chunk.placeholders.detailed.tokenCountMetadata),
              }
            : undefined,
          brief: chunk.placeholders.brief
            ? {
                ...chunk.placeholders.brief,
                tokenCountMetadata: heuristicOnly(chunk.placeholders.brief.tokenCountMetadata),
              }
            : undefined,
        },
      };
    }),
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
        requestedLowerBound: 1_600,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
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

    assert.match(result.compactStatus, /^(success|degraded)$/);
    assert.ok(result.threadViewId);
    assert.ok(result.generatedFilePath);
    assert.deepEqual(switchedTo, [result.generatedFilePath!]);

    const fileContent = await readFile(result.generatedFilePath!, "utf8");
    assert.match(fileContent, /pi-long-horizon\.thread-view\.output/);

    const after = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(after.ok, true);
    assert.deepEqual(after.value.messages, before.value.messages);
    assert.deepEqual(after.value.turns, before.value.turns);
    assert.equal(after.value.thread.target.currentGeneratedFilePath, result.generatedFilePath);
    assert.equal(after.value.projections.at(-1)?.status, "available");
  });
});

test("successful smart compact persists generated rollout session and model metadata", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 2_000,
        requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
        mode: "prepare",
        modelProvider: "openai-codex",
        modelId: "gpt-5.5",
        thinkingLevel: "low",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async () => ({ cancelled: false }),
        }),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    assert.match(result.compactStatus, /^(success|degraded)$/);
    assert.ok(result.generatedFilePath);

    const snapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(snapshot.ok, true);
    const latestProjection = snapshot.value.projections.at(-1);
    const generatedOutput = snapshot.value.thread.threadViewOutputSummary.generatedOutput;

    assert.equal(latestProjection?.generatedFilePath, result.generatedFilePath);
    assert.equal(latestProjection?.generatedSessionId, generatedOutput?.generatedSessionId);
    assert.equal(latestProjection?.threadViewId, result.threadViewId);
    assert.equal(latestProjection?.modelProvider, "openai-codex");
    assert.equal(latestProjection?.modelId, "gpt-5.5");
    assert.equal(latestProjection?.thinkingLevel, "low");
    assert.equal(generatedOutput?.generatedFilePath, result.generatedFilePath);
    assert.equal(generatedOutput?.threadViewId, result.threadViewId);
    assert.equal(generatedOutput?.modelProvider, "openai-codex");
    assert.equal(generatedOutput?.modelId, "gpt-5.5");
    assert.equal(generatedOutput?.thinkingLevel, "low");
  });
});

test("generated session over requested lower bound stops before write or reload", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 1_000,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOverTargetOpenAICounter,
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

    assert.equal(result.compactStatus, "degraded");
    assert.equal(result.generatedFilePath, undefined);
    assert.equal((result.generatedSessionTokenCount ?? 0) > 1_000, true);
    assert.equal(result.generatedSessionTokenCountMetadata?.scope, "generated_session");
    assert.equal(result.generatedSessionCountPolicy?.status, "usable");
    assert.equal(result.generatedSessionTokenCountMetadata?.source, "provider_input_count");
    assert.equal(result.generatedSessionTokenCountMetadata?.trustClass, "exact");
    assert.equal(result.blockers.some((issue) => issue.code === "GENERATED_SESSION_OVER_LOWER_BOUND"), true);
    assert.deepEqual(switchedTo, []);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, undefined);
    assert.equal(
      thread.value.thread.threadViewOutputSummary.generatedOutput?.generatedSessionTokenCount,
      result.generatedSessionTokenCount,
    );
    assert.equal(
      thread.value.thread.threadViewOutputSummary.generatedOutput?.issues?.some(
        (issue) => issue.code === "GENERATED_SESSION_OVER_LOWER_BOUND",
      ),
      true,
    );
  });
});

test("generated session over target retries by reducing lower-fidelity content and then writes", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];
    const retryingCounter = createRetryingGeneratedSessionCounter([1_100, 900]);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 1_000,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: retryingCounter,
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

    assert.match(result.compactStatus, /^(success|degraded)$/);
    assert.equal(result.generatedSessionTokenCount, 900);
    assert.equal(result.generatedSessionTokenCountMetadata?.source, "provider_input_count");
    assert.equal(result.generatedSessionTokenCountMetadata?.trustClass, "exact");
    assert.deepEqual(switchedTo, [result.generatedFilePath!]);
    const fileContent = await readFile(result.generatedFilePath!, "utf8");
    assert.equal(countGeneratedSourceEntries(fileContent, "brief_chunk_summary"), 0);
  });
});

test("command default reload path uses the configured PI session switch dependency", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
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

test("zero-percent smooth allocation materializes no smooth_turn entries", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async () => ({ cancelled: false }),
        }),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    assert.equal(result.compactStatus, "degraded");
    assert.ok(result.threadViewId);
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);

    const views = await seeded.threadViewStore.listThreadViews(seeded.threadId);
    assert.equal(views.ok, true);
    assert.equal(views.value.length, 0);
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
      requestedLowerBound: STAGE7_READY_LOWER_BOUND,
      requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
      mode: "strict",
    } as const;

    const firstResult = await runSmartCompact(commandInput, {
      threadStore: seeded.threadStore,
      openAIInputTokenCounter: fakeOpenAICounter,
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
    assert.ok(firstResult.projectionRevisionId);
    const expectedFileName = `${firstResult.projectionRevisionId}-${firstResult.threadViewId}.jsonl`;
    const expectedGeneratedPath = context.resolveGeneratedPath(seeded.threadId, expectedFileName);
    assert.equal(firstResult.generatedFilePath, expectedGeneratedPath);
    assert.equal(firstResult.archivePath, undefined);
    assert.equal(firstResult.generatedFilePath.startsWith(context.storeRootDir), true);
    const firstContent = await readFile(firstResult.generatedFilePath!, "utf8");

    const secondResult = await runSmartCompact(commandInput, {
      threadStore: seeded.threadStore,
      openAIInputTokenCounter: fakeOpenAICounter,
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
    assert.ok(secondResult.projectionRevisionId);
    assert.notEqual(secondResult.threadViewId, firstResult.threadViewId);
    assert.notEqual(secondResult.projectionRevisionId, firstResult.projectionRevisionId);
    assert.notEqual(secondResult.generatedFilePath, expectedGeneratedPath);
    assert.equal(secondResult.archivePath, undefined);
    assert.notEqual(await readFile(secondResult.generatedFilePath!, "utf8"), firstContent);
    assert.deepEqual(switchedTo, [expectedGeneratedPath, secondResult.generatedFilePath!]);
    const mappedThreadId = await seeded.threadStore.resolveThreadIdMap({
      runtime: "pi",
      sessionFilePath: expectedGeneratedPath,
    });
    if (!mappedThreadId.ok) {
      assert.fail(mappedThreadId.issues.map((issue) => issue.message).join("; "));
    }
    assert.equal(mappedThreadId.value, seeded.threadId);
    const mappedProjectionId = await seeded.threadStore.resolveProjectionRevisionIdMap({
      runtime: "pi",
      sessionFilePath: secondResult.generatedFilePath!,
    });
    if (!mappedProjectionId.ok) {
      assert.fail(mappedProjectionId.issues.map((issue) => issue.message).join("; "));
    }
    assert.equal(mappedProjectionId.value, secondResult.projectionRevisionId);
  });
});

test("command rejects invalid per-run inputs", async () => {
  const result = await runSmartCompact(
    {
      threadId: "thread-invalid-smart-compact",
      requestedLowerBound: 0,
      requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
      mode: "strict",
    },
    {
      threadStore: {} as never,
    },
  );

  assert.equal(result.compactStatus, "blocked");
  assert.equal(result.blockers[0]?.code, "INVALID_COMMAND_ARGS");
  assert.match(result.blockers[0]?.message ?? "", /requestedLowerBound must be greater than 0/);
});

test("strict mode skips missing smooth output when allocation selects an alternative", async () => {
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
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.deepEqual(
      result.blockers.filter((issue) => issue.code === "SMOOTH_MISSING"),
      [],
    );
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
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
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

test("strict mode skips unselected missing lower-band artifacts without writing lower-band blockers", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
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
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"), false);
    assert.equal(switchedTo.length, 1);

    const projections = await seeded.threadStore.readProjectionRevisions(seeded.threadId);
    assert.equal(projections.ok, true);
    assert.equal(projections.value.length, 1);
    assert.equal(projections.value[0]?.compactSnapshot !== undefined, true);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, result.generatedFilePath);
  });
});

test("strict mode ignores missing detailed lower-band artifacts on chunks only selected for brief output", async () => {
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
      chunks: chunks.value.map((chunk) => {
        if (chunk.chunkId !== seeded.chunks.oldestClosed) {
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
        };
      }),
    });

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
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
      result.blockers.filter((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"),
      [],
    );
    assert.equal(switchedTo.length, 1);
  });
});

test("strict mode ignores missing lower-band artifacts when lower bands are not requested", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
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
      result.blockers.filter((issue) => issue.code === "CHUNK_LOWER_BAND_MISSING"),
      [],
    );
    assert.equal(switchedTo.length, 1);
  });
});

test("prepare mode catches up missing selected semantic lower-band output and then continues", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThreadWithOptions(context.storeRootDir, {
      canonicalClosedChunks: true,
    });
    await removeDetailedSemanticArtifact(seeded, seeded.chunks.newerClosed);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
          lowerBandCompressionProvider: {
            async compress(input) {
              return {
                text: "D".repeat(Math.max(1, Math.ceil(input.transcriptText.length * 0.2))),
                providerId: "openai-codex",
                modelId: input.modelId,
                reasoningEffort: input.reasoningEffort,
                promptVersion: input.promptVersion,
                elapsedMs: 25,
                generatedAt: "2026-05-13T12:00:00.000Z",
              };
            },
          },
        },
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

    assert.match(result.compactStatus, /^(success|degraded)$/);
    assert.equal(switchedTo.length, result.generatedFilePath ? 1 : 0);

    const chunks = await seeded.threadStore.readChunks(seeded.threadId);
    assert.equal(chunks.ok, true);
    const repairedChunk = chunks.value.find((chunk) => chunk.chunkId === seeded.chunks.newerClosed);
    assert.equal(repairedChunk?.lowerBand?.detailed?.status, "ready");
    assert.equal(typeof repairedChunk?.lowerBand?.detailed?.text, "string");
  });
});

test("prepare mode never substitutes deterministic placeholder text in written rollout output when lower-band repair is needed", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThreadWithOptions(context.storeRootDir, {
      canonicalClosedChunks: true,
    });
    await removeDetailedSemanticArtifact(seeded, seeded.chunks.newerClosed);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
          lowerBandCompressionProvider: {
            async compress(input) {
              return {
                text: `semantic repaired ${input.chunkId}`,
                providerId: "openai-codex",
                modelId: input.modelId,
                reasoningEffort: input.reasoningEffort,
                promptVersion: input.promptVersion,
                elapsedMs: 25,
                generatedAt: "2026-05-13T12:00:00.000Z",
              };
            },
          },
        },
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piCliHarnessAdapter: createPiCliHarnessAdapter({
          switchSession: async () => ({ cancelled: false }),
        }),
      },
    );

    assert.match(result.compactStatus, /^(success|degraded)$/);
    assert.ok(result.generatedFilePath);

    const fileContent = await readFile(result.generatedFilePath, "utf8");
    assert.equal(fileContent.includes("deterministic-placeholder"), false);
    assert.equal(fileContent.includes("[deterministic-placeholder:detailed]"), false);
    assert.equal(fileContent.includes("[not-semantic-summary]"), false);
  });
});

test("failed selected semantic lower-band catch-up blocks smart compact before write or reload", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThreadWithOptions(context.storeRootDir, {
      canonicalClosedChunks: true,
    });
    await removeDetailedSemanticArtifact(seeded, seeded.chunks.newerClosed);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
          lowerBandCompressionProvider: {
            async compress() {
              throw new Error("simulated selected lower-band failure");
            },
          },
        },
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

    assert.equal(result.compactStatus, "blocked");
    assert.deepEqual(switchedTo, []);
    assert.equal(result.generatedFilePath, undefined);
    assert.equal(
      result.blockers.some((issue) =>
        issue.message.includes("Lower-band catch-up failed during compact preparation:") &&
        issue.message.includes(`Chunk ${seeded.chunks.newerClosed} failed detailed lower-band compression`)),
      true,
    );

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, undefined);
    assert.equal(thread.value.thread.threadViewOutputSummary.currentGeneratedFilePath, undefined);
  });
});

test("first smart compact can bootstrap deterministic artifacts", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    await stripDerivedState(seeded);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        asyncThreadDependencies: {
          tokenCountModel: "gpt-test",
        },
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
    assert.equal(
      thread.value.turns.every((turn) => turn.smooth?.status === "ready" || turn.smooth?.status === "degraded"),
      true,
    );
  });
});

test("strict smart compact blocks heuristic-only materialized counts before write or reload", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    await forceHeuristicOnlyCounts(seeded);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
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

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.generatedFilePath, undefined);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.deepEqual(switchedTo, []);
  });
});

test("prepare smart compact blocks missing OpenAI counter without writing or reloading success", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    await forceHeuristicOnlyCounts(seeded);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "prepare",
      },
      {
        threadStore: seeded.threadStore,
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

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.generatedFilePath, undefined);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.deepEqual(switchedTo, []);
  });
});

test("smart compact blocks failed final OpenAI generated-session count without writing or reloading", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: failingFinalOpenAICounter,
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

    assert.equal(result.compactStatus, "blocked");
    assert.equal(result.generatedFilePath, undefined);
    assert.equal(result.generatedSessionTokenCount, undefined);
    assert.equal(result.blockers.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.match(result.blockers.find((issue) => issue.code === "TOKEN_COUNT_BLOCKED")?.cause ?? "", /final count failed/);
    assert.deepEqual(switchedTo, []);
  });
});

test("above-target draft reports degraded threshold result explicitly", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
      },
    );

    assert.equal(result.compactStatus, "degraded");
    assert.equal(result.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED"), true);
    assert.equal((result.resultingTokenCount ?? 0) > 2, true);
    assert.equal(result.generatedFilePath, undefined);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.status, "degraded");
    assert.equal(
      thread.value.thread.threadViewOutputSummary.generatedOutput?.issues?.some(
        (issue) => issue.code === "LOWER_THRESHOLD_UNREACHED",
      ),
      true,
    );
  });
});

test("compaction stops explicitly on threshold failure without writing or reloading", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);
    const switchedTo: string[] = [];

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: 2,
        requestedBandPercentages: { fullFidelity: 100, smooth: 0, detailed: 0, brief: 0 },
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
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

    assert.equal(result.compactStatus, "degraded");
    assert.deepEqual(switchedTo, []);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, undefined);
    assert.deepEqual(thread.value.projections, []);
  });
});

test("reload failure is explicit while preserving the generated output", async () => {
  await withTempFeature3Store(async (context) => {
    const seeded = await seedDeterministicRebuildThread(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: seeded.threadId,
        requestedLowerBound: STAGE7_READY_LOWER_BOUND,
        requestedBandPercentages: STAGE7_READY_BAND_PERCENTAGES,
        mode: "strict",
      },
      {
        threadStore: seeded.threadStore,
        openAIInputTokenCounter: fakeOpenAICounter,
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
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.status, "reload_failed");
  });
});
