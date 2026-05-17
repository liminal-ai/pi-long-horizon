import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ThreadStore } from "../../thread/store/thread-store.js";
import { FileThreadStore } from "../../thread/store/file-thread-store.js";
import {
  cloneBandRecord,
  cloneThreadViewRecord,
  orderThreadViewMessages,
  type BandRecord,
  type ThreadViewMessageRecord,
  type ThreadViewRecord,
  type ThreadViewState,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/thread-view-errors.js";
import type {
  ActivateThreadViewInput,
  CreateThreadViewInput,
  ThreadViewSnapshot,
  ThreadViewStore,
  UpdateThreadViewInput,
} from "./thread-view-store.js";

const THREAD_VIEW_STATE_ORDER: Record<ThreadViewState, number> = {
  active: 0,
  draft: 1,
  archived: 2,
};

function sortThreadViews(records: readonly ThreadViewRecord[]): ThreadViewRecord[] {
  return records
    .map(cloneThreadViewRecord)
    .sort((left, right) => {
      const stateOrder = THREAD_VIEW_STATE_ORDER[left.state] - THREAD_VIEW_STATE_ORDER[right.state];
      if (stateOrder !== 0) {
        return stateOrder;
      }

      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }

      if (left.createdAt !== right.createdAt) {
        return right.createdAt.localeCompare(left.createdAt);
      }

      return left.threadViewId.localeCompare(right.threadViewId);
    });
}

function normalizeBandPatch(
  currentBand: BandRecord,
  nextBand: BandRecord | undefined,
): BandRecord {
  return nextBand ? cloneBandRecord(nextBand) : cloneBandRecord(currentBand);
}

function normalizeEmittedMessages(
  threadViewId: string,
  emittedMessages: readonly ThreadViewMessageRecord[] | undefined,
  fallback: readonly ThreadViewMessageRecord[],
): ThreadViewMessageRecord[] {
  const messages = emittedMessages ?? fallback;
  return orderThreadViewMessages(
    messages.map((message) => ({
      ...message,
      threadViewId,
    })),
  );
}

