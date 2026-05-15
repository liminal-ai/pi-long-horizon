import type {
  EnsureSmoothTurnInput,
  EnsureSmoothTurnResult,
  ReadSmoothTurnStateInput,
  ReadSmoothTurnStateResult,
  SmoothTurnComponentState,
  SmoothTurnState,
  MaterializeSmoothTurnResult,
} from "../domain/smooth-turn-state.js";
import {
  SMOOTH_TURN_SCHEMA_VERSION,
  assembleSmoothTurnTextFromComponents,
  createSmoothComponentSourceFingerprint,
  normalizeDeterministicText,
  toTurnSmoothRecord,
} from "../domain/smooth-turn-state.js";
import type { ThreadSnapshot, ThreadStore } from "../../store/thread-store.js";
import type { MessageRecord, PartRecord, TurnRecord } from "../../domain/records.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import { fail, ok, StewardResultError, type StewardResult } from "../../domain/errors.js";
import {
  countSmoothTurnMaterialized,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface SmoothTurnServiceOptions {
  store: ThreadStore;
  now?: () => Date;
  formatOptions?: Partial<DeterministicSmoothFormatOptions>;
}

export interface DeterministicSmoothFormatOptions {
  toolOutputCharLimit: number;
}

export interface PersistSmoothTurnStateInput {
  threadId: string;
  turnId: string;
  expectedSourceRevision: number;
  expectedMessageHighWatermark: number;
  expectedTurnsRevision: number;
  smooth: SmoothTurnState;
}

function findTurn(snapshot: ThreadSnapshot, turnId: string): TurnRecord | undefined {
  return snapshot.turns.find((turn) => turn.turnId === turnId);
}

function sortTurnMessages(snapshot: ThreadSnapshot, turn: TurnRecord) {
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));

  return turn.messageIds
    .map((messageId) => messagesById.get(messageId))
    .filter((message) => message !== undefined)
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function calculateSmoothTokenCountRecord(turn: TurnRecord, generatedAt?: string): TokenCountRecord {
  return countSmoothTurnMaterialized(turn, { createdAt: generatedAt });
}

function calculateSmoothComponentsTokenCountRecord(
  turn: TurnRecord,
  components: readonly SmoothTurnComponentState[],
  sourceRevision: number | undefined,
  generatedAt?: string,
): TokenCountRecord {
  const text = assembleSmoothText(components);
  return countSmoothTurnMaterialized(
    {
      ...turn,
      smooth: {
        ...turn.smooth,
        components: [...components],
        text,
        sourceRevision,
      },
    },
    { createdAt: generatedAt },
  );
}

function withSmoothTokenCountMetadata(
  smooth: SmoothTurnState,
  turn: TurnRecord,
  messages: readonly MessageRecord[] = [],
): SmoothTurnState {
  const generatedAt = smooth.generatedAt ?? new Date().toISOString();
  const materialized = materializeSmoothTurnFromState({ turn, messages, state: { ...smooth, generatedAt } });
  const tokenCountMetadata =
    materialized.tokenCountMetadata ??
    calculateSmoothTokenCountRecord(
      {
        ...turn,
        smooth: toTurnSmoothRecord({
          ...smooth,
          generatedAt,
        }),
      },
      generatedAt,
    );

  return {
    ...smooth,
    tokenCountMetadata,
    materialized:
      materialized.status === "ready" || materialized.status === "degraded"
        ? {
            sourceFingerprint: materialized.sourceFingerprint,
            tokenCountMetadata,
          }
        : smooth.materialized,
    generatedAt,
  };
}

