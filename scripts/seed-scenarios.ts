import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSmartCompact } from "../src/commands/smart-compact.js";
import { seedLargeSession, summarizeLargeSession, printLargeSessionSummary } from "./large-session-lib.js";

interface ScenarioManifest {
  name: string;
  description: string;
  threadId: string;
  expectedCompactBehavior: string;
  suggestedCompactInputs: {
    requestedLowerBound: number;
    requestedBandPercentages: {
      fullFidelity: number;
      smooth: number;
      detailed: number;
      brief: number;
    };
    mode: "strict" | "prepare";
  };
}

const rootDir = process.argv[2];
if (!rootDir) {
  console.error("Usage: npx tsx scripts/seed-scenarios.ts <scenarios-root-dir>");
  process.exit(1);
}

const defaultBands = { fullFidelity: 20, smooth: 30, detailed: 30, brief: 20 };

function formatBlockers(blockers: readonly { code: string; message: string }[]): string {
  return blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join("\n");
}

async function writeManifest(
  scenarioDir: string,
  manifest: ScenarioManifest,
): Promise<void> {
  await writeFile(join(scenarioDir, "scenario-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function stripOneSmooth(threadStore: Awaited<ReturnType<typeof seedLargeSession>>["threadStore"], threadId: string) {
  const snapshot = await threadStore.openThread(threadId);
  if (!snapshot.ok) throw new Error(snapshot.issues.map((issue) => issue.message).join("\n"));
  const closedTurns = snapshot.value.turns.filter((turn) => turn.lifecycleStatus === "closed");
  const target = closedTurns.at(-3) ?? closedTurns.at(-1);
  if (!target) return;
  const written = await threadStore.writeTurns({
    threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    turns: snapshot.value.turns.map((turn) => (turn.turnId === target.turnId ? { ...turn, smooth: undefined } : turn)),
    turnState: snapshot.value.thread.status.turnState,
  });
  if (!written.ok) throw new Error(written.issues.map((issue) => issue.message).join("\n"));
}

async function stripOnePlaceholderSet(
  threadStore: Awaited<ReturnType<typeof seedLargeSession>>["threadStore"],
  threadId: string,
) {
  const snapshot = await threadStore.openThread(threadId);
  const chunks = await threadStore.readChunks(threadId);
  if (!snapshot.ok) throw new Error(snapshot.issues.map((issue) => issue.message).join("\n"));
  if (!chunks.ok) throw new Error(chunks.issues.map((issue) => issue.message).join("\n"));
  const target = chunks.value.find((chunk) => chunk.lifecycleStatus === "closed" && chunk.placeholders);
  if (!target) return;
  const written = await threadStore.writeChunks({
    threadId,
    expectedSourceRevision: snapshot.value.thread.sourceRevision,
    expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
    expectedTurnsRevision: snapshot.value.thread.turnsRevision,
    chunks: chunks.value.map((chunk) => (chunk.chunkId === target.chunkId ? { ...chunk, placeholders: undefined } : chunk)),
  });
  if (!written.ok) throw new Error(written.issues.map((issue) => issue.message).join("\n"));
}

async function compactOnce(result: Awaited<ReturnType<typeof seedLargeSession>>, lowerBound: number) {
  const compactResult = await runSmartCompact(
    {
      threadId: result.threadId,
      requestedLowerBound: lowerBound,
      requestedBandPercentages: defaultBands,
      mode: "prepare",
    },
    {
      threadStore: result.threadStore,
      threadViewStore: result.threadViewStore,
      piThreadViewWriterOptions: {
        pathResolver: {
          resolveGeneratedFilePath: (input) => join(result.storeRootDir, "generated", `${input.threadViewId}.jsonl`),
          resolveArchiveFilePath: (input) => join(result.storeRootDir, "archives", `${input.archivedAt}-${input.threadViewId}.jsonl`),
        },
        now: () => new Date("2026-01-15T13:00:00.000Z"),
      },
      piCliHarnessAdapter: {
        loadThreadViewFile: async () => ({ ok: true }),
      },
      now: () => new Date("2026-01-15T13:00:00.000Z"),
    },
  );
  if (compactResult.compactStatus !== "success") {
    const blockerSummary =
      compactResult.blockers.length > 0 ? `\n${formatBlockers(compactResult.blockers)}` : "";
    throw new Error(
      `runSmartCompact failed for ${result.threadId} with status ${compactResult.compactStatus}.${blockerSummary}`,
    );
  }
}

async function createScenario(input: {
  name: string;
  description: string;
  targetTokenCount: number;
  expectedCompactBehavior: string;
  requestedLowerBound: number;
  mode?: "strict" | "prepare";
  afterSeed?: (result: Awaited<ReturnType<typeof seedLargeSession>>) => Promise<void>;
}) {
  const scenarioDir = join(rootDir, input.name);
  await mkdir(scenarioDir, { recursive: true });
  const result = await seedLargeSession({
    targetTokenCount: input.targetTokenCount,
    storeRootDir: scenarioDir,
    sessionId: `scenario-${input.name}`,
  });
  await input.afterSeed?.(result);
  await writeManifest(scenarioDir, {
    name: input.name,
    description: input.description,
    threadId: result.threadId,
    expectedCompactBehavior: input.expectedCompactBehavior,
    suggestedCompactInputs: {
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: defaultBands,
      mode: input.mode ?? "prepare",
    },
  });
  printLargeSessionSummary(await summarizeLargeSession({ storeRootDir: scenarioDir, threadStore: result.threadStore, threadId: result.threadId }));
}

await mkdir(rootDir, { recursive: true });

await createScenario({
  name: "fresh-first-compact",
  description: "Clean thread with no prior compaction and roughly 50k source tokens.",
  targetTokenCount: 50_000,
  expectedCompactBehavior: "prepare mode should generate a first successful compact result.",
  requestedLowerBound: 18_000,
});

await createScenario({
  name: "repeated-compact-archive",
  description: "Thread with one prior successful compact, ready for a second compact/archive cycle.",
  targetTokenCount: 55_000,
  expectedCompactBehavior: "second compact should succeed and preserve prior output metadata for archive handling.",
  requestedLowerBound: 18_000,
  afterSeed: (result) => compactOnce(result, 18_000),
});

await createScenario({
  name: "strict-blocked-missing-smooth",
  description: "One closed turn is missing smooth output after seeding.",
  targetTokenCount: 35_000,
  expectedCompactBehavior: "strict mode should block on missing smooth state.",
  requestedLowerBound: 12_000,
  mode: "strict",
  afterSeed: (result) => stripOneSmooth(result.threadStore, result.threadId),
});

await createScenario({
  name: "prepare-repair-succeed",
  description: "Closed chunk placeholder artifacts are missing and prepare mode can repair them.",
  targetTokenCount: 35_000,
  expectedCompactBehavior: "prepare mode should regenerate missing placeholders and compact successfully.",
  requestedLowerBound: 12_000,
  afterSeed: (result) => stripOnePlaceholderSet(result.threadStore, result.threadId),
});

await createScenario({
  name: "degraded-threshold",
  description: "Recent full-fidelity turns alone exceed a deliberately low lower bound.",
  targetTokenCount: 45_000,
  expectedCompactBehavior: "compact should degrade because full-fidelity selection exceeds the requested bound.",
  requestedLowerBound: 500,
});

await createScenario({
  name: "post-switch-continuity",
  description: "Thread with a successful compact result already applied.",
  targetTokenCount: 45_000,
  expectedCompactBehavior: "subsequent report and compact operations should observe existing generated output metadata.",
  requestedLowerBound: 15_000,
  afterSeed: (result) => compactOnce(result, 15_000),
});

await createScenario({
  name: "reopen-compact-again",
  description: "Persisted thread suitable for reopening from disk after process restart.",
  targetTokenCount: 45_000,
  expectedCompactBehavior: "a fresh process can instantiate stores for this directory and compact again.",
  requestedLowerBound: 15_000,
});

await createScenario({
  name: "large-100k",
  description: "Large synthetic session around 100k tokens with dozens of turns and multiple chunks.",
  targetTokenCount: 100_000,
  expectedCompactBehavior: "prepare compact should succeed with all four bands populated under realistic scale.",
  requestedLowerBound: 30_000,
});
