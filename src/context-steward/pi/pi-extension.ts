import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import { ok, type StewardResult } from "../domain/errors.js";
import type { ThreadRecord, ThreadTargetMetadata } from "../domain/records.js";
import type { CanonicalActivity, CaptureActivityResult } from "../services/capture-service.js";
import { captureFinalizedActivity, type CaptureActivityInput } from "../services/capture-service.js";
import { openOrCreateManagedThread } from "../services/thread-service.js";
import { writeCapturedMessageTurns } from "../services/turn-service.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import type { ThreadStore } from "../store/thread-store.js";
import { createPiRuntimeNoteActivity, mapPiMessageEnd } from "./pi-message-mapper.js";

type PiCaptureEvent =
  | {
      type: "message_end";
      message: AgentMessage;
    }
  | SessionStartEvent
  | SessionBeforeSwitchEvent
  | SessionShutdownEvent
  | TurnStartEvent
  | TurnEndEvent
  | {
      type:
        | "message_start"
        | "message_update"
        | "tool_execution_start"
        | "tool_execution_update"
        | "tool_execution_end";
      [key: string]: unknown;
    };

type PiExtensionCaptureContext = Pick<ExtensionContext, "cwd" | "sessionManager">;

export interface ContextStewardExtensionOptions {
  createStore?: (ctx: PiExtensionCaptureContext) => ThreadStore;
}

export interface MapPiCaptureEventInput {
  event: PiCaptureEvent;
  ctx: PiExtensionCaptureContext;
}

export interface CapturePiEventInput extends Omit<CaptureActivityInput, "activity"> {
  event: PiCaptureEvent;
  ctx: PiExtensionCaptureContext;
}

function targetFromContext(ctx: PiExtensionCaptureContext): ThreadTargetMetadata {
  return {
    runtime: "pi",
    sessionId: ctx.sessionManager.getSessionId() || undefined,
    sessionFilePath: ctx.sessionManager.getSessionFile(),
    cwd: ctx.cwd,
  };
}

function defaultCreateStore(ctx: PiExtensionCaptureContext): ThreadStore {
  return new FileThreadStore(join(ctx.cwd, ".context-steward"));
}

function eventTimestampToIso(event: PiCaptureEvent): string | undefined {
  if ("timestamp" in event && typeof event.timestamp === "number" && Number.isFinite(event.timestamp)) {
    return new Date(event.timestamp).toISOString();
  }

  return undefined;
}

function runtimeNoteForEvent(event: PiCaptureEvent): Record<string, unknown> | undefined {
  switch (event.type) {
    case "session_start":
      return {
        event: event.type,
        reason: event.reason,
        previousSessionFile: event.previousSessionFile,
      };
    case "session_before_switch":
      return {
        event: event.type,
        reason: event.reason,
        targetSessionFile: event.targetSessionFile,
      };
    case "session_shutdown":
      return {
        event: event.type,
        reason: event.reason,
        targetSessionFile: event.targetSessionFile,
      };
    case "turn_start":
      return {
        event: event.type,
        turnIndex: event.turnIndex,
      };
    case "turn_end":
      return {
        event: event.type,
        turnIndex: event.turnIndex,
        finalizedMessageRole: event.message.role,
        toolResultCount: event.toolResults.length,
      };
    default:
      return undefined;
  }
}

export function mapPiCaptureEventToActivity(
  input: MapPiCaptureEventInput,
): StewardResult<CanonicalActivity | undefined> {
  if (input.event.type === "message_end") {
    return mapPiMessageEnd({
      message: input.event.message,
      ctx: input.ctx,
    });
  }

  const runtimeNote = runtimeNoteForEvent(input.event);
  if (!runtimeNote) {
    return ok(undefined);
  }

  return ok(createPiRuntimeNoteActivity({
    ctx: input.ctx,
    note: runtimeNote,
    createdAt: eventTimestampToIso(input.event),
    metadata: {
      rawType: input.event.type,
    },
  }));
}

export async function capturePiEvent(
  input: CapturePiEventInput,
): Promise<StewardResult<CaptureActivityResult | undefined>> {
  const activity = mapPiCaptureEventToActivity({
    event: input.event,
    ctx: input.ctx,
  });
  if (!activity.ok) {
    return activity;
  }

  if (!activity.value) {
    return ok(undefined, activity.issues);
  }

  return captureFinalizedActivity({
    store: input.store,
    threadId: input.threadId,
    activity: activity.value,
    turnWriter: input.turnWriter ?? writeCapturedMessageTurns,
  });
}

async function captureRuntimeStatus(input: {
  store: ThreadStore;
  threadId: string;
  ctx: PiExtensionCaptureContext;
  note: Record<string, unknown>;
}): Promise<void> {
  await captureFinalizedActivity({
    store: input.store,
    threadId: input.threadId,
    activity: createPiRuntimeNoteActivity({
      ctx: input.ctx,
      note: input.note,
      metadata: {
        rawType: "capture_status",
      },
    }),
    turnWriter: writeCapturedMessageTurns,
  });
}

async function captureAndReport(input: CapturePiEventInput): Promise<StewardResult<CaptureActivityResult | undefined>> {
  const result = await capturePiEvent(input);
  const issues = result.ok ? (result.issues ?? []) : result.issues;
  const shouldCaptureStatus =
    issues.length > 0 &&
    !(result.ok && result.value?.duplicate === true) &&
    input.event.type !== "session_shutdown";

  if (shouldCaptureStatus) {
    await captureRuntimeStatus({
      store: input.store,
      threadId: input.threadId,
      ctx: input.ctx,
      note: {
        event: "capture_status",
        sourceEvent: input.event.type,
        ok: result.ok,
        issues: issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          cause: issue.cause,
        })),
      },
    });
  }

  return result;
}

export function registerContextStewardExtension(
  pi: ExtensionAPI,
  options: ContextStewardExtensionOptions = {},
): void {
  const createStore = options.createStore ?? defaultCreateStore;
  let activeThread: ThreadRecord | undefined;

  async function ensureActiveThread(ctx: PiExtensionCaptureContext): Promise<{
    store: ThreadStore;
    thread: ThreadRecord;
  }> {
    const store = createStore(ctx);
    if (activeThread) {
      return { store, thread: activeThread };
    }

    const opened = await openOrCreateManagedThread({ target: targetFromContext(ctx) }, store);
    if (!opened.ok) {
      throw new Error(opened.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    activeThread = opened.value;
    return { store, thread: activeThread };
  }

  async function captureEvent(event: PiCaptureEvent, ctx: PiExtensionCaptureContext): Promise<void> {
    const { store, thread } = await ensureActiveThread(ctx);
    const result = await captureAndReport({
      store,
      threadId: thread.threadId,
      event,
      ctx,
    });

    if (!result.ok) {
      throw new Error(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }
  }

  pi.on("session_start", async (event, ctx) => {
    await captureEvent(event, ctx);
  });

  pi.on("session_before_switch", async (event, ctx) => {
    await captureEvent(event, ctx);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await captureEvent(event, ctx);
  });

  pi.on("turn_start", async (event, ctx) => {
    await captureEvent(event, ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    await captureEvent(event, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    await captureEvent(event, ctx);
  });
}

export default registerContextStewardExtension;
