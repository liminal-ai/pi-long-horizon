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
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runSmartCompact, type SmartCompactCommandDependencies } from "../../commands/smart-compact.js";
import { formatCommandResult, type CommandResult } from "../commands/command-results.js";
import {
  StewardResultError,
  createStewardIssue,
  fail,
  ok,
  type StewardIssue,
  type StewardResult,
} from "../domain/errors.js";
import type { FixtureRecord, ThreadRecord, ThreadTargetMetadata } from "../domain/records.js";
import type { CanonicalActivity, CaptureActivityResult } from "../services/capture-service.js";
import { captureFinalizedActivity, type CaptureActivityInput } from "../services/capture-service.js";
import { createRealSessionFixture } from "../services/fixture-service.js";
import { attachExistingPiSession } from "../services/import-service.js";
import { repairTurnState } from "../services/repair-service.js";
import { openOrCreateManagedThread } from "../services/thread-service.js";
import { checkTurnHealth, finalizeOpenTurnOnTurnEnd, writeCapturedMessageTurns } from "../services/turn-service.js";
import { maintainAsyncThread } from "../../thread/async-thread/services/async-thread-run-service.js";
import { PiCodexUserPromptSmoothingProvider } from "../../thread/async-thread/services/pi-codex-user-prompt-smoothing-provider.js";
import {
  UserPromptSmoothingService,
  type UserPromptSmoothingLogger,
  type UserPromptSmoothingProvider,
} from "../../thread/async-thread/services/user-prompt-smoothing-service.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import type { ThreadSnapshot, ThreadStore } from "../store/thread-store.js";
import type { SmartCompactCommandInput, SmartCompactCommandResult } from "../../thread-view/domain/pi-thread-view-file.js";
import { FileThreadViewStore } from "../../thread-view/store/file-thread-view-store.js";
import type { ThreadViewStore } from "../../thread-view/store/thread-view-store.js";
import {
  applyLiveToolResultTruncation,
  stringifyPiVisibleContentForLiveEstimate,
  type LiveToolResultTruncationOptions,
} from "../../thread-view/services/live-tool-result-truncation.js";
import { PromptVisibleToolResultProjection } from "../../thread-view/services/prompt-visible-tool-result-projection.js";
import { refreshActivePromptProjectionFile } from "../../thread-view/targets/pi/active-prompt-projection-writer.js";
import { formatCompactionAuditReport } from "../../workbench/services/compaction-report-formatter.js";
import { buildCompactionAuditReport } from "../../workbench/services/compaction-report-service.js";
import {
  formatActiveRolloutInspectionJson,
  inspectActiveThreadView,
} from "../../workbench/services/active-rollout-inspection-service.js";
import {
  formatSmoothingInspectionJson,
  inspectSmoothingStatus,
} from "../../workbench/services/smoothing-inspection-service.js";
import { mapPiMessageEnd } from "./pi-message-mapper.js";
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
type PiExtensionSwitchContext = PiExtensionCaptureContext &
  Partial<Pick<ExtensionCommandContext, "switchSession" | "ui">> &
  Partial<{
    model: ExtensionCommandContext["model"];
    getThinkingLevel: () => string;
  }>;

export interface ContextStewardExtensionOptions {
  createStore?: (ctx: PiExtensionCaptureContext) => ThreadStore;
  createThreadViewStore?: (ctx: PiExtensionCaptureContext, threadStore: ThreadStore) => ThreadViewStore;
  openAIInputTokenCounter?: SmartCompactCommandDependencies["openAIInputTokenCounter"];
  liveToolResultTruncation?: LiveToolResultTruncationOptions & { enabled?: boolean };
  userPromptSmoothing?: {
    enabled?: boolean;
    provider?: UserPromptSmoothingProvider;
    logger?: UserPromptSmoothingLogger;
  };
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

function snapshotCaptureContext(ctx: PiExtensionCaptureContext): PiExtensionCaptureContext | undefined {
  try {
    const cwd = ctx.cwd;
    const sessionId = ctx.sessionManager.getSessionId() || undefined;
    const sessionFilePath = ctx.sessionManager.getSessionFile();

    return {
      cwd,
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => sessionFilePath,
      } as PiExtensionCaptureContext["sessionManager"],
    };
  } catch (error) {
    if (isStalePiContextError(error)) {
      return undefined;
    }
    throw error;
  }
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

function targetsMatch(left: ThreadTargetMetadata, right: ThreadTargetMetadata): boolean {
  if (left.runtime !== right.runtime) {
    return false;
  }

  const leftSessionId = normalizeValue(left.sessionId);
  const rightSessionId = normalizeValue(right.sessionId);
  if (leftSessionId && rightSessionId && leftSessionId === rightSessionId) {
    return true;
  }

  const leftSessionFilePath = normalizeValue(left.sessionFilePath);
  const rightSessionFilePath = normalizeValue(right.sessionFilePath);
  return Boolean(leftSessionFilePath && rightSessionFilePath && leftSessionFilePath === rightSessionFilePath);
}

function activeLeafIdFromContext(ctx: PiExtensionCaptureContext): string | undefined {
  return ctx.sessionManager.getLeafId?.() ?? undefined;
}

function normalizePathForComparison(path: string | undefined): string | undefined {
  const normalized = normalizeValue(path);
  return normalized ? resolve(normalized) : undefined;
}

function samePath(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizePathForComparison(left);
  const normalizedRight = normalizePathForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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

function isPiTextContent(content: unknown): content is { type: "text"; text: string } {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { type?: unknown }).type === "text" &&
    typeof (content as { text?: unknown }).text === "string"
  );
}

function isPiToolResultMessage(message: AgentMessage): message is AgentMessage & {
  role: "toolResult";
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content: unknown[];
} {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "toolResult" &&
    Array.isArray((message as { content?: unknown }).content)
  );
}

function isPiCompactedBoundaryMessage(message: AgentMessage): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "custom" &&
    (message as { customType?: unknown }).customType === "pi-long-horizon.compacted-content"
  );
}

