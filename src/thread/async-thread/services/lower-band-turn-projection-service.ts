import type {
  EnsureSmoothTurnInput,
  TurnLowerBandProjectionState,
} from "../domain/smooth-turn-state.js";
import {
  SMOOTH_TURN_SCHEMA_VERSION,
  createSmoothComponentSourceFingerprint,
  normalizeDeterministicText,
} from "../domain/smooth-turn-state.js";
import type { ThreadSnapshot, ThreadStore } from "../../store/thread-store.js";
import type { MessageRecord, PartRecord, TurnRecord } from "../../domain/records.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import { fail, ok, StewardResultError, type StewardResult } from "../../domain/errors.js";
import type { OpenAIInputTokenCounter } from "../../../token-accounting/openai-input-token-counter.js";
import { createMaterializedRepresentationHash, validateTokenCountRecord } from "../../../token-accounting/index.js";

export interface LowerBandTurnProjectionServiceOptions {
  store: ThreadStore;
  openAIInputTokenCounter?: Pick<OpenAIInputTokenCounter, "countTurnLowerBandProjectionMaterialized">;
  tokenCountModel?: string;
  now?: () => Date;
}

export interface MaterializeLowerBandTurnProjectionResult {
  turnId: string;
  projectionStatus: "ready" | "pending" | "failed" | "invalid";
  text?: string;
  sourceFingerprint?: string;
  sourceRevision?: number;
  projectionTokenCount?: number;
  missingComponentIds?: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface EnsureLowerBandTurnProjectionResult {
  turnId: string;
  projectionStatus: "ready" | "pending" | "failed" | "invalid";
  projectionTokenCount?: number;
}

export interface PersistLowerBandTurnProjectionStateInput {
  threadId: string;
  turnId: string;
  expectedSourceRevision: number;
  expectedMessageHighWatermark: number;
  expectedTurnsRevision: number;
  projection: TurnLowerBandProjectionState;
}

interface RequiredProjectionComponent {
  componentId: string;
  kind: "user_prompt" | "assistant_message";
}

function findTurn(snapshot: ThreadSnapshot, turnId: string): TurnRecord | undefined {
  return snapshot.turns.find((turn) => turn.turnId === turnId);
}

function sortTurnMessages(snapshot: ThreadSnapshot, turn: TurnRecord): MessageRecord[] {
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));

  return turn.messageIds
    .map((messageId) => messagesById.get(messageId))
    .filter((message): message is MessageRecord => message !== undefined)
    .sort((left, right) => {
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }

      return left.messageId.localeCompare(right.messageId);
    });
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }

  return value;
}

function stableSerialize(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(sortJsonValue(value));
}

function contentObject(part: PartRecord): Record<string, unknown> {
  return typeof part.content === "object" && part.content !== null ? part.content : {};
}

function extractPlaintextThinking(part: PartRecord): string {
  if (typeof part.content === "string") {
    return normalizeDeterministicText(part.content);
  }

  const content = contentObject(part);
  const text = typeof content.text === "string"
    ? content.text
    : typeof content.thinking === "string"
      ? content.thinking
      : "";
  return normalizeDeterministicText(text);
}

function normalizePartText(part: PartRecord): string {
  return normalizeDeterministicText(stableSerialize(part.content));
}

function classifyProjectionComponentKind(
  message: MessageRecord,
  part: PartRecord,
): RequiredProjectionComponent["kind"] | undefined {
  if (part.partType === "reasoning") {
    return undefined;
  }

  if (
    part.partType === "tool_call" ||
    part.partType === "tool_result" ||
    message.messageKind === "tool_result" ||
    message.actorType === "tool"
  ) {
    return undefined;
  }

  if (message.actorType === "human" || message.messageKind === "prompt") {
    return "user_prompt";
  }

  return "assistant_message";
}

