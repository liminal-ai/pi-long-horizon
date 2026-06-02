import { describe, expect, it } from "vitest";
import { runCli } from "../../src/commands/run.js";
import { inspectionFixtureArgs } from "../fixture-paths.js";

describe("inspect report post-compact CLI", () => {
  it("returns stable structured JSON", async () => {
    const result = await runCli(["inspect", "report", "post-compact", ...inspectionFixtureArgs, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.kind).toBe("post_compact_report");
    expect(parsed.threadId).toBe("thread_alpha");
    expect(parsed.generatedThreadView.generatedSessionTokenCount.count).toBe(1234);
    expect(parsed.bands.full_fidelity.tokenSum).toBe(32);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it("formats a human post-compact report by sections and stable facts", async () => {
    const result = await runCli(["inspect", "report", "post-compact", ...inspectionFixtureArgs]);

    expect(result.exitCode).toBe(0);
    const text = result.stdout;
    expect(text).toContain("Post-compact");
    expect(text).toContain("Thread: thread_alpha");
    expect(text).toContain("Messages: 3");
    expect(text).toContain("Turns: 1 closed / 1 open");
    expect(text).toContain("Chunks: 1 closed / 1 open");
    expect(text).toContain("Generated thread-view:");
    expect(text).toContain("Generated tokens: 1,234");
    expect(text).toContain("exact");
    expect(text).toContain("Records: 4");
    expect(text).toContain("Messages: 2");
    expect(text).toContain("Status: degraded=1 repairNeeded=1");
    expect(text).toContain("full_fidelity");
    expect(text).toContain("smooth");
    expect(text).toContain("detailed");
    expect(text).toContain("brief");
    expect(text).toContain("turns 1-2");
    expect(text).not.toContain("turn_aaa..turn_zzz");
    expect(text).toContain("Canonical raw estimate");
    expect(text).toContain("Tool-result raw estimate");
    expect(text).toContain("Generated exact total");
  });
});
