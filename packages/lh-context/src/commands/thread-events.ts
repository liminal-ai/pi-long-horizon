import { readFileSync } from "node:fs";

import type { CliResult } from "./run.js";
import { ThreadEventStore, type ProjectedThreadRead } from "../thread-events/store.js";
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

  const eventDbPath = stringOption(parsed, "event-db") ?? stringOption(parsed, "thread-db");
  if (!eventDbPath) {
    return { exitCode: 1, stdout: "", stderr: "lhx thread-events requires --event-db <path>.\n" };
  }

  const store = new ThreadEventStore({ eventDbPath });
  try {
    const [command] = parsed.positional;
    if (command === "create") {
      const clientThreadId = stringOption(parsed, "client-thread-id");
      const title = stringOption(parsed, "title");
      return jsonResult(await store.createThread({ clientThreadId, title }));
    }

    if (command === "append") {
      const filePath = stringOption(parsed, "file");
      if (!filePath) {
        throw new Error("lhx thread-events append requires --file <event.json>.");
      }

      const input = JSON.parse(readFileSync(filePath, "utf8"));
      const result = await appendFromCliInput(store, input, stringOption(parsed, "client-thread-id"));
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
    }

    if (command === "list") {
      const events = await store.list();
      return parsed.options.has("json") ? jsonResult(events) : ok(printThreadEvents(events));
    }

    if (command === "threads") {
      const threads = await store.listThreads();
      return parsed.options.has("json") ? jsonResult(threads) : ok(printThreads(threads));
    }

    if (command === "read") {
      const clientThreadId = stringOption(parsed, "client-thread-id");
      if (!clientThreadId) {
        throw new Error("lhx thread-events read requires --client-thread-id <id>.");
      }

      const thread = await store.readThread(clientThreadId);
      if (!thread) {
        return { exitCode: 1, stdout: "", stderr: `Thread not found for clientThreadId: ${clientThreadId}\n` };
      }
      return parsed.options.has("json") ? jsonResult(thread) : ok(printThreadRead(thread));
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

async function appendFromCliInput(
  store: ThreadEventStore,
  input: unknown,
  clientThreadIdOption: string | undefined,
) {
  if (isObject(input) && typeof input.clientThreadId === "string" && Array.isArray(input.events)) {
    return await store.appendMany(input);
  }

  if (isObject(input) && Array.isArray(input.events)) {
    if (!clientThreadIdOption) {
      throw new Error("lhx thread-events append requires --client-thread-id <id> or clientThreadId in the input file.");
    }
    return await store.appendMany(clientThreadIdOption, input.events);
  }

  const clientThreadId = clientThreadIdOption ?? (isObject(input) && typeof input.clientThreadId === "string"
    ? input.clientThreadId
    : undefined);
  if (!clientThreadId) {
    throw new Error("lhx thread-events append requires --client-thread-id <id> or clientThreadId in the input file.");
  }

  const eventInput = isObject(input) && "clientThreadId" in input
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "clientThreadId"))
    : input;
  return await store.appendMany(clientThreadId, [eventInput]);
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

function printThreads(threads: readonly { threadId: string; clientThreadId: string; title?: string; updatedAt: string }[]): string {
  if (threads.length === 0) {
    return "No projected threads.\n";
  }

  const rows = threads.map((thread) => ({
    thread: thread.threadId,
    client: thread.clientThreadId,
    title: thread.title ?? "",
    updated: thread.updatedAt,
  }));
  const widths = {
    thread: Math.min(28, Math.max("THREAD".length, ...rows.map((row) => row.thread.length))),
    client: Math.min(28, Math.max("CLIENT".length, ...rows.map((row) => row.client.length))),
    title: Math.min(32, Math.max("TITLE".length, ...rows.map((row) => row.title.length))),
    updated: Math.max("UPDATED".length, ...rows.map((row) => row.updated.length)),
  };

  return `${[
    [
      pad("THREAD", widths.thread),
      pad("CLIENT", widths.client),
      pad("TITLE", widths.title),
      pad("UPDATED", widths.updated),
    ].join("  "),
    ...rows.map((row) =>
      [
        pad(truncate(row.thread, widths.thread), widths.thread),
        pad(truncate(row.client, widths.client), widths.client),
        pad(truncate(row.title, widths.title), widths.title),
        pad(row.updated, widths.updated),
      ].join("  "),
    ),
  ].join("\n")}\n`;
}

function printThreadRead(read: ProjectedThreadRead): string {
  if (read.messages.length === 0) {
    return `Thread ${read.thread.clientThreadId} has no projected messages.\n`;
  }

  return `${read.messages.map((message) =>
    [
      message.messageOrder.toString().padStart(3),
      message.messageKind.padEnd(11),
      message.status.padEnd(10),
      `${message.blocks.length} block${message.blocks.length === 1 ? "" : "s"}`,
    ].join("  "),
  ).join("\n")}\n`;
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

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const THREAD_EVENTS_HELP_TEXT = `lhx thread-events - Create, append, and inspect schema-backed thread events

USAGE
  lhx thread-events create --event-db <path> [--client-thread-id <id>] [--title "..."]
  lhx thread-events append --event-db <path> --client-thread-id <id> --file <event.json>
  lhx thread-events list --event-db <path> [--json]
  lhx thread-events threads --event-db <path> [--json]
  lhx thread-events read --event-db <path> --client-thread-id <id> [--json]

APPEND INPUT
  Append requires an existing clientThreadId. The JSON file may contain one
  event, or { "clientThreadId": "...", "events": [...] }. The service
  generates schemaVersion, threadEventId, canonical threadId, eventOrder, and
  recordedAt.

OPTIONS
  --event-db <path>     Dedicated thread-event/projection SQLite database path
  --file <event.json>   Thread event append input JSON
  --client-thread-id    Caller/harness thread id
  --title <title>       Optional projected thread title for create
  --json                Stable structured output for list
`;
