import type { StewardIssue } from "../../context-steward/domain/errors.js";
import type { MessageRecord, ThreadRecord, TurnRecord } from "../../context-steward/domain/records.js";
import type { ThreadStore } from "../../context-steward/store/thread-store.js";
import {
  bandTypeToSourceUnitType,
  cloneBandRecord,
  concatenateBandMessages,
  createThreadViewMessageId,
  type BandRecord,
  type BandType,
  type BandRenderedStatus,
  type ThreadViewMessageRecord,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";

const UPPER_BAND_TYPES = ["full_fidelity", "smooth"] as const;

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

function deriveDefaultSmoothBand(
  smoothBand: BandRecord,
  orderedTurns: readonly TurnRecord[],
  fullFidelityBand: BandRecord,
): BandRecord {
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
    content: {
      messageId: message.messageId,
      actorId: message.actorId,
      actorType: message.actorType,
      messageKind: message.messageKind,
      capturedAt: message.capturedAt,
      parts: structuredClone(message.parts),
      targetMetadata: message.targetMetadata ? structuredClone(message.targetMetadata) : undefined,
    },
  };
}

function buildSmoothTurnMessage(
  threadViewId: string,
  turn: TurnRecord,
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
    content: turn.smooth?.text ?? "",
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

function carryForwardLowerBandMessages(
  view: ThreadViewRecord,
): Record<"detailed" | "brief", ThreadViewMessageRecord[]> {
  return {
    detailed: view.emittedMessages
      .filter((message) => message.bandType === "detailed")
      .map((message) => structuredClone(message)),
    brief: view.emittedMessages
      .filter((message) => message.bandType === "brief")
      .map((message) => structuredClone(message)),
  };
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

    if (!turn.smooth?.text) {
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

    smoothMessages.push(buildSmoothTurnMessage(input.view.threadViewId, turn, turnIndex + 1));
  });

  return {
    emittedMessages: concatenateBandMessages({
      full_fidelity: fullFidelityMessages,
      smooth: smoothMessages,
    }),
    bandStatuses: {
      full_fidelity: "ready",
      smooth:
        input.smoothBand.selectedIds.length > 0 &&
        issues.some((issue) => issue.code === "WORKBENCH_ARTIFACT_MISSING")
          ? "missing_artifacts"
          : "ready",
    },
    issues,
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

    const orderedTurns = sortTurnsInSourceOrder(threadSnapshot.value.turns);
    const fullFidelityValidation = validateTurnSelections(
      input.threadId,
      orderedTurns,
      input.draftView.fullFidelityBand,
    );
    const smoothValidation = validateTurnSelections(input.threadId, orderedTurns, input.draftView.smoothBand);
    if (fullFidelityValidation.length > 0 || smoothValidation.length > 0) {
      return failWorkbenchResult(...fullFidelityValidation, ...smoothValidation);
    }

    const fullFidelityBand = normalizeTurnBand(
      "full_fidelity",
      input.draftView.fullFidelityBand,
      orderedTurns,
    );
    const smoothBand = deriveDefaultSmoothBand(input.draftView.smoothBand, orderedTurns, fullFidelityBand);
    const upperBandMessages = buildUpperBandMessages({
      thread: threadSnapshot.value.thread,
      view: input.draftView,
      turns: orderedTurns,
      messages: threadSnapshot.value.messages,
      fullFidelityBand,
      smoothBand,
    });
    const lowerBandMessages = carryForwardLowerBandMessages(input.draftView);
    const emittedMessages = concatenateBandMessages({
      full_fidelity: upperBandMessages.emittedMessages.filter((message) => message.bandType === "full_fidelity"),
      smooth: upperBandMessages.emittedMessages.filter((message) => message.bandType === "smooth"),
      detailed: lowerBandMessages.detailed,
      brief: lowerBandMessages.brief,
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
        detailed: getBand(input.draftView, "detailed").renderedStatus,
        brief: getBand(input.draftView, "brief").renderedStatus,
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
