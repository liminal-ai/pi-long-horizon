import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

import { ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { createContentFingerprint, createPartId, createStableId } from "../domain/ids.js";
import type {
  ActorRecord,
  MessageKind,
  MessageRecord,
  PartRecord,
  PiTargetMetadata,
} from "../domain/records.js";
import type { CanonicalActivity } from "../services/capture-service.js";
import type { TokenCountRecord } from "../../token-accounting/token-count-metadata.js";
import { createProviderUsageTelemetryTokenCountRecord } from "../../token-accounting/token-count-metadata.js";

type PiExtensionContext = Pick<ExtensionContext, "cwd" | "sessionManager">;

type PiFileReferenceContent = {
  type: "file" | "fileRef";
  path?: string;
  uri?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export interface PiMessageEndInput {
  message: AgentMessage;
  ctx: PiExtensionContext;
  imported?: boolean;
  sessionEntryId?: string;
}

function messageTimestampToIso(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function isTextContent(content: unknown): content is TextContent {
  return typeof content === "object" && content !== null && (content as { type?: unknown }).type === "text";
}

function isThinkingContent(content: unknown): content is ThinkingContent {
  return typeof content === "object" && content !== null && (content as { type?: unknown }).type === "thinking";
}

function isToolCall(content: unknown): content is ToolCall {
  return typeof content === "object" && content !== null && (content as { type?: unknown }).type === "toolCall";
}

function isImageContent(content: unknown): content is ImageContent {
  return typeof content === "object" && content !== null && (content as { type?: unknown }).type === "image";
}

function isFileReferenceContent(content: unknown): content is PiFileReferenceContent {
  if (typeof content !== "object" || content === null) {
    return false;
  }

  const type = (content as { type?: unknown }).type;
  return type === "file" || type === "fileRef";
}

function makeActorRecord(message: AgentMessage): ActorRecord {
  switch (message.role) {
    case "user":
      return {
        actorId: createStableId("actor", { runtime: "pi", role: "user" }),
        actorType: "human",
        displayName: "PI User",
        targetMetadata: {
          runtime: "pi",
          piRole: message.role,
        },
      };
    case "assistant":
      return {
        actorId: createStableId("actor", {
          runtime: "pi",
          role: "assistant",
          provider: message.provider,
          model: message.model,
        }),
        actorType: "agent",
        displayName: "PI Agent",
        targetMetadata: {
          runtime: "pi",
          piRole: message.role,
          provider: message.provider,
          model: message.model,
          responseId: message.responseId,
        },
      };
    case "toolResult":
      return {
        actorId: createStableId("actor", {
          runtime: "pi",
          role: "toolResult",
          toolName: message.toolName,
        }),
        actorType: "tool",
        displayName: message.toolName,
        targetMetadata: {
          runtime: "pi",
          piRole: message.role,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
        },
      };
    default:
      return {
        actorId: createStableId("actor", {
          runtime: "pi",
          role: "runtime",
          rawType: message.role,
        }),
        actorType: "runtime",
        displayName: "PI Runtime",
        targetMetadata: {
          runtime: "pi",
          rawType: message.role,
        },
      };
  }
}

function sessionIdentityFromMetadata(metadata: PiTargetMetadata): string {
  return metadata.sessionId ?? metadata.sessionFilePath ?? "unknown-session";
}

function createTargetEventKey(message: AgentMessage, metadata: PiTargetMetadata): string {
  const sessionKey = sessionIdentityFromMetadata(metadata);

  if (metadata.sessionEntryId) {
    return `pi:${sessionKey}:entry:${metadata.sessionEntryId}`;
  }

  if (message.role === "assistant" && message.responseId) {
    return `pi:${sessionKey}:assistant:${message.responseId}`;
  }

  if (message.role === "toolResult" && message.toolCallId) {
    return `pi:${sessionKey}:tool-result:${message.toolCallId}:${message.timestamp}`;
  }

  const fingerprint = createContentFingerprint({
    role: message.role,
    timestamp: "timestamp" in message ? message.timestamp : undefined,
    message,
  }).slice(0, 16);

  return `pi:${sessionKey}:${message.role}:${"timestamp" in message ? message.timestamp : "unknown"}:${fingerprint}`;
}

function makeTargetMetadata(input: PiMessageEndInput): PiTargetMetadata {
  const sessionId = input.ctx.sessionManager.getSessionId() || undefined;
  const sessionFilePath = input.ctx.sessionManager.getSessionFile();
  const metadata: PiTargetMetadata = {
    runtime: "pi",
    sessionId,
    sessionFilePath,
    sessionEntryId: input.sessionEntryId,
    imported: input.imported,
    rawType: input.message.role,
  };

  if (input.message.role === "assistant") {
    metadata.piRole = input.message.role;
    metadata.provider = input.message.provider;
    metadata.api = input.message.api;
    metadata.model = input.message.model;
    metadata.responseId = input.message.responseId;
    metadata.stopReason = input.message.stopReason;
  } else if (input.message.role === "toolResult") {
    metadata.piRole = input.message.role;
    metadata.toolCallId = input.message.toolCallId;
    metadata.toolName = input.message.toolName;
  } else if (input.message.role === "user") {
    metadata.piRole = input.message.role;
  }

  metadata.targetEventKey = createTargetEventKey(input.message, metadata);
  return metadata;
}

function isProviderUsageTotalTokens(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function omitUndefinedProperties<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as T;
}

function makeProviderUsageTelemetry(
  message: AssistantMessage,
): MessageRecord["tokenTelemetry"] | undefined {
  const rawUsage = (message as { usage?: unknown }).usage;
  if (typeof rawUsage !== "object" || rawUsage === null) {
    return undefined;
  }

  const usage = structuredClone(rawUsage) as Record<string, unknown>;
  const capturedAt = messageTimestampToIso(message.timestamp) ?? new Date().toISOString();
  const totalTokens = usage.totalTokens;
  const tokenCountResult = isProviderUsageTotalTokens(totalTokens)
    ? createProviderUsageTelemetryTokenCountRecord({
        count: totalTokens,
        source: "provider_usage",
        trustClass: "provider_reported",
        provider: message.provider,
        model: message.model,
        createdAt: capturedAt,
        note: "PI assistant message usage.totalTokens; provider usage telemetry only.",
      })
    : undefined;
  const tokenCountRecord: TokenCountRecord | undefined = tokenCountResult?.ok
    ? omitUndefinedProperties(tokenCountResult.value)
    : undefined;

  const providerUsage = omitUndefinedProperties({
    source: "pi_assistant_message_usage" as const,
    provider: message.provider,
    model: message.model,
    api: message.api,
    responseId: message.responseId,
    responseModel: message.responseModel,
    stopReason: message.stopReason,
    usage,
    tokenCountRecord,
    capturedAt,
  });

  return {
    providerUsage,
  };
}

function messageKindForPiMessage(message: Message): MessageKind {
  switch (message.role) {
    case "user":
      return "prompt";
    case "assistant":
      return "response";
    case "toolResult":
      return "tool_result";
  }
}

function textPartContent(content: TextContent): PartRecord["content"] {
  return content.textSignature ? { text: content.text, textSignature: content.textSignature } : content.text;
}

function buildPart(partOrder: number, partType: PartRecord["partType"], content: PartRecord["content"]): PartRecord {
  return {
    partId: createPartId(),
    partOrder,
    partType,
    content,
  };
}

function unknownPartIssue(rawType: string | undefined): StewardIssue {
  return {
    code: "UNMAPPED_PART_TYPE",
    message: `PI content part type ${rawType ?? "unknown"} could not be mapped canonically.`,
  };
}

function mapUserContentParts(message: UserMessage): { parts: PartRecord[]; issues: StewardIssue[] } {
  if (typeof message.content === "string") {
    return {
      parts: [buildPart(1, "text", message.content)],
      issues: [],
    };
  }

  const parts: PartRecord[] = [];
  const issues: StewardIssue[] = [];

  for (const [index, rawContent] of (message.content as readonly unknown[]).entries()) {
    if (isTextContent(rawContent)) {
      parts.push(buildPart(index + 1, "text", textPartContent(rawContent)));
      continue;
    }

    if (isImageContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "image_ref", {
          data: rawContent.data,
          mimeType: rawContent.mimeType,
        }),
      );
      continue;
    }

    if (isFileReferenceContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "file_ref", {
          path: rawContent.path,
          uri: rawContent.uri,
          mimeType: rawContent.mimeType,
        }),
      );
      continue;
    }

    issues.push(unknownPartIssue((rawContent as { type?: string }).type));
    parts.push(buildPart(index + 1, "unknown", { raw: structuredClone(rawContent) }));
  }

  return { parts, issues };
}

