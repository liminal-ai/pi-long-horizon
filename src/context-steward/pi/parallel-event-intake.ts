import { createHash } from "node:crypto";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  ThreadEventStore,
  type AppendThreadEventsInput,
  type AppendThreadEventKind,
  type AppendThreadEventsResult,
  type ThreadEventAppendInput,
} from "../../../packages/lh-context/src/index.js";
import { countLocalTokens } from "../../../packages/lh-context/src/token-counting/local-token-counter.js";
import type { FinalizeOpenTurnResult } from "../services/turn-service.js";
import type { ThreadStore } from "../store/thread-store.js";
import type { ThreadRecord } from "../domain/records.js";

interface PiParallelEventIntakeContext {
  cwd: string;
  sessionManager: {
    getSessionId: () => string | undefined;
    getSessionFile: () => string | undefined;
  };
}

export interface ParallelEventIntakeLogger {
  warn: (message: string, details?: Record<string, unknown>) => void;
}

export interface ParallelEventIntakeStoreFactoryInput {
  eventDbPath: string;
}

export type ParallelEventIntakeStoreFactory = (input: ParallelEventIntakeStoreFactoryInput) => ThreadEventStore;

export interface ParallelEventIntakeBaseInput {
  store: Pick<ThreadStore, "resolveThreadDbPath">;
  thread: ThreadRecord;
  ctx: PiParallelEventIntakeContext;
  now?: () => Date;
  logger?: ParallelEventIntakeLogger;
  threadEventStoreFactory?: ParallelEventIntakeStoreFactory;
}

export interface ParallelEventIntakeMessageEndInput extends ParallelEventIntakeBaseInput {
  event: {
    type: "message_end";
    message: AgentMessage;
  };
}

export interface ParallelEventIntakeTurnEndInput extends ParallelEventIntakeBaseInput {
  event: {
    type: "turn_end";
    timestamp?: unknown;
  };
  finalized?: FinalizeOpenTurnResult;
}

export type ParallelEventIntakeResult =
  | {
      ok: true;
      skipped?: false;
      eventDbPath: string;
      appendResult?: AppendThreadEventsResult;
      processedTriggerIds?: string[];
    }
  | {
      ok: true;
      skipped: true;
      reason: "no_canonical_events";
    }
  | {
      ok: false;
      threadId: string;
      eventType: string;
      cause: string;
      reason?: "thread_db_path_unavailable";
    };

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };

type MutableJsonObject = { [key: string]: JsonValue };

function defaultStoreFactory(input: ParallelEventIntakeStoreFactoryInput): ThreadEventStore {
  return new ThreadEventStore({
    eventDbPath: input.eventDbPath,
    worker: {
      lowerBandProjectionTokenCounter: {
        async countTurnLowerBandProjection(turnInput) {
          return { count: countLocalTokens(turnInput.text) };
        },
      },
    },
  });
}

function loggerFor(input: { logger?: ParallelEventIntakeLogger }): ParallelEventIntakeLogger {
  return input.logger ?? console;
}

function causeText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logParallelEventIntakeFailure(input: {
  logger?: ParallelEventIntakeLogger;
  threadId: string;
  eventType: string;
  cause: unknown;
  reason?: string;
}): void {
  loggerFor(input).warn("parallel event intake failed", {
    threadId: input.threadId,
    eventType: input.eventType,
    cause: causeText(input.cause),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sanitizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJson(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeJson(entry)]),
    );
  }
  return String(value);
}

function sessionIdentity(ctx: PiParallelEventIntakeContext): string {
  return ctx.sessionManager.getSessionId() || ctx.sessionManager.getSessionFile() || "unknown-session";
}

