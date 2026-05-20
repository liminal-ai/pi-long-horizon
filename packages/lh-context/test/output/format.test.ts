import { describe, expect, it } from "vitest";
import { formatJson, formatSummaryHuman } from "../../src/output/format.js";
import type { SummaryResult } from "../../src/index.js";

const summary: SummaryResult = {
  kind: "summary",
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
});