function mapAssistantContentParts(message: AssistantMessage): { parts: PartRecord[]; issues: StewardIssue[] } {
  const parts: PartRecord[] = [];
  const issues: StewardIssue[] = [];

  for (const [index, rawContent] of (message.content as readonly unknown[]).entries()) {
    if (isTextContent(rawContent)) {
      parts.push(buildPart(index + 1, "text", textPartContent(rawContent)));
      continue;
    }

    if (isThinkingContent(rawContent)) {
      const reasoningContent: Record<string, unknown> = {};
      if (rawContent.thinking.length > 0) {
        reasoningContent.text = rawContent.thinking;
      }
      if (rawContent.thinkingSignature) {
        reasoningContent.thinkingSignature = rawContent.thinkingSignature;
      }
      if (rawContent.redacted) {
        reasoningContent.redacted = true;
      }
      parts.push(buildPart(index + 1, "reasoning", reasoningContent));
      continue;
    }

    if (isToolCall(rawContent)) {
      parts.push(
        buildPart(index + 1, "tool_call", {
          id: rawContent.id,
          name: rawContent.name,
          arguments: structuredClone(rawContent.arguments),
          thoughtSignature: rawContent.thoughtSignature,
        }),
      );
      continue;
    }

    if (isImageContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "image_ref", {
          data: rawContent.data,
          mimeType: rawContent.mimeType,
        }),
      );
      continue;
    }

    if (isFileReferenceContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "file_ref", {
          path: rawContent.path,
          uri: rawContent.uri,
          mimeType: rawContent.mimeType,
        }),
      );
      continue;
    }

    issues.push(unknownPartIssue((rawContent as { type?: string }).type));
    parts.push(buildPart(index + 1, "unknown", { raw: structuredClone(rawContent) }));
  }

  return { parts, issues };
}

