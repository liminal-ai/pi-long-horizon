import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { createSourceRange, createTurnId, mergeSourceRanges } from "../domain/ids.js";
import type { MessageRecord, SourceRange, ThreadRecord, TurnRecord } from "../domain/records.js";
import type { ThreadStore } from "../store/thread-store.js";
import type { ThreadSnapshot } from "../store/thread-store.js";

export interface ApplyTurnInput {
  existingTurns: TurnRecord[];
  capturedMessage: MessageRecord;
}

export interface CapturedTurnWriteInput {
  store: ThreadStore;
  threadId: string;
  message: MessageRecord;
}

export interface CapturedTurnWriteResult {
  turns: TurnRecord[];
}

export type CapturedTurnWriter = (
  input: CapturedTurnWriteInput,
) => Promise<StewardResult<CapturedTurnWriteResult>>;

export interface TurnHealthReport {
  status: ThreadRecord["status"]["turnState"];
  issues: StewardIssue[];
  uncoveredRanges: SourceRange[];
  preTurnRanges: SourceRange[];
}

function cloneTurn(turn: TurnRecord): TurnRecord {
  return structuredClone(turn);
}

function cloneTurns(turns: readonly TurnRecord[]): TurnRecord[] {
  return turns.map((turn) => cloneTurn(turn));
}

function sortTurns(turns: readonly TurnRecord[]): TurnRecord[] {
  return cloneTurns(turns).sort((left, right) => {
    if (left.turnOrder !== right.turnOrder) {
      return left.turnOrder - right.turnOrder;
    }

    if (left.sourceRange.fromSourceOrder !== right.sourceRange.fromSourceOrder) {
      return left.sourceRange.fromSourceOrder - right.sourceRange.fromSourceOrder;
    }

    return left.sourceRange.toSourceOrder - right.sourceRange.toSourceOrder;
  });
}

function sortMessages(messages: readonly MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function isPromptMessage(message: MessageRecord): boolean {
  return message.messageKind === "prompt";
}

function messageTimestamp(message: MessageRecord): string {
  return message.createdAt ?? message.capturedAt;
}

function buildSourceRanges(messages: readonly MessageRecord[]): SourceRange[] {
  if (messages.length === 0) {
    return [];
  }

  const ranges: SourceRange[] = [];
  const orderedMessages = sortMessages(messages);
  let rangeStart = orderedMessages[0]!.sourceOrder;
  let previous = rangeStart;

  for (let index = 1; index < orderedMessages.length; index += 1) {
    const sourceOrder = orderedMessages[index]!.sourceOrder;
    if (sourceOrder !== previous + 1) {
      ranges.push(createSourceRange(rangeStart, previous));
      rangeStart = sourceOrder;
    }

    previous = sourceOrder;
  }

  ranges.push(createSourceRange(rangeStart, previous));
  return ranges;
}

function turnStateIncompleteIssue(threadId: string, message: MessageRecord, detail: string): StewardIssue {
  return {
    code: "TURN_STATE_INCOMPLETE",
    message: `Turn state for thread ${threadId} is incomplete: ${detail}`,
    threadId,
    sourceRange: createSourceRange(message.sourceOrder),
  };
}

function turnStateMissingIssue(threadId: string, sourceRange: SourceRange): StewardIssue {
  return {
    code: "TURN_STATE_MISSING",
    message: `Turn state is missing for thread ${threadId}.`,
    threadId,
    sourceRange,
  };
}

function validateExistingTurns(turns: readonly TurnRecord[], capturedMessage: MessageRecord): StewardIssue | undefined {
  const openTurns = turns.filter((turn) => turn.lifecycleStatus === "open");
  if (openTurns.length > 1) {
    return turnStateIncompleteIssue(
      capturedMessage.threadId,
      capturedMessage,
      "multiple canonical turns are marked open.",
    );
  }

  if (openTurns.length === 1) {
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn || lastTurn.turnId !== openTurns[0]!.turnId) {
      return turnStateIncompleteIssue(
        capturedMessage.threadId,
        capturedMessage,
        "the open canonical turn is not the latest turn.",
      );
    }
  }

  return undefined;
}

function appendMessageToOpenTurn(turn: TurnRecord, message: MessageRecord): TurnRecord {
  const nextTurn = cloneTurn(turn);
  nextTurn.messageIds = [...nextTurn.messageIds, message.messageId];
  nextTurn.sourceRange = createSourceRange(nextTurn.sourceRange.fromSourceOrder, message.sourceOrder);
  nextTurn.sourceRevision = message.sourceRevision;
  nextTurn.repairStatus = "ready";
  return nextTurn;
}

function closeTurn(turn: TurnRecord, message: MessageRecord): TurnRecord {
  const nextTurn = cloneTurn(turn);
  nextTurn.lifecycleStatus = "closed";
  nextTurn.closedAt = messageTimestamp(message);
  nextTurn.sourceRevision = message.sourceRevision;
  nextTurn.repairStatus = "ready";
  return nextTurn;
}

