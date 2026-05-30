import { LhxError } from "../errors/errors.js";
import type { InspectInput } from "../types/public.js";
import { runBandsCommand } from "./bands.js";
import { HELP_TEXT } from "./help.js";
import { runReadinessCommand } from "./readiness.js";
import { runPostCompactReportCommand } from "./report.js";
import { runSummaryCommand } from "./summary.js";
import { runThreadsCommand } from "./threads.js";
import { runTokensCommand } from "./tokens.js";

export interface CliResult { exitCode: number; stdout: string; stderr: string }

export async function runCli(argv: string[]): Promise<CliResult> {
  const wantsJson = argv.includes("--json");
  if (argv.length === 0) return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  const [command, ...rest] = argv;
  try {
    if (command === "inspect") return await runInspect(rest);
    if (command === "threads") return await runThreadsCommand(rest);
    if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
    const { input, json } = parseOptions(rest);
    if (command === "summary") return { exitCode: 0, stdout: await runSummaryCommand(input, json), stderr: "" };
    if (command === "tokens") return { exitCode: 0, stdout: await runTokensCommand(input, json), stderr: "" };
    if (command === "bands") return { exitCode: 0, stdout: await runBandsCommand(input, json), stderr: "" };
    if (command === "readiness") return { exitCode: 0, stdout: await runReadinessCommand(input, json), stderr: "" };
    return { exitCode: 1, stdout: HELP_TEXT, stderr: `Unknown command: ${command}\n` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson && error instanceof LhxError) {
      return {
        exitCode: 1,
        stdout: `${JSON.stringify({
          kind: "error",
          code: error.code,
          message: error.message,
          details: error.details,
        }, null, 2)}\n`,
        stderr: "",
      };
    }

    const code = error instanceof LhxError ? ` (${error.code})` : "";
    return { exitCode: 1, stdout: "", stderr: `lhx error${code}: ${message}\n` };
  }
}

async function runInspect(args: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = args;
  if (subcommand === "summary") {
    const { input, json } = parseOptions(rest);
    return { exitCode: 0, stdout: await runSummaryCommand(input, json), stderr: "" };
  }
  if (subcommand === "tokens") {
    const { input, json } = parseOptions(rest);
    return { exitCode: 0, stdout: await runTokensCommand(input, json), stderr: "" };
  }
  if (subcommand === "bands") {
    const { input, json } = parseOptions(rest);
    return { exitCode: 0, stdout: await runBandsCommand(input, json), stderr: "" };
  }
  if (subcommand === "readiness") {
    const { input, json } = parseOptions(rest);
    return { exitCode: 0, stdout: await runReadinessCommand(input, json), stderr: "" };
  }
  if (subcommand === "report") {
    const [reportName, ...reportRest] = rest;
    if (reportName === "post-compact") {
      const { input, json } = parseOptions(reportRest);
      return { exitCode: 0, stdout: await runPostCompactReportCommand(input, json), stderr: "" };
    }
    return { exitCode: 1, stdout: HELP_TEXT, stderr: `Unknown inspect report: ${reportName ?? ""}\n` };
  }
  return { exitCode: 1, stdout: HELP_TEXT, stderr: `Unknown inspect command: ${subcommand ?? ""}\n` };
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
    else if (arg === "--backing") {
      if (next !== "auto" && next !== "file" && next !== "sqlite") {
        throw new LhxError(`Unknown backing mode: ${next}`, "BAD_ARGS");
      }
      input.backing = next;
    }
    else throw new LhxError(`Unknown option: ${arg}`, "BAD_ARGS");
  }
  return { input, json };
}
