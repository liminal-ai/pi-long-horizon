import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { MessageRecord, TurnRecord, TurnSmoothComponentRecord } from "../../domain/records.js";
import type { ThreadSnapshot, ThreadStore } from "../../store/thread-store.js";
import { fail, ok, StewardResultError, type StewardResult } from "../../domain/errors.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import {
  SMOOTH_TURN_SCHEMA_VERSION,
  normalizeDeterministicText,
  type SmoothTurnState,
  toTurnSmoothRecord,
} from "../domain/smooth-turn-state.js";

export const USER_PROMPT_SMOOTHING_PROMPT_VERSION = "user_prompt_smoothing_v1" as const;

export interface UserPromptSmoothingProviderInput {
  threadId: string;
  turnId: string;
  messageId: string;
  rawText: string;
  sourceRevision: number;
  promptVersion: typeof USER_PROMPT_SMOOTHING_PROMPT_VERSION;
}

export interface UserPromptSmoothingProviderOutput {
  text: string;
  providerId: "openai-codex";
  modelId: "gpt-5.4-mini";
  reasoningEffort: "none";
  promptVersion: typeof USER_PROMPT_SMOOTHING_PROMPT_VERSION;
  usage?: Record<string, unknown>;
  elapsedMs: number;
  generatedAt: string;
}

export interface UserPromptSmoothingProvider {
  smoothUserPrompt(input: UserPromptSmoothingProviderInput): Promise<UserPromptSmoothingProviderOutput>;
}

export interface UserPromptSmoothingLogger {
  error(message: string, details?: Record<string, unknown>): void;
  debug?(message: string, details?: Record<string, unknown>): void;
}

export interface UserPromptSmoothingServiceOptions {
  store: ThreadStore;
  provider: UserPromptSmoothingProvider;
  now?: () => Date;
  logger?: UserPromptSmoothingLogger;
  maxAttempts?: number;
  shouldSkip?: (input: UserPromptSmoothingProviderInput) => boolean;
}

export interface ScheduleUserPromptSmoothingInput {
  threadId: string;
  messageId: string;
}

const inFlight = new Set<string>();

function inFlightKey(input: ScheduleUserPromptSmoothingInput): string {
  return `${input.threadId}:${input.messageId}`;
}

function defaultLogger(): UserPromptSmoothingLogger {
  return {
    error(message, details) {
      const rendered = details ? `${message} ${JSON.stringify(details)}` : message;
      console.error(rendered);
      const debugDir = join(process.cwd(), ".context-steward", "debug");
      const logPath = join(debugDir, "user-prompt-smoothing.log");
      void mkdir(debugDir, { recursive: true })
        .then(() => appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), level: "error", message, ...details })}\n`, "utf8"))
        .catch(() => undefined);
    },
    debug(message, details) {
      const debugDir = join(process.cwd(), ".context-steward", "debug");
      const logPath = join(debugDir, "user-prompt-smoothing.log");
      void mkdir(debugDir, { recursive: true })
        .then(() => appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), level: "debug", message, ...details })}\n`, "utf8"))
        .catch(() => undefined);
    },
  };
}

function findMessage(snapshot: ThreadSnapshot, messageId: string): MessageRecord | undefined {
  return snapshot.messages.find((message) => message.messageId === messageId);
}

function findTurnForMessage(snapshot: ThreadSnapshot, messageId: string): TurnRecord | undefined {
  return snapshot.turns.find((turn) => turn.messageIds.includes(messageId));
}

function readRawPromptText(message: MessageRecord): string {
  return message.parts
    .filter((part) => part.partType === "text")
    .sort((left, right) => left.partOrder - right.partOrder)
    .map((part) => (typeof part.content === "string" ? part.content : JSON.stringify(part.content)))
    .join("\n");
}

function componentId(turnId: string, message: MessageRecord): string {
  const partIds = message.parts
    .filter((part) => part.partType === "text")
    .sort((left, right) => left.partOrder - right.partOrder)
    .map((part) => part.partId)
    .join("+");
  return `${turnId}:user_prompt:${message.messageId}:${partIds || "text"}`;
}

function buildComponent(input: {
  turn: TurnRecord;
  message: MessageRecord;
  text: string;
  status: "ready" | "degraded";
  quality: "model_smoothed" | "deterministic_preserved";
  generatedAt: string;
  provider?: UserPromptSmoothingProviderOutput;
}): TurnSmoothComponentRecord {
  const sourcePartIds = input.message.parts
    .filter((part) => part.partType === "text")
    .sort((left, right) => left.partOrder - right.partOrder)
    .map((part) => part.partId);
  return {
    componentId: componentId(input.turn.turnId, input.message),
    kind: "user_prompt",
    status: input.status,
    text: input.text,
    quality: input.quality,
    sourceMessageIds: [input.message.messageId],
    sourcePartIds,
    sourceRevision: input.message.sourceRevision,
    generatedAt: input.generatedAt,
    strategy: input.quality === "model_smoothed" ? "gpt_5_4_mini_user_prompt_v1" : "deterministic_user_prompt_preserved_v1",
    providerMetadata: input.provider
      ? {
          providerId: input.provider.providerId,
          modelId: input.provider.modelId,
          reasoningEffort: input.provider.reasoningEffort,
          promptVersion: input.provider.promptVersion,
          usage: input.provider.usage,
          elapsedMs: input.provider.elapsedMs,
        }
      : undefined,
  };
}