interface ActivePiSettings {
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

function modelFromUnknown(value: unknown): Pick<ActivePiSettings, "modelProvider" | "modelId"> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const model = value as { provider?: unknown; modelId?: unknown; id?: unknown };
  return {
    modelProvider: typeof model.provider === "string" ? model.provider : undefined,
    modelId:
      typeof model.modelId === "string"
        ? model.modelId
        : typeof model.id === "string"
          ? model.id
          : undefined,
  };
}

function settingsFromSessionContext(ctx: PiExtensionCaptureContext): ActivePiSettings {
  const sessionManager = ctx.sessionManager as PiExtensionCaptureContext["sessionManager"] & {
    buildSessionContext?: () => { model?: unknown; thinkingLevel?: unknown };
  };
  const sessionContext = sessionManager.buildSessionContext?.();
  if (!sessionContext) {
    return {};
  }

  return {
    ...modelFromUnknown(sessionContext.model),
    thinkingLevel: typeof sessionContext.thinkingLevel === "string" ? sessionContext.thinkingLevel : undefined,
  };
}

function settingsFromSessionBranch(ctx: PiExtensionCaptureContext): ActivePiSettings {
  const sessionManager = importSessionManagerFromContext(ctx);
  if (!sessionManager) {
    return {};
  }

  const entries = sessionManager.getBranch(activeLeafIdFromContext(ctx));
  const settings: ActivePiSettings = {};
  for (const entry of entries) {
    if (entry.type === "thinking_level_change") {
      const thinkingLevel = (entry as { thinkingLevel?: unknown }).thinkingLevel;
      if (typeof thinkingLevel === "string") {
        settings.thinkingLevel = thinkingLevel;
      }
      continue;
    }

    if (entry.type === "model_change") {
      const model = modelFromUnknown(entry);
      settings.modelProvider = model.modelProvider ?? settings.modelProvider;
      settings.modelId = model.modelId ?? settings.modelId;
      continue;
    }

    if (entry.type === "message" && "message" in entry) {
      const message = (entry as { message?: { role?: unknown; provider?: unknown; model?: unknown } }).message;
      if (message?.role === "assistant") {
        if (typeof message.provider === "string") {
          settings.modelProvider = message.provider;
        }
        if (typeof message.model === "string") {
          settings.modelId = message.model;
        }
      }
    }
  }

  return settings;
}

function resolveActivePiSettings(ctx: ExtensionCommandContext & { getThinkingLevel?: () => string }): ActivePiSettings {
  const contextSettings = settingsFromSessionContext(ctx);
  const branchSettings = settingsFromSessionBranch(ctx);
  const contextModel = modelFromUnknown(ctx.model);
  const thinkingLevel =
    contextSettings.thinkingLevel ??
    branchSettings.thinkingLevel ??
    (typeof ctx.getThinkingLevel === "function" ? ctx.getThinkingLevel() : undefined);

  return {
    modelProvider: contextSettings.modelProvider ?? branchSettings.modelProvider ?? contextModel.modelProvider,
    modelId: contextSettings.modelId ?? branchSettings.modelId ?? contextModel.modelId,
    thinkingLevel,
  };
}

function stringifyPiMessageForLiveEstimate(message: AgentMessage): string {
  if (typeof message !== "object" || message === null) {
    return String(message);
  }

  return stringifyPiVisibleContentForLiveEstimate((message as { content?: unknown }).content, message);
}

function truncatePiToolResultMessage(
  message: AgentMessage,
  truncateText: (text: string) => string,
): AgentMessage {
  if (!isPiToolResultMessage(message)) {
    return message;
  }

  let changed = false;
  const content = message.content.map((part) => {
    if (!isPiTextContent(part)) {
      return part;
    }

    const text = truncateText(part.text);
    if (text === part.text) {
      return part;
    }

    changed = true;
    return {
      ...part,
      text,
    };
  });

  return changed
    ? ({
        ...message,
        content,
      } as AgentMessage)
    : message;
}

export function truncatePiLiveContextMessages(
  messages: readonly AgentMessage[],
  options: LiveToolResultTruncationOptions = {},
): AgentMessage[] {
  return applyLiveToolResultTruncation(
    messages,
    {
      isRawZoneBoundary: isPiCompactedBoundaryMessage,
      estimateText: stringifyPiMessageForLiveEstimate,
      isEligibleToolResult: isPiToolResultMessage,
      truncateToolResult: truncatePiToolResultMessage,
    },
    options,
  ).items;
}

interface OriginalToolResultContent {
  content: unknown[];
  isError: boolean;
  toolName: string;
}

function toolResultSideChannelKey(input: {
  ctx: PiExtensionCaptureContext;
  toolCallId: string | undefined;
}): string | undefined {
  if (!input.toolCallId) {
    return undefined;
  }

  const sessionKey = input.ctx.sessionManager.getSessionId() || input.ctx.sessionManager.getSessionFile() || "unknown-session";
  return `${sessionKey}:${input.toolCallId}`;
}

function restoreOriginalToolResultMessage(input: {
  message: AgentMessage;
  ctx: PiExtensionCaptureContext;
  originals: Map<string, OriginalToolResultContent>;
}): AgentMessage {
  if (!isPiToolResultMessage(input.message)) {
    return input.message;
  }

  const key = toolResultSideChannelKey({
    ctx: input.ctx,
    toolCallId: input.message.toolCallId,
  });
  if (!key) {
    return input.message;
  }

  const original = input.originals.get(key);
  if (!original) {
    return input.message;
  }

  input.originals.delete(key);
  return {
    ...input.message,
    toolName: original.toolName,
    isError: original.isError,
    content: structuredClone(original.content),
  } as AgentMessage;
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

  return ok(undefined);
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

async function captureAndReport(input: CapturePiEventInput): Promise<StewardResult<CaptureActivityResult | undefined>> {
  const result = await capturePiEvent(input);

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

function isStewardResultErrorLike(
  error: unknown,
): error is StewardResultError | { issues: StewardIssue[] } {
  return (
    error instanceof StewardResultError ||
    (typeof error === "object" &&
      error !== null &&
      "issues" in error &&
      Array.isArray((error as { issues?: unknown }).issues))
  );
}

function isStalePiContextError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.includes("This extension ctx is stale after session replacement or reload")
  );
}

