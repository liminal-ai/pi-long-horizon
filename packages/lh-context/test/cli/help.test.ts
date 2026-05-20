import { describe, expect, it } from "vitest";
import { runCli } from "../../src/commands/run.js";

describe("CLI", () => {
  it("prints onboarding help with no args", async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lhx - PI Long Horizon context inspection");
    expect(result.stdout).toContain("Canonical Thread");
    expect(result.stdout).toContain("--json");
  });
});
