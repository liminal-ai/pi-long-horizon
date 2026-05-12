import type {
  PiThreadViewEntry,
  WritePiThreadViewFileInput,
} from "../thread-view/domain/pi-thread-view-file.js";
import { createMaterializedRepresentationHash } from "./materialized-representation-counter.js";

export interface OpenAIResponsesInputTextContent {
  type: "input_text";
  text: string;
}

export interface OpenAIResponsesOutputTextContent {
  type: "output_text";
  text: string;
  annotations: [];
}

export interface OpenAIResponsesInputMessage {
  type: "message";
  role: "user" | "system" | "developer";
  content: OpenAIResponsesInputTextContent[];
}

export interface OpenAIResponsesOutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  status: "completed";
  content: OpenAIResponsesOutputTextContent[];
}

export interface OpenAIResponsesFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
  status?: "completed";
}

export interface OpenAIResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
  status?: "completed";
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesInputMessage
  | OpenAIResponsesOutputMessage
  | OpenAIResponsesFunctionCall
  | OpenAIResponsesFunctionCallOutput;

export interface OpenAIResponsesInputTokenCountRequest {
  model: string;
  input: OpenAIResponsesInputItem[];
  truncation: "disabled";
}

export interface OpenAIResponsesGeneratedSessionConversion {
  request: OpenAIResponsesInputTokenCountRequest;
  representationHash: string;
  excluded: Array<{
    entryIndex: number;
    reason: string;
  }>;
}

export interface ConvertGeneratedSessionToOpenAIResponsesInputOptions {
  model?: string;
}

function stableNormalize(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [entryKey, stableNormalize(entryValue)]),
    );
  }

  return String(value);
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }

  return JSON.stringify(value);
}

function structuredParts(content: string | Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  if (!isRecord(content) || !Array.isArray(content.parts)) {
    return undefined;
  }

  return content.parts.filter(isRecord);
}

function extractRawMessage(content: string | Record<string, unknown>): Record<string, unknown> | undefined {
  const parts = structuredParts(content);
  if (!parts) {
    return undefined;
  }

  for (const part of parts) {
    const partContent = part.content;
    if (isRecord(partContent) && isRecord(partContent.raw)) {
      return structuredClone(partContent.raw);
    }
  }

  return undefined;
}

function contentToInputText(content: string | Record<string, unknown>): OpenAIResponsesInputTextContent[] {
  const rawMessage = extractRawMessage(content);
  if (rawMessage?.role === "custom") {
    const rawContent = rawMessage.content;
    const rawContentParts = Array.isArray(rawContent) ? rawContent : [rawContent];
    return rawContentParts.map((part) => ({ type: "input_text", text: textFromUnknown(part) }));
  }

  const parts = structuredParts(content);
  if (!parts) {
    return [{ type: "input_text", text: textFromUnknown(content) }];
  }

  return parts
    .filter((part) => part.partType !== "tool_call")
    .map((part) => ({ type: "input_text", text: textFromUnknown(part.content) }));
}

function extractToolCallId(partContent: unknown, metadata: Record<string, unknown> | undefined): string | undefined {
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

function extractToolName(partContent: unknown, metadata: Record<string, unknown> | undefined): string {
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
    : "generated_tool_call";
}

function extractToolArguments(partContent: unknown): string {
  if (!isRecord(partContent)) {
    return "{}";
  }

  if (typeof partContent.arguments === "string") {
    return partContent.arguments;
  }

  if (isRecord(partContent.arguments)) {
    return stableJsonStringify(partContent.arguments);
  }

  return "{}";
}

function entryText(entry: PiThreadViewEntry): string {
  return contentToInputText(entry.content)
    .map((content) => content.text)
    .join("\n");
}

function assistantItems(entry: PiThreadViewEntry, index: number): OpenAIResponsesInputItem[] {
  const parts = structuredParts(entry.content);
  const outputText: OpenAIResponsesOutputTextContent[] = [];
  const toolCalls: OpenAIResponsesFunctionCall[] = [];

  if (!parts) {
    outputText.push({ type: "output_text", text: textFromUnknown(entry.content), annotations: [] });
  } else {
    for (const [partIndex, part] of parts.entries()) {
      const partType = typeof part.partType === "string" ? part.partType : "text";

      if (partType === "tool_call") {
        const callId = extractToolCallId(part.content, entry.metadata);
        if (!callId) {
          throw new Error("Assistant tool_call part is missing a tool call ID.");
        }

        toolCalls.push({
          type: "function_call",
          id: `fc_generated_${index + 1}_${partIndex + 1}`,
          call_id: callId,
          name: extractToolName(part.content, entry.metadata),
          arguments: extractToolArguments(part.content),
          status: "completed",
        });
        continue;
      }

      if (partType === "reasoning") {
        continue;
      }

      outputText.push({ type: "output_text", text: textFromUnknown(part.content), annotations: [] });
    }
  }

  return [
    ...(outputText.length > 0
      ? [
          {
            type: "message" as const,
            id: `msg_generated_${index + 1}`,
            role: "assistant" as const,
            status: "completed" as const,
            content: outputText,
          },
        ]
      : []),
    ...toolCalls,
  ];
}

function toolResultItem(entry: PiThreadViewEntry): OpenAIResponsesFunctionCallOutput {
  const toolCallId = entry.metadata?.toolCallId;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new Error("Tool result entry is missing metadata.toolCallId.");
  }

  return {
    type: "function_call_output",
    call_id: toolCallId,
    output: entryText(entry),
    status: "completed",
  };
}

function entryToItems(entry: PiThreadViewEntry, index: number): OpenAIResponsesInputItem[] {
  if (entry.generatedSource !== "raw_turn_message") {
    return [
      {
        type: "message",
        role: "user",
        content: contentToInputText(entry.content),
      },
    ];
  }

  if (entry.role === "assistant") {
    return assistantItems(entry, index);
  }

  if (entry.role === "toolResult") {
    return [toolResultItem(entry)];
  }

  return [
    {
      type: "message",
      role: "user",
      content: contentToInputText(entry.content),
    },
  ];
}

export function convertGeneratedSessionToOpenAIResponsesInput(
  input: WritePiThreadViewFileInput,
  options: ConvertGeneratedSessionToOpenAIResponsesInputOptions = {},
): OpenAIResponsesGeneratedSessionConversion {
  const model = options.model ?? input.file.modelId;
  if (!model) {
    throw new Error("OpenAI Responses input token count requires a model.");
  }

  const excluded: OpenAIResponsesGeneratedSessionConversion["excluded"] = [];
  const items = input.file.entries.flatMap((entry, index) => {
    const converted = entryToItems(entry, index);
    if (converted.length === 0) {
      excluded.push({ entryIndex: index, reason: "Entry has no OpenAI model-visible content." });
    }
    return converted;
  });
  const request: OpenAIResponsesInputTokenCountRequest = {
    model,
    input: items,
    truncation: "disabled",
  };

  return {
    request,
    representationHash: createMaterializedRepresentationHash(request),
    excluded,
  };
}
