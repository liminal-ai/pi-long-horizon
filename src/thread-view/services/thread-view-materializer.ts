import type { StewardIssue } from "../../thread/domain/errors.js";
import {
  getReadyChunkLowerBandArtifact,
  type ChunkState,
} from "../../thread/async-thread/domain/chunk-state.js";
import { materializeSmoothTurnFromState } from "../../thread/async-thread/services/smooth-turn-service.js";
import type { MessageRecord, ThreadRecord, TurnRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  bandTypeToSourceUnitType,
  cloneBandRecord,
  concatenateBandMessages,
  createThreadViewMessageId,
  type BandRecord,
  type BandRenderedStatus,
  type BandType,
  type ThreadViewMessageRecord,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/thread-view-errors.js";
import {
  applyLiveToolResultTruncation,
  stringifyCanonicalRawMessageForPiVisibleEstimate,
  type LiveToolResultTruncationOptions,
} from "./live-tool-result-truncation.js";

const UPPER_BAND_TYPES = ["full_fidelity", "smooth"] as const;
const LOWER_BAND_TYPES = ["detailed", "brief"] as const;

export interface MaterializeThreadViewInput {
  threadId: string;
  draftView: ThreadViewRecord;
}

export interface MaterializeThreadViewResult {
  fullFidelityBand: BandRecord;
  smoothBand: BandRecord;
  emittedMessages: ThreadViewMessageRecord[];
  bandStatuses: Record<BandType, BandRenderedStatus>;
  issues: StewardIssue[];
}

function getBand(view: ThreadViewRecord, bandType: BandType): BandRecord {
  switch (bandType) {
    case "full_fidelity":
      return view.fullFidelityBand;
    case "smooth":
      return view.smoothBand;
    case "detailed":
      return view.detailedBand;
    case "brief":
      return view.briefBand;
  }
}

function indexTurns(turns: readonly TurnRecord[]): Map<string, TurnRecord> {
  return new Map(turns.map((turn) => [turn.turnId, turn]));
}

function indexMessages(messages: readonly MessageRecord[]): Map<string, MessageRecord> {
  return new Map(messages.map((message) => [message.messageId, message]));
}

function sortTurnsInSourceOrder(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns].sort((left, right) => {
    if (left.turnOrder !== right.turnOrder) {
      return left.turnOrder - right.turnOrder;
    }

    if (left.sourceRange.fromSourceOrder !== right.sourceRange.fromSourceOrder) {
      return left.sourceRange.fromSourceOrder - right.sourceRange.fromSourceOrder;
    }

    return left.turnId.localeCompare(right.turnId);
  });
}

function sortMessagesInSourceOrder(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.sourceOrder !== right.sourceOrder) {
      return left.sourceOrder - right.sourceOrder;
    }

    return left.messageId.localeCompare(right.messageId);
  });
}

function getChunkSourceRange(
  chunk: ChunkState,
  turnsById: ReadonlyMap<string, TurnRecord>,
): { fromTurnOrder: number; toTurnOrder: number } | undefined {
  const turnOrders = chunk.sourceTurnIds
    .map((turnId) => turnsById.get(turnId)?.turnOrder)
    .filter((turnOrder): turnOrder is number => turnOrder !== undefined);

  if (turnOrders.length !== chunk.sourceTurnIds.length || turnOrders.length === 0) {
    return undefined;
  }

  return {
    fromTurnOrder: Math.min(...turnOrders),
    toTurnOrder: Math.max(...turnOrders),
  };
}

function sortChunksInSourceOrder(
  chunks: readonly ChunkState[],
  turnsById: ReadonlyMap<string, TurnRecord>,
): ChunkState[] {
  return [...chunks].sort((left, right) => {
    const leftRange = getChunkSourceRange(left, turnsById);
    const rightRange = getChunkSourceRange(right, turnsById);

    if (!leftRange && !rightRange) {
      return left.chunkId.localeCompare(right.chunkId);
    }

    if (!leftRange) {
      return 1;
    }

    if (!rightRange) {
      return -1;
    }

    if (leftRange.fromTurnOrder !== rightRange.fromTurnOrder) {
      return leftRange.fromTurnOrder - rightRange.fromTurnOrder;
    }

    if (leftRange.toTurnOrder !== rightRange.toTurnOrder) {
      return leftRange.toTurnOrder - rightRange.toTurnOrder;
    }

    return left.chunkId.localeCompare(right.chunkId);
  });
}

