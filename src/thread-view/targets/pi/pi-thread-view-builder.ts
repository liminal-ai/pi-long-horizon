import type { ThreadViewMessageRecord } from "../../domain/thread-view-records.js";
import type {
  BuildPiThreadViewFileInput,
  PiThreadViewEntry,
  PiThreadViewFile,
} from "../../domain/pi-thread-view-file.js";

const GENERATED_SOURCE_BY_KIND = {
  raw_turn_message: "raw_turn_message",
  smooth_turn: "smooth_turn",
  detailed_chunk_summary: "detailed_chunk_summary",
  brief_chunk_summary: "brief_chunk_summary",
} as const satisfies Record<ThreadViewMessageRecord["sourceKind"], PiThreadViewEntry["generatedSource"]>;

function isMaterializedRawMessageContent(
  content: ThreadViewMessageRecord["content"],
): content is {
  actorType?: string;
  messageKind?: string;
  parts?: Array<{
    content?: unknown;
  }>;
  targetMetadata?: {
    piRole?: string;
    rawType?: string;
    toolCallId?: string;
    toolName?: string;
  };
} {
  return typeof content !== "string";
}

function isPiThreadViewEntryRole(value: unknown): value is PiThreadViewEntry["role"] {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "toolResult" ||
    value === "custom"
  );
}

function extractRawMessageRole(
  content: Extract<ThreadViewMessageRecord["content"], Record<string, unknown>>,
): string | undefined {
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
      const rawRole = (partContent as { raw: { role?: unknown } }).raw.role;
      if (typeof rawRole === "string") {
        return rawRole;
      }
    }
  }

  return undefined;
}

function inferPiRole(message: ThreadViewMessageRecord): PiThreadViewEntry["role"] {
  if (message.sourceKind !== "raw_turn_message" || !isMaterializedRawMessageContent(message.content)) {
    return "assistant";
  }

  const explicitRole = message.content.targetMetadata?.piRole ?? message.content.targetMetadata?.rawType;
  if (isPiThreadViewEntryRole(explicitRole)) {
    return explicitRole;
  }

  const rawMessageRole = extractRawMessageRole(message.content);
  if (isPiThreadViewEntryRole(rawMessageRole)) {
    return rawMessageRole;
  }

  if (
    message.content.actorType === "tool" ||
    message.content.messageKind === "tool_result"
  ) {
    return "toolResult";
  }

  if (
    message.content.actorType === "human" ||
    message.content.actorType === "steward"
  ) {
    return "user";
  }

  return "assistant";
}

function isSystemSourceRecord(message: ThreadViewMessageRecord): boolean {
  if (message.sourceKind !== "raw_turn_message" || !isMaterializedRawMessageContent(message.content)) {
    return false;
  }

  const explicitRole = message.content.targetMetadata?.piRole ?? message.content.targetMetadata?.rawType;
  if (explicitRole === "system") {
    return true;
  }

  return extractRawMessageRole(message.content) === "system" || message.content.actorType === "system";
}

function buildEntryMetadata(message: ThreadViewMessageRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    bandType: message.bandType,
    sourceKind: message.sourceKind,
    sourceReference: message.sourceReference,
    threadViewMessageId: message.threadViewMessageId,
    projectionOutput: true,
  };

  if (
    message.sourceKind === "raw_turn_message" &&
    isMaterializedRawMessageContent(message.content) &&
    typeof message.content.targetMetadata?.piRole === "string"
  ) {
    metadata.piRole = message.content.targetMetadata.piRole;
  }

  if (
    message.sourceKind === "raw_turn_message" &&
    isMaterializedRawMessageContent(message.content) &&
    typeof message.content.targetMetadata?.rawType === "string"
  ) {
    metadata.rawType = message.content.targetMetadata.rawType;
  }

  if (
    message.sourceKind === "raw_turn_message" &&
    isMaterializedRawMessageContent(message.content) &&
    typeof message.content.targetMetadata?.toolCallId === "string"
  ) {
    metadata.toolCallId = message.content.targetMetadata.toolCallId;
  }

  if (
    message.sourceKind === "raw_turn_message" &&
    isMaterializedRawMessageContent(message.content) &&
    typeof message.content.targetMetadata?.toolName === "string"
  ) {
    metadata.toolName = message.content.targetMetadata.toolName;
  }

  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function structuredParts(content: ThreadViewMessageRecord["content"]): Array<Record<string, unknown>> | undefined {
  if (!isRecord(content) || !Array.isArray(content.parts)) {
    return undefined;
  }

  return content.parts.filter(isRecord);
}

