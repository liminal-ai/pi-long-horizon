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

import { runSmartCompact } from "../../commands/smart-compact.js";
import { formatCommandResult, type CommandResult } from "../commands/command-results.js";
import { createStewardIssue, fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
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
import type { SmartCompactCommandInput, SmartCompactCommandResult } from "../../thread-view/domain/pi-thread-view-file.js";
import { FileThreadViewStore } from "../../thread-view/store/file-thread-view-store.js";
import type { ThreadViewStore } from "../../thread-view/store/thread-view-store.js";
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
  createThreadViewStore?: (ctx: PiExtensionCaptureContext, threadStore: ThreadStore) => ThreadViewStore;
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

function defaultCreateThreadViewStore(
  ctx: PiExtensionCaptureContext,
  threadStore: ThreadStore,
): ThreadViewStore {
  return new FileThreadViewStore(join(ctx.cwd, ".context-steward"), threadStore);
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizedSessionFileCandidates(target: ThreadTargetMetadata): string[] {
  return [...new Set([target.sessionFilePath, target.currentGeneratedFilePath].map(normalizeValue).filter(Boolean))] as string[];
}

function targetsMatch(left: ThreadTargetMetadata, right: ThreadTargetMetadata): boolean {
  if (left.runtime !== right.runtime) {
    return false;
  }

  const leftSessionId = normalizeValue(left.sessionId);
  const rightSessionId = normalizeValue(right.sessionId);
  if (leftSessionId && rightSessionId && leftSessionId === rightSessionId) {
    return true;
  }

  const rightSessionFiles = new Set(normalizedSessionFileCandidates(right));
  return normalizedSessionFileCandidates(left).some((sessionFilePath) => rightSessionFiles.has(sessionFilePath));
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

function isSessionMessageEntry(
  entry: ReturnType<PiImportSessionManager["getEntries"]>[number],
): entry is ReturnType<PiImportSessionManager["getEntries"]>[number] & { type: "message"; message: AgentMessage } {
  return entry.type === "message" && "message" in entry;
}

function samePiMessage(left: AgentMessage, right: AgentMessage): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canAutoCreateManagedThreadForMessageEnd(input: {
  event: Extract<PiCaptureEvent, { type: "message_end" }>;
  ctx: PiExtensionCaptureContext;
}): boolean {
  const sessionManager = importSessionManagerFromContext(input.ctx);
  if (!sessionManager) {
    return true;
  }

  const entries = sessionManager.getEntries();
  if (entries.length === 0) {
    return true;
  }

  const activeLeafId = activeLeafIdFromContext(input.ctx) ?? sessionManager.getLeafId() ?? undefined;
  if (!activeLeafId) {
    return false;
  }

  const activePathEntries = sessionManager.getBranch(activeLeafId);
  if (activePathEntries.length === 0) {
    return false;
  }

  const activePathMessages = activePathEntries.filter(isSessionMessageEntry);
  if (activePathMessages.length === 0) {
    return true;
  }

  if (activePathMessages.length > 1) {
    return false;
  }

  return samePiMessage(activePathMessages[0]!.message, input.event.message);
}

function canAutoCreateManagedThreadOnSessionStart(ctx: PiExtensionCaptureContext): boolean {
  const sessionManager = importSessionManagerFromContext(ctx);
  if (!sessionManager) {
    return true;
  }

  return sessionManager.getEntries().length === 0;
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

function invalidCommandArgsIssue(message: string): StewardIssue {
  return createStewardIssue({
    code: "INVALID_COMMAND_ARGS",
    message,
  });
}

function parseNumberArgument(rawValue: string, flag: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw invalidCommandArgsIssue(`Expected ${flag} to be a finite number, received "${rawValue}".`);
  }

  return parsed;
}

function parseSmartCompactCommandArgs(args: string): StewardResult<SmartCompactCommandInput> {
  const allowedFlags = new Set(["--lower-bound", "--full", "--smooth", "--detailed", "--brief", "--mode"]);
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return fail(
      invalidCommandArgsIssue(
        "Provide smart compact inputs as --lower-bound <tokens> --full <pct> --smooth <pct> --detailed <pct> --brief <pct> [--mode strict|prepare].",
      ),
    );
  }

  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];

    if (!flag?.startsWith("--")) {
      return fail(invalidCommandArgsIssue(`Unexpected token "${flag}". Smart compact inputs must use --flag value pairs.`));
    }

    if (!allowedFlags.has(flag)) {
      return fail(
        invalidCommandArgsIssue(
          `Unknown smart compact argument ${flag}. Expected --lower-bound, --full, --smooth, --detailed, --brief, and optional --mode.`,
        ),
      );
    }

    if (!value) {
      return fail(invalidCommandArgsIssue(`Missing value for ${flag}.`));
    }

    if (values.has(flag)) {
      return fail(invalidCommandArgsIssue(`Duplicate smart compact argument ${flag}.`));
    }

    values.set(flag, value);
  }

  const requiredFlags = ["--lower-bound", "--full", "--smooth", "--detailed", "--brief"] as const;
  const missingFlags = requiredFlags.filter((flag) => !values.has(flag));
  if (missingFlags.length > 0) {
    return fail(
      invalidCommandArgsIssue(`Missing required smart compact inputs: ${missingFlags.join(", ")}.`),
    );
  }

  try {
    const mode = values.get("--mode") ?? "strict";
    if (mode !== "strict" && mode !== "prepare") {
      return fail(
        invalidCommandArgsIssue(`Invalid value for --mode: "${mode}". Expected "strict" or "prepare".`),
      );
    }

    return ok({
      threadId: "",
      requestedLowerBound: parseNumberArgument(values.get("--lower-bound")!, "--lower-bound"),
      requestedBandPercentages: {
        fullFidelity: parseNumberArgument(values.get("--full")!, "--full"),
        smooth: parseNumberArgument(values.get("--smooth")!, "--smooth"),
        detailed: parseNumberArgument(values.get("--detailed")!, "--detailed"),
        brief: parseNumberArgument(values.get("--brief")!, "--brief"),
      },
      mode,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "INVALID_COMMAND_ARGS") {
      return fail(error as StewardIssue);
    }

    throw error;
  }
}

function commandResultFromSmartCompact(
  threadId: string,
  result: SmartCompactCommandResult,
): CommandResult {
  switch (result.compactStatus) {
    case "success":
      return {
        ok: true,
        title: "Smart compact",
        summary: `Generated PI session ${result.generatedFilePath} for thread ${threadId} and reloaded PI.`,
        issues: [],
        threadId,
      };
    case "blocked":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Thread ${threadId} is blocked before generated output could be written.`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "degraded":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Thread ${threadId} rebuilt a degraded draft and stopped before reload.`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "write_failed":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Generated PI session output could not be written for thread ${threadId}.`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "reload_failed":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Generated PI session ${result.generatedFilePath} was written for thread ${threadId}, but PI reload failed.`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
  }
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
    activeLeafId: activeLeafIdFromContext(input.ctx),
    sessionManager: importSessionManagerFromContext(input.ctx),
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

export async function executeSmartCompactCommand(input: {
  store: ThreadStore;
  threadViewStore: ThreadViewStore;
  ctx: ExtensionCommandContext;
  args: string;
  activeThread?: ThreadRecord;
  onReplacementSession?: (ctx: ExtensionCommandContext) => void | Promise<void>;
}): Promise<StewardResult<ContextStewardCommandExecutionResult>> {
  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }

  if (!thread.value) {
    return ok({
      result: {
        ok: false,
        title: "Smart compact",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  const parsed = parseSmartCompactCommandArgs(input.args);
  if (!parsed.ok) {
    return ok({
      thread: thread.value,
      result: {
        ok: false,
        title: "Smart compact",
        summary: parsed.issues[0]?.message ?? "Invalid smart compact arguments.",
        issues: cloneIssues(parsed.issues),
        threadId: thread.value.threadId,
      },
    });
  }

  try {
    const result = await runSmartCompact(
      {
        ...parsed.value,
        threadId: thread.value.threadId,
      },
      {
        threadStore: input.store,
        threadViewStore: input.threadViewStore,
        piSessionSwitch: {
          currentSessionFile: () => input.ctx.sessionManager.getSessionFile(),
          switchSession: (sessionPath) =>
            input.ctx.switchSession(sessionPath, {
              withSession: async (ctx) => {
                await input.onReplacementSession?.(ctx);
              },
            }),
        },
      },
    );

    return ok({
      thread: thread.value,
      result: commandResultFromSmartCompact(thread.value.threadId, result),
    });
  } catch (error) {
    return fail(
      createStewardIssue({
        code: "STORE_UNAVAILABLE",
        message: `Smart compact failed for thread ${thread.value.threadId}.`,
        threadId: thread.value.threadId,
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export function registerContextStewardExtension(
  pi: ExtensionAPI,
  options: ContextStewardExtensionOptions = {},
): void {
  const createStore = options.createStore ?? defaultCreateStore;
  const createThreadViewStore = options.createThreadViewStore ?? defaultCreateThreadViewStore;
  let activeThread: ThreadRecord | undefined;

  async function resolveCaptureThread(
    event: PiCaptureEvent,
    ctx: PiExtensionCaptureContext,
  ): Promise<{
    store: ThreadStore;
    thread?: ThreadRecord;
  }> {
    const store = createStore(ctx);
    const target = targetFromContext(ctx);
    if (activeThread && targetsMatch(activeThread.target, target)) {
      return { store, thread: activeThread };
    }

    const existing = await store.findManagedThread(target);
    if (!existing.ok) {
      throw new Error(existing.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    if (existing.value) {
      activeThread = existing.value;
      return { store, thread: activeThread };
    }

    const shouldCreateOnSessionStart =
      event.type === "session_start" && canAutoCreateManagedThreadOnSessionStart(ctx);
    const shouldCreateOnMessageEnd =
      event.type === "message_end" && canAutoCreateManagedThreadForMessageEnd({ event, ctx });

    if (!shouldCreateOnSessionStart && !shouldCreateOnMessageEnd) {
      return { store, thread: undefined };
    }

    const opened = await openOrCreateManagedThread({ target }, store);
    if (!opened.ok) {
      throw new Error(opened.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    activeThread = opened.value;
    return { store, thread: activeThread };
  }

  async function captureEvent(event: PiCaptureEvent, ctx: PiExtensionCaptureContext): Promise<void> {
    const { store, thread } = await resolveCaptureThread(event, ctx);
    if (!thread) {
      return;
    }

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

  pi.registerCommand("lh-smart-compact", {
    description:
      "Run manual smart compact with explicit inputs: --lower-bound <tokens> --full <pct> --smooth <pct> --detailed <pct> --brief <pct> [--mode strict|prepare].",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const threadViewStore = createThreadViewStore(ctx, store);
      let replacementSessionContext: ExtensionCommandContext | undefined;
      const executed = await executeSmartCompactCommand({
        store,
        threadViewStore,
        ctx,
        args,
        activeThread,
        onReplacementSession: async (nextCtx) => {
          replacementSessionContext = nextCtx;
        },
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Smart compact",
          summary: executed.issues[0]?.message ?? "Smart compact failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      if (executed.value.thread) {
        const refreshedThread = await store.openThread(executed.value.thread.threadId);
        if (refreshedThread.ok) {
          activeThread = refreshedThread.value.thread;
        } else {
          activeThread = executed.value.thread;
        }
      }

      if (executed.value.result.ok && replacementSessionContext) {
        notifyCommand(replacementSessionContext, executed.value.result);
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });
}

export default registerContextStewardExtension;