function normalizeTurnBand(
  bandType: "full_fidelity" | "smooth",
  band: BandRecord,
  orderedTurns: readonly TurnRecord[],
  options: {
    excludeTurnIds?: ReadonlySet<string>;
  } = {},
): BandRecord {
  const excludeTurnIds = options.excludeTurnIds ?? new Set<string>();
  const selectedTurnIdSet = new Set(band.selectedIds);
  const exclusionSet = new Set(band.exclusions ?? []);
  const selectedIds = orderedTurns
    .filter((turn) => selectedTurnIdSet.has(turn.turnId))
    .map((turn) => turn.turnId)
    .filter((turnId) => !excludeTurnIds.has(turnId) && !exclusionSet.has(turnId));

  return {
    ...cloneBandRecord(band),
    bandType,
    sourceUnitType: bandTypeToSourceUnitType(bandType),
    selectedIds,
    exclusions: exclusionSet.size > 0 ? [...exclusionSet] : undefined,
  };
}

function normalizeLowerBand(
  bandType: "detailed" | "brief",
  band: BandRecord,
  orderedChunks: readonly ChunkState[],
): BandRecord {
  const selectedChunkIdSet = new Set(band.selectedIds);
  const exclusionSet = new Set(band.exclusions ?? []);
  const selectedIds = orderedChunks
    .filter((chunk) => selectedChunkIdSet.has(chunk.chunkId))
    .map((chunk) => chunk.chunkId)
    .filter((chunkId) => !exclusionSet.has(chunkId));

  return {
    ...cloneBandRecord(band),
    bandType,
    sourceUnitType: "chunk",
    selectedIds,
    exclusions: exclusionSet.size > 0 ? [...exclusionSet] : undefined,
  };
}

function deriveDefaultSmoothBand(
  smoothBand: BandRecord,
  orderedTurns: readonly TurnRecord[],
  fullFidelityBand: BandRecord,
): BandRecord {
  // Feature 3 rebuilds persist a zero smooth-band budget when the operator explicitly selects 0%.
  // Preserve that explicit empty selection instead of backfilling from the full-fidelity boundary.
  if (smoothBand.selectedIds.length === 0 && smoothBand.targetTokenBudget === 0) {
    return normalizeTurnBand("smooth", smoothBand, orderedTurns);
  }

  if (smoothBand.selectedIds.length > 0) {
    return normalizeTurnBand("smooth", smoothBand, orderedTurns, {
      excludeTurnIds: new Set(fullFidelityBand.selectedIds),
    });
  }

  if (fullFidelityBand.selectedIds.length === 0) {
    return normalizeTurnBand("smooth", smoothBand, orderedTurns);
  }

  const fullFidelityTurnIds = new Set(fullFidelityBand.selectedIds);
  const exclusionSet = new Set(smoothBand.exclusions ?? []);
  const oldestSelectedIndex = orderedTurns.findIndex((turn) => fullFidelityTurnIds.has(turn.turnId));
  if (oldestSelectedIndex <= 0) {
    return {
      ...cloneBandRecord(smoothBand),
      bandType: "smooth",
      sourceUnitType: "turn",
      selectedIds: [],
      exclusions: exclusionSet.size > 0 ? [...exclusionSet] : undefined,
    };
  }

  return {
    ...cloneBandRecord(smoothBand),
    bandType: "smooth",
    sourceUnitType: "turn",
    selectedIds: orderedTurns
      .slice(0, oldestSelectedIndex)
      .map((turn) => turn.turnId)
      .filter((turnId) => !fullFidelityTurnIds.has(turnId) && !exclusionSet.has(turnId)),
    exclusions: exclusionSet.size > 0 ? [...exclusionSet] : undefined,
  };
}