export class FileThreadViewStore implements ThreadViewStore {
  private static readonly threadMutationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly rootDir: string,
    private readonly threadStore: ThreadStore = new FileThreadStore(rootDir),
  ) {}

  async createThreadView(input: CreateThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>> {
    const threadCheck = await this.threadStore.assertCanMutate(input.view.threadId);
    if (!threadCheck.ok) {
      return failWorkbenchResult(...threadCheck.issues);
    }

    const existingViews = await this.listThreadViews(input.view.threadId);
    if (!existingViews.ok) {
      return failWorkbenchResult(...existingViews.issues);
    }

    if (existingViews.value.some((view) => view.threadViewId === input.view.threadViewId)) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_DUPLICATE",
          message: `Thread View ${input.view.threadViewId} already exists for thread ${input.view.threadId}.`,
          threadId: input.view.threadId,
        }),
      );
    }

    if (
      input.view.state === "active" &&
      existingViews.value.some((view) => view.state === "active")
    ) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
          message: `Thread ${input.view.threadId} already has an active Thread View.`,
          threadId: input.view.threadId,
        }),
      );
    }

    try {
      const filePath = this.resolveThreadViewPath(input.view.threadId, input.view.threadViewId);
      await mkdir(this.resolveThreadViewsDir(input.view.threadId), { recursive: true });
      await mkdir(dirname(filePath), { recursive: false });
      await this.writeJsonAtomic(filePath, cloneThreadViewRecord(input.view));

      return okWorkbenchResult(cloneThreadViewRecord(input.view), existingViews.issues);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return failWorkbenchResult(
        {
          code: "STORE_UNAVAILABLE",
          message: `Failed to create Thread View ${input.view.threadViewId}.`,
          threadId: input.view.threadId,
          cause,
        },
      );
    }
  }

  async openThreadView(threadId: string, threadViewId: string): Promise<WorkbenchResult<ThreadViewSnapshot>> {
    const listedViews = await this.listThreadViews(threadId);
    if (!listedViews.ok) {
      return failWorkbenchResult(...listedViews.issues);
    }

    const view = listedViews.value.find((candidate) => candidate.threadViewId === threadViewId);
    if (!view) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_NOT_FOUND",
          message: `Thread View ${threadViewId} was not found for thread ${threadId}.`,
          threadId,
        }),
      );
    }

    return okWorkbenchResult(
      {
        view: cloneThreadViewRecord(view),
      },
      listedViews.issues,
    );
  }

  async listThreadViews(threadId: string): Promise<WorkbenchResult<ThreadViewRecord[]>> {
    const threadSnapshot = await this.threadStore.openThread(threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    try {
      const views = sortThreadViews(await this.readThreadViews(threadId));
      const activeViews = views.filter((view) => view.state === "active");

      if (activeViews.length > 1) {
        return failWorkbenchResult(
          createWorkbenchIssue({
            code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
            message: `Thread ${threadId} has multiple active Thread Views.`,
            threadId,
          }),
        );
      }

      return okWorkbenchResult(views);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return failWorkbenchResult(
        {
          code: "STORE_UNAVAILABLE",
          message: `Failed to list Thread Views for thread ${threadId}.`,
          threadId,
          cause,
        },
      );
    }
  }

  async updateThreadView(input: UpdateThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>> {
    const threadCheck = await this.threadStore.assertCanMutate(input.threadId);
    if (!threadCheck.ok) {
      return failWorkbenchResult(...threadCheck.issues);
    }

    const listedViews = await this.listThreadViews(input.threadId);
    if (!listedViews.ok) {
      return failWorkbenchResult(...listedViews.issues);
    }

    const existingView = listedViews.value.find((view) => view.threadViewId === input.threadViewId);
    if (!existingView) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_NOT_FOUND",
          message: `Thread View ${input.threadViewId} was not found for thread ${input.threadId}.`,
          threadId: input.threadId,
        }),
      );
    }

    if (
      input.expectedUpdatedAt !== undefined &&
      existingView.updatedAt !== input.expectedUpdatedAt
    ) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${input.threadViewId} changed since ${input.expectedUpdatedAt}.`,
          threadId: input.threadId,
        }),
      );
    }

    const nextState = input.patch.state ?? existingView.state;
    if (
      nextState === "active" &&
      listedViews.value.some(
        (view) => view.threadViewId !== input.threadViewId && view.state === "active",
      )
    ) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
          message: `Thread ${input.threadId} already has another active Thread View.`,
          threadId: input.threadId,
        }),
      );
    }

    const nextUpdatedAt = input.patch.updatedAt ?? new Date().toISOString();
    const nextView = cloneThreadViewRecord({
      ...existingView,
      state: nextState,
      name: Object.prototype.hasOwnProperty.call(input.patch, "name")
        ? input.patch.name
        : existingView.name,
      purpose: Object.prototype.hasOwnProperty.call(input.patch, "purpose")
        ? input.patch.purpose
        : existingView.purpose,
      sourceStateReference: Object.prototype.hasOwnProperty.call(input.patch, "sourceStateReference")
        ? input.patch.sourceStateReference
        : existingView.sourceStateReference,
      status: input.patch.status ?? existingView.status,
      updatedAt: nextUpdatedAt,
      fullFidelityBand: normalizeBandPatch(existingView.fullFidelityBand, input.patch.fullFidelityBand),
      smoothBand: normalizeBandPatch(existingView.smoothBand, input.patch.smoothBand),
      detailedBand: normalizeBandPatch(existingView.detailedBand, input.patch.detailedBand),
      briefBand: normalizeBandPatch(existingView.briefBand, input.patch.briefBand),
      emittedMessages: normalizeEmittedMessages(
        input.threadViewId,
        input.patch.emittedMessages,
        existingView.emittedMessages,
      ),
    });

    try {
      await this.writeJsonAtomic(
        this.resolveThreadViewPath(input.threadId, input.threadViewId),
        nextView,
      );

      return okWorkbenchResult(nextView, listedViews.issues);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return failWorkbenchResult(
        {
          code: "STORE_UNAVAILABLE",
          message: `Failed to update Thread View ${input.threadViewId}.`,
          threadId: input.threadId,
          cause,
        },
      );
    }
  }

  async archiveThreadView(threadId: string, threadViewId: string): Promise<WorkbenchResult<ThreadViewRecord>> {
    const openedView = await this.openThreadView(threadId, threadViewId);
    if (!openedView.ok) {
      return failWorkbenchResult(...openedView.issues);
    }

    if (openedView.value.view.state === "active") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
          message: `Active Thread View ${threadViewId} cannot be archived outside activation flow.`,
          threadId,
        }),
      );
    }

    if (openedView.value.view.state === "archived") {
      return okWorkbenchResult(cloneThreadViewRecord(openedView.value.view), openedView.issues);
    }

    return this.updateThreadView({
      threadId,
      threadViewId,
      expectedUpdatedAt: openedView.value.view.updatedAt,
      patch: {
        state: "archived",
      },
    });
  }

  async activateThreadView(
    input: ActivateThreadViewInput,
  ): Promise<WorkbenchResult<{ active: ThreadViewRecord; archived: ThreadViewRecord }>> {
    return this.withThreadMutation(input.threadId, async () => {
      const threadCheck = await this.threadStore.assertCanMutate(input.threadId);
      if (!threadCheck.ok) {
        return failWorkbenchResult(...threadCheck.issues);
      }

      const views = sortThreadViews(await this.readThreadViews(input.threadId));
      const draftView = views.find((view) => view.threadViewId === input.draftThreadViewId);
      if (!draftView) {
        return failWorkbenchResult(
          createWorkbenchIssue({
            code: "THREAD_VIEW_NOT_FOUND",
            message: `Thread View ${input.draftThreadViewId} was not found for thread ${input.threadId}.`,
            threadId: input.threadId,
          }),
        );
      }

      if (draftView.state !== "draft") {
        return failWorkbenchResult(
          createWorkbenchIssue({
            code: "THREAD_VIEW_STATE_CONFLICT",
            message: `Thread View ${input.draftThreadViewId} must be in draft state for activation, but is ${draftView.state}.`,
            threadId: input.threadId,
          }),
        );
      }

      const activeViews = views.filter((view) => view.state === "active");
      if (activeViews.length > 1) {
        return failWorkbenchResult(
          createWorkbenchIssue({
            code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
            message: `Thread ${input.threadId} has multiple active Thread Views.`,
            threadId: input.threadId,
          }),
        );
      }

      const priorActiveView = activeViews[0];
      if (!priorActiveView) {
        return failWorkbenchResult(
          createWorkbenchIssue({
            code: "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
            message: `Thread ${input.threadId} does not have an active Thread View to archive during activation.`,
            threadId: input.threadId,
          }),
        );
      }

      const activatedAt = input.activatedAt ?? new Date().toISOString();
      const nextActiveView = cloneThreadViewRecord({
        ...draftView,
        state: "active",
        updatedAt: activatedAt,
      });
      const nextArchivedView = cloneThreadViewRecord({
        ...priorActiveView,
        state: "archived",
        updatedAt: activatedAt,
      });
      try {
        await this.writeJsonAtomic(
          this.resolveThreadViewPath(input.threadId, nextActiveView.threadViewId),
          nextActiveView,
        );
        await this.writeJsonAtomic(
          this.resolveThreadViewPath(input.threadId, nextArchivedView.threadViewId),
          nextArchivedView,
        );
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        return failWorkbenchResult(
          {
            code: "STORE_UNAVAILABLE",
            message: `Failed to activate Thread View ${input.draftThreadViewId}.`,
            threadId: input.threadId,
            cause,
          },
        );
      }

      return okWorkbenchResult({
        active: nextActiveView,
        archived: nextArchivedView,
      });
    });
  }

  private async readThreadViews(threadId: string): Promise<ThreadViewRecord[]> {
    const threadViewsDir = this.resolveThreadViewsDir(threadId);
    const entries = await readdir(threadViewsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

    const views = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const view = await this.readJsonFile<ThreadViewRecord>(
            this.resolveThreadViewPath(threadId, entry.name),
          );
          if (view.threadId !== threadId) {
            throw new Error(
              `Thread View ${view.threadViewId} belongs to thread ${view.threadId}, not ${threadId}.`,
            );
          }

          return cloneThreadViewRecord(view);
        }),
    );

    return views;
  }

  private resolveThreadViewsDir(threadId: string): string {
    return join(this.rootDir, "threads", threadId, "thread-views");
  }

  private resolveThreadViewPath(threadId: string, threadViewId: string): string {
    return join(this.resolveThreadViewsDir(threadId), threadViewId, "thread-view.json");
  }

  private async readJsonFile<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  }

  private async withThreadMutation<T>(
    threadId: string,
    run: () => Promise<WorkbenchResult<T>>,
  ): Promise<WorkbenchResult<T>> {
    const previous = FileThreadViewStore.threadMutationQueues.get(threadId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => current);
    FileThreadViewStore.threadMutationQueues.set(threadId, chain);

    await previous.catch(() => undefined);

    try {
      return await run();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return failWorkbenchResult({
        code: "STORE_UNAVAILABLE",
        message: `Thread View mutation failed for thread ${threadId}.`,
        threadId,
        cause,
      });
    } finally {
      releaseQueue();
      if (FileThreadViewStore.threadMutationQueues.get(threadId) === chain) {
        FileThreadViewStore.threadMutationQueues.delete(threadId);
      }
    }
  }
}