function safeContextModelId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.model?.id;
  } catch (error) {
    if (isStalePiContextError(error)) {
      return undefined;
    }
    throw error;
  }
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

function currentGeneratedRolloutFromSnapshot(snapshot: Pick<ThreadSnapshot, "thread" | "projections">): {
  projectionRevisionId?: string;
  generatedFilePath?: string;
  generatedSessionId?: string;
  threadViewId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: string;
} {
  const currentProjectionRevisionId = snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId;
  const projections = snapshot.projections as Array<{
    revisionId?: string;
    generatedFilePath?: string;
    generatedSessionId?: string;
    threadViewId?: string;
    createdAt?: string;
    status?: string;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: string;
  }>;
  const currentProjection = currentProjectionRevisionId
    ? projections.find(
        (projection) =>
          projection.revisionId === currentProjectionRevisionId &&
          projection.status === "available" &&
          normalizeValue(projection.generatedFilePath),
      )
    : undefined;
  const selectedProjection = currentProjection ?? projections
    .filter((projection) => projection.status === "available" && normalizeValue(projection.generatedFilePath))
    .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))
    .at(-1);
  if (selectedProjection?.generatedFilePath) {
    return {
      projectionRevisionId: selectedProjection.revisionId,
      ...selectedProjection,
    };
  }

  const generatedOutput = snapshot.thread.threadViewOutputSummary.generatedOutput;
  if (
    generatedOutput?.generatedFilePath &&
    (generatedOutput.status === "available" || generatedOutput.status === "degraded")
  ) {
    return {
      projectionRevisionId: generatedOutput.projectionRevisionId,
      generatedFilePath: generatedOutput.generatedFilePath,
      generatedSessionId: generatedOutput.generatedSessionId,
      threadViewId: generatedOutput.threadViewId,
      modelProvider: generatedOutput.modelProvider,
      modelId: generatedOutput.modelId,
      thinkingLevel: generatedOutput.thinkingLevel,
    };
  }

  if (
    snapshot.thread.threadViewOutputSummary.lastRevisionStatus === "available" &&
    snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath
  ) {
    return {
      projectionRevisionId: snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId,
      generatedFilePath: snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath,
      generatedSessionId: snapshot.thread.threadViewOutputSummary.currentGeneratedSessionId,
      threadViewId: snapshot.thread.threadViewOutputSummary.currentThreadViewId,
    };
  }

  return {
    generatedFilePath: snapshot.thread.target.currentGeneratedFilePath,
  };
}