function pickMarker(message: MessageRecord, partType: MessageRecord["parts"][number]["partType"]): string {
  if (partType === "reasoning") {
    return "[thinking]";
  }

  if (
    message.actorType === "tool" ||
    message.messageKind === "tool_result" ||
    message.targetMetadata?.piRole === "toolResult" ||
    partType === "tool_result"
  ) {
    return "[tool]";
  }

  if (message.actorType === "human" || message.actorType === "steward" || message.actorType === "system") {
    return "[user]";
  }

  return "[assistant]";
}

function stringifyPartContent(content: string | Record<string, unknown>): string {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content.text === "string" && content.text.trim().length > 0) {
    return content.text;
  }

  return JSON.stringify(content);
}

export function materializeRawThreadViewMessageContent(message: MessageRecord): ThreadViewMessageRecord["content"] {
  return {
    messageId: message.messageId,
    actorId: message.actorId,
    actorType: message.actorType,
    messageKind: message.messageKind,
    capturedAt: message.capturedAt,
    parts: structuredClone(message.parts),
    targetMetadata: message.targetMetadata ? structuredClone(message.targetMetadata) : undefined,
  };
}

function buildRawTurnMessage(
  threadViewId: string,
  turnId: string,
  message: MessageRecord,
  messageOrder: number,
): ThreadViewMessageRecord {
  return {
    threadViewMessageId: createThreadViewMessageId({
      threadViewId,
      bandType: "full_fidelity",
      sourceReference: `${turnId}/${message.messageId}`,
      messageOrder,
    }),
    threadViewId,
    bandType: "full_fidelity",
    sourceKind: "raw_turn_message",
    sourceReference: `${turnId}/${message.messageId}`,
    messageOrder,
    content: materializeRawThreadViewMessageContent(message),
  };
}

function isMaterializedRawContent(content: ThreadViewMessageRecord["content"]): content is {
  actorType?: unknown;
  messageKind?: unknown;
  parts: Array<{
    partType?: unknown;
    content?: unknown;
  }>;
  targetMetadata?: {
    piRole?: unknown;
  };
} {
  return (
    typeof content === "object" &&
    content !== null &&
    Array.isArray((content as { parts?: unknown }).parts)
  );
}

function isRawThreadViewToolResult(message: ThreadViewMessageRecord): boolean {
  if (message.sourceKind !== "raw_turn_message" || !isMaterializedRawContent(message.content)) {
    return false;
  }

  return (
    message.content.actorType === "tool" ||
    message.content.messageKind === "tool_result" ||
    message.content.targetMetadata?.piRole === "toolResult" ||
    message.content.parts.some((part) => part.partType === "tool_result")
  );
}

function truncateRawThreadViewToolResult(
  message: ThreadViewMessageRecord,
  truncateText: (text: string) => string,
): ThreadViewMessageRecord {
  if (!isRawThreadViewToolResult(message) || !isMaterializedRawContent(message.content)) {
    return message;
  }

  let changed = false;
  const parts = message.content.parts.map((part) => {
    if (part.partType !== "tool_result" || typeof part.content !== "object" || part.content === null) {
      return part;
    }

    const output = (part.content as { output?: unknown }).output;
    if (typeof output !== "string") {
      return part;
    }

    const truncatedOutput = truncateText(output);
    if (truncatedOutput === output) {
      return part;
    }

    changed = true;
    return {
      ...part,
      content: {
        ...part.content,
        output: truncatedOutput,
      },
    };
  });

  return changed
    ? {
        ...message,
        content: {
          ...message.content,
          parts,
        },
      }
    : message;
}

export function truncateRawThreadViewMessages(
  messages: readonly ThreadViewMessageRecord[],
  options: LiveToolResultTruncationOptions = {},
): ThreadViewMessageRecord[] {
  return applyLiveToolResultTruncation(
    messages,
    {
      isRawZoneBoundary: () => false,
      estimateText: (message) => stringifyCanonicalRawMessageForPiVisibleEstimate(message.content),
      isEligibleToolResult: isRawThreadViewToolResult,
      truncateToolResult: truncateRawThreadViewToolResult,
    },
    options,
  ).items;
}

