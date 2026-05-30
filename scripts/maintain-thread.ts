#!/usr/bin/env tsx
import { join, resolve } from "node:path";

import { SqliteThreadStore } from "../src/context-steward/store/sqlite-thread-store.js";
import { repairThreadMaintenance } from "../src/thread/async-thread/services/thread-maintenance-repair-service.js";
import { PiCodexLowerBandCompressionProvider } from "../src/thread/async-thread/services/pi-codex-lower-band-compression-provider.js";
import { OpenAIInputTokenCounter } from "../src/token-accounting/index.js";

interface Args {
  root: string;
  threadId?: string;
  json: boolean;
  lowerBand: boolean;
  tokenCountModel?: string;
}

const args = parseArgs(process.argv.slice(2));
if (!args.threadId) {
  process.stderr.write(help());
  process.exitCode = 1;
} else {
  const store = new SqliteThreadStore(join(resolve(args.root), ".context-steward"));
  const result = await repairThreadMaintenance(
    { threadId: args.threadId },
    {
      store,
      lowerBandCompressionProvider: args.lowerBand ? new PiCodexLowerBandCompressionProvider() : undefined,
      openAIInputTokenCounter: args.tokenCountModel ? new OpenAIInputTokenCounter(undefined, args.tokenCountModel) : undefined,
      tokenCountModel: args.tokenCountModel,
    },
  );

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    const s = result.value.summary;
    process.stdout.write(
      `Thread maintenance ${result.value.threadId}: ready\n` +
      `  alreadyReady=${s.alreadyReady} repaired=${s.repaired} skipped=${s.skipped} failed=${s.failed}\n`,
    );
  } else {
    process.stderr.write(`Thread maintenance failed: ${result.issues.map((issue) => issue.message).join("; ")}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): Args {
  const out: Args = { root: ".", json: false, lowerBand: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--lower-band") out.lowerBand = true;
    else if (arg === "--root") out.root = requireValue(argv, ++i, arg);
    else if (arg === "--thread") out.threadId = requireValue(argv, ++i, arg);
    else if (arg === "--token-count-model") out.tokenCountModel = requireValue(argv, ++i, arg);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(help());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function help(): string {
  return `Usage: tsx scripts/maintain-thread.ts --thread <thread_id> [--root .] [--json]\n\n` +
    `Runs standalone Context Steward maintenance/repair without generating or reloading a PI session.\n\n` +
    `Options:\n` +
    `  --token-count-model <model>  Enable OpenAI exact materialized token repair with this model id\n` +
    `  --lower-band                 Enable awaited PI Codex lower-band detailed/brief repair\n`;
}
