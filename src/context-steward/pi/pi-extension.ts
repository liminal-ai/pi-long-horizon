import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import { formatCommandResult, type CommandResult } from "../commands/command-results.js";
import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import type { FixtureRecord, ThreadRecord, ThreadTargetMetadata } from "../domain/records.js";
import type { CanonicalActivity, CaptureActivityResult } from "../services/capture-service.js";
import { captureFinalizedActivity, type CaptureActivityInput } from "../services/capture-service.js";
import { createRealSessionFixture } from "../services/fixture-service.js";
import { attachExistingPiSession } from "../services/import-service.js";
import { repairTurnState } from "../services/repair-service.js";
import { openOrCreateManagedThread } from "../services/thread-service.js";
import { checkTurnHealth, writeCapturedMessageTurns } from "../services/turn-service.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import type { ThreadStore } from "../store/thread-store.js";
import { createPiRuntimeNoteActivity, mapPiMessageEnd } from "./pi-message-mapper.js";
import type { PiImportSessionManager } from "./pi-session-importer.js";

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

export interface ContextStewardCommandExecutionResult {
  result: CommandResult;
  thread?: ThreadRecord;
  fixture?: FixtureRecord;
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

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function targetsMatch(left: ThreadTargetMetadata, right: ThreadTargetMetadata): boolean {
  return (
    left.runtime === right.runtime &&
    normalizeValue(left.sessionId) === normalizeValue(right.sessionId) &&
    normalizeValue(left.sessionFilePath) === normalizeValue(right.sessionFilePath)
  );
}

function activeLeafIdFromContext(ctx: PiExtensionCaptureContext): string | undefined {
  return ctx.sessionManager.getLeafId?.() ?? undefined;
}

function importSessionManagerFromContext(ctx: PiExtensionCaptureContext): PiImportSessionManager | undefined {
  const manager = ctx.sessionManager;
  if (
    typeof manager.getBranch === "function" &&
    typeof manager.getEntries === "function" &&
    typeof manager.getLeafId === "function" &&
    typeof manager.getSessionFile === "function" &&
    typeof manager.getSessionId === "function"
  ) {
    return manager as PiImportSessionManager;
  }

  return undefined;
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

function cloneIssues(issues: readonly StewardIssue[] | undefined): StewardIssue[] {
  return (issues ?? []).map((issue) => ({
    ...issue,
    sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
  }));
}

function notifyCommand(ctx: ExtensionCommandContext, result: CommandResult): void {
  ctx.ui.notify(formatCommandResult(result), result.ok ? "info" : "error");
}

function missingCommandIssue(code: StewardIssue["code"], message: string): StewardIssue {
  return {
    code,
    message,
  };
}

async function resolveManagedThreadForCommand(
  store: ThreadStore,
  ctx: PiExtensionCaptureContext,
  activeThread: ThreadRecord | undefined,
): Promise<StewardResult<ThreadRecord | undefined>> {
  const target = targetFromContext(ctx);
  if (target.sessionId || target.sessionFilePath) {
    const existing = await store.findManagedThread(target);
    if (!existing.ok) {
      return existing;
    }

    if (existing.value) {
      return existing;
    }
  }

  if (activeThread && targetsMatch(activeThread.target, target)) {
    return ok(activeThread);
  }

  return ok(undefined);
}

function statusSummary(thread: ThreadRecord, messageCount: number, turnCount: number): string {
  return `Thread ${thread.threadId} has ${messageCount} messages, ${turnCount} turns, and turn state ${thread.status.turnState}.`;
}

export async function executeAttachCommand(input: {
  store: ThreadStore;
  ctx: ExtensionCommandContext;
  args: string;
  now?: () => Date;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const sessionFilePath = normalizeValue(input.args) ?? normalizeValue(input.ctx.sessionManager.getSessionFile());
  if (!sessionFilePath) {
    return fail(missingCommandIssue("IMPORT_SOURCE_UNREADABLE", "No PI session file is available to attach."));
  }

  const attached = await attachExistingPiSession({
    store: input.store,
    target: targetFromContext(input.ctx),
    sessionFilePath,
    now: input.now,
  });
  if (!attached.ok) {
    return attached;
  }

  return ok({
    thread: attached.value.thread,
    result: {
      ok: true,
      title: "Attach complete",
      summary: `Imported ${attached.value.importedMessages} messages into thread ${attached.value.thread.threadId}.`,
      issues: cloneIssues(attached.issues),
      threadId: attached.value.thread.threadId,
    },
  });
}

export async function executeTurnHealthCommand(input: {
  store: ThreadStore;
  ctx: ExtensionCommandContext;
  activeThread?: ThreadRecord;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }

  if (!thread.value) {
    return ok({
      result: {
        ok: false,
        title: "Turn health",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  const snapshot = await input.store.openThread(thread.value.threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  const health = checkTurnHealth(snapshot.value);

  return ok({
    thread: thread.value,
    result: {
      ok: health.status === "ready",
      title: "Turn health",
      summary:
        health.status === "ready"
          ? `Thread ${thread.value.threadId} is ready.`
          : `Thread ${thread.value.threadId} is ${health.status} across ${health.uncoveredRanges.length} uncovered ranges.`,
      issues: cloneIssues(health.issues),
      threadId: thread.value.threadId,
    },
  });
}

export async function executeRepairTurnsCommand(input: {
  store: ThreadStore;
  ctx: ExtensionCommandContext;
  activeThread?: ThreadRecord;
  now?: () => Date;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }

  if (!thread.value) {
    return ok({
      result: {
        ok: false,
        title: "Turn repair",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  const repaired = await repairTurnState({
    store: input.store,
    threadId: thread.value.threadId,
    now: input.now,
  });
  if (!repaired.ok) {
    return repaired;
  }

  return ok({
    thread: thread.value,
    result: {
      ok: repaired.value.health.status === "ready",
      title: "Turn repair",
      summary: `Rebuilt ${repaired.value.turns.length} turns for thread ${thread.value.threadId}; health is ${repaired.value.health.status}.`,
      issues: cloneIssues(repaired.issues),
      threadId: thread.value.threadId,
    },
  });
}

export async function executeFixtureCommand(input: {
  store: ThreadStore;
  ctx: ExtensionCommandContext;
  args: string;
  activeThread?: ThreadRecord;
  now?: () => Date;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const tokens = input.args
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const sourceMode = tokens[0]?.toLowerCase() ?? "managed-thread";

  if (sourceMode === "pi-session" || sourceMode === "pi_session" || sourceMode === "pi") {
    const sessionFilePath = tokens.slice(1).join(" ").trim() || input.ctx.sessionManager.getSessionFile();
    if (!sessionFilePath) {
      return ok({
        result: {
          ok: false,
          title: "Fixture",
          summary: "No PI session file is available for fixture creation.",
          issues: [missingCommandIssue("FIXTURE_CREATE_FAILED", "No PI session file is available for fixture creation.")],
        },
      });
    }

    const created = await createRealSessionFixture({
      store: input.store,
      source: {
        type: "pi_session",
        sessionFilePath,
        sessionId: input.ctx.sessionManager.getSessionId() || undefined,
        activeLeafId: activeLeafIdFromContext(input.ctx),
        sessionManager: importSessionManagerFromContext(input.ctx),
      },
      now: input.now,
    });
    if (!created.ok) {
      return created;
    }

    return ok({
      fixture: created.value,
      result: {
        ok: true,
        title: "Fixture created",
        summary: `Created fixture ${created.value.fixtureId} from PI session ${sessionFilePath}.`,
        issues: cloneIssues(created.issues),
        fixtureId: created.value.fixtureId,
      },
    });
  }

  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }

  if (!thread.value) {
    return ok({
      result: {
        ok: false,
        title: "Fixture",
        summary: "No managed thread exists for the current PI session.",
        issues: [missingCommandIssue("FIXTURE_CREATE_FAILED", "No managed thread exists for the current PI session.")],
      },
    });
  }

  const created = await createRealSessionFixture({
    store: input.store,
    source: {
      type: "managed_thread",
      threadId: thread.value.threadId,
    },
    now: input.now,
  });
  if (!created.ok) {
    return created;
  }

  return ok({
    thread: thread.value,
    fixture: created.value,
    result: {
      ok: true,
      title: "Fixture created",
      summary: `Created fixture ${created.value.fixtureId} from thread ${thread.value.threadId}.`,
      issues: cloneIssues(created.issues),
      threadId: thread.value.threadId,
      fixtureId: created.value.fixtureId,
    },
  });
}

export async function executeStatusCommand(input: {
  store: ThreadStore;
  ctx: ExtensionCommandContext;
  activeThread?: ThreadRecord;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }

  if (!thread.value) {
    return ok({
      result: {
        ok: true,
        title: "Status",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  const snapshot = await input.store.openThread(thread.value.threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  return ok({
    thread: thread.value,
    result: {
      ok: true,
      title: "Status",
      summary: statusSummary(thread.value, snapshot.value.messages.length, snapshot.value.turns.length),
      issues: [],
      threadId: thread.value.threadId,
    },
  });
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
    const target = targetFromContext(ctx);
    if (activeThread && targetsMatch(activeThread.target, target)) {
      return { store, thread: activeThread };
    }

    const opened = await openOrCreateManagedThread({ target }, store);
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

  if (typeof pi.registerCommand !== "function") {
    return;
  }

  pi.registerCommand("lh-attach", {
    description: "Attach an unmanaged PI session into a managed Thread.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeAttachCommand({
        store,
        ctx,
        args,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Attach",
          summary: executed.issues[0]?.message ?? "Attach failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      if (executed.value.thread) {
        activeThread = executed.value.thread;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });

  pi.registerCommand("lh-turn-health", {
    description: "Report prompt-bounded turn health for the current managed Thread.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeTurnHealthCommand({
        store,
        ctx,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Turn health",
          summary: executed.issues[0]?.message ?? "Turn health failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });

  pi.registerCommand("lh-repair-turns", {
    description: "Rebuild prompt-bounded turn state from captured source messages.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeRepairTurnsCommand({
        store,
        ctx,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Turn repair",
          summary: executed.issues[0]?.message ?? "Turn repair failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });

  pi.registerCommand("lh-fixture", {
    description: "Create a real-session fixture from the current managed Thread or PI session.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeFixtureCommand({
        store,
        ctx,
        args,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Fixture",
          summary: executed.issues[0]?.message ?? "Fixture creation failed.",
          issues: cloneIssues(executed.issues),
          fixtureId: executed.issues[0]?.code === "FIXTURE_CREATE_FAILED" ? undefined : undefined,
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });

  pi.registerCommand("lh-status", {
    description: "Show the current managed Thread id and turn-state status.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeStatusCommand({
        store,
        ctx,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Status",
          summary: executed.issues[0]?.message ?? "Status failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });
}

export default registerContextStewardExtension;
