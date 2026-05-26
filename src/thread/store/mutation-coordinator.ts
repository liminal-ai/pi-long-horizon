import { createStewardIssue, type StewardIssue } from "../domain/errors.js";
import type { ThreadStore } from "./thread-store.js";

export interface ThreadMutationLease {
  threadId: string;
  expectedSourceRevision?: number;
  release(): Promise<void>;
}

export interface ThreadMutationCoordinator {
  acquireThreadLease(input: {
    threadId: string;
    expectedSourceRevision?: number;
  }): Promise<ThreadMutationLease>;
}

export class ThreadMutationCoordinatorError extends Error {
  readonly issue: StewardIssue;

  constructor(issue: StewardIssue) {
    super(issue.message);
    this.name = "ThreadMutationCoordinatorError";
    this.issue = createStewardIssue(issue);
  }
}

export class StaleThreadMutationError extends ThreadMutationCoordinatorError {
  constructor(input: { threadId: string; expectedSourceRevision: number; actualSourceRevision: number }) {
    super(
      createStewardIssue({
        code: "STALE_SOURCE_REVISION",
        message: `Thread ${input.threadId} source revision ${input.actualSourceRevision} does not match expected ${input.expectedSourceRevision}.`,
        threadId: input.threadId,
      }),
    );
    this.name = "StaleThreadMutationError";
  }
}

export class FileThreadMutationCoordinator implements ThreadMutationCoordinator {
  private static readonly threadQueues = new Map<string, Promise<void>>();

  constructor(private readonly threadStore: ThreadStore) {}

  async acquireThreadLease(input: {
    threadId: string;
    expectedSourceRevision?: number;
  }): Promise<ThreadMutationLease> {
    const previous = FileThreadMutationCoordinator.threadQueues.get(input.threadId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => current);
    FileThreadMutationCoordinator.threadQueues.set(input.threadId, chain);

    await previous.catch(() => undefined);

    let released = false;
    const release = async (): Promise<void> => {
      if (released) {
        return;
      }

      released = true;
      releaseQueue();
      if (FileThreadMutationCoordinator.threadQueues.get(input.threadId) === chain) {
        FileThreadMutationCoordinator.threadQueues.delete(input.threadId);
      }
    };

    try {
      const threadResult = await this.threadStore.assertCanMutate(input.threadId);
      if (!threadResult.ok) {
        throw new ThreadMutationCoordinatorError(
          threadResult.issues[0] ??
            createStewardIssue({
              code: "STORE_UNAVAILABLE",
              message: `Thread ${input.threadId} could not be opened for mutation.`,
              threadId: input.threadId,
            }),
        );
      }

      if (
        input.expectedSourceRevision !== undefined &&
        threadResult.value.sourceRevision !== input.expectedSourceRevision
      ) {
        throw new StaleThreadMutationError({
          threadId: input.threadId,
          expectedSourceRevision: input.expectedSourceRevision,
          actualSourceRevision: threadResult.value.sourceRevision,
        });
      }

      return {
        threadId: input.threadId,
        expectedSourceRevision: input.expectedSourceRevision,
        release,
      };
    } catch (error) {
      await release();
      if (error instanceof ThreadMutationCoordinatorError) {
        throw error;
      }

      throw new ThreadMutationCoordinatorError(
        createStewardIssue({
          code: "STORE_UNAVAILABLE",
          message: `Thread ${input.threadId} could not acquire a mutation lease.`,
          threadId: input.threadId,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
