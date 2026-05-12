import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
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

import type { MessageRecord, PartRecord } from "../../thread/domain/records.js";

const ZERO_USAGE: Usage = {
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

function stringifyPartContent(content: string | Record<string, unknown>): string {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content.text === "string" && content.text.trim().length > 0) {
    return content.text;
  }

  if (typeof content.output === "string") {
    return content.output;
  }

  return JSON.stringify(content);
}

function contentTimestamp(record: { createdAt?: string; capturedAt?: string }): number {
  const parsed = Date.parse(record.createdAt ?? record.capturedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function partText(part: PartRecord | MaterializedPart): string {
  return stringifyPartContent(part.content);
}

function extractToolCallId(
  part: PartRecord | MaterializedPart,
  metadata?: { toolCallId?: string },
): string {
  const content = part.content;
  if (typeof content === "object" && content !== null) {
    const id = content.toolCallId ?? content.callId ?? content.call_id ?? content.id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return metadata?.toolCallId ?? "estimated-tool-call";
}

function extractToolName(
  part: PartRecord | MaterializedPart,
  metadata?: { toolName?: string },
): string {
  const content = part.content;
  if (typeof content === "object" && content !== null) {
    const name = content.toolName ?? content.name;
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }

  return metadata?.toolName ?? "estimated_tool";
}

function extractToolArguments(part: PartRecord | MaterializedPart): Record<string, unknown> {
  const content = part.content;
  if (
    typeof content === "object" &&
    content !== null &&
    typeof content.arguments === "object" &&
    content.arguments !== null
  ) {
    return content.arguments as Record<string, unknown>;
  }

  return {};
}

function textBlocks(parts: readonly (PartRecord | MaterializedPart)[]): TextContent[] {
  return parts.map((part) => ({
    type: "text",
    text: partText(part),
  }));
}

function assistantBlocks(
  parts: readonly (PartRecord | MaterializedPart)[],
  metadata?: { toolCallId?: string; toolName?: string },
): Array<TextContent | ThinkingContent | ToolCall> {
  return parts.map((part) => {
    if (part.partType === "reasoning") {
      return {
        type: "thinking",
        thinking: partText(part),
      } satisfies ThinkingContent;
    }

    if (part.partType === "tool_call") {
      return {
        type: "toolCall",
        id: extractToolCallId(part, metadata),
        name: extractToolName(part, metadata),
        arguments: extractToolArguments(part),
      } satisfies ToolCall;
    }

    return {
      type: "text",
      text: partText(part),
    } satisfies TextContent;
  });
}

function inferRole(input: {
  actorType?: string;
  messageKind?: string;
  targetMetadata?: { piRole?: string; rawType?: string };
}): "user" | "assistant" | "toolResult" | "custom" {
  const explicitRole = input.targetMetadata?.piRole ?? input.targetMetadata?.rawType;
  if (
    explicitRole === "user" ||
    explicitRole === "assistant" ||
    explicitRole === "toolResult" ||
    explicitRole === "custom"
  ) {
    return explicitRole;
  }

  if (input.actorType === "tool" || input.messageKind === "tool_result") {
    return "toolResult";
  }

  if (input.actorType === "human" || input.actorType === "steward" || input.actorType === "system") {
    return "user";
  }

  return "assistant";
}

function messageFromParts(input: {
  actorType?: string;
  messageKind?: string;
  parts: readonly (PartRecord | MaterializedPart)[];
  targetMetadata?: {
    piRole?: string;
    rawType?: string;
    provider?: string;
    model?: string;
    api?: string;
    responseId?: string;
    stopReason?: string;
    toolCallId?: string;
    toolName?: string;
  };
  timestamp: number;
}): AgentMessage {
  const role = inferRole(input);

  if (role === "user") {
    return {
      role: "user",
      content: textBlocks(input.parts),
      timestamp: input.timestamp,
    } satisfies UserMessage;
  }

  if (role === "toolResult") {
    return {
      role: "toolResult",
      toolCallId: input.targetMetadata?.toolCallId ?? "estimated-tool-result",
      toolName: input.targetMetadata?.toolName ?? "estimated_tool",
      content: textBlocks(input.parts),
      isError: false,
      timestamp: input.timestamp,
    } satisfies ToolResultMessage;
  }

  if (role === "custom") {
    return {
      role: "custom",
      customType: "pi-long-horizon.estimated-message",
      content: textBlocks(input.parts),
      display: false,
      timestamp: input.timestamp,
    } as AgentMessage;
  }

  return {
    role: "assistant",
    content: assistantBlocks(input.parts, input.targetMetadata),
    api: input.targetMetadata?.api ?? "pi-long-horizon",
    provider: input.targetMetadata?.provider ?? "pi-long-horizon",
    model: input.targetMetadata?.model ?? "estimated-message",
    responseId: input.targetMetadata?.responseId,
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: input.timestamp,
  } satisfies AssistantMessage;
}

export function estimateRawMessageTokenCount(message: MessageRecord): number {
  return estimateTokens(
    messageFromParts({
      actorType: message.actorType,
      messageKind: message.messageKind,
      parts: [...message.parts].sort((left, right) => left.partOrder - right.partOrder),
      targetMetadata: message.targetMetadata,
      timestamp: contentTimestamp(message),
    }),
  );
}

interface MaterializedPart {
  partType?: string;
  partOrder?: number;
  content: string | Record<string, unknown>;
}

interface MaterializedRawMessageContent {
  actorType?: string;
  messageKind?: string;
  capturedAt?: string;
  parts: MaterializedPart[];
  targetMetadata?: {
    piRole?: string;
    rawType?: string;
    provider?: string;
    model?: string;
    api?: string;
    responseId?: string;
    stopReason?: string;
    toolCallId?: string;
    toolName?: string;
  };
}

export function estimateCompactedTextTokenCount(text: string): number {
  return estimateTokens({
    role: "custom",
    customType: "pi-long-horizon.compacted-content",
    content: [{ type: "text", text }],
    display: false,
    timestamp: 0,
  } as AgentMessage);
}

export function estimateMaterializedMessageTokenCount(content: string | Record<string, unknown>): number {
  if (typeof content === "string") {
    return estimateCompactedTextTokenCount(content);
  }

  if (Array.isArray(content.parts)) {
    const rawContent = content as unknown as MaterializedRawMessageContent;
    return estimateTokens(
      messageFromParts({
        actorType: rawContent.actorType,
        messageKind: rawContent.messageKind,
        parts: [...rawContent.parts].sort((left, right) => (left.partOrder ?? 0) - (right.partOrder ?? 0)),
        targetMetadata: rawContent.targetMetadata,
        timestamp: contentTimestamp({ capturedAt: rawContent.capturedAt }),
      }),
    );
  }

  return estimateCompactedTextTokenCount(JSON.stringify(content));
}