function buildSmoothTurnMessage(
  threadViewId: string,
  turn: TurnRecord,
  content: string,
  messageOrder: number,
): ThreadViewMessageRecord {
  return {
    threadViewMessageId: createThreadViewMessageId({
      threadViewId,
      bandType: "smooth",
      sourceReference: turn.turnId,
      messageOrder,
    }),
    threadViewId,
    bandType: "smooth",
    sourceKind: "smooth_turn",
    sourceReference: turn.turnId,
    messageOrder,
    content,
  };
}

function buildLowerBandMessage(
  threadViewId: string,
  bandType: "detailed" | "brief",
  chunk: ChunkState,
  messageOrder: number,
): ThreadViewMessageRecord {
  const artifact = getReadyChunkLowerBandArtifact(chunk, bandType);

  return {
    threadViewMessageId: createThreadViewMessageId({
      threadViewId,
      bandType,
      sourceReference: chunk.chunkId,
      messageOrder,
    }),
    threadViewId,
    bandType,
    sourceKind: bandType === "detailed" ? "detailed_chunk_summary" : "brief_chunk_summary",
    sourceReference: chunk.chunkId,
    messageOrder,
    content: artifact?.text ?? "",
  };
}

function validateTurnSelections(
  threadId: string,
  orderedTurns: readonly TurnRecord[],
  band: BandRecord,
): StewardIssue[] {
  if (band.sourceUnitType !== "turn") {
    return [
      createWorkbenchIssue({
        code: "THREAD_VIEW_STATE_CONFLICT",
        message: `Band ${band.bandType} must select turns in thread ${threadId}.`,
        threadId,
      }),
    ];
  }

  const knownTurnIds = new Set(orderedTurns.map((turn) => turn.turnId));
  const missingTurnIds = [...new Set([...band.selectedIds, ...(band.exclusions ?? [])])].filter(
    (turnId) => !knownTurnIds.has(turnId),
  );

  return missingTurnIds.map((turnId) =>
    createWorkbenchIssue({
      code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
      message: `Turn ${turnId} was not found in thread ${threadId}.`,
      threadId,
    }),
  );
}

