import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { buildCompactionAuditReport } from "../../src/workbench/services/compaction-report-service.js";
import { OpenAIInputTokenCounter } from "../../src/token-accounting/index.js";
import { seedLargeSession } from "../../scripts/large-session-lib.js";

const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 100;
  },
}, "gpt-test");

test("compaction audit report covers all bands for a medium large session", async () => {
  const storeRootDir = await mkdtemp(join(tmpdir(), "pi-compaction-report-large-"));
  const seeded = await seedLargeSession({
    targetTokenCount: 12_000,
    storeRootDir,
    sessionId: "compaction-report-large-session-test",
  });
  const requestedLowerBound = 6_000;
  const requestedBandPercentages = { fullFidelity: 20, smooth: 30, detailed: 30, brief: 20 };

  const result = await runSmartCompact(
    {
      threadId: seeded.threadId,
      requestedLowerBound,
      requestedBandPercentages,
      mode: "prepare",
    },
    {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
      asyncThreadDependencies: {
        tokenCountModel: "gpt-test",
      },
      piThreadViewWriterOptions: {
        pathResolver: {
          resolveGeneratedFilePath: (input) => join(storeRootDir, "generated", `${input.threadViewId}.jsonl`),
          resolveArchiveFilePath: (input) => join(storeRootDir, "archives", `${input.archivedAt}-${input.threadViewId}.jsonl`),
        },
        now: () => new Date("2026-01-15T14:00:00.000Z"),
      },
      piCliHarnessAdapter: {
        loadThreadViewFile: async () => ({ ok: true }),
      },
      now: () => new Date("2026-01-15T14:00:00.000Z"),
    },
  );

  assert.equal(result.compactStatus, "success");
  assert.ok(result.threadViewId);
  assert.ok(result.resultingTokenCount);
  assert.ok(result.resultingTokenCount > 0);
  assert.ok(result.resultingTokenCount <= requestedLowerBound * 4);

  const report = await buildCompactionAuditReport(
    {
      threadId: seeded.threadId,
      threadViewId: result.threadViewId,
    },
    {
      threadStore: seeded.threadStore,
      threadViewStore: seeded.threadViewStore,
    },
  );

  assert.equal(report.blockers.length, 0);
  assert.ok(report.bands.full_fidelity.selectedCount > 0);
  assert.ok((report.bands.detailed.targetTokenBudget ?? 0) > 0);
  assert.ok((report.bands.brief.targetTokenBudget ?? 0) > 0);

  const expectedBudgets = {
    full_fidelity: 1_200,
    smooth: 1_800,
    detailed: 1_800,
    brief: 1_200,
  };
  for (const [bandType, expectedBudget] of Object.entries(expectedBudgets)) {
    const band = report.bands[bandType as keyof typeof report.bands];
    assert.equal(band.targetTokenBudget, expectedBudget);
    assert.ok(band.actualTokenCount >= 0);
    assert.ok(
      band.actualTokenCount <= expectedBudget * (bandType === "full_fidelity" ? 12 : 3),
      `${bandType} actual ${band.actualTokenCount} exceeded rough target ${expectedBudget}`,
    );
  }

  assert.ok(report.selectedTurns.some((turn) => turn.bandType === "full_fidelity"));
  assert.ok(report.selectedChunks.length >= 0);
});
