import { ParseResult, Schema } from "effect";

export const THREAD_EVENT_SCHEMA_VERSION = "thread_event.v1" as const;

export const ThreadEventKindSchema = Schema.Literal(
  "user_prompt",
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "tool_result",
  "runtime_note",
  "unknown_activity",
);
export type ThreadEventKind = Schema.Schema.Type<typeof ThreadEventKindSchema>;

export const ActorKindSchema = Schema.Literal("user", "assistant", "tool", "runtime", "system");
export type ActorKind = Schema.Schema.Type<typeof ActorKindSchema>;

const NonEmptyStringSchema = Schema.String.pipe(Schema.nonEmptyString());

export const ActorRefSchema = Schema.Struct({
  actorKind: ActorKindSchema,
  actorId: NonEmptyStringSchema,
  displayName: Schema.optional(Schema.String),
});
export type ActorRef = Schema.Schema.Type<typeof ActorRefSchema>;

export const HarnessRefSchema = Schema.Struct({
  runtime: Schema.Literal("pi", "codex", "claude_code"),
  externalThreadId: Schema.optional(Schema.String),
});
export type HarnessRef = Schema.Schema.Type<typeof HarnessRefSchema>;

export const ThreadEventOriginSchema = Schema.Struct({
  envelopeId: NonEmptyStringSchema,
  envelopeOrder: Schema.optional(Schema.Number),
});
export type ThreadEventOrigin = Schema.Schema.Type<typeof ThreadEventOriginSchema>;

export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  ),
);
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const JsonObjectSchema = Schema.Record({ key: Schema.String, value: JsonValueSchema });
export type JsonObject = Schema.Schema.Type<typeof JsonObjectSchema>;

const BaseAppendInputFields = {
  threadId: NonEmptyStringSchema,
  idempotencyKey: NonEmptyStringSchema,
  actor: ActorRefSchema,
  harness: HarnessRefSchema,
  origin: Schema.optional(ThreadEventOriginSchema),
  occurredAt: Schema.optional(Schema.String),
} as const;

const UserPromptPayloadInputSchema = Schema.Struct({
  text: Schema.String,
});

export const UserPromptPayloadSchema = Schema.Struct({
  _tag: Schema.Literal("user_prompt"),
  text: Schema.String,
});
export type UserPromptPayload = Schema.Schema.Type<typeof UserPromptPayloadSchema>;

const AssistantTextPayloadInputSchema = Schema.Struct({
  text: Schema.String,
});

export const AssistantTextPayloadSchema = Schema.Struct({
  _tag: Schema.Literal("assistant_text"),
  text: Schema.String,
});
export type AssistantTextPayload = Schema.Schema.Type<typeof AssistantTextPayloadSchema>;

const ReasoningTextPayloadFields = {
  thinkingKind: Schema.Literal("reasoning_text"),
  text: Schema.String,
  signature: Schema.optional(Schema.String),
} as const;

const ReasoningSummaryPayloadFields = {
  thinkingKind: Schema.Literal("reasoning_summary"),
  text: Schema.String,
  signature: Schema.optional(Schema.String),
} as const;

const EncryptedReasoningPayloadFields = {
  thinkingKind: Schema.Literal("encrypted_reasoning"),
  encryptedContent: Schema.String,
  signature: Schema.optional(Schema.String),
} as const;

const RedactedReasoningPayloadFields = {
  thinkingKind: Schema.Literal("redacted_reasoning"),
  signature: Schema.optional(Schema.String),
} as const;

const AssistantThinkingPayloadInputSchema = Schema.Union(
  Schema.Struct(ReasoningTextPayloadFields),
  Schema.Struct(ReasoningSummaryPayloadFields),
  Schema.Struct(EncryptedReasoningPayloadFields),
  Schema.Struct(RedactedReasoningPayloadFields),
);

export const AssistantThinkingPayloadSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("assistant_thinking"),
    ...ReasoningTextPayloadFields,
  }),
  Schema.Struct({
    _tag: Schema.Literal("assistant_thinking"),
    ...ReasoningSummaryPayloadFields,
  }),
  Schema.Struct({
    _tag: Schema.Literal("assistant_thinking"),
    ...EncryptedReasoningPayloadFields,
  }),
  Schema.Struct({
    _tag: Schema.Literal("assistant_thinking"),
    ...RedactedReasoningPayloadFields,
  }),
);
export type AssistantThinkingPayload = Schema.Schema.Type<typeof AssistantThinkingPayloadSchema>;

const ToolCallPayloadInputSchema = Schema.Struct({
  toolCallId: NonEmptyStringSchema,
  toolName: Schema.optional(Schema.String),
  argumentsJson: Schema.optional(JsonValueSchema),
});

export const ToolCallPayloadSchema = Schema.Struct({
  _tag: Schema.Literal("tool_call"),
  toolCallId: NonEmptyStringSchema,
  toolName: Schema.optional(Schema.String),
  argumentsJson: Schema.optional(JsonValueSchema),
});
export type ToolCallPayload = Schema.Schema.Type<typeof ToolCallPayloadSchema>;

const ToolResultPayloadInputSchema = Schema.Struct({
  toolCallId: Schema.optional(NonEmptyStringSchema),
  toolName: Schema.optional(Schema.String),
  outputText: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
});

export const ToolResultPayloadSchema = Schema.Struct({
  _tag: Schema.Literal("tool_result"),
  toolCallId: Schema.optional(NonEmptyStringSchema),
  toolName: Schema.optional(Schema.String),
  outputText: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
});
export type ToolResultPayload = Schema.Schema.Type<typeof ToolResultPayloadSchema>;

const RuntimeNotePayloadInputSchema = Schema.Struct({
  text: Schema.String,
  noteKind: Schema.optional(Schema.String),
});

export const RuntimeNotePayloadSchema = Schema.Struct({
  _tag: Schema.Literal("runtime_note"),
  text: Schema.String,
  noteKind: Schema.optional(Schema.String),
});
export type RuntimeNotePayload = Schema.Schema.Type<typeof RuntimeNotePayloadSchema>;

const UnknownActivityPayloadInputSchema = Schema.Struct({
  summary: Schema.optional(Schema.String),
});

export const UnknownActivityPayloadSchema = Schema.Struct({
  _tag: Schema.Literal("unknown_activity"),
  summary: Schema.optional(Schema.String),
});
export type UnknownActivityPayload = Schema.Schema.Type<typeof UnknownActivityPayloadSchema>;

export const ThreadEventPayloadSchema = Schema.Union(
  UserPromptPayloadSchema,
  AssistantTextPayloadSchema,
  AssistantThinkingPayloadSchema,
  ToolCallPayloadSchema,
  ToolResultPayloadSchema,
  RuntimeNotePayloadSchema,
  UnknownActivityPayloadSchema,
);
export type ThreadEventPayload = Schema.Schema.Type<typeof ThreadEventPayloadSchema>;

export const ThreadEventAppendInputSchema = Schema.Union(
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("user_prompt"),
    payload: UserPromptPayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("assistant_text"),
    payload: AssistantTextPayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("assistant_thinking"),
    payload: AssistantThinkingPayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("tool_call"),
    payload: ToolCallPayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("tool_result"),
    payload: ToolResultPayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("runtime_note"),
    payload: RuntimeNotePayloadInputSchema,
  }),
  Schema.Struct({
    ...BaseAppendInputFields,
    eventKind: Schema.Literal("unknown_activity"),
    payload: UnknownActivityPayloadInputSchema,
  }),
);
export type ThreadEventAppendInput = Schema.Schema.Type<typeof ThreadEventAppendInputSchema>;

const ThreadEventAppendEnvelopeSchema = Schema.Struct({
  ...BaseAppendInputFields,
  eventKind: ThreadEventKindSchema,
  payload: JsonObjectSchema,
});

