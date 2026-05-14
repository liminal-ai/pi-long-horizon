import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { PromptVisibleToolResultDecision } from "../../services/prompt-visible-tool-result-projection.js";
import { truncateLiveToolResultText } from "../../services/live-tool-result-truncation.js";

interface ActivePromptProjectionWriterFs {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rename(fromPath: string, toPath: string): Promise<void>;
  rm(path: string, options: { force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
}

export interface RefreshActivePromptProjectionInput {
  generatedFilePath: string;
  decisions: readonly PromptVisibleToolResultDecision[];
}

export interface RefreshActivePromptProjectionResult {
  updated: boolean;
  updatedToolCallIds: string[];
  cleanableToolCallIds: string[];
  skippedReason?: "missing_file" | "changed_during_write" | "no_matching_entries" | "already_current" | "no_decisions";
}

export interface ActivePromptProjectionWriterOptions {
  fs?: ActivePromptProjectionWriterFs;
  now?: () => Date;
}

const defaultFs: ActivePromptProjectionWriterFs = {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
};

function parseJsonLine(line: string): unknown {
  return JSON.parse(line);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function toolResultMessageToolCallId(entry: unknown): string | undefined {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) {
    return undefined;
  }

  const message = entry.message;
  return message.role === "toolResult" && typeof message.toolCallId === "string" ? message.toolCallId : undefined;
}

function truncateToolResultEntry(entry: unknown, decision: PromptVisibleToolResultDecision): {
  entry: unknown;
  changed: boolean;
} {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) {
    return { entry, changed: false };
  }

  const message = entry.message;
  if (message.role !== "toolResult" || !Array.isArray(message.content)) {
    return { entry, changed: false };
  }

  let changed = false;
  const content = message.content.map((part) => {
    if (!isTextBlock(part)) {
      return part;
    }

    const text = truncateLiveToolResultText(part.text, decision.truncatedCharLimit);
    if (text === part.text) {
      return part;
    }

    changed = true;
    return {
      ...part,
      text,
    };
  });

  if (!changed) {
    return { entry, changed: false };
  }

  return {
    entry: {
      ...entry,
      message: {
        ...message,
        content,
      },
    },
    changed: true,
  };
}

async function writeAtomicIfUnchanged(input: {
  filePath: string;
  content: string;
  initialStat: { mtimeMs: number; size: number };
  fs: ActivePromptProjectionWriterFs;
  now: Date;
}): Promise<boolean> {
  const tempPath = join(
    dirname(input.filePath),
    `.${basename(input.filePath)}.${process.pid}.${input.now.getTime()}.prompt-projection.tmp`,
  );

  try {
    await input.fs.mkdir(dirname(input.filePath), { recursive: true });
    await input.fs.writeFile(tempPath, input.content, "utf8");
    const currentStat = await input.fs.stat(input.filePath);
    if (
      currentStat.mtimeMs !== input.initialStat.mtimeMs ||
      currentStat.size !== input.initialStat.size
    ) {
      await input.fs.rm(tempPath, { force: true });
      return false;
    }

    await input.fs.rename(tempPath, input.filePath);
    return true;
  } catch (error) {
    await input.fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function refreshActivePromptProjectionFile(
  input: RefreshActivePromptProjectionInput,
  options: ActivePromptProjectionWriterOptions = {},
): Promise<RefreshActivePromptProjectionResult> {
  if (input.decisions.length === 0) {
    return { updated: false, updatedToolCallIds: [], cleanableToolCallIds: [], skippedReason: "no_decisions" };
  }

  const fsImpl = options.fs ?? defaultFs;
  let initialStat: { mtimeMs: number; size: number };
  let content: string;
  try {
    initialStat = await fsImpl.stat(input.generatedFilePath);
    content = await fsImpl.readFile(input.generatedFilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { updated: false, updatedToolCallIds: [], cleanableToolCallIds: [], skippedReason: "missing_file" };
    }
    throw error;
  }

  const decisionsByToolCallId = new Map(input.decisions.map((decision) => [decision.toolCallId, decision]));
  const lines = content.split("\n");
  const updatedToolCallIds = new Set<string>();
  const matchedToolCallIds = new Set<string>();
  let changed = false;
  const nextLines = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }
    if (!line.includes("\"toolCallId\"")) {
      return line;
    }

    let parsed: unknown;
    try {
      parsed = parseJsonLine(line);
    } catch {
      return line;
    }

    const toolCallId = toolResultMessageToolCallId(parsed);
    if (!toolCallId) {
      return line;
    }

    const decision = decisionsByToolCallId.get(toolCallId);
    if (!decision) {
      return line;
    }
    matchedToolCallIds.add(toolCallId);

    const truncated = truncateToolResultEntry(parsed, decision);
    if (!truncated.changed) {
      return line;
    }

    changed = true;
    updatedToolCallIds.add(toolCallId);
    return JSON.stringify(truncated.entry);
  });

  if (!changed) {
    return {
      updated: false,
      updatedToolCallIds: [],
      cleanableToolCallIds: [...matchedToolCallIds],
      skippedReason: matchedToolCallIds.size > 0 ? "already_current" : "no_matching_entries",
    };
  }

  const nextContent = nextLines.join("\n");
  const wrote = await writeAtomicIfUnchanged({
    filePath: input.generatedFilePath,
    content: nextContent,
    initialStat,
    fs: fsImpl,
    now: (options.now ?? (() => new Date()))(),
  });

  if (!wrote) {
    return {
      updated: false,
      updatedToolCallIds: [],
      cleanableToolCallIds: [],
      skippedReason: "changed_during_write",
    };
  }

  return {
    updated: true,
    updatedToolCallIds: [...updatedToolCallIds],
    cleanableToolCallIds: [...matchedToolCallIds],
  };
}