function createPromptTurn(existingTurns: readonly TurnRecord[], message: MessageRecord): TurnRecord {
  const maxTurnOrder = existingTurns.reduce((highest, turn) => Math.max(highest, turn.turnOrder), 0);

  return {
    turnId: createTurnId(),
    threadId: message.threadId,
    turnOrder: maxTurnOrder + 1,
    lifecycleStatus: "open",
    repairStatus: "ready",
    initiatingMessageId: message.messageId,
    messageIds: [message.messageId],
    sourceRange: createSourceRange(message.sourceOrder),
    openedAt: messageTimestamp(message),
    sourceRevision: message.sourceRevision,
  };
}

export function applyCapturedMessageToTurns(input: ApplyTurnInput): StewardResult<TurnRecord[]> {
  const turns = sortTurns(input.existingTurns);
  const validationIssue = validateExistingTurns(turns, input.capturedMessage);
  if (validationIssue) {
    return fail(validationIssue);
  }

  const openTurnIndex = turns.findIndex((turn) => turn.lifecycleStatus === "open");

  if (isPromptMessage(input.capturedMessage)) {
    if (openTurnIndex >= 0) {
      turns[openTurnIndex] = closeTurn(turns[openTurnIndex]!, input.capturedMessage);
    }

    turns.push(createPromptTurn(turns, input.capturedMessage));
    return ok(turns);
  }

  if (openTurnIndex >= 0) {
    turns[openTurnIndex] = appendMessageToOpenTurn(turns[openTurnIndex]!, input.capturedMessage);
    return ok(turns);
  }

  if (turns.length === 0) {
    return ok(turns);
  }

  return fail(
    turnStateIncompleteIssue(
      input.capturedMessage.threadId,
      input.capturedMessage,
      "non-prompt activity arrived without an open canonical turn.",
    ),
  );
}

export async function writeCapturedMessageTurns(
  input: CapturedTurnWriteInput,
): Promise<StewardResult<CapturedTurnWriteResult>> {
  const existingTurns = await input.store.readTurns(input.threadId);
  if (!existingTurns.ok) {
    return existingTurns;
  }

  const appliedTurns = applyCapturedMessageToTurns({
    existingTurns: existingTurns.value,
    capturedMessage: input.message,
  });
  if (!appliedTurns.ok) {
    return appliedTurns;
  }

  const writtenTurns = await input.store.writeTurns({
    threadId: input.threadId,
    expectedSourceRevision: input.message.sourceRevision,
    expectedMessageHighWatermark: input.message.sourceOrder,
    turns: appliedTurns.value,
    turnState: "ready",
  });
  if (!writtenTurns.ok) {
    return writtenTurns;
  }

  return ok({
    turns: writtenTurns.value,
  });
}

function coveredMessageOrders(snapshot: ThreadSnapshot): Set<number> {
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));
  const covered = new Set<number>();

  for (const turn of snapshot.turns) {
    for (const messageId of turn.messageIds) {
      const message = messagesById.get(messageId);
      if (message) {
        covered.add(message.sourceOrder);
      }
    }
  }

  return covered;
}

function nonReadyStatus(
  thread: ThreadRecord,
): Extract<ThreadRecord["status"]["turnState"], "repair_needed" | "repair_failed" | "unknown"> {
  if (thread.status.turnState === "repair_failed") {
    return "repair_failed";
  }

  return "repair_needed";
}

export function checkTurnHealth(snapshot: ThreadSnapshot): TurnHealthReport {
  const orderedMessages = sortMessages(snapshot.messages);
  if (orderedMessages.length === 0) {
    return {
      status: "ready",
      issues: [],
      uncoveredRanges: [],
      preTurnRanges: [],
    };
  }

  const firstPromptOrder = orderedMessages.find((message) => isPromptMessage(message))?.sourceOrder;
  const coveredOrders = coveredMessageOrders(snapshot);
  const preTurnMessages = orderedMessages.filter((message) =>
    firstPromptOrder === undefined ? true : message.sourceOrder < firstPromptOrder,
  );
  const preTurnUncoveredMessages = preTurnMessages.filter((message) => !coveredOrders.has(message.sourceOrder));
  const uncoveredMessages = orderedMessages.filter(
    (message) =>
      !coveredOrders.has(message.sourceOrder) &&
      firstPromptOrder !== undefined &&
      message.sourceOrder >= firstPromptOrder,
  );

  const issues: StewardIssue[] = [];
  const uncoveredRanges = buildSourceRanges(uncoveredMessages);

  if (firstPromptOrder !== undefined && snapshot.turns.length === 0) {
    issues.push(turnStateMissingIssue(snapshot.thread.threadId, createSourceRange(firstPromptOrder, orderedMessages.at(-1)!.sourceOrder)));
  } else if (uncoveredRanges.length > 0) {
    const uncoveredRange = mergeSourceRanges(uncoveredRanges)!;
    issues.push({
      code: "TURN_STATE_INCOMPLETE",
      message: `Turn state is incomplete for thread ${snapshot.thread.threadId}.`,
      threadId: snapshot.thread.threadId,
      sourceRange: uncoveredRange,
    });
  }

  const turnValidationIssue = validateExistingTurns(sortTurns(snapshot.turns), orderedMessages.at(-1)!);
  if (turnValidationIssue) {
    issues.push(turnValidationIssue);
  }

  return {
    status: issues.length === 0 ? "ready" : nonReadyStatus(snapshot.thread),
    issues,
    uncoveredRanges,
    preTurnRanges: buildSourceRanges(preTurnUncoveredMessages),
  };
}