function validateLowerBandSelections(
  threadId: string,
  orderedChunks: readonly ChunkState[],
  turnsById: ReadonlyMap<string, TurnRecord>,
  messagesById: ReadonlyMap<string, MessageRecord>,
  band: BandRecord,
): StewardIssue[] {
  if (band.sourceUnitType !== "chunk") {
    return [
      createWorkbenchIssue({
        code: "THREAD_VIEW_STATE_CONFLICT",
        message: `Band ${band.bandType} must select chunks in thread ${threadId}.`,
        threadId,
      }),
    ];
  }

  const chunksById = new Map(orderedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const issues: StewardIssue[] = [];
  const selectedIds = [...new Set([...band.selectedIds, ...(band.exclusions ?? [])])];
  const lowerBandType = band.bandType as "detailed" | "brief";

  for (const chunkId of selectedIds) {
    const chunk = chunksById.get(chunkId);
    if (!chunk) {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Chunk ${chunkId} was not found in thread ${threadId}.`,
          threadId,
        }),
      );
      continue;
    }

    if (chunk.lifecycleStatus !== "closed") {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_CHUNK_INELIGIBLE",
          message: `Chunk ${chunkId} is ${chunk.lifecycleStatus} and cannot be used in the ${band.bandType} band.`,
          threadId,
        }),
      );
      continue;
    }

    const artifact = getReadyChunkLowerBandArtifact(chunk, lowerBandType);
    if (!artifact) {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_ARTIFACT_MISSING",
          message: `Chunk ${chunkId} is missing a ready ${lowerBandType} lower-band artifact required for materialization.`,
          threadId,
        }),
      );
    }
  }

  return issues;
}

function buildUpperBandMessages(input: {
  thread: ThreadRecord;
  view: ThreadViewRecord;
  turns: readonly TurnRecord[];
  messages: readonly MessageRecord[];
  fullFidelityBand: BandRecord;
  smoothBand: BandRecord;
}): {
  emittedMessages: ThreadViewMessageRecord[];
  bandStatuses: Pick<Record<BandType, BandRenderedStatus>, "full_fidelity" | "smooth">;
  issues: StewardIssue[];
} {
  const turnsById = indexTurns(input.turns);
  const messagesById = indexMessages(input.messages);
  const fullFidelityMessages: ThreadViewMessageRecord[] = [];
  const smoothMessages: ThreadViewMessageRecord[] = [];
  const issues: StewardIssue[] = [];

  input.fullFidelityBand.selectedIds.forEach((turnId, turnIndex) => {
    const turn = turnsById.get(turnId);
    if (!turn) {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Turn ${turnId} was not found in thread ${input.thread.threadId}.`,
          threadId: input.thread.threadId,
        }),
      );
      return;
    }

    const turnMessages = sortMessagesInSourceOrder(
      turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    if (turnMessages.length !== turn.messageIds.length) {
      issues.push(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Turn ${turn.turnId} cannot be materialized because canonical source messages are missing.`,
          threadId: input.thread.threadId,
          sourceRange: structuredClone(turn.sourceRange),
        }),
      );
      return;
    }

    turnMessages.forEach((message, messageIndex) => {
      fullFidelityMessages.push(
        buildRawTurnMessage(
          input.view.threadViewId,
          turn.turnId,
          message,
          turnIndex * 1_000 + messageIndex + 1,
        ),
      );
    });
  });

  input.smoothBand.selectedIds.forEach((turnId, turnIndex) => {
    const turn = turnsById.get(turnId);
    if (!turn) {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Turn ${turnId} was not found in thread ${input.thread.threadId}.`,
          threadId: input.thread.threadId,
        }),
      );
      return;
    }

    const turnMessages = sortMessagesInSourceOrder(
      turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is MessageRecord => message !== undefined),
    );
    const materialized = materializeSmoothTurnFromState({ turn, messages: turnMessages });
    if (
      turnMessages.length !== turn.messageIds.length ||
      (materialized.status !== "ready" && materialized.status !== "degraded") ||
      !materialized.text
    ) {
      issues.push(
        createWorkbenchIssue({
          code: "WORKBENCH_ARTIFACT_MISSING",
          message: `Turn ${turn.turnId} does not have a smooth representation available for the smooth band.`,
          threadId: input.thread.threadId,
          sourceRange: structuredClone(turn.sourceRange),
        }),
      );
      return;
    }

    smoothMessages.push(buildSmoothTurnMessage(input.view.threadViewId, turn, materialized.text, turnIndex + 1));
  });

  return {
    emittedMessages: concatenateBandMessages({
      full_fidelity: truncateRawThreadViewMessages(fullFidelityMessages),
      smooth: smoothMessages,
    }),
    bandStatuses: {
      full_fidelity:
        input.fullFidelityBand.selectedIds.length > 0 &&
        issues.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT")
          ? "blocked"
          : "ready",
      smooth:
        input.smoothBand.selectedIds.length > 0 &&
        issues.some((issue) => issue.code === "WORKBENCH_ARTIFACT_MISSING")
          ? "missing_artifacts"
          : "ready",
    },
    issues,
  };
}

