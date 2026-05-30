import {
  AmbiguousThreadCatalogReferenceError,
  ThreadCatalog,
  ThreadCatalogNotFoundError,
  type ThreadResumeCommand,
  type ThreadCatalogRow,
} from "../threads/catalog.js";
import type { CliResult } from "./run.js";

interface ParsedThreadArgs {
  positional: string[];
  options: Map<string, string | boolean>;
}

export async function runThreadsCommand(args: string[]): Promise<CliResult> {
  const parsed = parseThreadArgs(args);
  if (parsed.options.has("help") || parsed.positional.length === 0) {
    return { exitCode: 0, stdout: THREADS_HELP_TEXT, stderr: "" };
  }

  const catalog = new ThreadCatalog({
    catalogDbPath: stringOption(parsed, "catalog-db") ?? process.env.LH_THREADS_CATALOG_DB,
  });

  try {
    const [command, ...rest] = parsed.positional;
    if (command === "upsert") {
      const threadDbPath = stringOption(parsed, "thread-db");
      if (!threadDbPath) {
        throw new Error("lhx threads upsert requires --thread-db <path>.");
      }
      return jsonResult(catalog.upsertFromThreadDb({ threadDbPath, name: stringOption(parsed, "name") }));
    }

    if (command === "list") {
      const rows = catalog.list();
      return parsed.options.has("json") ? jsonResult(rows) : ok(printThreadList(rows));
    }

    if (command === "show") {
      const reference = rest[0];
      if (!reference) {
        throw new Error("lhx threads show requires <id-or-name>.");
      }
      return jsonResult(catalog.show(reference));
    }

    if (command === "refresh") {
      if (parsed.options.has("all")) {
        return jsonResult(catalog.refreshAll());
      }

      const reference = rest[0];
      if (!reference) {
        throw new Error("lhx threads refresh requires <id-or-name> or --all.");
      }
      return jsonResult(catalog.refresh(reference));
    }

    if (command === "resume") {
      const reference = rest[0];
      if (!reference) {
        throw new Error("lhx threads resume requires <id-or-name>.");
      }
      const resumeCommand = catalog.generateResumeCommand(reference);
      return parsed.options.has("json") ? jsonResult(resumeCommand) : ok(printThreadResumeCommand(resumeCommand));
    }

    return { exitCode: 1, stdout: THREADS_HELP_TEXT, stderr: `Unknown threads command: ${command ?? ""}\n` };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: formatThreadCatalogError(error) };
  } finally {
    catalog.close();
  }
}