function messageOccurredAt(message: AgentMessage): string | undefined {
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function messageIdentity(message: AgentMessage, ctx: PiParallelEventIntakeContext): string {
  const session = sessionIdentity(ctx);
  if (message.role === "assistant" && typeof message.responseId === "string" && message.responseId.length > 0) {
    return `${session}:assistant:${message.responseId}`;
  }
  if (message.role === "toolResult" && typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
    return `${session}:tool-result:${message.toolCallId}:${(message as { timestamp?: unknown }).timestamp ?? "unknown-time"}`;
  }
  return `${session}:${message.role}:${(message as { timestamp?: unknown }).timestamp ?? "unknown-time"}:${stableHash(message)}`;
}

function eventBase(input: {
  thread: ThreadRecord;
  ctx: PiParallelEventIntakeContext;
  message: AgentMessage;
  blockIndex?: number;
  kind: AppendThreadEventKind;
}) {
  const messageId = messageIdentity(input.message, input.ctx);
  const blockSuffix = input.blockIndex === undefined ? "message" : `block:${input.blockIndex + 1}`;
  const envelopeId = `pi:${messageId}:${blockSuffix}:${input.kind}`;
  return {
    idempotencyKey: `parallel-event-intake:${envelopeId}`,
    harness: {
      runtime: "pi" as const,
      externalThreadId: input.thread.threadId,
    },
    origin: {
      envelopeId,
      envelopeOrder: input.blockIndex === undefined ? undefined : input.blockIndex + 1,
    },
    occurredAt: messageOccurredAt(input.message),
  };
}

function actorForMessage(message: AgentMessage) {
  switch (message.role) {
    case "user":
      return { actorKind: "user" as const, actorId: "pi-user", displayName: "PI User" };
    case "assistant":
      return { actorKind: "assistant" as const, actorId: "pi-assistant", displayName: "PI Agent" };
    case "toolResult":
      return {
        actorKind: "tool" as const,
        actorId: message.toolName || "pi-tool",
        displayName: message.toolName || "PI Tool",
      };
    default:
      return { actorKind: "runtime" as const, actorId: "pi-runtime", displayName: "PI Runtime" };
  }
}

function textFromUserContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return "";
}

function toolResultOutputText(content: unknown): string | undefined {
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter((entry) => entry.length > 0)
      .join("\n");
    return text || undefined;
  }
  if (typeof content === "string") {
    return content;
  }
  return undefined;
}

function runtimeNoteForUnsupported(input: {
  thread: ThreadRecord;
  ctx: PiParallelEventIntakeContext;
  message: AgentMessage;
  blockIndex?: number;
  text: string;
  metadata?: MutableJsonObject;
}): ThreadEventAppendInput {
  return {
    ...eventBase({
      thread: input.thread,
      ctx: input.ctx,
      message: input.message,
      blockIndex: input.blockIndex,
      kind: "runtime_note",
    }),
    eventKind: "runtime_note",
    actor: actorForMessage(input.message),
    payload: {
      text: input.text,
      systemKind: "runtime_error",
      metadata: input.metadata,
    },
  };
}

