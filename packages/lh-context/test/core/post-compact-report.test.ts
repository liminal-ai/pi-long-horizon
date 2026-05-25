import { describe, expect, it } from "vitest";
import path from "node:path";
import { inspectPostCompactReport } from "../../src/index.js";

const rootDir = path.resolve("test/fixtures/sample");

function bucketTotal(buckets: Array<{ label: string; count: number }>, label: string): number {
  return buckets.filter((bucket) => bucket.label === label).reduce((sum, bucket) => sum + bucket.count, 0);
}

describe("post-compact report", () => {
  it("composes canonical, generated, band, status, and token-scale facts without message bodies", async () => {
    const report = await inspectPostCompactReport({ rootDir });

    expect(report.kind).toBe("post_compact_report");
    expect(report.threadId).toBe("thread_alpha");
    expect(report.canonical.messages.total).toBe(3);
    expect(report.canonical.messages.byKind.prompt).toBe(1);
    expect(report.canonical.messages.byActorType.tool).toBe(1);
    expect(report.canonical.turns).toEqual({ total: 2, closed: 1, open: 1 });
    expect(report.canonical.chunks).toEqual({ total: 2, closed: 1, open: 1 });

    expect(report.generatedThreadView.generatedSessionTokenCount?.count).toBe(1234);
    expect(report.generatedThreadView.generatedSessionTokenCount?.source).toBe("thread_view_output_summary.generatedSessionTokenCountMetadata");
    expect(report.generatedThreadView.recordCount).toBe(4);
    expect(report.generatedThreadView.messageCount).toBe(2);
    expect(report.generatedThreadView.latestAssistantUsageTotalTokens).toBe(0);
    expect(report.generatedThreadView.statusSummary).toEqual({ degradedCount: 1, repairNeededCount: 1 });

    expect(report.bands.full_fidelity.turns.indices).toEqual([1, 2]);
    expect(report.bands.full_fidelity.tokenSum).toBe(32);
    expect(report.bands.smooth.tokenSum).toBe(3);
    expect(report.bands.detailed.chunks.ids).toEqual(["chunk-001"]);
    expect(report.bands.detailed.tokenSum).toBe(50);
    expect(report.bands.brief.tokenSum).toBe(20);

    expect(report.tokenScale.canonicalRawEstimate.count).toBeGreaterThan(0);
    expect(report.tokenScale.toolResultRawEstimate.count).toBeGreaterThan(0);
    expect(report.tokenScale.rawTurn.providerExactTotal).toBe(32);
    expect(report.tokenScale.detailedChunk.providerExactTotal).toBe(50);
    expect(report.tokenScale.smoothTurn.estimatedTotal).toBe(10);
    expect(report.tokenScale.generated.providerExactTotal).toBe(1234);
    expect(bucketTotal(report.tokenScale.rawTurn.buckets, "provider_exact")).toBe(32);

    expect(JSON.stringify(report)).not.toContain("tool output payload");
  });

  it("returns a partial report with warnings when the generated thread-view file is missing", async () => {
    const report = await inspectPostCompactReport({ rootDir, threadViewPath: "does-not-exist.jsonl" });

    expect(report.canonical.messages.total).toBe(3);
    expect(report.generatedThreadView.recordCount).toBe(0);
    expect(report.generatedThreadView.messageCount).toBe(0);
    expect(report.generatedThreadView.generatedSessionTokenCount?.count).toBe(1234);
    expect(report.warnings.join("\n")).toContain("not found");
  });
});
