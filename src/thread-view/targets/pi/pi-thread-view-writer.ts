import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import {
  CURRENT_SESSION_VERSION,
  type CustomEntry,
  type SessionHeader,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import type {
  PiThreadViewEntry,
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

const GENERATED_USAGE: Usage = {
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

function toAssistantBlocks(
  content: string | Record<string, unknown>,
): Array<TextContent | ThinkingContent | ToolCall> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  const parts = Array.isArray(content.parts) ? content.parts : undefined;
  if (!parts) {
    return [{ type: "text", text: JSON.stringify(content) }];
  }

  return parts.map((part, index) => {
    const partType = typeof part.partType === "string" ? part.partType : "text";
    const partContent = part.content;
    const text =
      typeof partContent === "string"
        ? partContent
        : typeof partContent?.text === "string"
          ? partContent.text
          : JSON.stringify(partContent);

    if (partType === "reasoning") {
      return {
        type: "thinking",
        thinking: text,
        thinkingSignature: `generated-thinking-${index + 1}`,
      } satisfies ThinkingContent;
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

      return {
        type: "toolCall",
        id: `generated-tool-call-${index + 1}`,
        name: toolName,
        arguments: toolArguments,
      } satisfies ToolCall;
    }

    return {
      type: "text",
      text,
    } satisfies TextContent;
  });
}

function serializeUserMessage(entry: PiThreadViewEntry, timestamp: string): UserMessage {
  return {
    role: "user",
    content: toUserVisibleBlocks(entry.content),
    timestamp: Date.parse(timestamp),
  };
}

function serializeAssistantMessage(entry: PiThreadViewEntry, timestamp: string): AssistantMessage {
  return {
    role: "assistant",
    api: "pi-long-horizon",
    provider: "pi-long-horizon",
    model: "generated-thread-view",
    stopReason: "stop",
    usage: GENERATED_USAGE,
    content: toAssistantBlocks(entry.content),
    timestamp: Date.parse(timestamp),
  };
}

function serializeToolResultMessage(
  entry: PiThreadViewEntry,
  timestamp: string,
  index: number,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId:
      typeof entry.metadata?.toolCallId === "string"
        ? entry.metadata.toolCallId
        : `generated-tool-result-${index + 1}`,
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

function serializeSessionMessageEntry(
  entry: PiThreadViewEntry,
  index: number,
  parentId: string | null,
  timestamp: string,
): SessionMessageEntry {
  const id = `entry-${String(index + 1).padStart(3, "0")}`;
  const message =
    entry.role === "user"
      ? serializeUserMessage(entry, timestamp)
      : entry.role === "toolResult"
        ? serializeToolResultMessage(entry, timestamp, index)
        : entry.role === "custom"
          ? serializeCustomMessage(entry, timestamp)
          : serializeAssistantMessage(entry, timestamp);

  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message,
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

function serializeFileContent(input: WritePiThreadViewFileInput, timestamp: string): string {
  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.file.sessionId,
    timestamp: input.file.generatedAt,
    cwd: input.file.cwd,
    parentSession: input.file.parentSessionId,
  };
  const threadViewOutputMetadata = serializeThreadViewOutputMetadataEntry(input, timestamp);
  const messageEntries = input.file.entries.map((entry, index) =>
    serializeSessionMessageEntry(
      entry,
      index,
      index === 0 ? threadViewOutputMetadata.id : `entry-${String(index).padStart(3, "0")}`,
      timestamp,
    ),
  );

  return [header, threadViewOutputMetadata, ...messageEntries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
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
  const nextContent = serializeFileContent(input, now);

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