function buildLowerBandMessages(input: {
  view: ThreadViewRecord;
  chunks: readonly ChunkState[];
  detailedBand: BandRecord;
  briefBand: BandRecord;
}): {
  emittedMessages: Partial<Record<BandType, ThreadViewMessageRecord[]>>;
  bandStatuses: Pick<Record<BandType, BandRenderedStatus>, "detailed" | "brief">;
} {
  const chunksById = new Map(input.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const detailedMessages = input.detailedBand.selectedIds.map((chunkId, index) =>
    buildLowerBandMessage(
      input.view.threadViewId,
      "detailed",
      chunksById.get(chunkId) as ChunkState,
      index + 1,
    ),
  );
  const briefMessages = input.briefBand.selectedIds.map((chunkId, index) =>
    buildLowerBandMessage(
      input.view.threadViewId,
      "brief",
      chunksById.get(chunkId) as ChunkState,
      index + 1,
    ),
  );

  return {
    emittedMessages: {
      detailed: detailedMessages,
      brief: briefMessages,
    },
    bandStatuses: {
      detailed: "ready",
      brief: "ready",
    },
  };
}

export class ThreadViewMaterializer {
  constructor(private readonly threadStore: ThreadStore) {}

  async materializeThreadView(
    input: MaterializeThreadViewInput,
  ): Promise<WorkbenchResult<MaterializeThreadViewResult>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const chunksSnapshot = await this.threadStore.readChunks(input.threadId);
    if (!chunksSnapshot.ok) {
      return failWorkbenchResult(...chunksSnapshot.issues);
    }

    const orderedTurns = sortTurnsInSourceOrder(threadSnapshot.value.turns);
    const turnsById = indexTurns(orderedTurns);
    const orderedChunks = sortChunksInSourceOrder(chunksSnapshot.value, turnsById);
    const fullFidelityValidation = validateTurnSelections(
      input.threadId,
      orderedTurns,
      input.draftView.fullFidelityBand,
    );
    const smoothValidation = validateTurnSelections(input.threadId, orderedTurns, input.draftView.smoothBand);
    const lowerBandValidation = LOWER_BAND_TYPES.flatMap((bandType) =>
      validateLowerBandSelections(
        input.threadId,
        orderedChunks,
        turnsById,
        indexMessages(threadSnapshot.value.messages),
        getBand(input.draftView, bandType),
      ),
    );
    if (
      fullFidelityValidation.length > 0 ||
      smoothValidation.length > 0 ||
      lowerBandValidation.length > 0
    ) {
      return failWorkbenchResult(...fullFidelityValidation, ...smoothValidation, ...lowerBandValidation);
    }

    const fullFidelityBand = normalizeTurnBand(
      "full_fidelity",
      input.draftView.fullFidelityBand,
      orderedTurns,
    );
    const smoothBand = deriveDefaultSmoothBand(input.draftView.smoothBand, orderedTurns, fullFidelityBand);
    const detailedBand = normalizeLowerBand("detailed", input.draftView.detailedBand, orderedChunks);
    const briefBand = normalizeLowerBand("brief", input.draftView.briefBand, orderedChunks);
    const upperBandMessages = buildUpperBandMessages({
      thread: threadSnapshot.value.thread,
      view: input.draftView,
      turns: orderedTurns,
      messages: threadSnapshot.value.messages,
      fullFidelityBand,
      smoothBand,
    });
    const lowerBandMessages = buildLowerBandMessages({
      view: input.draftView,
      chunks: orderedChunks,
      detailedBand,
      briefBand,
    });
    const emittedMessages = concatenateBandMessages({
      full_fidelity: upperBandMessages.emittedMessages.filter((message) => message.bandType === "full_fidelity"),
      smooth: upperBandMessages.emittedMessages.filter((message) => message.bandType === "smooth"),
      detailed: lowerBandMessages.emittedMessages.detailed,
      brief: lowerBandMessages.emittedMessages.brief,
    });

    return okWorkbenchResult({
      fullFidelityBand: {
        ...fullFidelityBand,
        renderedStatus: upperBandMessages.bandStatuses.full_fidelity,
      },
      smoothBand: {
        ...smoothBand,
        renderedStatus: upperBandMessages.bandStatuses.smooth,
      },
      emittedMessages,
      bandStatuses: {
        full_fidelity: upperBandMessages.bandStatuses.full_fidelity,
        smooth: upperBandMessages.bandStatuses.smooth,
        detailed: lowerBandMessages.bandStatuses.detailed,
        brief: lowerBandMessages.bandStatuses.brief,
      },
      issues: upperBandMessages.issues,
    }, upperBandMessages.issues);
  }
}

export function formatSmoothTurnFromMessages(messages: readonly MessageRecord[]): string {
  return sortMessagesInSourceOrder(messages)
    .flatMap((message) =>
      [...message.parts]
        .sort((left, right) => left.partOrder - right.partOrder)
        .map((part) => `${pickMarker(message, part.partType)}\n${stringifyPartContent(part.content)}`),
    )
    .join("\n\n");
}

export { UPPER_BAND_TYPES };
