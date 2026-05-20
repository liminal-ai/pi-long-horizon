import { LhxError } from "../errors/errors.js";
import type { InspectInput } from "../types/public.js";
import { runBandsCommand } from "./bands.js";
import { HELP_TEXT } from "./help.js";
import { runSummaryCommand } from "./summary.js";
import { runTokensCommand } from "./tokens.js";

export interface CliResult { exitCode: number; stdout: string; stderr: string }

export async function runCli(argv: string[]): Promise<CliResult> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  const [command, ...rest] = argv;
  const { input, json } = parseOptions(rest);
  try {
    if (command === "summary") return { exitCode: 0, stdout: await runSummaryCommand(input, json), stderr: "" };
    if (command === "tokens") return { exitCode: 0, stdout: await runTokensCommand(input, json), stderr: "" };
    if (command === "bands") return { exitCode: 0, stdout: await runBandsCommand(input, json), stderr: "" };
    return { exitCode: 1, stdout: HELP_TEXT, stderr: `Unknown command: ${command}\n` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof LhxError ? ` (${error.code})` : "";
    return { exitCode: 1, stdout: "", stderr: `lhx error${code}: ${message}\n` };
  }
}

function parseOptions(args: string[]): { input: InspectInput; json: boolean } {
  const input: InspectInput = {};
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") { json = true; continue; }
    const next = args[++i];
    if (!next) throw new LhxError(`Missing value for ${arg}`, "BAD_ARGS");
    if (arg === "--root") input.rootDir = next;
    else if (arg === "--thread") input.threadId = next;
    else if (arg === "--thread-dir") input.threadDir = next;
    else if (arg === "--thread-view") input.threadViewPath = next;
    else throw new LhxError(`Unknown option: ${arg}`, "BAD_ARGS");
  }
  return { input, json };
}
