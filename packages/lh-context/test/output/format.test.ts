import { describe, expect, it } from "vitest";

import { formatJson, formatReadinessHuman, formatSummaryHuman, type ReadinessResult, type SummaryResult } from "../../src/index.js";

const summary: SummaryResult = {
  kind: "summary",
  backing: "sqlite",
  rootDir: "/r",
  contextStewardDir: "/r/.context-steward",
  threadDir: "/r/.context-steward/threads/thread_alpha",
  threadId: "thread_alpha",
  sourceRevision: 1,
  messageHighWatermark: 1,
  updatedAt: "now",
  messages: { total: 1, byKind: { prompt: 1 }, byActorType: { human: 1 } },
  turns: { total: 1, closed: 1, open: 0 },
  chunks: { total: 0, closed: 0, open: 0 },
  currentGeneratedFilePath: "/view.jsonl",
  currentGeneratedTokenCount: 10,
  status: { degraded: [], repairNeeded: [] },
  warnings: [],
};

describe("formatters", () => {
  it("formats JSON with stable parseable structure", () => {
    expect(JSON.parse(formatJson(summary))).toEqual(summary);
  });

  it("formats concise human summary", () => {
    const text = formatSummaryHuman(summary);
    expect(text).toContain("PI Long Horizon context summary");
    expect(text).toContain("Thread: thread_alpha");
    expect(text).toContain("Messages: 1");
  });

  it("renders missing maintenance sections without crashing", () => {
    const readiness: ReadinessResult = {
      kind: "readiness",
      backing: "sqlite",
      threadId: "thread-format-readiness-001",
      overallStatus: "prepare_recommended",
      compactModeRecommendation: "prepare",
      turnState: "ready",
      tokenCounting: {
        status: "ready",
        issueCount: 0,
        issues: [],
      },
      projection: {
        status: "degraded",
        currentGeneratedFilePath: "/tmp/generated.jsonl",
        issueCount: 1,
        issues: [{ code: "RELOAD_FAILED", message: "Reload failed." }],
      },
      maintenance: {
        background: undefined,
        manualRepair: undefined,
        prepare: undefined,
      },
      warnings: [],
    };

    expect(formatReadinessHuman(readiness)).toContain(
      "Maintenance background: status=unknown scope=unknown fixed=0 skipped=0 failed=0 remainingDebt=0",
    );
    expect(formatReadinessHuman(readiness)).toContain(
      "Maintenance manualRepair: status=unknown scope=unknown fixed=0 skipped=0 failed=0 remainingDebt=0",
    );
    expect(formatReadinessHuman(readiness)).toContain(
      "Maintenance prepare: status=unknown scope=unknown fixed=0 skipped=0 failed=0 remainingDebt=0",
    );
  });
});