export function mapPiMessageEndToThreadEvents(input: {
  thread: ThreadRecord;
  ctx: PiParallelEventIntakeContext;
  message: AgentMessage;
}): ThreadEventAppendInput[] {
  const { thread, ctx, message } = input;
  if (message.role === "user") {
    return [{
      ...eventBase({ thread, ctx, message, kind: "user_prompt" }),
      eventKind: "user_prompt",
      actor: actorForMessage(message),
      payload: { text: textFromUserContent(message.content) },
    }];
  }

  if (message.role === "assistant") {
    const events: ThreadEventAppendInput[] = [];
    for (const [index, part] of (message.content as readonly unknown[]).entries()) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        events.push({
          ...eventBase({ thread, ctx, message, blockIndex: index, kind: "assistant_text" }),
          eventKind: "assistant_text",
          actor: actorForMessage(message),
          payload: { text: String((part as { text?: unknown }).text ?? "") },
        });
        continue;
      }
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "thinking") {
        const thinking = part as { thinking?: unknown; thinkingSignature?: unknown };
        events.push({
          ...eventBase({ thread, ctx, message, blockIndex: index, kind: "assistant_thinking" }),
          eventKind: "assistant_thinking",
          actor: actorForMessage(message),
          payload: {
            thinkingKind: "reasoning",
            text: String(thinking.thinking ?? ""),
            signature: typeof thinking.thinkingSignature === "string" ? thinking.thinkingSignature : undefined,
          },
        });
        continue;
      }
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall") {
        const toolCall = part as { id?: unknown; name?: unknown; arguments?: unknown };
        const toolCallId = typeof toolCall.id === "string" && toolCall.id.length > 0
          ? toolCall.id
          : `tool-call-${stableHash({ message: messageIdentity(message, ctx), index })}`;
        events.push({
          ...eventBase({ thread, ctx, message, blockIndex: index, kind: "tool_call" }),
          eventKind: "tool_call",
          actor: actorForMessage(message),
          payload: {
            toolCallId,
            toolName: typeof toolCall.name === "string" ? toolCall.name : undefined,
            argumentsJson: sanitizeJson(toolCall.arguments),
          },
        });
        continue;
      }
      events.push(runtimeNoteForUnsupported({
        thread,
        ctx,
        message,
        blockIndex: index,
        text: `Unsupported PI assistant content part for parallel event intake: ${String((part as { type?: unknown })?.type ?? "unknown")}`,
        metadata: { rawType: String((part as { type?: unknown })?.type ?? "unknown") },
      }));
    }
    return events;
  }

  if (message.role === "toolResult") {
    return [{
      ...eventBase({ thread, ctx, message, kind: "tool_result" }),
      eventKind: "tool_result",
      actor: actorForMessage(message),
      payload: {
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        outputText: toolResultOutputText(message.content),
        isError: message.isError,
      },
    }];
  }

  return [runtimeNoteForUnsupported({
    thread,
    ctx,
    message,
    text: `Unsupported PI message role for parallel event intake: ${String((message as { role?: unknown }).role ?? "unknown")}`,
    metadata: { rawRole: String((message as { role?: unknown }).role ?? "unknown") },
  })];
}

function markerMetadata(input: ParallelEventIntakeBaseInput, timestamp: string): JsonObject {
  return {
    managedThreadId: input.thread.threadId,
    sourceRevisionAtStart: input.thread.sourceRevision,
    currentGeneratedFilePathAtStart: input.thread.threadViewOutputSummary.currentGeneratedFilePath ?? null,
    timestamp,
  };
}

async function ensureParallelEventIntakeThread(input: ParallelEventIntakeBaseInput & { eventStore: ThreadEventStore }) {
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  await input.eventStore.createThread({
    clientThreadId: input.thread.threadId,
    title: input.thread.target.sessionId ?? input.thread.target.sessionFilePath ?? input.thread.threadId,
    harness: {
      runtime: "pi",
      externalThreadId: input.thread.threadId,
    },
    occurredAt: input.thread.createdAt,
  });

  await input.eventStore.appendMany(input.thread.threadId, [{
    idempotencyKey: `parallel-event-intake:start:${input.thread.threadId}`,
    eventKind: "runtime_note",
    actor: { actorKind: "runtime", actorId: "parallel-event-intake", displayName: "Parallel event intake" },
    harness: {
      runtime: "pi",
      externalThreadId: input.thread.threadId,
    },
    origin: {
      envelopeId: `parallel-event-intake:start:${input.thread.threadId}`,
    },
    occurredAt: timestamp,
    payload: {
      text: "Parallel event intake started.",
      systemKind: "lifecycle",
      metadata: markerMetadata(input, timestamp),
    },
  }]);
}

