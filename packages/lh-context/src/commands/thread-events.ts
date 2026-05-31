import { readFileSync } from "node:fs";

import type { CliResult } from "./run.js";
import { ThreadEventStore } from "../thread-events/store.js";
import { ThreadEventValidationError, type PersistedThreadEvent } from "../thread-events/schema.js";

interface ParsedThreadEventArgs {
  positional: string[];
  options: Map<string, string | boolean>;
}

export async function runThreadEventsCommand(args: string[]): Promise<CliResult> {
  const parsed = parseThreadEventArgs(args);
  if (parsed.options.has("help") || parsed.positional.length === 0) {
    return { exitCode: 0, stdout: THREAD_EVENTS_HELP_TEXT, stderr: "" };
  }

  const threadDbPath = stringOption(parsed, "thread-db");
  if (!threadDbPath) {
    return { exitCode: 1, stdout: "", stderr: "lhx thread-events requires --thread-db <path>.\n" };
  }

  const store = new ThreadEventStore({ threadDbPath });
  try {
    const [command] = parsed.positional;
    if (command === "append") {
      const filePath = stringOption(parsed, "file");
      if (!filePath) {
        throw new Error("lhx thread-events append requires --file <event.json>.");
      }

      const input = JSON.parse(readFileSync(filePath, "utf8"));
      return jsonResult(store.append(input));
    }

    if (command === "list") {
      const events = store.list();
      return parsed.options.has("json") ? jsonResult(events) : ok(printThreadEvents(events));
    }

    return { exitCode: 1, stdout: THREAD_EVENTS_HELP_TEXT, stderr: `Unknown thread-events command: ${command ?? ""}\n` };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: formatThreadEventError(error) };
  } finally {
    store.close();
  }
}

function parseThreadEventArgs(argv: string[]): ParsedThreadEventArgs {
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const optionName = arg.slice(2);
    if (optionName === "json" || optionName === "help") {
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

function stringOption(parsed: ParsedThreadEventArgs, name: string): string | undefined {
  const value = parsed.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function jsonResult(value: unknown): CliResult {
  return ok(`${JSON.stringify(value, null, 2)}\n`);
}

function printThreadEvents(events: readonly PersistedThreadEvent[]): string {
  if (events.length === 0) {
    return "No thread events.\n";
  }

  const rows = events.map((event) => ({
    order: event.eventOrder.toString(),
    thread: event.threadId,
    kind: event.eventKind,
    actor: `${event.actor.actorKind}:${event.actor.actorId}`,
    recorded: event.recordedAt,
    idempotency: event.idempotencyKey,
  }));
  const widths = {
    order: Math.max("ORDER".length, ...rows.map((row) => row.order.length)),
    thread: Math.min(28, Math.max("THREAD".length, ...rows.map((row) => row.thread.length))),
    kind: Math.max("KIND".length, ...rows.map((row) => row.kind.length)),
    actor: Math.min(24, Math.max("ACTOR".length, ...rows.map((row) => row.actor.length))),
    recorded: Math.max("RECORDED".length, ...rows.map((row) => row.recorded.length)),
  };

  return `${[
    [
      pad("ORDER", widths.order, "right"),
      pad("THREAD", widths.thread),
      pad("KIND", widths.kind),
      pad("ACTOR", widths.actor),
      pad("RECORDED", widths.recorded),
      "IDEMPOTENCY",
    ].join("  "),
    ...rows.map((row) =>
      [
        pad(row.order, widths.order, "right"),
        pad(truncate(row.thread, widths.thread), widths.thread),
        pad(row.kind, widths.kind),
        pad(truncate(row.actor, widths.actor), widths.actor),
        pad(row.recorded, widths.recorded),
        row.idempotency,
      ].join("  "),
    ),
  ].join("\n")}\n`;
}

function formatThreadEventError(error: unknown): string {
  if (error instanceof ThreadEventValidationError || error instanceof Error) {
    return `${error.message}\n`;
  }
  return `${String(error)}\n`;
}

function pad(value: string, width: number, align: "left" | "right" = "left"): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return width <= 3 ? value.slice(0, width) : `${value.slice(0, width - 3)}...`;
}

export const THREAD_EVENTS_HELP_TEXT = `lhx thread-events - Append and list schema-backed thread events

USAGE
  lhx thread-events append --thread-db <path> --file <event.json>
  lhx thread-events list --thread-db <path> [--json]

APPEND INPUT
  The JSON file contains caller-provided append input. The service generates
  schemaVersion, threadEventId, eventOrder, and recordedAt.

OPTIONS
  --thread-db <path>    Per-thread SQLite database path
  --file <event.json>   Thread event append input JSON
  --json                Stable structured output for list
`;
