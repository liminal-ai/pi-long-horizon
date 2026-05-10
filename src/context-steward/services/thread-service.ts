import { fail, ok, type StewardResult } from "../domain/errors.js";
import { createThreadId } from "../domain/ids.js";
import type {
  ActorRecord,
  MessageRecord,
  ProjectionRevisionRecord,
  ThreadRecord,
  ThreadTargetMetadata,
  TurnRecord,
} from "../domain/records.js";
import { createThreadRecord } from "../domain/records.js";
import type { AppendMessageInput, ThreadStore } from "../store/thread-store.js";

export interface ManagedThreadInput {
  target: ThreadTargetMetadata;
  now?: () => Date;
}

export interface AppendSourceMessageInput {
  store: ThreadStore;
  threadId: string;
  actor: ActorRecord;
  message: AppendMessageInput["message"];
  targetEventKey?: string;
}

export interface GeneratedSessionMetadataInput {
  store: ThreadStore;
  threadId: string;
  generatedFilePath?: string;
  revision?: ProjectionRevisionRecord;
  now?: () => Date;
}

const appendSourceMessageQueues = new Map<string, Promise<void>>();

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

async function withSerializedAppendSourceMessage<T>(
  threadId: string,
  run: () => Promise<StewardResult<T>>,
): Promise<StewardResult<T>> {
  const previous = appendSourceMessageQueues.get(threadId) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  appendSourceMessageQueues.set(threadId, chain);

  await previous.catch(() => undefined);

  try {
    return await run();
  } finally {
    releaseQueue();
    if (appendSourceMessageQueues.get(threadId) === chain) {
      appendSourceMessageQueues.delete(threadId);
    }
  }
}

function mergeManagedTarget(
  existing: ThreadTargetMetadata,
  incoming: ThreadTargetMetadata,
): ThreadTargetMetadata {
  const merged = {
    ...existing,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)),
  };

  if (existing.sessionId !== undefined) {
    merged.sessionId = existing.sessionId;
  }

  if (existing.sessionFilePath !== undefined) {
    merged.sessionFilePath = existing.sessionFilePath;
  }

  return merged;
}

function managedTargetsMatch(left: ThreadTargetMetadata, right: ThreadTargetMetadata): boolean {
  return (
    left.runtime === right.runtime &&
    left.sessionId === right.sessionId &&
    left.sessionFilePath === right.sessionFilePath &&
    left.cwd === right.cwd &&
    left.currentGeneratedFilePath === right.currentGeneratedFilePath
  );
}

export async function openOrCreateManagedThread(
  input: ManagedThreadInput,
  store: ThreadStore,
): Promise<StewardResult<ThreadRecord>> {
  const targetRef = {
    runtime: input.target.runtime,
    sessionId: input.target.sessionId,
    sessionFilePath: input.target.sessionFilePath,
  } as const;

  const existing = await store.findManagedThread(input.target);
  if (!existing.ok) {
    return existing;
  }

  let thread: ThreadRecord;

  if (existing.value) {
    const nextTarget = mergeManagedTarget(existing.value.target, input.target);
    const targetMatches = managedTargetsMatch(existing.value.target, nextTarget);

    if (targetMatches) {
      thread = existing.value;
    } else {
      const updated = await store.updateThreadMetadata({
        threadId: existing.value.threadId,
        patch: {
          target: nextTarget,
          updatedAt: nowIso(input.now),
        },
      });

      if (!updated.ok) {
        return updated;
      }

      thread = updated.value;
    }
  } else {
    const createdAt = nowIso(input.now);
    const created = await store.createThread({
      thread: createThreadRecord({
        threadId: createThreadId(),
        target: input.target,
        createdAt,
      }),
      targetRef,
    });

    if (!created.ok) {
      return created;
    }

    thread = created.value;
  }

  return store.assertCanMutate(thread.threadId);
}

export async function declareThreadActor(
  store: ThreadStore,
  threadId: string,
  actor: ActorRecord,
): Promise<StewardResult<ActorRecord>> {
  const existingActors = await store.listActors(threadId);
  if (!existingActors.ok) {
    return existingActors;
  }

  const existingActor = existingActors.value.find((candidate) => candidate.actorId === actor.actorId);
  if (existingActor) {
    return ok(existingActor);
  }

  return store.upsertActor(threadId, actor);
}

export async function appendSourceMessage(input: AppendSourceMessageInput): Promise<StewardResult<MessageRecord>> {
  return withSerializedAppendSourceMessage(input.threadId, async () => {
    const actor = await declareThreadActor(input.store, input.threadId, input.actor);
    if (!actor.ok) {
      return actor;
    }

    return input.store.appendMessage({
      threadId: input.threadId,
      actor: actor.value,
      message: input.message,
      targetEventKey: input.targetEventKey,
    });
  });
}

export async function updateGeneratedSessionMetadata(
  input: GeneratedSessionMetadataInput,
): Promise<StewardResult<ThreadRecord>> {
  const mutationCheck = await input.store.assertCanMutate(input.threadId);
  if (!mutationCheck.ok) {
    return mutationCheck;
  }

  if (input.revision) {
    if (input.revision.threadId !== input.threadId) {
      return fail({
        code: "STORE_UNAVAILABLE",
        message: `Projection revision ${input.revision.revisionId} does not belong to thread ${input.threadId}.`,
        threadId: input.threadId,
      });
    }

    const writtenRevision = await input.store.writeProjectionRevision(input.revision);
    if (!writtenRevision.ok) {
      return writtenRevision;
    }
  }

  return input.store.updateThreadMetadata({
    threadId: input.threadId,
    expectedSourceRevision: mutationCheck.value.sourceRevision,
    patch: {
      target: {
        ...mutationCheck.value.target,
        currentGeneratedFilePath: input.generatedFilePath,
      },
      projectionSummary: {
        ...mutationCheck.value.projectionSummary,
        currentGeneratedFilePath: input.generatedFilePath,
      },
      updatedAt: nowIso(input.now),
    },
  });
}

export async function readThreadTurns(store: ThreadStore, threadId: string): Promise<StewardResult<TurnRecord[]>> {
  return store.readTurns(threadId);
}