async function withParallelEventIntakeStore<T>(input: ParallelEventIntakeBaseInput & {
  eventType: string;
  body: (eventStore: ThreadEventStore, eventDbPath: string) => Promise<T>;
}): Promise<T | ParallelEventIntakeResult> {
  const eventDbPath = input.store.resolveThreadDbPath?.(input.thread.threadId);
  if (!eventDbPath) {
    const cause = "SQLite thread DB path unavailable for parallel event intake";
    logParallelEventIntakeFailure({
      logger: input.logger,
      threadId: input.thread.threadId,
      eventType: input.eventType,
      cause,
      reason: "thread_db_path_unavailable",
    });
    return {
      ok: false,
      threadId: input.thread.threadId,
      eventType: input.eventType,
      cause,
      reason: "thread_db_path_unavailable",
    };
  }

  const eventStore = (input.threadEventStoreFactory ?? defaultStoreFactory)({ eventDbPath });
  try {
    await ensureParallelEventIntakeThread({ ...input, eventStore });
    return await input.body(eventStore, eventDbPath);
  } finally {
    eventStore.close();
  }
}

export async function recordParallelEventIntakeMessageEnd(
  input: ParallelEventIntakeMessageEndInput,
): Promise<ParallelEventIntakeResult> {
  try {
    const events = mapPiMessageEndToThreadEvents({
      thread: input.thread,
      ctx: input.ctx,
      message: input.event.message,
    });
    if (events.length === 0) {
      return { ok: true, skipped: true, reason: "no_canonical_events" };
    }

    const result = await withParallelEventIntakeStore({
      ...input,
      eventType: "message_end",
      async body(eventStore, eventDbPath) {
        const appendResult = await eventStore.appendMany({
          clientThreadId: input.thread.threadId,
          events,
        } satisfies AppendThreadEventsInput);
        return { ok: true as const, eventDbPath, appendResult };
      },
    });
    return result as ParallelEventIntakeResult;
  } catch (error) {
    logParallelEventIntakeFailure({
      logger: input.logger,
      threadId: input.thread.threadId,
      eventType: "message_end",
      cause: error,
    });
    return { ok: false, threadId: input.thread.threadId, eventType: "message_end", cause: causeText(error) };
  }
}

export async function recordParallelEventIntakeTurnEnd(
  input: ParallelEventIntakeTurnEndInput,
): Promise<ParallelEventIntakeResult> {
  try {
    const eventTimestamp = input.event.timestamp;
    const occurredAt = typeof eventTimestamp === "number" && Number.isFinite(eventTimestamp)
      ? new Date(eventTimestamp).toISOString()
      : undefined;
    const session = sessionIdentity(input.ctx);
    const turnIdentity = input.finalized?.finalizedTurnId
      ? `turn:${input.finalized.finalizedTurnId}`
      : `event:${session}:${occurredAt ?? "unknown-time"}:${input.thread.sourceRevision}`;

    const result = await withParallelEventIntakeStore({
      ...input,
      eventType: "turn_end",
      async body(eventStore, eventDbPath) {
        const appendResult = await eventStore.appendMany(input.thread.threadId, [{
          idempotencyKey: `parallel-event-intake:turn-end:${input.thread.threadId}:${turnIdentity}`,
          eventKind: "turn_end",
          actor: { actorKind: "runtime", actorId: "pi-runtime", displayName: "PI Runtime" },
          harness: {
            runtime: "pi",
            externalThreadId: input.thread.threadId,
          },
          origin: {
            envelopeId: `parallel-event-intake:turn-end:${input.thread.threadId}:${turnIdentity}`,
          },
          occurredAt,
          payload: {},
        }]);
        const processedTriggerIds: string[] = [];
        for (const item of appendResult.results) {
          if (item.ok && "event" in item && item.trigger && !item.duplicate) {
            await eventStore.processTurnEndTrigger(item.trigger.triggerId);
            processedTriggerIds.push(item.trigger.triggerId);
          }
        }
        return { ok: true as const, eventDbPath, appendResult, processedTriggerIds };
      },
    });
    return result as ParallelEventIntakeResult;
  } catch (error) {
    logParallelEventIntakeFailure({
      logger: input.logger,
      threadId: input.thread.threadId,
      eventType: "turn_end",
      cause: error,
    });
    return { ok: false, threadId: input.thread.threadId, eventType: "turn_end", cause: causeText(error) };
  }
}