function buildRequiredProjectionComponents(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
): RequiredProjectionComponent[] {
  const required: RequiredProjectionComponent[] = [];

  for (const message of messages) {
    for (const part of [...message.parts].sort((left, right) => left.partOrder - right.partOrder)) {
      const kind = classifyProjectionComponentKind(message, part);
      if (!kind) {
        continue;
      }

      const text = kind === "user_prompt" ? normalizePartText(part) : normalizePartText(part);
      if (text.length === 0) {
        continue;
      }

      required.push({
        componentId: `${turn.turnId}:${kind}:${message.messageId}:${part.partId}`,
        kind,
      });
    }
  }

  return required;
}

function formatProjectionBlock(marker: ">" | "●", text: string): string {
  return text
    .split("\n")
    .map((line) => `${marker} ${line}`)
    .join("\n");
}

function cloneProjectionState(record: TurnLowerBandProjectionState): TurnLowerBandProjectionState {
  return {
    ...record,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
  };
}

function sameProjectionState(
  left: TurnLowerBandProjectionState | undefined,
  right: TurnLowerBandProjectionState,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function isProjectionStateFresher(
  current: TurnLowerBandProjectionState | undefined,
  incoming: TurnLowerBandProjectionState,
): boolean {
  return (
    typeof current?.generatedAt === "string" &&
    typeof incoming.generatedAt === "string" &&
    current.generatedAt > incoming.generatedAt
  );
}

function createProjectionFailureState(input: {
  text: string;
  sourceFingerprint: string;
  sourceRevision: number;
  generatedAt: string;
  errorCode: string;
  errorMessage: string;
}): TurnLowerBandProjectionState {
  return {
    status: "failed",
    text: input.text,
    sourceFingerprint: input.sourceFingerprint,
    sourceRevision: input.sourceRevision,
    generatedAt: input.generatedAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}

function isCurrentExactProjection(
  projection: TurnLowerBandProjectionState | undefined,
  materialized: MaterializeLowerBandTurnProjectionResult,
): boolean {
  if (
    projection?.status !== "ready" ||
    materialized.projectionStatus !== "ready" ||
    !projection.text ||
    !materialized.text ||
    !projection.tokenCountMetadata ||
    !materialized.sourceFingerprint
  ) {
    return false;
  }

  const validation = validateTokenCountRecord(projection.tokenCountMetadata);
  if (!validation.ok) {
    return false;
  }

  return (
    projection.text === materialized.text &&
    projection.sourceFingerprint === materialized.sourceFingerprint &&
    projection.sourceRevision === materialized.sourceRevision &&
    projection.tokenCountMetadata.scope === "turn_lower_band_projection_materialized" &&
    projection.tokenCountMetadata.source === "provider_input_count" &&
    projection.tokenCountMetadata.trustClass === "exact" &&
    projection.tokenCountMetadata.sourceRevision === materialized.sourceRevision &&
    projection.tokenCountMetadata.representationHash === createMaterializedRepresentationHash(materialized.text)
  );
}

export function materializeLowerBandTurnProjectionFromState(input: {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
  state?: TurnRecord["smooth"];
}): MaterializeLowerBandTurnProjectionResult {
  const state = input.state ?? input.turn.smooth;
  if (!state || state.schemaVersion !== SMOOTH_TURN_SCHEMA_VERSION || !state.components) {
    return {
      turnId: input.turn.turnId,
      projectionStatus: "pending",
      missingComponentIds: ["components"],
      errorCode: "LOWER_BAND_PROJECTION_SMOOTH_MISSING",
      errorMessage: `Turn ${input.turn.turnId} is missing ready smooth components required for lower-band projection.`,
    };
  }

  if (input.messages.length !== input.turn.messageIds.length) {
    const foundMessageIds = new Set(input.messages.map((message) => message.messageId));
    return {
      turnId: input.turn.turnId,
      projectionStatus: "pending",
      missingComponentIds: input.turn.messageIds.filter((messageId) => !foundMessageIds.has(messageId)),
      errorCode: "LOWER_BAND_PROJECTION_SOURCE_MESSAGES_MISSING",
      errorMessage: `Turn ${input.turn.turnId} is missing canonical messages required for lower-band projection.`,
    };
  }

  const requiredComponents = buildRequiredProjectionComponents(input.turn, input.messages);
  const requiredUserPrompts = requiredComponents.filter((component) => component.kind === "user_prompt");
  if (requiredUserPrompts.length > 1) {
    return {
      turnId: input.turn.turnId,
      projectionStatus: "invalid",
      errorCode: "LOWER_BAND_PROJECTION_MULTIPLE_USER_PROMPTS",
      errorMessage: `Turn ${input.turn.turnId} has multiple user prompts and cannot be projected into a single conversation-only lower-band turn.`,
    };
  }

  const readyComponentsById = new Map(
    state.components
      .filter(
        (component) =>
          (component.kind === "user_prompt" || component.kind === "assistant_message") &&
          (component.status === "ready" || component.status === "degraded") &&
          typeof component.text === "string" &&
          component.text.length > 0,
      )
      .map((component) => [component.componentId, component] as const),
  );
  const missingComponentKinds = [...new Set(
    requiredComponents
      .filter((component) => !readyComponentsById.has(component.componentId))
      .map((component) => component.kind),
  )];
  if (requiredUserPrompts.length === 0) {
    missingComponentKinds.unshift("user_prompt");
  }

  if (missingComponentKinds.length > 0) {
    return {
      turnId: input.turn.turnId,
      projectionStatus: "pending",
      missingComponentIds: [...new Set(missingComponentKinds)],
      errorCode: "LOWER_BAND_PROJECTION_COMPONENTS_PENDING",
      errorMessage: `Turn ${input.turn.turnId} is missing ready smooth user or assistant components required for lower-band projection.`,
    };
  }

  const projectionComponents = requiredComponents
    .map((component) => readyComponentsById.get(component.componentId))
    .filter((component): component is NonNullable<typeof component> => component !== undefined);
  const userComponent = projectionComponents.find((component) => component.kind === "user_prompt");
  if (!userComponent?.text) {
    return {
      turnId: input.turn.turnId,
      projectionStatus: "pending",
      missingComponentIds: ["user_prompt"],
      errorCode: "LOWER_BAND_PROJECTION_USER_PROMPT_MISSING",
      errorMessage: `Turn ${input.turn.turnId} is missing a ready smooth user prompt required for lower-band projection.`,
    };
  }

  const assistantComponents = projectionComponents.filter((component) => component.kind === "assistant_message");
  const text = [
    formatProjectionBlock(">", userComponent.text),
    ...assistantComponents.map((component) => formatProjectionBlock("●", component.text!)),
  ].join("\n\n");
  const sourceRevision = Math.max(...projectionComponents.map((component) => component.sourceRevision), 0);

  return {
    turnId: input.turn.turnId,
    projectionStatus: "ready",
    text,
    sourceFingerprint: createSmoothComponentSourceFingerprint(projectionComponents),
    sourceRevision,
  };
}

async function writeProjectionState(
  input: {
    snapshot: ThreadSnapshot;
    turn: TurnRecord;
    projection: TurnLowerBandProjectionState;
  },
  store: ThreadStore,
): Promise<StewardResult<void>> {
  const updatedTurn = {
    ...structuredClone(input.turn),
    smooth: {
      ...(structuredClone(input.turn.smooth) ?? {}),
      lowerBandProjection: cloneProjectionState(input.projection),
    },
  };

  const writeResult = store.writeTurnRows
    ? await store.writeTurnRows({
        threadId: input.snapshot.thread.threadId,
        expectedSourceRevision: input.snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: input.snapshot.thread.messageHighWatermark,
        turns: [updatedTurn],
        turnState: input.snapshot.thread.status.turnState,
        updatedAt: input.projection.generatedAt,
      })
    : await store.writeTurns({
        threadId: input.snapshot.thread.threadId,
        expectedSourceRevision: input.snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: input.snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: input.snapshot.thread.turnsRevision,
        turns: input.snapshot.turns.map((turn) =>
          turn.turnId === input.turn.turnId ? updatedTurn : structuredClone(turn),
        ),
        turnState: input.snapshot.thread.status.turnState,
      });

  if (!writeResult.ok) {
    return fail(...writeResult.issues);
  }

  return ok(undefined);
}

async function persistLowerBandTurnProjectionStateWithinSerializedThreadOperation(
  input: PersistLowerBandTurnProjectionStateInput,
  store: ThreadStore,
): Promise<StewardResult<void>> {
  const snapshotResult = await store.openThread(input.threadId);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }

  if (snapshotResult.value.thread.sourceRevision !== input.expectedSourceRevision) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} source revision ${snapshotResult.value.thread.sourceRevision} does not match expected ${input.expectedSourceRevision}.`,
      threadId: input.threadId,
    });
  }

  if (snapshotResult.value.thread.messageHighWatermark !== input.expectedMessageHighWatermark) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} message high watermark ${snapshotResult.value.thread.messageHighWatermark} does not match expected ${input.expectedMessageHighWatermark}.`,
      threadId: input.threadId,
    });
  }

  if (
    !store.writeTurnRows &&
    snapshotResult.value.thread.turnsRevision !== input.expectedTurnsRevision
  ) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Thread ${input.threadId} turns revision ${snapshotResult.value.thread.turnsRevision} does not match expected ${input.expectedTurnsRevision}.`,
      threadId: input.threadId,
      cause: "turns_revision",
    });
  }

  const turn = findTurn(snapshotResult.value, input.turnId);
  if (!turn) {
    return fail({
      code: "TURN_STATE_MISSING",
      message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
      threadId: input.threadId,
    });
  }

  if (isProjectionStateFresher(turn.smooth?.lowerBandProjection, input.projection)) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Turn ${input.turnId} already has fresher lower-band projection state than the attempted write.`,
      threadId: input.threadId,
      cause: "lower_band_projection_generated_at",
    });
  }

  if (sameProjectionState(turn.smooth?.lowerBandProjection, input.projection)) {
    return ok(undefined);
  }

  return writeProjectionState(
    {
      snapshot: snapshotResult.value,
      turn,
      projection: input.projection,
    },
    store,
  );
}