function parseThreadArgs(argv: string[]): ParsedThreadArgs {
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const optionName = arg.slice(2);
    if (optionName === "all" || optionName === "json" || optionName === "help") {
      options.set(optionName, true);
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${optionName} requires a value.`);
    }
    options.set(optionName, value);
    index += 1;
  }

  return { positional, options };
}

function stringOption(parsed: ParsedThreadArgs, name: string): string | undefined {
  const value = parsed.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function jsonResult(value: unknown): CliResult {
  return ok(`${JSON.stringify(value, null, 2)}\n`);
}

function printThreadList(rows: readonly ThreadCatalogRow[]): string {
  if (rows.length === 0) {
    return "No cataloged threads.\n";
  }

  const displayRows = rows.map((row) => ({
    id: row.id?.toString() ?? "-",
    project: row.projectName ?? "-",
    age: formatAge(row.updatedAt),
    turns: row.turnCount.toString(),
    tokens: formatTokens(row.generatedTokenCount),
    health: formatHealth(row),
    name: row.name ?? row.threadId,
  }));

  const terminalWidth = process.stdout.columns ?? 120;
  const widths = {
    id: Math.max("ID".length, ...displayRows.map((row) => row.id.length)),
    project: Math.min(22, Math.max("PROJECT".length, ...displayRows.map((row) => row.project.length))),
    age: Math.max("AGE".length, ...displayRows.map((row) => row.age.length)),
    turns: Math.max("TURNS".length, ...displayRows.map((row) => row.turns.length)),
    tokens: Math.max("TOKENS".length, ...displayRows.map((row) => row.tokens.length)),
    health: Math.max("HEALTH".length, ...displayRows.map((row) => row.health.length)),
  };
  const separatorWidth = 2 * 6;
  const fixedWidth = widths.id + widths.project + widths.age + widths.turns + widths.tokens + widths.health + separatorWidth;
  const nameWidth = Math.max("NAME".length, terminalWidth - fixedWidth);

  const lines = [
    [
      pad("ID", widths.id, "right"),
      pad("PROJECT", widths.project),
      pad("AGE", widths.age),
      pad("TURNS", widths.turns, "right"),
      pad("TOKENS", widths.tokens, "right"),
      pad("HEALTH", widths.health),
      "NAME",
    ].join("  "),
    ...displayRows.map((row) =>
      [
        pad(row.id, widths.id, "right"),
        pad(truncate(row.project, widths.project), widths.project),
        pad(row.age, widths.age),
        pad(row.turns, widths.turns, "right"),
        pad(row.tokens, widths.tokens, "right"),
        pad(row.health, widths.health),
        truncate(row.name, nameWidth),
      ].join("  "),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function printThreadResumeCommand(command: ThreadResumeCommand): string {
  return [
    "Long Horizon thread resume command",
    `Thread: ${command.name ? `${command.name} (${command.threadId})` : command.threadId}`,
    `Project: ${command.projectRoot}`,
    `Session: ${command.sessionId}`,
    `Session file: ${command.sessionFilePath}`,
    command.currentGeneratedFilePath ? `Generated file: ${command.currentGeneratedFilePath}` : undefined,
    `Thread DB: ${command.threadDbPath}`,
    "",
    command.shellCommand,
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatThreadCatalogError(error: unknown): string {
  if (error instanceof AmbiguousThreadCatalogReferenceError) {
    const matches = error.matches
      .map((row) => `${row.id ? `${row.id}: ` : ""}${row.threadId}${row.name ? ` (${row.name})` : ""}`)
      .join(", ");
    return `${error.message} Matches: ${matches}\n`;
  }

  if (error instanceof ThreadCatalogNotFoundError || error instanceof Error) {
    return `${error.message}\n`;
  }

  return `${String(error)}\n`;
}

const THREADS_HELP_TEXT = `lhx threads - Manual Long Horizon thread catalog

USAGE
  lhx threads upsert --thread-db <path> [--name "..."] [--catalog-db <path>]
  lhx threads list [--json] [--catalog-db <path>]
  lhx threads show <id-or-name> [--catalog-db <path>]
  lhx threads refresh <id-or-name> [--catalog-db <path>]
  lhx threads refresh --all [--catalog-db <path>]
  lhx threads resume <id-or-name> [--json] [--catalog-db <path>]

OPTIONS
  --thread-db <path>    Canonical per-thread thread.sqlite to observe
  --name <name>         User-managed catalog name; preserved across refreshes
  --catalog-db <path>   Catalog SQLite cache path
  --json                Stable structured output for list and resume

REFERENCES
  <id-or-name> accepts the catalog-local integer ID, full/prefix thread id,
  full/prefix session id, exact name, or unique name substring.

ENVIRONMENT
  LH_THREADS_CATALOG_DB  Override the catalog SQLite path
`;

function pad(value: string, width: number, align: "left" | "right" = "left"): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return width <= 3 ? value.slice(0, width) : `${value.slice(0, width - 3)}...`;
}

function formatAge(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) {
    return "-";
  }

  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const yearMs = 365 * dayMs;

  if (elapsedMs < minuteMs) {
    return "now";
  }
  if (elapsedMs < hourMs) {
    return `${Math.floor(elapsedMs / minuteMs)}m`;
  }
  if (elapsedMs < dayMs) {
    return `${Math.floor(elapsedMs / hourMs)}h`;
  }
  if (elapsedMs < yearMs) {
    return `${Math.floor(elapsedMs / dayMs)}d`;
  }
  return `${Math.floor(elapsedMs / yearMs)}y`;
}

function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) {
    return "-";
  }
  if (tokens < 1_000) {
    return `${tokens}`;
  }
  if (tokens < 1_000_000) {
    return `${formatOneDecimal(tokens / 1_000)}k`;
  }
  return `${formatOneDecimal(tokens / 1_000_000)}m`;
}

function formatOneDecimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatHealth(row: ThreadCatalogRow): string {
  if (row.observationStatus !== "ok") {
    return row.observationStatus;
  }

  const states = [row.turnState, row.tokenCountingState, row.maintenanceState].filter(
    (state): state is string => Boolean(state),
  );
  if (states.some((state) => state.includes("failed"))) {
    return "failed";
  }
  if (states.some((state) => state.includes("repair_needed"))) {
    return "repair";
  }
  return "ok";
}
