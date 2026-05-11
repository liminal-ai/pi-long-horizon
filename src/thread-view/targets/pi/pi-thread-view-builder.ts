import type { ThreadViewMessageRecord } from "../../../context-workbench/domain/thread-view-records.js";
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
    placeholderExplicit:
      message.sourceKind === "detailed_chunk_summary" || message.sourceKind === "brief_chunk_summary",
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
  const entries = input.emittedMessages
    .filter((message) => !isSystemSourceRecord(message))
    .map(toPiThreadViewEntry);

  return {
    threadId: input.threadId,
    threadViewId: input.threadViewId,
    sessionId: input.sessionId ?? `${input.threadId}-${input.threadViewId}`,
    cwd: input.cwd ?? process.cwd(),
    parentSessionId: input.parentSessionId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    placeholderExplicit: entries.some(
      (entry) =>
        entry.generatedSource === "detailed_chunk_summary" ||
        entry.generatedSource === "brief_chunk_summary",
    ),
    fileName: input.fileName ?? `${input.threadId}-${input.threadViewId}.jsonl`,
    entries,
    entryCount: entries.length,
  };
}