function mapToolResultParts(message: ToolResultMessage): { parts: PartRecord[]; issues: StewardIssue[] } {
  const parts: PartRecord[] = [];
  const issues: StewardIssue[] = [];

  for (const [index, rawContent] of (message.content as readonly unknown[]).entries()) {
    if (isTextContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "tool_result", {
          output: rawContent.text,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          textSignature: rawContent.textSignature,
        }),
      );
      continue;
    }

    if (isImageContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "image_ref", {
          data: rawContent.data,
          mimeType: rawContent.mimeType,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
        }),
      );
      continue;
    }

    if (isFileReferenceContent(rawContent)) {
      parts.push(
        buildPart(index + 1, "file_ref", {
          path: rawContent.path,
          uri: rawContent.uri,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
        }),
      );
      continue;
    }

    issues.push(unknownPartIssue((rawContent as { type?: string }).type));
    parts.push(buildPart(index + 1, "unknown", { raw: structuredClone(rawContent) }));
  }

  return { parts, issues };
}

function mapParts(message: Message): { parts: PartRecord[]; issues: StewardIssue[] } {
  switch (message.role) {
    case "user":
      return mapUserContentParts(message);
    case "assistant":
      return mapAssistantContentParts(message);
    case "toolResult":
      return mapToolResultParts(message);
  }
}

export function mapPiMessageEnd(input: PiMessageEndInput): StewardResult<CanonicalActivity> {
  if (input.message.role !== "user" && input.message.role !== "assistant" && input.message.role !== "toolResult") {
    const rawType = (input.message as { role?: string }).role ?? "unknown";
    const targetMetadata: PiTargetMetadata = {
      runtime: "pi",
      sessionId: input.ctx.sessionManager.getSessionId() || undefined,
      sessionFilePath: input.ctx.sessionManager.getSessionFile(),
      rawType,
      imported: input.imported,
      sessionEntryId: input.sessionEntryId,
    };

    return ok(
      {
        actor: makeActorRecord(input.message),
        messageKind: "unknown",
        createdAt: "timestamp" in input.message ? messageTimestampToIso(input.message.timestamp) : undefined,
        parts: [buildPart(1, "unknown", { raw: structuredClone(input.message) })],
        targetMetadata,
        targetEventKey: createContentFingerprint(input.message),
      },
      [unknownPartIssue(rawType)],
    );
  }

  const targetMetadata = makeTargetMetadata(input);
  const parts = mapParts(input.message);

  return ok(
    {
      actor: makeActorRecord(input.message),
      messageKind: messageKindForPiMessage(input.message),
      createdAt: messageTimestampToIso(input.message.timestamp),
      parts: parts.parts,
      targetMetadata,
      targetEventKey: targetMetadata.targetEventKey,
      tokenTelemetry: input.message.role === "assistant" ? makeProviderUsageTelemetry(input.message) : undefined,
    },
    parts.issues,
  );
}