export const PersistedThreadEventSchema = Schema.Struct({
  schemaVersion: Schema.Literal(THREAD_EVENT_SCHEMA_VERSION),
  threadEventId: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  eventOrder: Schema.Number,
  idempotencyKey: NonEmptyStringSchema,
  eventKind: ThreadEventKindSchema,
  actor: ActorRefSchema,
  harness: HarnessRefSchema,
  origin: Schema.optional(ThreadEventOriginSchema),
  recordedAt: Schema.String,
  occurredAt: Schema.optional(Schema.String),
  payload: ThreadEventPayloadSchema,
});
export type PersistedThreadEvent = Schema.Schema.Type<typeof PersistedThreadEventSchema>;

/*
 * Keep append input payloads untagged for humans/CLI while persisted payloads
 * carry `_tag` for discriminated decoding.
 */
export type NormalizedThreadEventAppendInput = Omit<ThreadEventAppendInput, "payload"> & {
  payload: ThreadEventPayload;
};

export class ThreadEventValidationError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
  }
}

export function decodeThreadEventAppendInput(value: unknown): NormalizedThreadEventAppendInput {
  assertAppendInputDoesNotProvideGeneratedFields(value);
  const input = decodeOrThrow(ThreadEventAppendEnvelopeSchema, value, "Invalid thread event append input");
  return {
    ...input,
    payload: normalizePayload(input.eventKind, input.payload),
  };
}

function assertAppendInputDoesNotProvideGeneratedFields(value: unknown): void {
  if (!isJsonObject(value)) {
    return;
  }

  const generatedFields = ["schemaVersion", "threadEventId", "eventOrder", "recordedAt"]
    .filter((field) => field in value);
  if (generatedFields.length > 0) {
    throw new ThreadEventValidationError(
      `Thread event append input must not include generated field(s): ${generatedFields.join(", ")}`,
      value,
    );
  }
}

export function decodePersistedThreadEvent(value: unknown): PersistedThreadEvent {
  return decodeOrThrow(PersistedThreadEventSchema, value, "Invalid persisted thread event");
}

export function normalizePayload(eventKind: ThreadEventKind, payload: JsonObject): ThreadEventPayload {
  if ("_tag" in payload) {
    throw new ThreadEventValidationError("Thread event append payload must not include generated field: _tag", payload);
  }

  const normalized = { ...payload, _tag: eventKind };
  switch (eventKind) {
    case "user_prompt":
      return decodeOrThrow(UserPromptPayloadSchema, normalized, "Invalid user_prompt payload");
    case "assistant_text":
      return decodeOrThrow(AssistantTextPayloadSchema, normalized, "Invalid assistant_text payload");
    case "assistant_thinking":
      return decodeOrThrow(AssistantThinkingPayloadSchema, normalized, "Invalid assistant_thinking payload");
    case "tool_call":
      return decodeOrThrow(ToolCallPayloadSchema, normalized, "Invalid tool_call payload");
    case "tool_result":
      return decodeOrThrow(ToolResultPayloadSchema, normalized, "Invalid tool_result payload");
    case "runtime_note":
      return decodeOrThrow(RuntimeNotePayloadSchema, normalized, "Invalid runtime_note payload");
    case "unknown_activity":
      return decodeOrThrow(UnknownActivityPayloadSchema, normalized, "Invalid unknown_activity payload");
  }

  const unreachable: never = eventKind;
  return decodeOrThrow(
    UnknownActivityPayloadSchema,
    { _tag: "unknown_activity", summary: `Unsupported event kind: ${unreachable}` },
    "Invalid unknown_activity payload",
  );
}

function decodeOrThrow<A, I>(schema: Schema.Schema<A, I, never>, value: unknown, message: string): A {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
  } catch (error) {
    throw new ThreadEventValidationError(`${message}: ${formatParseError(error)}`, value);
  }
}

function formatParseError(error: unknown): string {
  if (ParseResult.isParseError(error)) {
    return ParseResult.TreeFormatter.formatErrorSync(error);
  }
  return error instanceof Error ? error.message : String(error);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
