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
  extensionPaths?: string[];
}

export const PI_LH_HELP_TEXT = `pi-lh - launch PI with the Long Horizon extension\n\nUsage:\n  pi-lh [pi args...]\n\nBehavior:\n  - runs PI from the current working directory\n  - loads the packaged Long Horizon PI extensions\n  - disables PI auto extension discovery to avoid duplicate registrations\n  - enables hosted Codex web search for supported GPT models\n  - uses PI's default agent directory unless PI_CODING_AGENT_DIR is already set\n  - passes non-help args through to PI\n`;

export function isLauncherHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function resolvePiCliPath(): string {
  const piMainPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(piMainPath), "cli.js");
}

export function resolvePackagedExtensionPaths(): string[] {
  return [
    fileURLToPath(new URL("./pi-extension/index.js", import.meta.url)),
    fileURLToPath(new URL("./pi-extensions/codex-fast.js", import.meta.url)),
    fileURLToPath(new URL("./pi-extensions/codex-web-search.js", import.meta.url)),
  ];
}

export function resolvePackagedExtensionPath(): string {
  return resolvePackagedExtensionPaths()[0] as string;
}

function extensionArgs(paths: string[]): string[] {
  return paths.flatMap((path) => ["--extension", path]);
}

export function buildPiLaunchPlan(options: BuildPiLaunchPlanOptions): PiLaunchPlan {
  const cwd = options.cwd ?? process.cwd();
  const piCliPath = options.piCliPath ?? resolvePiCliPath();
  const extensionPaths = options.extensionPaths ?? (options.extensionPath ? [options.extensionPath] : resolvePackagedExtensionPaths());

  return {
    command: process.execPath,
    args: [
      piCliPath,
      "--no-extensions",
      ...extensionArgs(extensionPaths),
      "--codex-web-search",
      ...options.argv,
    ],
    cwd,
    env: {
      ...(options.env ?? process.env),
    },
  };
}