function extractToolCallId(partContent: unknown, metadata?: Record<string, unknown>): string | undefined {
  if (isRecord(partContent)) {
    const id = partContent.toolCallId ?? partContent.callId ?? partContent.call_id ?? partContent.id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return typeof metadata?.toolCallId === "string" && metadata.toolCallId.length > 0
    ? metadata.toolCallId
    : undefined;
}

function extractToolName(partContent: unknown, metadata?: Record<string, unknown>): string | undefined {
  if (isRecord(partContent)) {
    if (typeof partContent.toolName === "string" && partContent.toolName.length > 0) {
      return partContent.toolName;
    }

    if (typeof partContent.name === "string" && partContent.name.length > 0) {
      return partContent.name;
    }
  }

  return typeof metadata?.toolName === "string" && metadata.toolName.length > 0
    ? metadata.toolName
    : undefined;
}

function extractToolArguments(partContent: unknown): unknown {
  if (!isRecord(partContent) || !("arguments" in partContent)) {
    return {};
  }

  return partContent.arguments;
}

function collectGeneratedToolResultIds(entries: readonly PiThreadViewEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.role !== "toolResult") {
      continue;
    }

    if (typeof entry.metadata?.toolCallId === "string" && entry.metadata.toolCallId.length > 0) {
      ids.add(entry.metadata.toolCallId);
      continue;
    }

    for (const part of structuredParts(entry.content) ?? []) {
      if (part.partType !== "tool_result") {
        continue;
      }
      const toolCallId = extractToolCallId(part.content, entry.metadata);
      if (toolCallId) {
        ids.add(toolCallId);
      }
    }
  }

  return ids;
}

function renderInertToolCall(partContent: unknown, metadata?: Record<string, unknown>): string {
  const record: Record<string, unknown> = {
    type: "unpaired_tool_call",
    name: extractToolName(partContent, metadata) ?? "generated_tool_call",
    arguments: extractToolArguments(partContent),
  };
  const toolCallId = extractToolCallId(partContent, metadata);
  if (toolCallId) {
    record.toolCallId = toolCallId;
  }

  return JSON.stringify(record);
}

function inertUnmatchedToolCalls(
  entry: PiThreadViewEntry,
  generatedToolResultIds: ReadonlySet<string>,
): PiThreadViewEntry {
  if (entry.generatedSource !== "raw_turn_message" || entry.role !== "assistant" || typeof entry.content === "string") {
    return entry;
  }

  const parts = Array.isArray(entry.content.parts) ? entry.content.parts : undefined;
  if (!parts) {
    return entry;
  }

  let changed = false;
  const nextParts = parts.map((part) => {
    if (!isRecord(part)) {
      return part;
    }

    if (part.partType !== "tool_call") {
      return part;
    }

    const toolCallId = extractToolCallId(part.content, entry.metadata);
    if (toolCallId && generatedToolResultIds.has(toolCallId)) {
      return part;
    }

    changed = true;
    return {
      ...part,
      partType: "text",
      content: renderInertToolCall(part.content, entry.metadata),
      metadata: {
        ...(isRecord(part.metadata) ? part.metadata : {}),
        inertReason: "unmatched_tool_result",
      },
    };
  });

  return changed
    ? {
        ...entry,
        content: {
          ...entry.content,
          parts: nextParts,
        },
      }
    : entry;
}

function toPiThreadViewEntry(message: ThreadViewMessageRecord): PiThreadViewEntry {
  return {
    entryType: "message",
    role: inferPiRole(message),
    content: typeof message.content === "string" ? message.content : structuredClone(message.content),
    generatedSource: GENERATED_SOURCE_BY_KIND[message.sourceKind],
    metadata: buildEntryMetadata(message),
  };
}

export async function buildPiThreadViewFile(
  input: BuildPiThreadViewFileInput,
): Promise<PiThreadViewFile> {
  const rawEntries = input.emittedMessages
    .filter((message) => !isSystemSourceRecord(message))
    .map(toPiThreadViewEntry);
  const generatedToolResultIds = collectGeneratedToolResultIds(rawEntries);
  const entries = rawEntries.map((entry) => inertUnmatchedToolCalls(entry, generatedToolResultIds));

  return {
    threadId: input.threadId,
    threadViewId: input.threadViewId,
    sessionId: input.sessionId ?? `${input.threadId}-${input.threadViewId}`,
    cwd: input.cwd ?? process.cwd(),
    parentSessionId: input.parentSessionId,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    placeholderExplicit: false,
    fileName: input.fileName ?? `${input.threadId}-${input.threadViewId}.jsonl`,
    entries,
    entryCount: entries.length,
  };
}