function isRetryableTurnsRevisionFailure(result: StewardResult<void>): boolean {
  return (
    !result.ok &&
    result.issues.some((issue) => issue.code === "STALE_SOURCE_REVISION" && issue.cause === "turns_revision")
  );
}

async function persistLowerBandTurnProjectionStateWithRetry(
  input: PersistLowerBandTurnProjectionStateInput,
  store: ThreadStore,
): Promise<StewardResult<void>> {
  let nextInput = { ...input };
  let lastResult: StewardResult<void> | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await persistLowerBandTurnProjectionStateWithinSerializedThreadOperation(nextInput, store);
    if (result.ok) {
      return result;
    }

    lastResult = result;
    if (!isRetryableTurnsRevisionFailure(result)) {
      return result;
    }

    const latestSnapshot = await store.openThread(input.threadId);
    if (!latestSnapshot.ok) {
      return latestSnapshot;
    }

    nextInput = {
      ...nextInput,
      expectedTurnsRevision: latestSnapshot.value.thread.turnsRevision,
    };
  }

  return (
    lastResult ??
    fail({
      code: "STORE_UNAVAILABLE",
      message: `Lower-band turn projection state for ${input.turnId} could not be persisted.`,
      threadId: input.threadId,
    })
  );
}

export async function persistLowerBandTurnProjectionState(
  input: PersistLowerBandTurnProjectionStateInput,
  options: Pick<LowerBandTurnProjectionServiceOptions, "store">,
): Promise<void> {
  return withSerializedThreadOperation(input.threadId, async () =>
    persistLowerBandTurnProjectionStateWithRetry(input, options.store),
  ).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }
  });
}

