#!/usr/bin/env node
import { spawn } from "node:child_process";
import { PI_LH_HELP_TEXT, buildPiLaunchPlan, isLauncherHelpRequest } from "./pi-launcher.js";

const argv = process.argv.slice(2);
if (isLauncherHelpRequest(argv)) {
  process.stdout.write(PI_LH_HELP_TEXT);
  process.exit(0);
}

let plan;
try {
  plan = buildPiLaunchPlan({ argv });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pi-lh error: ${message}`);
  process.exit(1);
}

const child = spawn(plan.command, plan.args, {
  cwd: plan.cwd,
  env: plan.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`pi-lh error: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
