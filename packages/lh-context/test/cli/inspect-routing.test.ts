import { describe, expect, it } from "vitest";
import { runCli } from "../../src/commands/run.js";
import { inspectionFixtureArgs } from "../fixture-paths.js";

describe("hierarchical inspect CLI routing", () => {
  it("routes inspect summary/tokens/bands/readiness to existing primitive inspectors", async () => {
    const summary = await runCli(["inspect", "summary", ...inspectionFixtureArgs, "--json"]);
    expect(summary.exitCode).toBe(0);
    expect(summary.stderr).toBe("");
    expect(JSON.parse(summary.stdout)).toMatchObject({ threadId: "thread_alpha", messages: { total: 3 } });

    const tokens = await runCli(["inspect", "tokens", ...inspectionFixtureArgs, "--json"]);
    expect(tokens.exitCode).toBe(0);
    expect(tokens.stderr).toBe("");
    expect(JSON.parse(tokens.stdout).generatedThreadViewTokenCount.count).toBe(1234);

    const bands = await runCli(["inspect", "bands", ...inspectionFixtureArgs, "--json"]);
    expect(bands.exitCode).toBe(0);
    const parsedBands = JSON.parse(bands.stdout);
    expect(parsedBands.bands.full_fidelity.turns.indices).toEqual([1, 2]);
    expect(parsedBands.generatedSessionTokenCount.count).toBe(1234);

    const readiness = await runCli(["inspect", "readiness", ...inspectionFixtureArgs, "--json"]);
    expect(readiness.exitCode).toBe(0);
    const parsedReadiness = JSON.parse(readiness.stdout);
    expect(parsedReadiness.kind).toBe("readiness");
    expect(parsedReadiness.compactModeRecommendation).toBe("prepare");
  });

  it("keeps top-level summary/tokens/bands/readiness aliases compatible", async () => {
    expect(JSON.parse((await runCli(["summary", ...inspectionFixtureArgs, "--json"])).stdout).threadId).toBe("thread_alpha");
    expect(JSON.parse((await runCli(["tokens", ...inspectionFixtureArgs, "--json"])).stdout).generatedThreadViewTokenCount.count).toBe(1234);
    expect(JSON.parse((await runCli(["bands", ...inspectionFixtureArgs, "--json"])).stdout).selectedBandEntryCounts).toEqual({
      full_fidelity: 2,
      smooth: 1,
      detailed: 1,
      brief: 1,
    });
    expect(JSON.parse((await runCli(["readiness", ...inspectionFixtureArgs, "--json"])).stdout).kind).toBe("readiness");
  });
});
