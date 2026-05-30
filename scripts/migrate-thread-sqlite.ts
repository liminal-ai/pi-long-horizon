#!/usr/bin/env tsx
import path from "node:path";
import { existsSync } from "node:fs";

import { importFileBackedThread } from "../src/thread/migration/sqlite-thread-migration-service.js";

interface Args {
  rootDir: string;
  threadId?: string;
  json: boolean;
  validateOnly: boolean;
  replace: boolean;
}

function usage(): string {
  return `Usage: npm run migrate:sqlite -- --thread <thread_id> [--root .] [--json] [--validate-only] [--replace]\n\nMigrates a legacy file-backed .context-steward thread into thread.sqlite.\nRefuses to replace an existing thread.sqlite unless --replace is provided.\n`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { rootDir: ".", json: false, validateOnly: false, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--validate-only") {
      args.validateOnly = true;
      continue;
    }
    if (arg === "--replace") {
      args.replace = true;
      continue;
    }
    const value = argv[++i];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === "--root") args.rootDir = value;
    else if (arg === "--thread") args.threadId = value;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!args.threadId) throw new Error("Missing required --thread <thread_id>");
  return args;
}

function resolveStewardRoot(rootDir: string, threadId: string): string {
  const directThreadFile = path.join(rootDir, "threads", threadId, "thread.json");
  if (existsSync(directThreadFile)) return rootDir;
  return path.join(rootDir, ".context-steward");
}

function formatHuman(result: Awaited<ReturnType<typeof importFileBackedThread>>, rootDir: string, validateOnly: boolean): string {
  if (!result.ok) {
    return `SQLite migration failed:\n${JSON.stringify(result.issues, null, 2)}\n`;
  }

  const value = result.value;
  const lines = [
    validateOnly ? "SQLite migration validation complete." : "SQLite migration complete.",
    `Thread: ${value.threadId}`,
    `DB: ${value.dbPath}`,
    `Mode/state: ${value.partialStateHandling.status}`,
    `Note: ${value.partialStateHandling.note}`,
    "Imported:",
  ];
  for (const [key, count] of Object.entries(value.importedCounts)) {
    lines.push(`  ${key}: ${count}`);
  }
  if (Object.keys(value.skippedCounts).length > 0) {
    lines.push("Skipped:");
    for (const [key, count] of Object.entries(value.skippedCounts)) {
      lines.push(`  ${key}: ${count}`);
    }
  }
  if (value.generatedRolloutPath) {
    lines.push(`Generated rollout: ${value.generatedRolloutPath}`);
  }
  if (value.warnings.length > 0) {
    const shownWarnings = value.warnings.slice(0, 10);
    lines.push(`Warnings: ${value.warnings.length}`);
    for (const warning of shownWarnings) {
      lines.push(`  - ${warning.code}: ${warning.message}`);
    }
    if (value.warnings.length > shownWarnings.length) {
      lines.push(`  ... ${value.warnings.length - shownWarnings.length} more; rerun with --json for full details.`);
    }
  }
  lines.push("Next check:");
  lines.push(`  node packages/lh-context/dist/cli.js inspect summary --root ${rootDir} --thread ${value.threadId} --backing sqlite`);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stewardRoot = resolveStewardRoot(args.rootDir, args.threadId!);
  const validation = await importFileBackedThread({
    rootDir: stewardRoot,
    threadId: args.threadId!,
    mode: "validate_only",
  });

  if (!validation.ok || args.validateOnly) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(validation.ok ? { ok: true, ...validation.value } : { ok: false, issues: validation.issues }, null, 2)}\n`);
    } else {
      process.stdout.write(formatHuman(validation, args.rootDir, true));
    }
    if (!validation.ok) process.exitCode = 1;
    return;
  }

  if (validation.value.partialStateHandling.existingDbDetected && !args.replace) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, code: "SQLITE_EXISTS", message: "thread.sqlite already exists; rerun with --replace to overwrite from legacy JSON.", validation: validation.value }, null, 2)}\n`);
    } else {
      process.stdout.write(formatHuman(validation, args.rootDir, true));
      process.stderr.write("Refusing to replace existing thread.sqlite. Rerun with --replace if you intentionally want legacy JSON to overwrite SQLite.\n");
    }
    process.exitCode = 1;
    return;
  }

  const result = await importFileBackedThread({
    rootDir: stewardRoot,
    threadId: args.threadId!,
    mode: "import",
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, issues: result.issues }, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(result, args.rootDir, false));
  }

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`migrate:sqlite error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
