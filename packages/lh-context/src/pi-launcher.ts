import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export interface PiLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface BuildPiLaunchPlanOptions {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  piCliPath?: string;
  extensionPath?: string;
}

export const PI_LH_HELP_TEXT = `pi-lh - launch PI with the Long Horizon extension\n\nUsage:\n  pi-lh [pi args...]\n\nBehavior:\n  - runs PI from the current working directory\n  - loads the packaged Long Horizon PI extension\n  - sets PI_CODING_AGENT_DIR=<cwd>/.pi/agent for project-local PI state\n  - passes non-help args through to PI\n`;

export function isLauncherHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function resolvePiCliPath(): string {
  const piMainPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(piMainPath), "cli.js");
}

export function resolvePackagedExtensionPath(): string {
  return fileURLToPath(new URL("./pi-extension/index.js", import.meta.url));
}

export function buildPiLaunchPlan(options: BuildPiLaunchPlanOptions): PiLaunchPlan {
  const cwd = options.cwd ?? process.cwd();
  const piCliPath = options.piCliPath ?? resolvePiCliPath();
  const extensionPath = options.extensionPath ?? resolvePackagedExtensionPath();

  return {
    command: process.execPath,
    args: [piCliPath, "--extension", extensionPath, ...options.argv],
    cwd,
    env: {
      ...(options.env ?? process.env),
      PI_CODING_AGENT_DIR: join(cwd, ".pi", "agent"),
    },
  };
}
