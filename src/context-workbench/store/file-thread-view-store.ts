import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ThreadStore } from "../../context-steward/store/thread-store.js";
import { FileThreadStore } from "../../context-steward/store/file-thread-store.js";
import {
  cloneThreadViewRecord,
  type ThreadViewRecord,
  type ThreadViewState,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type {
  CreateThreadViewInput,
  ThreadViewSnapshot,
  ThreadViewStore,
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

export class FileThreadViewStore implements ThreadViewStore {
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

      if (input.view.state === "active") {
        const updatedThread = await this.threadStore.updateThreadMetadata({
          threadId: input.view.threadId,
          patch: {
            activeThreadViewId: input.view.threadViewId,
            updatedAt: input.view.updatedAt,
          },
        });
        if (!updatedThread.ok) {
          return failWorkbenchResult(...updatedThread.issues);
        }
      }

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

      const pointer = threadSnapshot.value.thread.activeThreadViewId;
      const actualActiveId = activeViews[0]?.threadViewId;

      if (pointer === actualActiveId) {
        return okWorkbenchResult(views);
      }

      const reconcile = await this.threadStore.updateThreadMetadata({
        threadId,
        patch: {
          activeThreadViewId: actualActiveId ?? null,
        },
      });
      if (!reconcile.ok) {
        return failWorkbenchResult(...reconcile.issues);
      }

      const mismatchMessage =
        pointer && actualActiveId
          ? `Thread ${threadId} activeThreadViewId pointed to ${pointer}, but ${actualActiveId} is the only active Thread View.`
          : pointer
            ? `Thread ${threadId} activeThreadViewId pointed to ${pointer}, but no Thread View is currently active.`
            : `Thread ${threadId} was missing activeThreadViewId even though ${actualActiveId} is active.`;

      return okWorkbenchResult(
        views,
        [
          createWorkbenchIssue({
            code: "THREAD_VIEW_STATE_CONFLICT",
            message: `${mismatchMessage} The source pointer was reconciled to match per-view state.`,
            threadId,
          }),
        ],
      );
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
}