function evaluateSmoothTurn(
  turn: TurnRecord,
  messages: readonly MessageRecord[] = [],
): ReadSmoothTurnStateResult {
  const smooth = turn.smooth;
  if (!smooth) {
    return {
      turnId: turn.turnId,
      smoothStatus: "missing",
    };
  }

  if (turn.lifecycleStatus !== "closed") {
    return {
      turnId: turn.turnId,
      smoothStatus: "missing",
      generatedAt: smooth.generatedAt,
      sourceRevision: smooth.sourceRevision,
    };
  }

  if (smooth.schemaVersion === SMOOTH_TURN_SCHEMA_VERSION || smooth.components) {
    const materialized = materializeSmoothTurnFromState({
      turn,
      messages,
      state: {
        turnId: turn.turnId,
        threadId: turn.threadId,
        schemaVersion: smooth.schemaVersion,
        status: smooth.status ?? "missing",
        components: smooth.components,
        materialized: smooth.materialized,
        sourceRevision: smooth.sourceRevision,
        generatedAt: smooth.generatedAt,
      },
    });
    const sourceRevision = smooth.sourceRevision ?? Math.max(...(smooth.components ?? []).map((component) => component.sourceRevision), 0);
    const base = {
      turnId: turn.turnId,
      smoothStatus: materialized.status,
      smoothText: materialized.text,
      smoothTokenCount: materialized.tokenCount,
      generatedAt: smooth.generatedAt,
      sourceRevision,
      schemaVersion: SMOOTH_TURN_SCHEMA_VERSION,
      components: smooth.components,
      materialized: {
        sourceFingerprint: materialized.sourceFingerprint ?? smooth.materialized?.sourceFingerprint,
        tokenCountMetadata: materialized.tokenCountMetadata ?? smooth.materialized?.tokenCountMetadata,
      },
    } satisfies ReadSmoothTurnStateResult;

    if (sourceRevision !== turn.sourceRevision && (materialized.status === "ready" || materialized.status === "degraded")) {
      return { ...base, smoothStatus: "stale" };
    }

    return base;
  }

  return {
    turnId: turn.turnId,
    smoothStatus: "missing",
    smoothTokenCount: smooth.tokenCountMetadata?.count,
    generatedAt: smooth.generatedAt,
    sourceRevision: smooth.sourceRevision,
  };
}