export async function ensureLowerBandTurnProjection(
  input: EnsureSmoothTurnInput,
  options: LowerBandTurnProjectionServiceOptions,
): Promise<EnsureLowerBandTurnProjectionResult> {
  return withSerializedThreadOperation<EnsureLowerBandTurnProjectionResult>(input.threadId, async () => {
    const snapshotResult = await options.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const turn = findTurn(snapshotResult.value, input.turnId);
    if (!turn) {
      return fail({
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
        threadId: input.threadId,
      });
    }

    if (turn.lifecycleStatus !== "closed") {
      return ok({
        turnId: turn.turnId,
        projectionStatus: "pending",
      } satisfies EnsureLowerBandTurnProjectionResult);
    }

    const materialized = materializeLowerBandTurnProjectionFromState({
      turn,
      messages: sortTurnMessages(snapshotResult.value, turn),
    });
    if (isCurrentExactProjection(turn.smooth?.lowerBandProjection, materialized)) {
      return ok({
        turnId: turn.turnId,
        projectionStatus: "ready",
        projectionTokenCount: turn.smooth?.lowerBandProjection?.tokenCountMetadata?.count,
      } satisfies EnsureLowerBandTurnProjectionResult);
    }

    const generatedAt = (options.now ?? (() => new Date()))().toISOString();
    let projection = turn.smooth?.lowerBandProjection;
    if (materialized.projectionStatus === "ready" && materialized.text && materialized.sourceFingerprint) {
      const counter = options.openAIInputTokenCounter;
      if (!counter) {
        projection = createProjectionFailureState({
          text: materialized.text,
          sourceFingerprint: materialized.sourceFingerprint,
          sourceRevision: materialized.sourceRevision ?? turn.sourceRevision,
          generatedAt,
          errorCode: "LOWER_BAND_PROJECTION_TOKEN_COUNT_MISSING",
          errorMessage: "Conversation-only lower-band turn projection requires an exact token counter before it can become ready.",
        });
      } else {
        try {
          const tokenCountMetadata = await counter.countTurnLowerBandProjectionMaterialized({
            text: materialized.text,
            sourceRevision: materialized.sourceRevision,
            model: options.tokenCountModel,
            now: options.now,
          });
          projection = {
            status: "ready",
            text: materialized.text,
            tokenCountMetadata,
            sourceFingerprint: materialized.sourceFingerprint,
            sourceRevision: materialized.sourceRevision,
            generatedAt,
          };
        } catch (error) {
          projection = createProjectionFailureState({
            text: materialized.text,
            sourceFingerprint: materialized.sourceFingerprint,
            sourceRevision: materialized.sourceRevision ?? turn.sourceRevision,
            generatedAt,
            errorCode: "LOWER_BAND_PROJECTION_TOKEN_COUNT_FAILED",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      projection = {
        status: materialized.projectionStatus,
        text: materialized.projectionStatus === "failed" ? materialized.text : undefined,
        sourceFingerprint: materialized.sourceFingerprint,
        sourceRevision: materialized.sourceRevision,
        generatedAt,
        errorCode: materialized.errorCode,
        errorMessage: materialized.errorMessage,
      };
    }

    const writeResult = await persistLowerBandTurnProjectionStateWithRetry(
      {
        threadId: input.threadId,
        turnId: turn.turnId,
        expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
        expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
        expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
        projection: projection!,
      },
      options.store,
    );
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok({
      turnId: turn.turnId,
      projectionStatus: projection!.status,
      projectionTokenCount: projection!.tokenCountMetadata?.count,
    } satisfies EnsureLowerBandTurnProjectionResult);
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }

    return result.value;
  });
}
