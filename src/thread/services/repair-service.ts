import { fail, mergeIssues, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { type SourceRange, type ThreadRecord, type TurnRecord } from "../domain/records.js";
import type { ThreadSnapshot, ThreadStore } from "../store/thread-store.js";
import { withSerializedThreadOperation } from "./thread-service.js";
import {
  checkMaintenanceReadiness,
  checkTurnHealth,
  persistTurnsWithRowFallback,
  reconstructTurnsFromMessages,
  type TurnHealthReport,
} from "./turn-service.js";

export interface RepairTurnStateInput {
  store: ThreadStore;
  threadId: string;
  range?: SourceRange;
  now?: () => Date;
}

export interface RepairTurnStateResult {
  turns: TurnRecord[];
  health: TurnHealthReport;
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function rangeOverlaps(left: SourceRange, right: SourceRange): boolean {
  return left.fromSourceOrder <= right.toSourceOrder && right.fromSourceOrder <= left.toSourceOrder;
}

function sortTurns(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns]
    .map((turn) => structuredClone(turn))
    .sort((left, right) => {
      if (left.turnOrder !== right.turnOrder) {
        return left.turnOrder - right.turnOrder;
      }

      if (left.sourceRange.fromSourceOrder !== right.sourceRange.fromSourceOrder) {
        return left.sourceRange.fromSourceOrder - right.sourceRange.fromSourceOrder;
      }

      return left.sourceRange.toSourceOrder - right.sourceRange.toSourceOrder;
    });
}

function mergeTurnsForRange(
  existingTurns: readonly TurnRecord[],
  reconstructedTurns: readonly TurnRecord[],
  range: SourceRange | undefined,
): TurnRecord[] {
  if (!range) {
    return sortTurns(reconstructedTurns);
  }

  const existingTurnsByInitiatingMessageId = new Map(
    existingTurns.map((turn) => [turn.initiatingMessageId, turn]),
  );
  const repairedTurns = reconstructedTurns
    .filter((turn) => rangeOverlaps(turn.sourceRange, range))
    .map((turn) => {
      const existingTurn = existingTurnsByInitiatingMessageId.get(turn.initiatingMessageId);
      if (!existingTurn) {
        return turn;
      }

      return {
        ...turn,
        turnId: existingTurn.turnId,
        turnOrder: existingTurn.turnOrder,
        sourceRevision: existingTurn.sourceRevision,
      };
    });
  const unaffectedTurns = existingTurns.filter(
    (turn) =>
      !rangeOverlaps(turn.sourceRange, range) &&
      !repairedTurns.some(
        (repairedTurn) =>
          repairedTurn.initiatingMessageId === turn.initiatingMessageId ||
          rangeOverlaps(repairedTurn.sourceRange, turn.sourceRange),
      ),
  );

  return sortTurns([...unaffectedTurns, ...repairedTurns]);
}

function turnStateFromReadiness(
  previous: ThreadRecord["status"]["turnState"],
  turns: readonly TurnRecord[],
  readiness: ReturnType<typeof checkMaintenanceReadiness>,
): ThreadRecord["status"]["turnState"] {
  if (readiness.status === "ready") {
    return "ready";
  }

  if (turns.some((turn) => turn.repairStatus === "repair_failed")) {
    return "repair_failed";
  }

  return previous === "repair_failed" ? "repair_failed" : "repair_needed";
}

function stringifyIssues(issues: readonly StewardIssue[]): string {
  return issues
    .map((issue) => `${issue.code}: ${issue.message}${issue.cause ? ` (${issue.cause})` : ""}`)
    .join("; ");
}

async function markThreadRepairFailed(
  store: ThreadStore,
  snapshot: ThreadSnapshot,
): Promise<readonly StewardIssue[] | undefined> {
  const updated = await store.updateThreadMetadata({
    threadId: snapshot.thread.threadId,
    expectedSourceRevision: snapshot.thread.sourceRevision,
    patch: {
      status: {
        turnState: "repair_failed",
      },
    },
  });

  return updated.ok ? undefined : updated.issues;
}

function mapWriteFailureIssues(
  threadId: string,
  range: SourceRange | undefined,
  issues: readonly StewardIssue[],
): StewardIssue[] {
  if (issues.some((issue) => issue.code === "STALE_SOURCE_REVISION")) {
    return issues.map((issue) => ({
      ...issue,
      threadId: issue.threadId ?? threadId,
      sourceRange: issue.sourceRange ?? range,
    }));
  }

  return [
    {
      code: "TURN_REPAIR_WRITE_FAILED",
      message: `Failed to write repaired turn state for thread ${threadId}.`,
      threadId,
      sourceRange: range,
      cause: stringifyIssues(issues),
    },
    ...issues.map((issue) => ({
      ...issue,
      threadId: issue.threadId ?? threadId,
      sourceRange: issue.sourceRange ?? range,
    })),
  ];
}

export async function repairTurnState(
  input: RepairTurnStateInput,
): Promise<StewardResult<RepairTurnStateResult>> {
  return withSerializedThreadOperation(input.threadId, async () => {
    const snapshot = await input.store.openThread(input.threadId);
    if (!snapshot.ok) {
      return snapshot;
    }

    const repairedAt = nowIso(input.now);
    const reconstructed = reconstructTurnsFromMessages({
      threadId: input.threadId,
      messages: snapshot.value.messages,
      sourceRevision: snapshot.value.thread.sourceRevision,
      repairedAt,
    });
    if (!reconstructed.ok) {
      const failureIssues = await markThreadRepairFailed(input.store, snapshot.value);
      return fail(...mergeIssues(reconstructed.issues, failureIssues));
    }

    const nextTurns = mergeTurnsForRange(snapshot.value.turns, reconstructed.value, input.range);
    const proposedSnapshot: ThreadSnapshot = {
      ...snapshot.value,
      thread: {
        ...snapshot.value.thread,
        status: {
          turnState: "ready",
        },
      },
      turns: nextTurns,
    };
    const readiness = checkMaintenanceReadiness(proposedSnapshot);
    const nextTurnState = turnStateFromReadiness(snapshot.value.thread.status.turnState, nextTurns, readiness);
    const writeResult = await persistTurnsWithRowFallback({
      store: input.store,
      threadId: input.threadId,
      existingTurns: snapshot.value.turns,
      nextTurns,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turnState: nextTurnState,
      updatedAt: repairedAt,
    });

    if (!writeResult.ok) {
      const failureIssues = writeResult.issues.some((issue) => issue.code === "STALE_SOURCE_REVISION")
        ? undefined
        : await markThreadRepairFailed(input.store, snapshot.value);
      return fail(...mergeIssues(mapWriteFailureIssues(input.threadId, input.range, writeResult.issues), failureIssues));
    }

    const finalSnapshot = await input.store.openThread(input.threadId);
    if (!finalSnapshot.ok) {
      return finalSnapshot;
    }

    const health = checkTurnHealth(finalSnapshot.value);
    const finalReadiness = checkMaintenanceReadiness(finalSnapshot.value);

    return ok(
      {
        turns: sortTurns(finalSnapshot.value.turns),
        health,
      },
      finalReadiness.status === "ready" ? undefined : finalReadiness.blockers,
    );
  });
}
