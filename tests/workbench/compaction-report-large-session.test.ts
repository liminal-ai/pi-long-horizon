import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { buildCompactionAuditReport } from "../../src/workbench/services/compaction-report-service.js";
import { seedLargeSession } from "../../scripts/large-session-lib.js";

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
  assert.ok(result.resultingTokenCount >= requestedLowerBound * 0.4);
  assert.ok(result.resultingTokenCount <= requestedLowerBound * 1.8);

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
  assert.ok(report.bands.smooth.selectedCount > 0);
  assert.ok(report.bands.detailed.selectedCount > 0);
  assert.ok(report.bands.brief.selectedCount > 0);

  const expectedBudgets = {
    full_fidelity: 1_200,
    smooth: 1_800,
    detailed: 1_800,
    brief: 1_200,
  };
  for (const [bandType, expectedBudget] of Object.entries(expectedBudgets)) {
    const band = report.bands[bandType as keyof typeof report.bands];
    assert.equal(band.targetTokenBudget, expectedBudget);
    assert.ok(band.actualTokenCount > 0);
    assert.ok(
      band.actualTokenCount <= expectedBudget * 2.5,
      `${bandType} actual ${band.actualTokenCount} exceeded rough target ${expectedBudget}`,
    );
  }

  assert.ok(report.selectedTurns.some((turn) => turn.bandType === "full_fidelity"));
  assert.ok(report.selectedTurns.some((turn) => turn.bandType === "smooth"));
  assert.ok(report.selectedChunks.some((chunk) => chunk.bandType === "detailed"));
  assert.ok(report.selectedChunks.some((chunk) => chunk.bandType === "brief"));
});