function stableSerialize(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(sortJsonValue(value));
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

function normalizePartText(part: PartRecord): string {
  return normalizeDeterministicText(stableSerialize(part.content));
}

function classifyComponentKind(message: MessageRecord, part: PartRecord): SmoothTurnComponentState["kind"] {
  if (part.partType === "reasoning") {
    return "thinking";
  }

  if (part.partType === "tool_call" || part.partType === "tool_result" || message.messageKind === "tool_result" || message.actorType === "tool") {
    return "tool_exchange";
  }

  if (message.actorType === "human" || message.messageKind === "prompt") {
    return "user_prompt";
  }

  return "assistant_message";
}

function componentStrategy(kind: SmoothTurnComponentState["kind"]): SmoothTurnComponentState["strategy"] {
  if (kind === "user_prompt") {
    return "deterministic_user_prompt_preserved_v1";
  }
  if (kind === "assistant_message") {
    return "deterministic_assistant_v1";
  }
  if (kind === "tool_exchange") {
    return "deterministic_tool_exchange_v1";
  }

  return "thinking_plaintext_or_omitted_v1";
}

function componentQuality(kind: SmoothTurnComponentState["kind"], omitted: boolean): SmoothTurnComponentState["quality"] {
  if (omitted) {
    return "omitted_no_plaintext";
  }
  if (kind === "tool_exchange") {
    return "deterministic_rendered";
  }

  return "deterministic_preserved";
}

function buildComponentId(turnId: string, kind: SmoothTurnComponentState["kind"], messageId: string, partId: string): string {
  return [turnId, kind, messageId, partId].join(":");
}

function buildSmoothComponents(input: {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
  generatedAt: string;
  formatOptions?: Partial<DeterministicSmoothFormatOptions>;
}): SmoothTurnComponentState[] {
  const options = { toolOutputCharLimit: 240, ...input.formatOptions };
  const components: SmoothTurnComponentState[] = [];

  for (const message of input.messages) {
    for (const part of [...message.parts].sort((left, right) => left.partOrder - right.partOrder)) {
      const kind = classifyComponentKind(message, part);
      let text = normalizePartText(part);
      if (kind === "tool_exchange" && text.length > options.toolOutputCharLimit) {
        text = `${text.slice(0, options.toolOutputCharLimit)}...`;
      }
      const omitted = kind === "thinking" && text.length === 0;
      if (text.length === 0 && !omitted) {
        continue;
      }

      components.push({
        componentId: buildComponentId(input.turn.turnId, kind, message.messageId, part.partId),
        kind,
        status: omitted ? "omitted" : "ready",
        text: omitted ? undefined : text,
        quality: componentQuality(kind, omitted),
        sourceMessageIds: [message.messageId],
        sourcePartIds: [part.partId],
        sourceRevision: message.sourceRevision,
        generatedAt: input.generatedAt,
        strategy: componentStrategy(kind),
      });
    }
  }

  return components;
}

function assembleSmoothText(components: readonly SmoothTurnComponentState[]): string {
  return assembleSmoothTurnTextFromComponents(components) ?? "";
}

function requiredComponentKinds(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
): Set<SmoothTurnComponentState["kind"]> {
  const kinds = new Set<SmoothTurnComponentState["kind"]>();
  for (const message of messages) {
    for (const part of message.parts) {
      const kind = classifyComponentKind(message, part);
      const text = normalizePartText(part);
      if (kind === "thinking" || text.length === 0) {
        continue;
      }
      kinds.add(kind);
    }
  }
  if (turn.messageIds.length > 0 && kinds.size === 0) {
    kinds.add("user_prompt");
  }
  return kinds;
}

function evaluateComponentStatus(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
  components: readonly SmoothTurnComponentState[] | undefined,
): { status: SmoothTurnState["status"]; missingComponentIds: string[] } {
  if (!components) {
    return { status: "missing", missingComponentIds: ["components"] };
  }

  const missingComponentIds: string[] = [];
  const requiredKinds = requiredComponentKinds(turn, messages);
  for (const kind of requiredKinds) {
    if (!components.some((component) => component.kind === kind && (component.status === "ready" || component.status === "degraded"))) {
      missingComponentIds.push(kind);
    }
  }

  const blocking = components.filter((component) => component.kind !== "thinking" && (component.status === "pending" || component.status === "stale" || component.status === "invalid"));
  missingComponentIds.push(...blocking.map((component) => component.componentId));
  if (missingComponentIds.length > 0) {
    return { status: blocking.some((component) => component.status === "invalid") ? "invalid" : "pending", missingComponentIds };
  }
  if (components.some((component) => component.status === "degraded")) {
    return { status: "degraded", missingComponentIds };
  }
  return { status: "ready", missingComponentIds };
}

export function materializeSmoothTurnFromState(input: {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
  state?: SmoothTurnState | TurnRecord["smooth"];
}): MaterializeSmoothTurnResult {
  const { turn, messages } = input;
  const state = input.state ?? turn.smooth;
  if (!state || state.schemaVersion !== SMOOTH_TURN_SCHEMA_VERSION || !state.components) {
    return { turnId: turn.turnId, status: "missing", missingComponentIds: ["components"] };
  }
  if (messages.length !== turn.messageIds.length) {
    const foundMessageIds = new Set(messages.map((message) => message.messageId));
    return {
      turnId: turn.turnId,
      status: "pending",
      missingComponentIds: turn.messageIds.filter((messageId) => !foundMessageIds.has(messageId)),
    };
  }

  const componentEvaluation = evaluateComponentStatus(turn, messages, state.components);
  if (componentEvaluation.status !== "ready" && componentEvaluation.status !== "degraded") {
    return {
      turnId: turn.turnId,
      status: componentEvaluation.status,
      missingComponentIds: componentEvaluation.missingComponentIds,
    };
  }

  const components = state.components ?? [];
  const text = assembleSmoothText(components);
  if (!text) {
    return { turnId: turn.turnId, status: "pending", missingComponentIds: ["materialized_text"] };
  }

  const sourceRevision = Math.max(...components.map((component) => component.sourceRevision), turn.sourceRevision);
  const tokenCountMetadata = calculateSmoothComponentsTokenCountRecord(turn, components, sourceRevision, state.generatedAt);
  const sourceFingerprint = createSmoothComponentSourceFingerprint(components);

  return {
    turnId: turn.turnId,
    status: componentEvaluation.status,
    text,
    tokenCountMetadata,
    tokenCount: tokenCountMetadata.count,
    sourceFingerprint,
  };
}

export async function materializeSmoothTurn(
  input: ReadSmoothTurnStateInput,
  options: Pick<SmoothTurnServiceOptions, "store">,
): Promise<MaterializeSmoothTurnResult> {
  const snapshotResult = await options.store.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new StewardResultError(snapshotResult.issues);
  }
  const turn = findTurn(snapshotResult.value, input.turnId);
  if (!turn) {
    throw new StewardResultError([
      {
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
        threadId: input.threadId,
      },
    ]);
  }

  if (!turn.smooth) {
    return { turnId: turn.turnId, status: "missing", missingComponentIds: ["components"] };
  }

  return materializeSmoothTurnFromState({
    turn,
    messages: sortTurnMessages(snapshotResult.value, turn),
    state: {
      turnId: turn.turnId,
      threadId: turn.threadId,
      schemaVersion: turn.smooth.schemaVersion,
      status: turn.smooth.status ?? "missing",
      components: turn.smooth.components,
      sourceRevision: turn.smooth.sourceRevision,
      generatedAt: turn.smooth.generatedAt,
      materialized: turn.smooth.materialized,
    },
  });
}

