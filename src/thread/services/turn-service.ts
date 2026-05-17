import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { compareSourceRanges, createSourceRange, createTurnId, mergeSourceRanges } from "../domain/ids.js";
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

export interface FinalizeOpenTurnInput {
  store: ThreadStore;
  threadId: string;
  closedAt?: string;
}

export interface FinalizeOpenTurnResult {
  turns: TurnRecord[];
  finalizedTurnId?: string;
  finalized: boolean;
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

export interface TurnMaintenanceReadinessReport {
  status: "ready" | "blocked";
  blockers: StewardIssue[];
  uncoveredRanges: SourceRange[];
  preTurnRanges: SourceRange[];
}

export interface ReconstructTurnsFromMessagesInput {
  threadId: string;
  messages: readonly MessageRecord[];
  sourceRevision: number;
  repairedAt?: string;
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

function isFinalAssistantMessage(message: MessageRecord): boolean {
  return message.messageKind === "response" && message.targetMetadata?.stopReason === "stop";
}

function isAmbiguousTurnBoundaryMessage(message: MessageRecord): boolean {
  if (message.messageKind === "unknown") {
    return true;
  }

  if (message.messageKind === "prompt") {
    return message.actorType !== "human";
  }

  return message.actorType === "human";
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

function turnStateLifecycleIssue(threadId: string, turn: TurnRecord, detail: string): StewardIssue {
  return {
    code: "TURN_STATE_INCOMPLETE",
    message: `Turn state for thread ${threadId} is incomplete: ${detail}`,
    threadId,
    sourceRange: { ...turn.sourceRange },
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

function turnRepairAmbiguousIssue(threadId: string, message: MessageRecord): StewardIssue {
  return {
    code: "TURN_REPAIR_AMBIGUOUS",
    message: `Stored message ${message.messageId} has an ambiguous turn boundary classification.`,
    threadId,
    sourceRange: createSourceRange(message.sourceOrder),
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

function closeTurnForLifecycleEnd(turn: TurnRecord, closedAt: string): TurnRecord {
  const nextTurn = cloneTurn(turn);
  nextTurn.lifecycleStatus = "closed";
  nextTurn.closedAt = closedAt;
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
    const appended = appendMessageToOpenTurn(turns[openTurnIndex]!, input.capturedMessage);
    turns[openTurnIndex] = isFinalAssistantMessage(input.capturedMessage)
      ? closeTurn(appended, input.capturedMessage)
      : appended;
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
  const mutationCheck = await input.store.assertCanMutate(input.threadId);
  if (!mutationCheck.ok) {
    return mutationCheck;
  }

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
    expectedTurnsRevision: mutationCheck.value.turnsRevision,
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

export async function finalizeOpenTurnOnTurnEnd(
  input: FinalizeOpenTurnInput,
): Promise<StewardResult<FinalizeOpenTurnResult>> {
  const mutationCheck = await input.store.assertCanMutate(input.threadId);
  if (!mutationCheck.ok) {
    return mutationCheck;
  }

  const existingTurns = await input.store.readTurns(input.threadId);
  if (!existingTurns.ok) {
    return existingTurns;
  }

  const turns = sortTurns(existingTurns.value);
  const openTurns = turns.filter((turn) => turn.lifecycleStatus === "open");
  if (openTurns.length === 0) {
    return ok({
      turns,
      finalized: false,
    });
  }

  if (openTurns.length > 1) {
    return fail(
      turnStateLifecycleIssue(
        input.threadId,
        openTurns[0]!,
        "multiple canonical turns are marked open.",
      ),
    );
  }

  const openTurn = openTurns[0]!;
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || lastTurn.turnId !== openTurn.turnId) {
    return fail(
      turnStateLifecycleIssue(
        input.threadId,
        openTurn,
        "the open canonical turn is not the latest turn.",
      ),
    );
  }

  const closedAt = input.closedAt ?? new Date().toISOString();
  const nextTurns = turns.map((turn) =>
    turn.turnId === openTurn.turnId ? closeTurnForLifecycleEnd(turn, closedAt) : turn,
  );
  const writtenTurns = await input.store.writeTurns({
    threadId: input.threadId,
    expectedSourceRevision: mutationCheck.value.sourceRevision,
    expectedMessageHighWatermark: mutationCheck.value.messageHighWatermark,
    expectedTurnsRevision: mutationCheck.value.turnsRevision,
    turns: nextTurns,
    turnState: "ready",
  });
  if (!writtenTurns.ok) {
    return writtenTurns;
  }

  return ok({
    turns: writtenTurns.value,
    finalizedTurnId: openTurn.turnId,
    finalized: true,
  });
}

function repairedTurnMetadata(
  turn: TurnRecord,
  sourceRevision: number,
  repairedAt: string | undefined,
): TurnRecord["repairMetadata"] {
  return {
    sourceRange: { ...turn.sourceRange },
    sourceRevisionChecked: sourceRevision,
    ...(repairedAt ? { repairedAt } : {}),
  };
}

export function reconstructTurnsFromMessages(
  input: ReconstructTurnsFromMessagesInput,
): StewardResult<TurnRecord[]> {
  const orderedMessages = sortMessages(input.messages);
  let turns: TurnRecord[] = [];

  for (const message of orderedMessages) {
    if (isAmbiguousTurnBoundaryMessage(message)) {
      return fail(turnRepairAmbiguousIssue(input.threadId, message));
    }

    const applied = applyCapturedMessageToTurns({
      existingTurns: turns,
      capturedMessage: message,
    });
    if (!applied.ok) {
      return fail(...applied.issues);
    }

    turns = applied.value;
  }

  return ok(
    turns.map((turn) => ({
      ...structuredClone(turn),
      repairStatus: "ready",
      sourceRevision: input.sourceRevision,
      repairMetadata: repairedTurnMetadata(turn, input.sourceRevision, input.repairedAt),
    })),
  );
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

function sortIssues(issues: readonly StewardIssue[]): StewardIssue[] {
  return [...issues]
    .map((issue) => ({
      ...issue,
      sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
    }))
    .sort((left, right) => {
      const leftRange = left.sourceRange;
      const rightRange = right.sourceRange;

      if (leftRange && rightRange) {
        const compared = compareSourceRanges(leftRange, rightRange);
        if (compared !== 0) {
          return compared;
        }
      } else if (leftRange) {
        return -1;
      } else if (rightRange) {
        return 1;
      }

      if (left.code !== right.code) {
        return left.code.localeCompare(right.code);
      }

      return left.message.localeCompare(right.message);
    });
}

function issueKey(issue: StewardIssue): string {
  return [
    issue.code,
    issue.threadId ?? "",
    issue.sourceRange?.fromSourceOrder ?? "",
    issue.sourceRange?.toSourceOrder ?? "",
    issue.message,
  ].join("|");
}

function postPromptRange(messages: readonly MessageRecord[]): SourceRange | undefined {
  const orderedMessages = sortMessages(messages);
  const firstPrompt = orderedMessages.find((message) => isPromptMessage(message));
  const lastMessage = orderedMessages.at(-1);

  if (!firstPrompt || !lastMessage || firstPrompt.sourceOrder > lastMessage.sourceOrder) {
    return undefined;
  }

  return createSourceRange(firstPrompt.sourceOrder, lastMessage.sourceOrder);
}

function turnRepairBlocker(turn: TurnRecord, threadId: string): StewardIssue {
  const failureCode = turn.repairMetadata?.failureCode;
  const sourceRange = turn.repairMetadata?.sourceRange ?? turn.sourceRange;
  const defaultMessage =
    turn.repairStatus === "repair_failed"
      ? `Turn repair is blocked for source range ${sourceRange.fromSourceOrder}-${sourceRange.toSourceOrder}.`
      : `Turn state is not ready for source range ${sourceRange.fromSourceOrder}-${sourceRange.toSourceOrder}.`;

  return {
    code:
      failureCode ??
      (turn.repairStatus === "repair_failed" ? "TURN_REPAIR_WRITE_FAILED" : "TURN_STATE_INCOMPLETE"),
    message: turn.repairMetadata?.failureReason ?? defaultMessage,
    threadId,
    sourceRange: { ...sourceRange },
  };
}

function threadStatusBlocker(snapshot: ThreadSnapshot, health: TurnHealthReport): StewardIssue | undefined {
  if (snapshot.thread.status.turnState === "ready" || snapshot.messages.length === 0) {
    return undefined;
  }

  const blockerRange =
    mergeSourceRanges(health.uncoveredRanges) ??
    mergeSourceRanges(snapshot.turns.map((turn) => turn.repairMetadata?.sourceRange ?? turn.sourceRange)) ??
    postPromptRange(snapshot.messages);

  if (!blockerRange) {
    return undefined;
  }

  return {
    code: snapshot.thread.status.turnState === "repair_failed" ? "TURN_REPAIR_WRITE_FAILED" : "TURN_STATE_INCOMPLETE",
    message:
      snapshot.thread.status.turnState === "repair_failed"
        ? `Turn repair remains blocked for thread ${snapshot.thread.threadId}.`
        : `Turn state is not ready for thread ${snapshot.thread.threadId}.`,
    threadId: snapshot.thread.threadId,
    sourceRange: blockerRange,
  };
}

export function checkMaintenanceReadiness(snapshot: ThreadSnapshot): TurnMaintenanceReadinessReport {
  const health = checkTurnHealth(snapshot);
  const blockers = [
    ...health.issues,
    ...snapshot.turns
      .filter((turn) => turn.repairStatus !== "ready")
      .map((turn) => turnRepairBlocker(turn, snapshot.thread.threadId)),
  ];
  const threadLevelBlocker =
    blockers.length === 0 ? threadStatusBlocker(snapshot, health) : undefined;

  if (threadLevelBlocker) {
    blockers.push(threadLevelBlocker);
  }

  const uniqueBlockers = sortIssues(
    blockers.filter((issue, index, issues) => issues.findIndex((candidate) => issueKey(candidate) === issueKey(issue)) === index),
  );

  return {
    status: uniqueBlockers.length === 0 ? "ready" : "blocked",
    blockers: uniqueBlockers,
    uncoveredRanges: health.uncoveredRanges.map((range) => ({ ...range })),
    preTurnRanges: health.preTurnRanges.map((range) => ({ ...range })),
  };
}
