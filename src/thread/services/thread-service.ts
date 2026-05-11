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
import type { GeneratedOutputMetadata } from "../domain/output-metadata.js";

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

export interface GeneratedThreadViewOutputMetadataInput {
  store: ThreadStore;
  threadId: string;
  generatedFilePath?: string;
  revision?: ProjectionRevisionRecord;
  generatedOutput?: GeneratedOutputMetadata;
  now?: () => Date;
}

const serializedThreadOperationQueues = new Map<string, Promise<void>>();

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

export async function withSerializedThreadOperation<T>(
  threadId: string,
  run: () => Promise<StewardResult<T>>,
): Promise<StewardResult<T>> {
  const previous = serializedThreadOperationQueues.get(threadId) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  serializedThreadOperationQueues.set(threadId, chain);

  await previous.catch(() => undefined);

  try {
    return await run();
  } finally {
    releaseQueue();
    if (serializedThreadOperationQueues.get(threadId) === chain) {
      serializedThreadOperationQueues.delete(threadId);
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
  return withSerializedThreadOperation(input.threadId, async () => {
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

function buildNextThreadViewOutputSummary(input: {
  thread: ThreadRecord;
  generatedFilePath?: string;
  generatedOutput?: GeneratedOutputMetadata;
}): ThreadRecord["threadViewOutputSummary"] {
  const nextThreadViewOutputSummary =
    input.thread.threadViewOutputSummary.count > 0
      ? input.thread.threadViewOutputSummary
      : {
          ...input.thread.threadViewOutputSummary,
          currentGeneratedFilePath:
            input.generatedFilePath ?? input.thread.threadViewOutputSummary.currentGeneratedFilePath,
        };

  return input.generatedOutput === undefined
    ? nextThreadViewOutputSummary
    : {
        ...nextThreadViewOutputSummary,
        generatedOutput: input.generatedOutput,
      };
}

export async function updateGeneratedThreadViewOutputMetadata(
  input: GeneratedThreadViewOutputMetadataInput,
): Promise<StewardResult<ThreadRecord>> {
  return withSerializedThreadOperation(input.threadId, async () => {
    const mutationCheck = await input.store.assertCanMutate(input.threadId);
    if (!mutationCheck.ok) {
      return mutationCheck;
    }

    if (input.revision) {
      if (input.revision.threadId !== input.threadId) {
        return fail({
          code: "STORE_UNAVAILABLE",
          message: `Thread View output revision ${input.revision.revisionId} does not belong to thread ${input.threadId}.`,
          threadId: input.threadId,
        });
      }

      const writtenRevision = await input.store.writeProjectionRevision(input.revision);
      if (!writtenRevision.ok) {
        return writtenRevision;
      }
    }

    const refreshedThread = input.revision
      ? await input.store.openThread(input.threadId)
      : ok({
          thread: mutationCheck.value,
          actors: [],
          messages: [],
          turns: [],
          imports: [],
          projections: [],
        });
    if (!refreshedThread.ok) {
      return refreshedThread;
    }

    const nextGeneratedFilePath =
      input.generatedFilePath ?? refreshedThread.value.thread.target.currentGeneratedFilePath;
    const nextThreadViewOutputSummary = buildNextThreadViewOutputSummary({
      thread: refreshedThread.value.thread,
      generatedFilePath: input.generatedFilePath,
      generatedOutput: input.generatedOutput,
    });

    return input.store.updateThreadMetadata({
      threadId: input.threadId,
      expectedSourceRevision: mutationCheck.value.sourceRevision,
      patch: {
        target: {
          ...refreshedThread.value.thread.target,
          currentGeneratedFilePath: nextGeneratedFilePath,
        },
        threadViewOutputSummary: nextThreadViewOutputSummary,
        updatedAt: nowIso(input.now),
      },
    });
  });
}

export async function readThreadTurns(store: ThreadStore, threadId: string): Promise<StewardResult<TurnRecord[]>> {
  return store.readTurns(threadId);
}