function buildSmoothState(
  input: {
    threadId: string;
    turn: TurnRecord;
    generatedAt: string;
    formatOptions?: Partial<DeterministicSmoothFormatOptions>;
  },
  snapshot: ThreadSnapshot,
): SmoothTurnState {
  const messages = sortTurnMessages(snapshot, input.turn);
  const components = buildSmoothComponents({
    turn: input.turn,
    messages,
    generatedAt: input.generatedAt,
    formatOptions: input.formatOptions,
  });
  const sourceRevision = input.turn.sourceRevision;
  const smooth: SmoothTurnState = {
    turnId: input.turn.turnId,
    threadId: input.threadId,
    schemaVersion: SMOOTH_TURN_SCHEMA_VERSION,
    status: "ready",
    strategy: "component_smooth_turn_v1",
    generatedAt: input.generatedAt,
    sourceRevision,
    components,
    materialized: {
      sourceFingerprint: createSmoothComponentSourceFingerprint(components),
      tokenCountMetadata: calculateSmoothComponentsTokenCountRecord(input.turn, components, sourceRevision, input.generatedAt),
    },
  };

  return withSmoothTokenCountMetadata(smooth, input.turn, messages);
}

async function writeSmoothTurn(
  input: {
    snapshot: ThreadSnapshot;
    turn: TurnRecord;
    smooth: SmoothTurnState;
  },
  store: ThreadStore,
): Promise<StewardResult<void>> {
  const turns = input.snapshot.turns.map((turn) =>
    turn.turnId === input.turn.turnId
      ? {
          ...structuredClone(turn),
          smooth: toTurnSmoothRecord(input.smooth),
        }
      : structuredClone(turn),
  );

  const writeResult = await store.writeTurns({
    threadId: input.snapshot.thread.threadId,
    expectedSourceRevision: input.snapshot.thread.sourceRevision,
    expectedMessageHighWatermark: input.snapshot.thread.messageHighWatermark,
    expectedTurnsRevision: input.snapshot.thread.turnsRevision,
    turns,
    turnState: input.snapshot.thread.status.turnState,
  });

  if (!writeResult.ok) {
    return fail(...writeResult.issues);
  }

  return ok(undefined);
}

