#!/usr/bin/env tsx

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { USER_PROMPT_SMOOTHING_PROMPT_VERSION, type UserPromptSmoothingProvider } from "../src/thread/async-thread/services/user-prompt-smoothing-service.js";
import { PiCodexUserPromptSmoothingProvider } from "../src/thread/async-thread/services/pi-codex-user-prompt-smoothing-provider.js";
import type { MessageRecord } from "../src/thread/domain/records.js";
import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import type { ThreadStore } from "../src/thread/store/thread-store.js";

export interface UserPromptSmoothingEvalRow {
  promptNumber: number;
  sourceMessageId: string;
  original: string;
  smoothed?: string;
  promptVersion: typeof USER_PROMPT_SMOOTHING_PROMPT_VERSION;
  provider: "openai-codex";
  model: "gpt-5.4-mini";
  reasoningEffort: "none";
  usage?: Record<string, unknown>;
  elapsedMs?: number;
  error?: string;
}

export interface RunUserPromptSmoothingEvalInput {
  threadId: string;
  sampleSize: number;
  outputPath: string;
}

export interface RunUserPromptSmoothingEvalDependencies {
  threadStore: ThreadStore;
  provider: UserPromptSmoothingProvider;
}

function usage(): never {
  console.error("Usage: tsx scripts/eval-user-prompt-smoothing.ts <store-root-dir> <thread-id> [--sample-size n] [--output path]");
  process.exit(1);
}

function readPromptText(message: MessageRecord): string {
  return message.parts
    .filter((part) => part.partType === "text")
    .sort((left, right) => left.partOrder - right.partOrder)
    .map((part) => (typeof part.content === "string" ? part.content : JSON.stringify(part.content)))
    .join("\n")
    .trim();
}

function defaultOutputPath(threadId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(
    "docs",
    "spec-build",
    "epics",
    "04-smooth-context-quality",
    "eval-results",
    `${threadId}-${stamp}.jsonl`,
  );
}

export async function runUserPromptSmoothingEval(
  input: RunUserPromptSmoothingEvalInput,
  dependencies: RunUserPromptSmoothingEvalDependencies,
): Promise<{ outputPath: string; rows: UserPromptSmoothingEvalRow[] }> {
  const snapshotResult = await dependencies.threadStore.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new Error(snapshotResult.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }
  const snapshot = snapshotResult.value;
  const turnsByMessageId = new Map(snapshot.turns.flatMap((turn) => turn.messageIds.map((messageId) => [messageId, turn])));
  const userMessages = snapshot.messages
    .filter((message) => message.actorType === "human")
    .map((message) => ({ message, original: readPromptText(message), turn: turnsByMessageId.get(message.messageId) }))
    .filter((entry) => entry.original.length > 0 && entry.turn)
    .slice(0, input.sampleSize);

  const rows: UserPromptSmoothingEvalRow[] = [];
  for (const [index, entry] of userMessages.entries()) {
    const startedAt = Date.now();
    try {
      const output = await dependencies.provider.smoothUserPrompt({
        threadId: input.threadId,
        turnId: entry.turn!.turnId,
        messageId: entry.message.messageId,
        rawText: entry.original,
        sourceRevision: entry.message.sourceRevision,
        promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
      });
      rows.push({
        promptNumber: index + 1,
        sourceMessageId: entry.message.messageId,
        original: entry.original,
        smoothed: output.text,
        promptVersion: output.promptVersion,
        provider: output.providerId,
        model: output.modelId,
        reasoningEffort: output.reasoningEffort,
        usage: output.usage,
        elapsedMs: output.elapsedMs,
      });
    } catch (error) {
      rows.push({
        promptNumber: index + 1,
        sourceMessageId: entry.message.messageId,
        original: entry.original,
        promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
        provider: "openai-codex",
        model: "gpt-5.4-mini",
        reasoningEffort: "none",
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return { outputPath: input.outputPath, rows };
}

function parseArgs(argv: string[]): { storeRootDir: string; threadId: string; sampleSize: number; outputPath: string } {
  const [storeRootDir, threadId, ...rest] = argv;
  if (!storeRootDir || !threadId) {
    usage();
  }
  let sampleSize = 10;
  let outputPath = defaultOutputPath(threadId);
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--sample-size" && value) {
      sampleSize = Number(value);
      index += 1;
    } else if (flag === "--output" && value) {
      outputPath = value;
      index += 1;
    } else {
      usage();
    }
  }
  return { storeRootDir, threadId, sampleSize, outputPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runUserPromptSmoothingEval(
    {
      threadId: args.threadId,
      sampleSize: args.sampleSize,
      outputPath: args.outputPath,
    },
    {
      threadStore: new FileThreadStore(args.storeRootDir),
      provider: new PiCodexUserPromptSmoothingProvider(),
    },
  );
  console.log(JSON.stringify({ outputPath: result.outputPath, rowCount: result.rows.length }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