function upsertUserPromptComponent(
  smooth: SmoothTurnState | TurnRecord["smooth"] | undefined,
  component: TurnSmoothComponentRecord,
  threadId: string,
  turn: TurnRecord,
  generatedAt: string,
): SmoothTurnState {
  const components = (smooth?.components ?? []).filter((candidate) => candidate.componentId !== component.componentId);
  components.push(component);
  components.sort((left, right) => left.componentId.localeCompare(right.componentId));

  return {
    turnId: turn.turnId,
    threadId,
    schemaVersion: SMOOTH_TURN_SCHEMA_VERSION,
    status: components.some((candidate) => candidate.status === "degraded") ? "degraded" : smooth?.status ?? "pending",
    strategy: "component_smooth_turn_v1",
    generatedAt,
    sourceRevision: turn.sourceRevision,
    components,
  };
}

async function persistComponent(input: {
  store: ThreadStore;
  threadId: string;
  turnId: string;
  messageId: string;
  component: TurnSmoothComponentRecord;
  generatedAt: string;
}): Promise<void> {
  const result = await withSerializedThreadOperation(input.threadId, async (): Promise<StewardResult<void>> => {
    const snapshotResult = await input.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const snapshot = snapshotResult.value;
    const latestTurn = findTurnForMessage(snapshot, input.messageId);
    if (!latestTurn || latestTurn.turnId !== input.turnId) {
      return fail({
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found for message ${input.messageId}.`,
        threadId: input.threadId,
      });
    }

    const smooth = upsertUserPromptComponent(
      latestTurn.smooth,
      input.component,
      input.threadId,
      latestTurn,
      input.generatedAt,
    );
    const turns = snapshot.turns.map((turn) =>
      turn.turnId === latestTurn.turnId
        ? {
            ...structuredClone(turn),
            smooth: toTurnSmoothRecord(smooth),
          }
        : structuredClone(turn),
    );
    const writeResult = await input.store.writeTurns({
      threadId: input.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns,
      turnState: snapshot.thread.status.turnState,
    });
    if (!writeResult.ok) {
      return fail(...writeResult.issues);
    }

    return ok(undefined);
  });

  if (!result.ok) {
    throw new StewardResultError(result.issues);
  }
}

export class UserPromptSmoothingService {
  private readonly logger: UserPromptSmoothingLogger;
  private readonly maxAttempts: number;

  constructor(private readonly options: UserPromptSmoothingServiceOptions) {
    this.logger = options.logger ?? defaultLogger();
    this.maxAttempts = options.maxAttempts ?? 1;
  }

  schedule(input: ScheduleUserPromptSmoothingInput): boolean {
    const key = inFlightKey(input);
    if (inFlight.has(key)) {
      return false;
    }
    inFlight.add(key);
    void this.run(input)
      .catch((error) => {
        this.logger.error("User prompt smoothing job failed.", {
          threadId: input.threadId,
          messageId: input.messageId,
          cause: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => inFlight.delete(key));
    return true;
  }

  async run(input: ScheduleUserPromptSmoothingInput): Promise<void> {
    const snapshotResult = await this.options.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      throw new StewardResultError(snapshotResult.issues);
    }
    const snapshot = snapshotResult.value;
    const message = findMessage(snapshot, input.messageId);
    const turn = findTurnForMessage(snapshot, input.messageId);
    if (!message || !turn || message.actorType !== "human") {
      return;
    }

    const rawText = readRawPromptText(message);
    if (rawText.length === 0) {
      return;
    }

    const providerInput: UserPromptSmoothingProviderInput = {
      threadId: input.threadId,
      turnId: turn.turnId,
      messageId: message.messageId,
      rawText,
      sourceRevision: message.sourceRevision,
      promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
    };

    if (this.options.shouldSkip?.(providerInput)) {
      await this.writeDeterministicFallback(snapshot, turn, message, rawText, "skip");
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const output = await this.options.provider.smoothUserPrompt(providerInput);
        const text = normalizeDeterministicText(output.text);
        await persistComponent({
          store: this.options.store,
          threadId: input.threadId,
          turnId: turn.turnId,
          messageId: message.messageId,
          generatedAt: output.generatedAt,
          component: buildComponent({
            turn,
            message,
            text,
            status: "ready",
            quality: "model_smoothed",
            generatedAt: output.generatedAt,
            provider: output,
          }),
        });
        this.logger.debug?.("User prompt smoothing completed.", { threadId: input.threadId, messageId: input.messageId });
        return;
      } catch (error) {
        lastError = error;
        this.logger.error("User prompt smoothing attempt failed.", {
          threadId: input.threadId,
          messageId: input.messageId,
          attempt,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.writeDeterministicFallback(snapshot, turn, message, rawText, "failure", lastError);
  }

  private async writeDeterministicFallback(
    snapshot: ThreadSnapshot,
    turn: TurnRecord,
    message: MessageRecord,
    rawText: string,
    reason: "failure" | "skip",
    error?: unknown,
  ): Promise<void> {
    const generatedAt = (this.options.now ?? (() => new Date()))().toISOString();
    await persistComponent({
      store: this.options.store,
      threadId: snapshot.thread.threadId,
      turnId: turn.turnId,
      messageId: message.messageId,
      generatedAt,
      component: buildComponent({
        turn,
        message,
        text: normalizeDeterministicText(rawText),
        status: reason === "failure" ? "degraded" : "ready",
        quality: "deterministic_preserved",
        generatedAt,
      }),
    });
    this.logger.debug?.("User prompt smoothing deterministic fallback written.", {
      threadId: snapshot.thread.threadId,
      messageId: message.messageId,
      reason,
      cause: error instanceof Error ? error.message : error ? String(error) : undefined,
    });
  }
}

export async function runUserPromptSmoothingSerialized(
  service: UserPromptSmoothingService,
  input: ScheduleUserPromptSmoothingInput,
): Promise<void> {
  return withSerializedThreadOperation(input.threadId, async () => {
    await service.run(input);
    return { ok: true, value: undefined, issues: [] };
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }
  });
}
