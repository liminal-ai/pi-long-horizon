import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PI_LH_HELP_TEXT, buildPiLaunchPlan, isLauncherHelpRequest } from "../../src/pi-launcher.js";

describe("pi-lh launcher plan", () => {
  it("launches PI from the caller cwd with the packaged extension", () => {
    const plan = buildPiLaunchPlan({
      argv: ["--help"],
      cwd: "/tmp/example-repo",
      env: { PI_CODING_AGENT_DIR: "/unrelated/agent" },
      piCliPath: "/pkg/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      extensionPath: "/pkg/dist/pi-extension/index.js",
    });

    expect(plan.command).toBe(process.execPath);
    expect(plan.cwd).toBe("/tmp/example-repo");
    expect(plan.args).toEqual([
      "/pkg/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      "--extension",
      "/pkg/dist/pi-extension/index.js",
      "--help",
    ]);
    expect(plan.env.PI_CODING_AGENT_DIR).toBe(join("/tmp/example-repo", ".pi", "agent"));
  });

  it("handles explicit wrapper help without stealing the no-arg PI launch", () => {
    expect(isLauncherHelpRequest([])).toBe(false);
    expect(isLauncherHelpRequest(["--help"])).toBe(true);
    expect(isLauncherHelpRequest(["-h"])).toBe(true);
    expect(isLauncherHelpRequest(["-p", "hello"])).toBe(false);
    expect(PI_LH_HELP_TEXT).toContain("pi-lh [pi args...]");
  });
});
