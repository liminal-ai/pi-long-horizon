import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import {
  CURRENT_SESSION_VERSION,
  type CustomEntry,
  type ModelChangeEntry,
  type SessionHeader,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
} from "@earendil-works/pi-coding-agent";

import type {
  PiThreadViewEntry,
  PiThreadViewFile,
  WritePiThreadViewFileInput,
  WritePiThreadViewFileResult,
} from "../../domain/pi-thread-view-file.js";

interface PiThreadViewWriterFs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rename(fromPath: string, toPath: string): Promise<void>;
  rm(path: string, options: { force?: boolean }): Promise<void>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
}

interface PiCustomMessage {
  role: "custom";
  customType: string;
  content: string | Array<TextContent | ImageContent>;
  display: boolean;
  details?: unknown;
  timestamp: number;
}

export interface PiThreadViewWriterPathResolver {
  resolveGeneratedFilePath(input: WritePiThreadViewFileInput): string;
  resolveArchiveFilePath(input: WritePiThreadViewFileInput & { archivedAt: string }): string;
}

export interface PiThreadViewWriterOptions {
  fs?: PiThreadViewWriterFs;
  now?: () => Date;
  pathResolver?: PiThreadViewWriterPathResolver;
}

const defaultFs: PiThreadViewWriterFs = {
  readFile,
  rename,
  rm,
  writeFile,
};

