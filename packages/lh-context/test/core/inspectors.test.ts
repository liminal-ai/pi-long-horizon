import { describe, expect, it } from "vitest";
import path from "node:path";
import { inspectBands, inspectSummary, inspectTokens } from "../../src/index.js";
import { formatBandsHuman } from "../../src/output/format.js";

const rootDir = path.resolve("test/fixtures/sample");

describe("core inspectors", () => {
  it("summarizes canonical thread state without large message bodies", async () => {
    const result = await inspectSummary({ rootDir });
    expect(result.threadId).toBe("thread_alpha");
    expect(result.messages.total).toBe(3);
    expect(result.messages.byKind.prompt).toBe(1);
    expect(result.messages.byActorType.tool).toBe(1);
    expect(result.turns).toEqual({ total: 2, closed: 1, open: 1 });
    expect(result.chunks).toEqual({ total: 2, closed: 1, open: 1 });
    expect(result.currentGeneratedTokenCount).toBe(1234);
    expect(JSON.stringify(result)).not.toContain("tool output payload");
    expect(result.status.degraded).toHaveLength(1);
    expect(result.status.repairNeeded).toHaveLength(1);
  });

  it("rolls token metadata and distinguishes provider exact from heuristic", async () => {
    const result = await inspectTokens({ rootDir });
    expect(result.estimates.canonicalVisibleTextRaw.label).toBe("estimate");
    expect(result.generatedThreadViewTokenCount?.count).toBe(1234);
    expect(result.generatedThreadViewTokenCount?.source).toBe("thread_view_output_summary.generatedSessionTokenCountMetadata");
    expect(result.rollups.rawTurnTokenMetadata).toContainEqual(expect.objectContaining({ source: "provider_input_count", trustClass: "provider_input_count", count: 32, label: "provider_exact" }));
    expect(result.rollups.smoothTurnTokenMetadata).toContainEqual(expect.objectContaining({ source: "pi_heuristic", trustClass: "pi_heuristic", count: 10, label: "estimate" }));
    expect(result.rollups.lowerBandProjectionTokenMetadata).toContainEqual(expect.objectContaining({ source: "pi_heuristic", trustClass: "pi_heuristic", count: 10, label: "estimate" }));
    expect(result.rollups.detailedChunkTokenMetadata).toContainEqual(expect.objectContaining({ count: 50, label: "provider_exact" }));
    expect(result.rollups.briefChunkTokenMetadata).toContainEqual(expect.objectContaining({ count: 20, label: "estimate" }));
  });

  it("reports generated thread-view band layout", async () => {
    const result = await inspectBands({ rootDir });
    expect(result.recordCount).toBe(4);
    expect(result.messageCount).toBe(2);
    expect(result.latestAssistantUsageTotalTokens).toBe(0);
    expect(result.generatedSessionTokenCount?.count).toBe(1234);
    expect(result.selectedBandEntryCounts).toEqual({ full_fidelity: 2, smooth: 1, detailed: 1, brief: 1 });
    expect(result.bands.full_fidelity.turns.count).toBe(2);
    expect(result.bands.full_fidelity.turns.ids).toEqual(["turn_zzz", "turn_aaa"]);
    expect(result.bands.full_fidelity.turns.indices).toEqual([1, 2]);
    expect(result.bands.full_fidelity.tokenSum).toBe(32);
    expect(result.bands.smooth.tokenSum).toBe(3);
    expect(result.bands.detailed.chunks.ids).toEqual(["chunk-001"]);
    expect(result.bands.detailed.tokenSum).toBe(50);
    expect(result.bands.brief.tokenSum).toBe(20);
    expect(result.livePostCompactTailDetection.supported).toBe(false);
  });

  it("formats band human output with turn order ranges, not lexical UUID ranges", async () => {
    const result = await inspectBands({ rootDir });
    const text = formatBandsHuman(result);
    expect(text).toContain("full_fidelity: entries=2 turns=2 (turns 1-2)");
    expect(text).not.toContain("turn_aaa..turn_zzz");
  });

  it("handles a missing generated thread-view gracefully", async () => {
    const result = await inspectBands({ rootDir, threadViewPath: "does-not-exist.jsonl" });
    expect(result.recordCount).toBe(0);
    expect(result.warnings.join("\n")).toContain("not found");
  });
});