async function reconcileLatestGeneratedRollout(input: {
  store: ThreadStore;
  ctx: PiExtensionSwitchContext;
  activeThread?: ThreadRecord;
  onReplacementSession?: (ctx: ExtensionCommandContext) => void | Promise<void>;
}): Promise<StewardResult<{ switched: boolean; thread?: ThreadRecord; generatedFilePath?: string }>> {
  const thread = await resolveManagedThreadForCommand(input.store, input.ctx, input.activeThread);
  if (!thread.ok) {
    return thread;
  }
  if (!thread.value) {
    return ok({ switched: false });
  }

  const snapshot = await input.store.openThread(thread.value.threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  const latestRollout = currentGeneratedRolloutFromSnapshot(snapshot.value);
  const latestGeneratedFilePath = normalizeValue(latestRollout.generatedFilePath);
  const currentSessionFile = input.ctx.sessionManager.getSessionFile();
  const currentSessionId = input.ctx.sessionManager.getSessionId() || undefined;
  const loadedProjectionRevisionId = await input.store.resolveProjectionRevisionIdMap({
    runtime: "pi",
    sessionId: currentSessionId,
    sessionFilePath: currentSessionFile,
  });
  if (!loadedProjectionRevisionId.ok) {
    return loadedProjectionRevisionId;
  }
  if (!loadedProjectionRevisionId.value) {
    return ok({ switched: false, thread: snapshot.value.thread, generatedFilePath: latestGeneratedFilePath });
  }

  const alreadyOnCurrentProjection =
    latestRollout.projectionRevisionId &&
    loadedProjectionRevisionId.value === latestRollout.projectionRevisionId &&
    (currentSessionId === latestRollout.generatedSessionId || samePath(currentSessionFile, latestGeneratedFilePath));

  if (!latestGeneratedFilePath || alreadyOnCurrentProjection) {
    return ok({ switched: false, thread: snapshot.value.thread, generatedFilePath: latestGeneratedFilePath });
  }

  if (typeof input.ctx.switchSession !== "function") {
    return ok({ switched: false, thread: snapshot.value.thread, generatedFilePath: latestGeneratedFilePath });
  }

  const switchResult = await input.ctx.switchSession(latestGeneratedFilePath, {
    withSession: async (ctx) => {
      await input.onReplacementSession?.(ctx);
    },
  });
  if (switchResult.cancelled) {
    return ok({ switched: false, thread: snapshot.value.thread, generatedFilePath: latestGeneratedFilePath });
  }

  return ok({ switched: true, thread: snapshot.value.thread, generatedFilePath: latestGeneratedFilePath });
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

function generatedSessionCountSummary(result: SmartCompactCommandResult): string {
  const metadata = result.generatedSessionTokenCountMetadata;
  if (!metadata) {
    return "";
  }

  return ` Generated-session token count: ${metadata.count} (${metadata.source}/${metadata.trustClass}).`;
}

export function commandResultFromSmartCompact(
  threadId: string,
  result: SmartCompactCommandResult,
): CommandResult {
  const countSummary = generatedSessionCountSummary(result);

  switch (result.compactStatus) {
    case "success":
      return {
        ok: true,
        title: "Smart compact",
        summary: `Generated PI session ${result.generatedFilePath} for thread ${threadId} and reloaded PI.${countSummary}`,
        issues: [],
        threadId,
      };
    case "blocked":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Thread ${threadId} is blocked before generated output could be written.${countSummary}`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "degraded":
      return {
        ok: true,
        title: "Smart compact",
        summary: result.generatedFilePath
          ? `Generated degraded PI session ${result.generatedFilePath} for thread ${threadId} and reloaded PI.${countSummary}`
          : `Generated PI session for thread ${threadId} was not written or reloaded.${countSummary}`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "write_failed":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Generated PI session output could not be written for thread ${threadId}.${countSummary}`,
        issues: cloneIssues(result.blockers),
        threadId,
      };
    case "reload_failed":
      return {
        ok: false,
        title: "Smart compact",
        summary: `Generated PI session ${result.generatedFilePath} was written for thread ${threadId}, but PI reload failed.${countSummary}`,
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
  ctx: ExtensionCommandContext;
  args: string;
  activeThread?: ThreadRecord;
  openAIInputTokenCounter?: SmartCompactCommandDependencies["openAIInputTokenCounter"];
  liveToolResultTruncation?: LiveToolResultTruncationOptions & { enabled?: boolean };
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
    const activeSettings = resolveActivePiSettings(input.ctx);
    const result = await runSmartCompact(
      {
        ...parsed.value,
        threadId: thread.value.threadId,
        modelProvider: activeSettings.modelProvider,
        modelId: activeSettings.modelId,
        thinkingLevel: activeSettings.thinkingLevel,
      },
      {
        threadStore: input.store,
        openAIInputTokenCounter: input.openAIInputTokenCounter,
        promptVisibleToolResultTruncation: input.liveToolResultTruncation,
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
    if (isStewardResultErrorLike(error)) {
      return fail(...error.issues);
    }

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

function parseCompactReportCommandArgs(args: string): StewardResult<{ threadViewId?: string }> {
  const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
  const values = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== "--thread-view") {
      return fail(invalidCommandArgsIssue(`Unknown compact report argument ${token}.`));
    }

    const value = normalizeValue(tokens[index + 1]);
    index += 1;
    if (!value) {
      return fail(invalidCommandArgsIssue("Missing value for --thread-view."));
    }

    if (values.has(token)) {
      return fail(invalidCommandArgsIssue("Duplicate compact report argument --thread-view."));
    }

    values.set(token, value);
  }

  return ok({
    threadViewId: values.get("--thread-view"),
  });
}

async function resolveMostRecentThreadViewId(input: {
  threadId: string;
  store: ThreadStore;
}): Promise<StewardResult<string | undefined>> {
  const snapshot = await input.store.openThread(input.threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  const mostRecent = [...snapshot.value.projections]
    .filter((projection) => projection.compactSnapshot)
    .sort((left, right) => {
      const createdComparison = right.createdAt.localeCompare(left.createdAt);
      if (createdComparison !== 0) {
        return createdComparison;
      }

      return right.revisionId.localeCompare(left.revisionId);
    })[0];

  return ok(mostRecent?.threadViewId ?? mostRecent?.revisionId);
}

export async function executeCompactReportCommand(input: {
  store: ThreadStore;
  threadViewStore?: ThreadViewStore;
  ctx: ExtensionCommandContext;
  args: string;
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
        title: "Compact report",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  const parsed = parseCompactReportCommandArgs(input.args);
  if (!parsed.ok) {
    return ok({
      thread: thread.value,
      result: {
        ok: false,
        title: "Compact report",
        summary: parsed.issues[0]?.message ?? "Invalid compact report arguments.",
        issues: cloneIssues(parsed.issues),
        threadId: thread.value.threadId,
      },
    });
  }

  const resolvedThreadViewId = parsed.value.threadViewId
    ? ok(parsed.value.threadViewId)
    : await resolveMostRecentThreadViewId({
        threadId: thread.value.threadId,
        store: input.store,
      });
  if (!resolvedThreadViewId.ok) {
    return resolvedThreadViewId;
  }

  if (!resolvedThreadViewId.value) {
    return ok({
      thread: thread.value,
      result: {
        ok: false,
        title: "Compact report",
        summary: `Thread ${thread.value.threadId} has no thread views to report.`,
        issues: [],
        threadId: thread.value.threadId,
      },
    });
  }

  try {
    const report = await buildCompactionAuditReport(
      {
        threadId: thread.value.threadId,
        threadViewId: resolvedThreadViewId.value,
      },
      {
        threadStore: input.store,
      },
    );

    return ok({
      thread: thread.value,
      result: {
        ok: true,
        title: "Compact report",
        summary: formatCompactionAuditReport(report),
        issues: cloneIssues(report.blockers),
        threadId: thread.value.threadId,
      },
    });
  } catch (error) {
    if (isStewardResultErrorLike(error)) {
      return fail(...error.issues);
    }

    return fail(
      createStewardIssue({
        code: "STORE_UNAVAILABLE",
        message: `Compact report failed for thread ${thread.value.threadId}.`,
        threadId: thread.value.threadId,
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function executeActiveThreadViewStatusCommand(input: {
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
        title: "Active thread view",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  try {
    const report = await inspectActiveThreadView(
      { threadId: thread.value.threadId },
      { threadStore: input.store },
    );
    return ok({
      thread: thread.value,
      result: {
        ok: true,
        title: "Active thread view",
        summary: formatActiveRolloutInspectionJson(report),
        issues: [],
        threadId: thread.value.threadId,
      },
    });
  } catch (error) {
    if (isStewardResultErrorLike(error)) {
      return fail(...error.issues);
    }
    return fail(
      createStewardIssue({
        code: "STORE_UNAVAILABLE",
        message: `Active thread view inspection failed for thread ${thread.value.threadId}.`,
        threadId: thread.value.threadId,
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function executeSmoothingStatusCommand(input: {
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
        title: "Smoothing status",
        summary: "No managed thread exists for the current PI session.",
        issues: [],
      },
    });
  }

  try {
    const report = await inspectSmoothingStatus(
      { threadId: thread.value.threadId },
      { threadStore: input.store },
    );
    return ok({
      thread: thread.value,
      result: {
        ok: true,
        title: "Smoothing status",
        summary: formatSmoothingInspectionJson(report),
        issues: [],
        threadId: thread.value.threadId,
      },
    });
  } catch (error) {
    if (isStewardResultErrorLike(error)) {
      return fail(...error.issues);
    }
    return fail(
      createStewardIssue({
        code: "STORE_UNAVAILABLE",
        message: `Smoothing status inspection failed for thread ${thread.value.threadId}.`,
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
  const userPromptSmoothingEnabled =
    options.userPromptSmoothing?.enabled ?? process.env.NODE_TEST_CONTEXT === undefined;
  const userPromptSmoothingProvider =
    options.userPromptSmoothing?.provider ?? new PiCodexUserPromptSmoothingProvider();
  const liveTruncationOptions = options.liveToolResultTruncation ?? {};
  const liveTruncationEnabled = liveTruncationOptions.enabled !== false;
  const promptProjection = new PromptVisibleToolResultProjection(liveTruncationOptions);
  const originalToolResults = new Map<string, OriginalToolResultContent>();
  let activeThread: ThreadRecord | undefined;
  let activeSessionContext: PiExtensionCaptureContext | undefined;
  let activePromptProjectionScopeKey: string | undefined;
  type BackgroundMaintenanceInput = {
    threadId: string;
    ctx: PiExtensionCaptureContext;
    tokenCountModel?: string;
  };
  type BackgroundMaintenanceState = {
    running: boolean;
    pending: boolean;
    latest: BackgroundMaintenanceInput;
  };
  const backgroundMaintenanceByThreadId = new Map<string, BackgroundMaintenanceState>();

  function logTiming(label: string, startedAt: number, parts: Record<string, unknown> = {}): void {
    const cwd = activeSessionContext?.cwd ?? process.cwd();
    const debugDir = join(cwd, ".context-steward", "debug");
    const logPath = join(debugDir, "lh-timing.log");
    const record = {
      at: new Date().toISOString(),
      label,
      totalMs: Date.now() - startedAt,
      ...parts,
    };

    void mkdir(debugDir, { recursive: true })
      .then(() => appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8"))
      .catch(() => undefined);
  }

  function promptProjectionScopeKeyFromContext(ctx: PiExtensionCaptureContext): string | undefined {
    try {
      return JSON.stringify({
        cwd: ctx.cwd,
        sessionId: ctx.sessionManager.getSessionId() || undefined,
        sessionFile: ctx.sessionManager.getSessionFile(),
      });
    } catch (error) {
      if (isStalePiContextError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  function syncPromptProjectionScope(ctx: PiExtensionCaptureContext): void {
    const scopeKey = promptProjectionScopeKeyFromContext(ctx);
    if (!scopeKey || scopeKey === activePromptProjectionScopeKey) {
      return;
    }

    promptProjection.reset();
    activePromptProjectionScopeKey = scopeKey;
  }

  async function resolveCaptureThread(
    event: PiCaptureEvent,
    ctx: PiExtensionCaptureContext,
  ): Promise<{
    store: ThreadStore;
    thread?: ThreadRecord;
  }> {
    const store = createStore(ctx);
    const target = targetFromContext(ctx);
    const existing = await store.findManagedThread(target);
    if (!existing.ok) {
      throw new Error(existing.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    if (existing.value) {
      activeThread = existing.value;
      return { store, thread: activeThread };
    }

    if (activeThread && targetsMatch(activeThread.target, target)) {
      return { store, thread: activeThread };
    }

    const shouldCreateOnMessageEnd =
      event.type === "message_end" && canAutoCreateManagedThreadForMessageEnd({ event, ctx });

    if (!shouldCreateOnMessageEnd) {
      return { store, thread: undefined };
    }

    const opened = await openOrCreateManagedThread({ target }, store);
    if (!opened.ok) {
      throw new Error(opened.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    activeThread = opened.value;
    return { store, thread: activeThread };
  }

  async function resolveExistingCaptureThread(ctx: PiExtensionCaptureContext): Promise<{
    store: ThreadStore;
    thread?: ThreadRecord;
  }> {
    const store = createStore(ctx);
    const target = targetFromContext(ctx);
    const existing = await store.findManagedThread(target);
    if (!existing.ok) {
      throw new Error(existing.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    if (existing.value) {
      activeThread = existing.value;
      return { store, thread: activeThread };
    }

    if (activeThread && targetsMatch(activeThread.target, target)) {
      return { store, thread: activeThread };
    }

    return { store, thread: undefined };
  }

  async function captureEvent(
    event: PiCaptureEvent,
    ctx: PiExtensionCaptureContext,
  ): Promise<CaptureActivityResult | undefined> {
    const startedAt = Date.now();
    let resolveMs = 0;
    let captureMs = 0;
    let threadId = "none";
    let duplicate = "n/a";
    try {
      let stepStartedAt = Date.now();
      const { store, thread } = await resolveCaptureThread(event, ctx);
      resolveMs = Date.now() - stepStartedAt;
      if (!thread) {
        return undefined;
      }

      threadId = thread.threadId;
      stepStartedAt = Date.now();
      const result = await captureAndReport({
        store,
        threadId: thread.threadId,
        event,
        ctx,
      });
      captureMs = Date.now() - stepStartedAt;

      if (!result.ok) {
        throw new Error(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
      }

      duplicate = String(result.value?.duplicate);
      return result.value;
    } finally {
      logTiming("captureEvent", startedAt, {
        event: event.type,
        resolve: `${resolveMs}ms`,
        capture: `${captureMs}ms`,
        threadId,
        duplicate,
      });
    }
  }

  function hydratePromptProjectionFromContext(ctx: PiExtensionCaptureContext): void {
    try {
      syncPromptProjectionScope(ctx);
      const sessionManager = importSessionManagerFromContext(ctx);
      if (!sessionManager) {
        return;
      }

      const activePathEntries = sessionManager.getBranch(activeLeafIdFromContext(ctx));
      promptProjection.hydrateFromMessages(
        activePathEntries
          .filter(isSessionMessageEntry)
          .map((entry) => entry.message),
      );
    } catch (error) {
      if (isStalePiContextError(error)) {
        return;
      }
      throw error;
    }
  }

  async function refreshActivePromptProjectionFromContext(input: {
    store: ThreadStore;
    thread: ThreadRecord;
    ctx: PiExtensionCaptureContext;
  }): Promise<void> {
    const startedAt = Date.now();
    let dirtyCount = 0;
    let openThreadMs = 0;
    let writeMs = 0;
    let skipped = "";
    try {
      if (!liveTruncationEnabled) {
        skipped = "disabled";
        return;
      }

      const dirtyToolCallIds = promptProjection.getDirtyToolCallIds();
      dirtyCount = dirtyToolCallIds.length;
      if (dirtyToolCallIds.length === 0) {
        skipped = "clean";
        return;
      }

      let stepStartedAt = Date.now();
      const snapshot = await input.store.openThread(input.thread.threadId);
      openThreadMs = Date.now() - stepStartedAt;
      if (!snapshot.ok) {
        skipped = "openThreadFailed";
        return;
      }

      const currentRollout = currentGeneratedRolloutFromSnapshot(snapshot.value);
      const generatedFilePath = normalizeValue(currentRollout.generatedFilePath);
      const currentSessionFile = input.ctx.sessionManager.getSessionFile();
      if (!generatedFilePath || !samePath(generatedFilePath, currentSessionFile)) {
        skipped = "notActiveFile";
        return;
      }

      const decisions = dirtyToolCallIds
        .map((toolCallId) => promptProjection.getDecision(toolCallId))
        .filter((decision): decision is NonNullable<typeof decision> => decision !== undefined);
      stepStartedAt = Date.now();
      const refreshed = await refreshActivePromptProjectionFile({
        generatedFilePath,
        decisions,
      });
      writeMs = Date.now() - stepStartedAt;
      if (refreshed.cleanableToolCallIds.length > 0) {
        promptProjection.markClean(refreshed.cleanableToolCallIds);
      }
      skipped = refreshed.updated ? "updated" : refreshed.skippedReason ?? "unchanged";
    } catch (error) {
      if (isStalePiContextError(error)) {
        skipped = "staleContext";
        return;
      }
      throw error;
    } finally {
      logTiming("refreshActivePromptProjection", startedAt, {
        dirty: dirtyCount,
        openThread: `${openThreadMs}ms`,
        write: `${writeMs}ms`,
        result: skipped,
      });
    }
  }

  async function refreshActivePromptProjectionForContext(ctx: PiExtensionCaptureContext): Promise<void> {
    try {
      syncPromptProjectionScope(ctx);
      const resolved = await resolveExistingCaptureThread(ctx);
      if (!resolved.thread) {
        return;
      }

      await refreshActivePromptProjectionFromContext({
        store: resolved.store,
        thread: resolved.thread,
        ctx,
      });
    } catch (error) {
      if (isStalePiContextError(error)) {
        return;
      }
      throw error;
    }
  }

  async function runBackgroundMaintenance(input: BackgroundMaintenanceInput): Promise<void> {
    const startedAt = Date.now();
    let result = "completed";
    try {
      await maintainAsyncThread(
        { threadId: input.threadId },
        {
          store: createStore(input.ctx),
          openAIInputTokenCounter: options.openAIInputTokenCounter,
          tokenCountModel: input.tokenCountModel,
        },
      );
    } catch (error) {
      result = "failed";
      logTiming("backgroundMaintenanceError", startedAt, {
        threadId: input.threadId,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      logTiming("backgroundMaintenanceRun", startedAt, {
        threadId: input.threadId,
        result,
      });
    }
  }

  function scheduleBackgroundMaintenance(input: BackgroundMaintenanceInput): void {
    const startedAt = Date.now();
    let state = backgroundMaintenanceByThreadId.get(input.threadId);
    if (state?.running) {
      state.pending = true;
      state.latest = input;
      logTiming("backgroundMaintenanceSchedule", startedAt, {
        threadId: input.threadId,
        result: "pending",
      });
      return;
    }

    state = {
      running: true,
      pending: false,
      latest: input,
    };
    backgroundMaintenanceByThreadId.set(input.threadId, state);
    logTiming("backgroundMaintenanceSchedule", startedAt, {
      threadId: input.threadId,
      result: "started",
    });

    void runBackgroundMaintenance(input).finally(() => {
      const latestState = backgroundMaintenanceByThreadId.get(input.threadId);
      if (!latestState) {
        return;
      }

      if (latestState.pending) {
        const next = latestState.latest;
        latestState.running = false;
        latestState.pending = false;
        scheduleBackgroundMaintenance(next);
        return;
      }

      backgroundMaintenanceByThreadId.delete(input.threadId);
    });
  }

  function scheduleUserPromptSmoothing(input: {
    ctx: PiExtensionCaptureContext;
    threadId: string;
    messageId: string;
  }): boolean {
    if (!userPromptSmoothingEnabled) {
      return false;
    }
    const service = new UserPromptSmoothingService({
      store: createStore(input.ctx),
      provider: userPromptSmoothingProvider,
      logger: options.userPromptSmoothing?.logger,
    });
    return service.schedule({
      threadId: input.threadId,
      messageId: input.messageId,
    });
  }

  const reconcileCurrentSession = async (ctx: ExtensionContext): Promise<ExtensionCommandContext | undefined> => {
    let replacementSessionContext: ExtensionCommandContext | undefined;
    try {
      if (typeof (ctx as Partial<ExtensionCommandContext>).switchSession !== "function") {
        return undefined;
      }

      const store = createStore(ctx);
      const reconciled = await reconcileLatestGeneratedRollout({
        store,
        ctx: ctx as unknown as PiExtensionSwitchContext,
        activeThread,
        onReplacementSession: async (nextCtx) => {
          replacementSessionContext = nextCtx;
          activeSessionContext = snapshotCaptureContext(nextCtx) ?? activeSessionContext;
          const refreshedStore = createStore(nextCtx);
          const refreshedThread = await resolveManagedThreadForCommand(refreshedStore, nextCtx, activeThread);
          if (refreshedThread.ok && refreshedThread.value) {
            activeThread = refreshedThread.value;
          }
          hydratePromptProjectionFromContext(nextCtx);
          await refreshActivePromptProjectionForContext(nextCtx);
        },
      });
      if (reconciled.ok && reconciled.value.thread) {
        activeThread = reconciled.value.thread;
      }
      if (!reconciled.ok) {
        ctx.ui?.notify?.(
          formatCommandResult({
            ok: false,
            title: "Resume repair",
            summary: reconciled.issues[0]?.message ?? "Could not reconcile latest generated PI session.",
            issues: cloneIssues(reconciled.issues),
          }),
          "error",
        );
      }
      return replacementSessionContext;
    } catch (error) {
      if (isStalePiContextError(error)) {
        return replacementSessionContext;
      }
      ctx.ui?.notify?.(
        formatCommandResult({
          ok: false,
          title: "Resume repair",
          summary: "Could not reconcile latest generated PI session.",
          issues: [
            createStewardIssue({
              code: "PI_RELOAD_FAILED",
              message: "PI Long Horizon could not switch to the latest generated rollout on session start.",
              cause: error instanceof Error ? error.message : String(error),
            }),
          ],
        }),
        "error",
      );
      return replacementSessionContext;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const startedAt = Date.now();
    let snapshotMs = 0;
    let reconcileMs = 0;
    let hydrateMs = 0;
    let refreshMs = 0;
    try {
      let stepStartedAt = Date.now();
      activeSessionContext = snapshotCaptureContext(ctx) ?? activeSessionContext;
      snapshotMs = Date.now() - stepStartedAt;
      stepStartedAt = Date.now();
      const replacementSessionContext = await reconcileCurrentSession(ctx);
      reconcileMs = Date.now() - stepStartedAt;
      if (replacementSessionContext) {
        return;
      }
      stepStartedAt = Date.now();
      hydratePromptProjectionFromContext(ctx);
      hydrateMs = Date.now() - stepStartedAt;
      stepStartedAt = Date.now();
      await refreshActivePromptProjectionForContext(ctx);
      refreshMs = Date.now() - stepStartedAt;
    } finally {
      logTiming("session_start", startedAt, {
        snapshot: `${snapshotMs}ms`,
        reconcile: `${reconcileMs}ms`,
        hydrate: `${hydrateMs}ms`,
        refresh: `${refreshMs}ms`,
      });
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    const startedAt = Date.now();
    let resolveMs = 0;
    let finalizeMs = 0;
    let maintenanceScheduleMs = 0;
    let refreshMs = 0;
    let threadId = "none";
    let staleFallback = false;
    try {
      let resolved: Awaited<ReturnType<typeof resolveCaptureThread>>;
      let resolvedContext: PiExtensionCaptureContext = ctx;
      try {
        const stepStartedAt = Date.now();
        resolved = await resolveCaptureThread(event, ctx);
        resolveMs = Date.now() - stepStartedAt;
      } catch (error) {
        if (isStalePiContextError(error)) {
          if (!activeSessionContext) {
            return;
          }
          staleFallback = true;
          resolvedContext = activeSessionContext;
          const stepStartedAt = Date.now();
          resolved = await resolveCaptureThread(event, activeSessionContext);
          resolveMs = Date.now() - stepStartedAt;
        } else {
          throw error;
        }
      }

      const { store, thread } = resolved;
      if (!thread) {
        return;
      }

      threadId = thread.threadId;
      let stepStartedAt = Date.now();
      const eventTimestamp = (event as { timestamp?: unknown }).timestamp;
      const finalized = await finalizeOpenTurnOnTurnEnd({
        store,
        threadId: thread.threadId,
        closedAt: typeof eventTimestamp === "number" ? new Date(eventTimestamp).toISOString() : undefined,
      });
      finalizeMs = Date.now() - stepStartedAt;
      if (!finalized.ok) {
        throw new StewardResultError(finalized.issues);
      }

      stepStartedAt = Date.now();
      await refreshActivePromptProjectionFromContext({
        store,
        thread,
        ctx: resolvedContext,
      });
      refreshMs = Date.now() - stepStartedAt;

      stepStartedAt = Date.now();
      scheduleBackgroundMaintenance({
        threadId: thread.threadId,
        ctx: snapshotCaptureContext(resolvedContext) ?? resolvedContext,
        tokenCountModel: resolvedContext === ctx ? safeContextModelId(ctx as ExtensionContext) : undefined,
      });
      maintenanceScheduleMs = Date.now() - stepStartedAt;
    } finally {
      logTiming("turn_end", startedAt, {
        resolve: `${resolveMs}ms`,
        finalize: `${finalizeMs}ms`,
        refresh: `${refreshMs}ms`,
        maintenanceSchedule: `${maintenanceScheduleMs}ms`,
        staleFallback,
        threadId,
      });
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    const startedAt = Date.now();
    let refreshMs = 0;
    try {
      const stepStartedAt = Date.now();
      await refreshActivePromptProjectionForContext(ctx);
      refreshMs = Date.now() - stepStartedAt;
    } finally {
      logTiming("agent_end", startedAt, {
        refresh: `${refreshMs}ms`,
      });
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const startedAt = Date.now();
    let captureMs = 0;
    let observeMs = 0;
    let fallback = false;
    let duplicate = "n/a";
    let smoothingScheduled = false;
    try {
      let stepStartedAt = Date.now();
      const captureResult = await captureEvent(
        {
          ...event,
          message: restoreOriginalToolResultMessage({
            message: event.message,
            ctx,
            originals: originalToolResults,
          }),
        },
        ctx,
      );
      captureMs = Date.now() - stepStartedAt;
      duplicate = String(captureResult?.duplicate);
      if (captureResult && !captureResult.duplicate && event.message.role === "user") {
        smoothingScheduled = scheduleUserPromptSmoothing({
          ctx: snapshotCaptureContext(ctx) ?? ctx,
          threadId: captureResult.message.threadId,
          messageId: captureResult.message.messageId,
        });
      }
      if (captureResult && !captureResult.duplicate && liveTruncationEnabled) {
        stepStartedAt = Date.now();
        syncPromptProjectionScope(ctx);
        promptProjection.observeMessage(event.message);
        observeMs = Date.now() - stepStartedAt;
      }
    } catch (error) {
      if (!isStalePiContextError(error) || !activeSessionContext) {
        throw error;
      }

      fallback = true;
      const stepStartedAt = Date.now();
      const captureResult = await captureEvent(
        {
          ...event,
          message: restoreOriginalToolResultMessage({
            message: event.message,
            ctx: activeSessionContext,
            originals: originalToolResults,
          }),
        },
        activeSessionContext,
      );
      captureMs += Date.now() - stepStartedAt;
      duplicate = String(captureResult?.duplicate);
      if (captureResult && !captureResult.duplicate && event.message.role === "user") {
        smoothingScheduled = scheduleUserPromptSmoothing({
          ctx: snapshotCaptureContext(activeSessionContext) ?? activeSessionContext,
          threadId: captureResult.message.threadId,
          messageId: captureResult.message.messageId,
        });
      }
      if (captureResult && !captureResult.duplicate && liveTruncationEnabled) {
        const observeStartedAt = Date.now();
        syncPromptProjectionScope(activeSessionContext);
        promptProjection.observeMessage(event.message);
        observeMs += Date.now() - observeStartedAt;
      }
    } finally {
      logTiming("message_end", startedAt, {
        capture: `${captureMs}ms`,
        observe: `${observeMs}ms`,
        fallback,
        duplicate,
        role: event.message.role,
        smoothingScheduled,
      });
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    let key: string | undefined;
    try {
      key = toolResultSideChannelKey({
        ctx,
        toolCallId: event.toolCallId,
      });
    } catch (error) {
      if (!isStalePiContextError(error) || !activeSessionContext) {
        throw error;
      }
      key = toolResultSideChannelKey({
        ctx: activeSessionContext,
        toolCallId: event.toolCallId,
      });
    }
    if (key) {
      originalToolResults.set(key, {
        content: structuredClone(event.content),
        isError: event.isError,
        toolName: event.toolName,
      });
    }
  });

  pi.on("context", async (event, ctx) => {
    const startedAt = Date.now();
    let applyMs = 0;
    let messageCount = event.messages.length;
    let staleFallback = false;
    let result = "skipped";
    if (!liveTruncationEnabled) {
      return;
    }

    try {
      try {
        syncPromptProjectionScope(ctx);
      } catch (error) {
        if (!isStalePiContextError(error) || !activeSessionContext) {
          throw error;
        }
        staleFallback = true;
        syncPromptProjectionScope(activeSessionContext);
      }
      const stepStartedAt = Date.now();
      const messages = promptProjection.applyToMessages(event.messages);
      applyMs = Date.now() - stepStartedAt;
      messageCount = messages.length;
      result = "applied";
      return {
        messages,
      };
    } catch (error) {
      if (isStalePiContextError(error)) {
        result = "staleContext";
        return;
      }
      throw error;
    } finally {
      logTiming("context", startedAt, {
        apply: `${applyMs}ms`,
        messages: messageCount,
        staleFallback,
        result,
      });
    }
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

  pi.registerCommand("lh-prompt-projection-status", {
    description: "Show live prompt-visible tool-result truncation state.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const status = promptProjection.getStatus();
      const activeFile = normalizeValue(ctx.sessionManager.getSessionFile());
      notifyCommand(ctx, {
        ok: true,
        title: "Prompt projection",
        summary: [
          `hydrated=${status.hydrated}`,
          `observed=${status.observedCount}`,
          `protected=${status.protectedMessageCount} messages/${status.protectedTokenTotal} estimated tokens`,
          `decisions=${status.decisionCount}`,
          `dirty=${status.dirtyCount}`,
          `threshold=${status.rawZoneTokenThreshold}`,
          `charLimit=${status.truncatedCharLimit}`,
          activeFile ? `activeFile=${activeFile}` : undefined,
        ].filter((part): part is string => part !== undefined).join("; "),
        issues: [],
      });
    },
  });

  pi.registerCommand("lh-active-thread-view-status", {
    description: "Inspect the active generated PI rollout as machine-readable JSON.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeActiveThreadViewStatusCommand({
        store,
        ctx,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Active thread view",
          summary: executed.issues[0]?.message ?? "Active thread view inspection failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });

  pi.registerCommand("lh-smoothing-status", {
    description: "Inspect smooth component readiness and quality as machine-readable JSON.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeSmoothingStatusCommand({
        store,
        ctx,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Smoothing status",
          summary: executed.issues[0]?.message ?? "Smoothing status inspection failed.",
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
      let replacementSessionContext: ExtensionCommandContext | undefined;
      const executed = await executeSmartCompactCommand({
        store,
        ctx,
        args,
        activeThread,
        openAIInputTokenCounter: options.openAIInputTokenCounter,
        liveToolResultTruncation: liveTruncationOptions,
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

  pi.registerCommand("lh-compact-report", {
    description: "Show a compaction audit report for the most recent thread view or --thread-view <id>.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const store = createStore(ctx);
      const executed = await executeCompactReportCommand({
        store,
        ctx,
        args,
        activeThread,
      });
      if (!executed.ok) {
        notifyCommand(ctx, {
          ok: false,
          title: "Compact report",
          summary: executed.issues[0]?.message ?? "Compact report failed.",
          issues: cloneIssues(executed.issues),
        });
        return;
      }

      notifyCommand(ctx, executed.value.result);
    },
  });
}

export default registerContextStewardExtension;