const SYNTHETIC_GENERATED_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function defaultPathResolver(): PiThreadViewWriterPathResolver {
  return {
    resolveGeneratedFilePath(input) {
      return resolve(
        input.file.cwd,
        ".context-steward",
        "threads",
        input.threadId,
        "generated",
        input.file.fileName,
      );
    },
    resolveArchiveFilePath(input) {
      const archiveStamp = input.archivedAt.replace(/[:.]/g, "-");
      return resolve(
        input.file.cwd,
        ".context-steward",
        "threads",
        input.threadId,
        "archives",
        "pi-thread-views",
        `${archiveStamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

function toUserVisibleBlocks(
  content: string | Record<string, unknown>,
): Array<TextContent | ImageContent> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  const parts = Array.isArray(content.parts) ? content.parts : undefined;
  if (!parts) {
    return [{ type: "text", text: JSON.stringify(content) }];
  }

  return parts.map((part, index) => {
    const partContent = part.content;
    const text =
      typeof partContent === "string"
        ? partContent
        : typeof partContent?.text === "string"
          ? partContent.text
          : JSON.stringify(partContent);

    return {
      type: "text",
      text,
    } satisfies TextContent;
  });
}

function isStructuredEntryContent(content: string | Record<string, unknown>): content is Record<string, unknown> {
  return typeof content === "object" && content !== null;
}

function extractRawMessage(
  content: string | Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isStructuredEntryContent(content)) {
    return undefined;
  }

  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    const partContent = part?.content;
    if (
      partContent &&
      typeof partContent === "object" &&
      "raw" in partContent &&
      typeof (partContent as { raw?: unknown }).raw === "object" &&
      (partContent as { raw?: unknown }).raw !== null
    ) {
      return structuredClone((partContent as { raw: Record<string, unknown> }).raw);
    }
  }

  return undefined;
}

function extractToolCallId(partContent: unknown, fallback?: unknown): string | undefined {
  if (partContent && typeof partContent === "object") {
    const content = partContent as {
      id?: unknown;
      toolCallId?: unknown;
      callId?: unknown;
      call_id?: unknown;
    };
    const id = content.toolCallId ?? content.callId ?? content.call_id ?? content.id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return typeof fallback === "string" && fallback.length > 0 ? fallback : undefined;
}

function toAssistantBlocks(entry: PiThreadViewEntry): Array<TextContent | ToolCall> {
  const content = entry.content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  const parts = Array.isArray(content.parts) ? content.parts : undefined;
  if (!parts) {
    return [{ type: "text", text: JSON.stringify(content) }];
  }

  return parts.flatMap((part): Array<TextContent | ToolCall> => {
    const partType = typeof part.partType === "string" ? part.partType : "text";
    const partContent = part.content;
    const text =
      typeof partContent === "string"
        ? partContent
        : typeof partContent?.text === "string"
          ? partContent.text
          : JSON.stringify(partContent);

    if (partType === "reasoning") {
      return [];
    }

    if (partType === "tool_call" && partContent && typeof partContent === "object") {
      const toolName =
        typeof (partContent as { toolName?: unknown }).toolName === "string"
          ? (partContent as { toolName: string }).toolName
          : typeof (partContent as { name?: unknown }).name === "string"
            ? (partContent as { name: string }).name
            : "generated_tool_call";
      const toolArguments =
        typeof (partContent as { arguments?: unknown }).arguments === "object" &&
          (partContent as { arguments?: unknown }).arguments !== null
          ? (partContent as { arguments: Record<string, unknown> }).arguments
          : {};
      const toolCallId = extractToolCallId(partContent, entry.metadata?.toolCallId);
      if (!toolCallId) {
        throw new Error("Assistant tool_call part is missing a tool call ID.");
      }

      return [{
        type: "toolCall",
        id: toolCallId,
        name: toolName,
        arguments: toolArguments,
      } satisfies ToolCall];
    }

    return [{
      type: "text",
      text,
    } satisfies TextContent];
  });
}

function serializeUserMessage(entry: PiThreadViewEntry, timestamp: string): UserMessage {
  return {
    role: "user",
    content: toUserVisibleBlocks(entry.content),
    timestamp: Date.parse(timestamp),
  };
}

function serializeAssistantMessage(
  entry: PiThreadViewEntry,
  file: PiThreadViewFile,
  timestamp: string,
): AssistantMessage {
  return {
    role: "assistant",
    api: "pi-long-horizon",
    provider: file.modelProvider ?? "pi-long-horizon",
    model: file.modelId ?? "generated-thread-view",
    stopReason: "stop",
    usage: SYNTHETIC_GENERATED_USAGE,
    content: toAssistantBlocks(entry),
    timestamp: Date.parse(timestamp),
  };
}

function serializeToolResultMessage(
  entry: PiThreadViewEntry,
  timestamp: string,
): ToolResultMessage {
  if (typeof entry.metadata?.toolCallId !== "string" || entry.metadata.toolCallId.length === 0) {
    throw new Error("Tool result entry is missing metadata.toolCallId.");
  }

  return {
    role: "toolResult",
    toolCallId: entry.metadata.toolCallId,
    toolName:
      typeof entry.metadata?.toolName === "string"
        ? entry.metadata.toolName
        : "generated_thread_view",
    isError: false,
    content: toUserVisibleBlocks(entry.content),
    timestamp: Date.parse(timestamp),
  };
}

function serializeCustomMessage(entry: PiThreadViewEntry, timestamp: string): PiCustomMessage {
  const rawMessage = extractRawMessage(entry.content);
  if (rawMessage?.role === "custom") {
    const rawContent = rawMessage.content;

    return {
      role: "custom",
      customType:
        typeof rawMessage.customType === "string"
          ? rawMessage.customType
          : "pi-long-horizon.raw-message",
      content:
        typeof rawContent === "string" || Array.isArray(rawContent)
          ? structuredClone(rawContent)
          : toUserVisibleBlocks(entry.content),
      display: typeof rawMessage.display === "boolean" ? rawMessage.display : true,
      details: rawMessage.details,
      timestamp:
        typeof rawMessage.timestamp === "number" ? rawMessage.timestamp : Date.parse(timestamp),
    };
  }

  return {
    role: "custom",
    customType:
      typeof entry.metadata?.customType === "string"
        ? entry.metadata.customType
        : "pi-long-horizon.raw-message",
    content: toUserVisibleBlocks(entry.content),
    display:
      typeof entry.metadata?.display === "boolean"
        ? entry.metadata.display
        : true,
    details: entry.metadata?.details,
    timestamp: Date.parse(timestamp),
  };
}

function serializeCompactedContentMessage(entry: PiThreadViewEntry, timestamp: string): PiCustomMessage {
  return {
    role: "custom",
    customType: "pi-long-horizon.compacted-content",
    content: toUserVisibleBlocks(entry.content),
    display: false,
    timestamp: Date.parse(timestamp),
  };
}

function serializeSessionMessageEntry(
  input: {
    file: PiThreadViewFile;
    entry: PiThreadViewEntry;
    index: number;
    parentId: string | null;
    timestamp: string;
  },
): SessionMessageEntry {
  const id = `entry-${String(input.index + 1).padStart(3, "0")}`;
  const message =
    input.entry.generatedSource === "raw_turn_message"
      ? input.entry.role === "user"
        ? serializeUserMessage(input.entry, input.timestamp)
        : input.entry.role === "toolResult"
          ? serializeToolResultMessage(input.entry, input.timestamp)
          : input.entry.role === "custom"
            ? serializeCustomMessage(input.entry, input.timestamp)
            : serializeAssistantMessage(input.entry, input.file, input.timestamp)
      : serializeCompactedContentMessage(input.entry, input.timestamp);

  return {
    type: "message",
    id,
    parentId: input.parentId,
    timestamp: input.timestamp,
    message,
  };
}

function serializeModelChangeEntry(
  input: WritePiThreadViewFileInput,
  parentId: string,
  timestamp: string,
): ModelChangeEntry | undefined {
  if (!input.file.modelProvider || !input.file.modelId) {
    return undefined;
  }

  return {
    type: "model_change",
    provider: input.file.modelProvider,
    modelId: input.file.modelId,
    id: "thread-view-model-change-001",
    parentId,
    timestamp,
  };
}

function serializeThinkingLevelChangeEntry(
  input: WritePiThreadViewFileInput,
  parentId: string,
  timestamp: string,
): ThinkingLevelChangeEntry | undefined {
  if (!input.file.thinkingLevel) {
    return undefined;
  }

  return {
    type: "thinking_level_change",
    thinkingLevel: input.file.thinkingLevel,
    id: "thread-view-thinking-level-change-001",
    parentId,
    timestamp,
  };
}

function serializeThreadViewOutputMetadataEntry(
  input: WritePiThreadViewFileInput,
  timestamp: string,
): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom",
    customType: "pi-long-horizon.thread-view.output",
    data: {
      threadId: input.threadId,
      threadViewId: input.threadViewId,
      fileName: input.file.fileName,
      generatedAt: input.file.generatedAt,
      placeholderExplicit: input.file.placeholderExplicit,
      entries: input.file.entries.map((entry, index) => ({
        index,
        generatedSource: entry.generatedSource,
        role: entry.role,
        metadata: entry.metadata ? structuredClone(entry.metadata) : undefined,
      })),
    },
    id: "thread-view-output-metadata-001",
    parentId: null,
    timestamp,
  };
}

export function serializePiThreadViewFileContent(input: WritePiThreadViewFileInput, timestamp: string): string {
  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.file.sessionId,
    timestamp: input.file.generatedAt,
    cwd: input.file.cwd,
    parentSession: input.file.parentSessionId,
  };
  const threadViewOutputMetadata = serializeThreadViewOutputMetadataEntry(input, timestamp);
  const settingsEntries: Array<ModelChangeEntry | ThinkingLevelChangeEntry> = [];
  const modelChange = serializeModelChangeEntry(input, threadViewOutputMetadata.id, timestamp);
  if (modelChange) {
    settingsEntries.push(modelChange);
  }
  const thinkingLevelChange = serializeThinkingLevelChangeEntry(
    input,
    settingsEntries.at(-1)?.id ?? threadViewOutputMetadata.id,
    timestamp,
  );
  if (thinkingLevelChange) {
    settingsEntries.push(thinkingLevelChange);
  }
  const firstMessageParentId = settingsEntries.at(-1)?.id ?? threadViewOutputMetadata.id;
  const messageEntries = input.file.entries.map((entry, index) =>
    serializeSessionMessageEntry({
      file: input.file,
      entry,
      index,
      parentId: index === 0 ? firstMessageParentId : `entry-${String(index).padStart(3, "0")}`,
      timestamp,
    }),
  );

  return [header, threadViewOutputMetadata, ...settingsEntries, ...messageEntries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

async function writeAtomic(filePath: string, content: string, fsImpl: PiThreadViewWriterFs): Promise<void> {
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await fsImpl.writeFile(tempPath, content, "utf8");
    await fsImpl.rename(tempPath, filePath);
  } catch (error) {
    await fsImpl.rm(tempPath, { force: true });
    throw error;
  }
}

export async function writePiThreadViewFile(
  input: WritePiThreadViewFileInput,
  options: PiThreadViewWriterOptions = {},
): Promise<WritePiThreadViewFileResult> {
  const fsImpl = options.fs ?? defaultFs;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const pathResolver = options.pathResolver ?? defaultPathResolver();
  const generatedFilePath = pathResolver.resolveGeneratedFilePath(input);
  const archivePath = pathResolver.resolveArchiveFilePath({
    ...input,
    archivedAt: now,
  });
  const nextContent = serializePiThreadViewFileContent(input, now);

  let previousContent: string | undefined;
  try {
    previousContent = await fsImpl.readFile(generatedFilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (previousContent !== undefined) {
    await writeAtomic(archivePath, previousContent, fsImpl);
  }

  await writeAtomic(generatedFilePath, nextContent, fsImpl);

  return {
    generatedFilePath,
    archivePath: previousContent === undefined ? undefined : archivePath,
  };
}
