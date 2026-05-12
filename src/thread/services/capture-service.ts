import { fail, mergeIssues, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { createMessageId } from "../domain/ids.js";
import type {
  ActorRecord,
  MessageKind,
  MessageRecord,
  PiTargetMetadata,
  ThreadRecord,
  TurnRecord,
} from "../domain/records.js";
import type { ThreadStore } from "../store/thread-store.js";
import {
  declareThreadActor,
  withSerializedThreadOperation,
} from "./thread-service.js";
import {
  writeCapturedMessageTurns,
  type CapturedTurnWriter,
} from "./turn-service.js";

export interface CanonicalActivity {
  actor: ActorRecord;
  messageKind: MessageKind;
  createdAt?: string;
  parts: MessageRecord["parts"];
  targetMetadata: PiTargetMetadata;
  targetEventKey?: string;
  tokenTelemetry?: MessageRecord["tokenTelemetry"];
}

export interface CaptureActivityInput {
  store: ThreadStore;
  threadId: string;
  activity: CanonicalActivity;
  turnWriter?: CapturedTurnWriter;
}

export interface CaptureActivityResult {
  message: MessageRecord;
  turns: TurnRecord[];
  duplicate: boolean;
  turnStateOutcome: "updated" | "repair_needed" | "not_applicable";
}

function cloneTurns(turns: readonly TurnRecord[]): TurnRecord[] {
  return turns.map((turn) => structuredClone(turn));
}

function duplicateCaptureIssue(targetEventKey: string, threadId: string): StewardIssue {
  return {
    code: "CAPTURE_DUPLICATE_EVENT",
    message: `Target event ${targetEventKey} was already captured for thread ${threadId}.`,
    threadId,
  };
}

function captureAppendFailedIssue(input: {
  threadId: string;
  activity: CanonicalActivity;
  cause: string;
}): StewardIssue {
  const actorLabel = `${input.activity.actor.actorType}:${input.activity.actor.actorId}`;
  const eventTimestamp = input.activity.createdAt ?? "unknown";

  return {
    code: "CAPTURE_APPEND_FAILED",
    message: `Failed to append ${input.activity.messageKind} from ${actorLabel} at ${eventTimestamp}.`,
    threadId: input.threadId,
    targetRuntime: input.activity.targetMetadata.runtime,
    targetSessionId: input.activity.targetMetadata.sessionId,
    cause: input.cause,
  };
}

function stringifyIssues(issues: readonly StewardIssue[]): string {
  return issues
    .map((issue) => `${issue.code}: ${issue.message}${issue.cause ? ` (${issue.cause})` : ""}`)
    .join("; ");
}

function findCapturedMessageByTargetEventKey(
  snapshot: Awaited<ReturnType<ThreadStore["openThread"]>> extends StewardResult<infer TValue> ? TValue : never,
  targetEventKey: string,
): MessageRecord | undefined {
  const messageId = snapshot.thread.indexes.targetEventKeys[targetEventKey];
  if (!messageId) {
    return undefined;
  }

  return snapshot.messages.find((message) => message.messageId === messageId);
}

async function readCurrentTurns(store: ThreadStore, threadId: string): Promise<StewardResult<TurnRecord[]>> {
  const turns = await store.readTurns(threadId);
  if (!turns.ok) {
    return turns;
  }

  return ok(cloneTurns(turns.value));
}

async function resolveDuplicateCapture(
  store: ThreadStore,
  threadId: string,
  targetEventKey: string,
): Promise<StewardResult<CaptureActivityResult>> {
  const snapshot = await store.openThread(threadId);
  if (!snapshot.ok) {
    return snapshot;
  }

  const existingMessage = findCapturedMessageByTargetEventKey(snapshot.value, targetEventKey);
  if (!existingMessage) {
    return fail({
      code: "STORE_UNAVAILABLE",
      message: `Target event ${targetEventKey} is indexed for thread ${threadId}, but the stored message could not be found.`,
      threadId,
    });
  }

  return ok(
    {
      message: structuredClone(existingMessage),
      turns: cloneTurns(snapshot.value.turns),
      duplicate: true,
      turnStateOutcome: "not_applicable",
    },
    [duplicateCaptureIssue(targetEventKey, threadId)],
  );
}

async function markThreadRepairNeeded(
  store: ThreadStore,
  threadId: string,
  expectedSourceRevision: number,
): Promise<StewardIssue[]> {
  const updated = await store.updateThreadMetadata({
    threadId,
    expectedSourceRevision,
    patch: {
      status: {
        turnState: "repair_needed",
      },
    },
  });

  return updated.ok ? [] : updated.issues;
}

async function applyCapturedTurns(
  input: CaptureActivityInput,
  message: MessageRecord,
): Promise<StewardResult<CaptureActivityResult>> {
  const turnWriter = input.turnWriter ?? writeCapturedMessageTurns;
  const writtenTurns = await turnWriter({
    store: input.store,
    threadId: input.threadId,
    message,
  });

  if (writtenTurns.ok) {
    return ok(
      {
        message: structuredClone(message),
        turns: cloneTurns(writtenTurns.value.turns),
        duplicate: false,
        turnStateOutcome: "updated",
      },
      writtenTurns.issues,
    );
  }

  const repairIssues = await markThreadRepairNeeded(input.store, input.threadId, message.sourceRevision);
  const currentTurns = await readCurrentTurns(input.store, input.threadId);
  const issues = mergeIssues(writtenTurns.issues, repairIssues, currentTurns.ok ? undefined : currentTurns.issues);

  return ok({
    message: structuredClone(message),
    turns: currentTurns.ok ? currentTurns.value : [],
    duplicate: false,
    turnStateOutcome: "repair_needed",
  }, issues);
}

export async function captureFinalizedActivityInCurrentThreadOperation(
  input: CaptureActivityInput,
): Promise<StewardResult<CaptureActivityResult>> {
  const targetEventKey = input.activity.targetEventKey ?? input.activity.targetMetadata.targetEventKey;

  if (targetEventKey) {
    const snapshot = await input.store.openThread(input.threadId);
    if (!snapshot.ok) {
      return snapshot;
    }

    const existingMessage = findCapturedMessageByTargetEventKey(snapshot.value, targetEventKey);
    if (existingMessage) {
      return ok(
        {
          message: structuredClone(existingMessage),
          turns: cloneTurns(snapshot.value.turns),
          duplicate: true,
          turnStateOutcome: "not_applicable",
        },
        [duplicateCaptureIssue(targetEventKey, input.threadId)],
      );
    }
  }

  const actor = await declareThreadActor(
    input.store,
    input.threadId,
    structuredClone(input.activity.actor),
  );
  if (!actor.ok) {
    return actor;
  }

  const targetMetadata = {
    ...structuredClone(input.activity.targetMetadata),
    targetEventKey,
  };

  const appended = await input.store.appendMessage({
    threadId: input.threadId,
    actor: actor.value,
    message: {
      messageId: createMessageId(),
      threadId: input.threadId,
      actorId: input.activity.actor.actorId,
      actorType: input.activity.actor.actorType,
      messageKind: input.activity.messageKind,
      createdAt: input.activity.createdAt,
      parts: input.activity.parts.map((part) => structuredClone(part)),
      targetMetadata,
      tokenTelemetry: input.activity.tokenTelemetry
        ? structuredClone(input.activity.tokenTelemetry)
        : undefined,
    },
    targetEventKey,
  });

  if (!appended.ok) {
    if (targetEventKey && appended.issues.some((issue) => issue.code === "CAPTURE_DUPLICATE_EVENT")) {
      return resolveDuplicateCapture(input.store, input.threadId, targetEventKey);
    }

    const cause = stringifyIssues(appended.issues);
    return fail(captureAppendFailedIssue({ threadId: input.threadId, activity: input.activity, cause }), ...appended.issues);
  }

  return applyCapturedTurns(input, appended.value);
}

export async function captureFinalizedActivity(
  input: CaptureActivityInput,
): Promise<StewardResult<CaptureActivityResult>> {
  return withSerializedThreadOperation(input.threadId, async () =>
    captureFinalizedActivityInCurrentThreadOperation(input),
  );
}

export function getThreadTurnState(thread: ThreadRecord): ThreadRecord["status"]["turnState"] {
  return thread.status.turnState;
}