async function persistSmoothTurnStateWithinSerializedThreadOperation(
  input: PersistSmoothTurnStateInput,
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

  if (snapshotResult.value.thread.turnsRevision !== input.expectedTurnsRevision) {
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

  const smooth = withSmoothTokenCountMetadata(input.smooth, turn, sortTurnMessages(snapshotResult.value, turn));

  if (turn.sourceRevision !== smooth.sourceRevision) {
    return fail({
      code: "STALE_SOURCE_REVISION",
      message: `Turn ${input.turnId} source revision ${turn.sourceRevision} does not match smooth source revision ${smooth.sourceRevision}.`,
      threadId: input.threadId,
    });
  }

  return writeSmoothTurn(
    {
      snapshot: snapshotResult.value,
      turn,
      smooth,
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

async function persistSmoothTurnStateWithRetry(
  input: PersistSmoothTurnStateInput,
  store: ThreadStore,
): Promise<StewardResult<void>> {
  let nextInput = { ...input };
  let lastResult: StewardResult<void> | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await persistSmoothTurnStateWithinSerializedThreadOperation(nextInput, store);
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
      message: `Smooth turn state for ${input.turnId} could not be persisted.`,
      threadId: input.threadId,
    })
  );
}

export async function persistSmoothTurnState(
  input: PersistSmoothTurnStateInput,
  options: Pick<SmoothTurnServiceOptions, "store">,
): Promise<void> {
  return withSerializedThreadOperation(input.threadId, async () =>
    persistSmoothTurnStateWithRetry(input, options.store),
  ).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }
  });
}

export async function readSmoothTurnState(
  input: ReadSmoothTurnStateInput,
  options: Pick<SmoothTurnServiceOptions, "store">,
): Promise<ReadSmoothTurnStateResult> {
  const snapshotResult = await options.store.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new StewardResultError(snapshotResult.issues);
  }

  const turn = findTurn(snapshotResult.value, input.turnId);
  if (!turn) {
    throw new StewardResultError([
      {
        code: "TURN_STATE_MISSING",
        message: `Turn ${input.turnId} was not found in thread ${input.threadId}.`,
        threadId: input.threadId,
      },
    ]);
  }

  return evaluateSmoothTurn(turn, sortTurnMessages(snapshotResult.value, turn));
}

export async function ensureSmoothTurn(
  input: EnsureSmoothTurnInput,
  options: SmoothTurnServiceOptions,
): Promise<EnsureSmoothTurnResult> {
  return withSerializedThreadOperation(input.threadId, async () => {
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

    const current = evaluateSmoothTurn(turn, sortTurnMessages(snapshotResult.value, turn));
    if (turn.lifecycleStatus !== "closed") {
      return ok({
        turnId: current.turnId,
        smoothStatus: current.smoothStatus,
        smoothTokenCount: current.smoothTokenCount,
      } satisfies EnsureSmoothTurnResult);
    }

    if (current.smoothStatus === "ready" && current.schemaVersion === SMOOTH_TURN_SCHEMA_VERSION) {
      return ok({
        turnId: current.turnId,
        smoothStatus: current.smoothStatus,
        smoothTokenCount: current.smoothTokenCount,
      } satisfies EnsureSmoothTurnResult);
    }

    const smooth = buildSmoothState(
      {
        threadId: input.threadId,
        turn,
        generatedAt: (options.now ?? (() => new Date()))().toISOString(),
        formatOptions: options.formatOptions,
      },
      snapshotResult.value,
    );

    const writeResult = await persistSmoothTurnStateWithRetry(
      {
        threadId: input.threadId,
        turnId: turn.turnId,
        expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
        expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
        expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
        smooth,
      },
      options.store,
    );
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok({
      turnId: smooth.turnId,
      smoothStatus: smooth.status,
      smoothTokenCount: smooth.tokenCountMetadata?.count,
    } satisfies EnsureSmoothTurnResult);
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }

    return result.value;
  });
}
