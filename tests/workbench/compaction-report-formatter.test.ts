import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompactionAuditReport,
  formatCompactionAuditReportJson,
} from "../../src/workbench/services/compaction-report-formatter.js";
import type { CompactionAuditReport } from "../../src/workbench/services/compaction-report-service.js";

function makeReport(): CompactionAuditReport {
  return {
    threadId: "thread-001",
    threadViewId: "thread-view-001",
    compactStatus: "available",
    resultingTokenCount: 12,
    generatedFilePath: "/tmp/generated.jsonl",
    archivePath: "/tmp/archive.jsonl",
    reloadResult: "available",
    blockers: [],
    bands: {
      full_fidelity: {
        bandType: "full_fidelity",
        targetTokenBudget: 10,
        selectedCount: 1,
        selectedIds: ["turn-001"],
        renderedStatus: "ready",
        actualTokenCount: 4,
      },
      smooth: {
        bandType: "smooth",
        targetTokenBudget: 20,
        selectedCount: 1,
        selectedIds: ["turn-002"],
        renderedStatus: "ready",
        actualTokenCount: 3,
      },
      detailed: {
        bandType: "detailed",
        targetTokenBudget: 30,
        selectedCount: 1,
        selectedIds: ["chunk-001"],
        renderedStatus: "ready",
        actualTokenCount: 3,
      },
      brief: {
        bandType: "brief",
        targetTokenBudget: 40,
        selectedCount: 1,
        selectedIds: ["chunk-002"],
        renderedStatus: "ready",
        actualTokenCount: 2,
      },
    },
    selectedTurns: [
      {
        turnId: "turn-001",
        bandType: "full_fidelity",
        rawTokenCount: 4,
        smoothTokenCount: 4,
      },
    ],
    degradedSmoothingCount: 0,
    selectedChunks: [
      {
        chunkId: "chunk-001",
        bandType: "detailed",
        smoothTokenCount: 6,
        detailedTokenCount: 7,
        briefTokenCount: 4,
      },
    ],
  };
}

test("formatCompactionAuditReport contains expected sections", () => {
  const output = formatCompactionAuditReport(makeReport());

  assert.match(output, /Compaction audit report/);
  assert.match(output, /Bands/);
  assert.match(output, /full_fidelity/);
  assert.match(output, /Budget vs actual: 10 target, 4 actual/);
  assert.match(output, /Selected turns/);
  assert.match(output, /turn-001 \[full_fidelity\]: raw 4, smooth 4/);
  assert.match(output, /Selected chunks/);
  assert.match(output, /chunk-001 \[detailed\]: smooth 6, detailed 7, brief 4/);
  assert.match(output, /Blockers/);
});

test("formatCompactionAuditReportJson returns formatted valid JSON", () => {
  const output = formatCompactionAuditReportJson(makeReport());
  const parsed = JSON.parse(output) as CompactionAuditReport;

  assert.equal(parsed.threadId, "thread-001");
  assert.equal(parsed.threadViewId, "thread-view-001");
  assert.equal(parsed.bands.brief.actualTokenCount, 2);
  assert.equal(parsed.selectedTurns[0]?.turnId, "turn-001");
  assert.match(output, /\n  "threadId": "thread-001"/);
});
