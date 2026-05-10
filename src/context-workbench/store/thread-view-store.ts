import type { WorkbenchResult } from "../domain/workbench-errors.js";
import type { ThreadViewRecord } from "../domain/thread-view-records.js";

export interface ThreadViewSnapshot {
  view: ThreadViewRecord;
}

export interface CreateThreadViewInput {
  view: ThreadViewRecord;
}

export interface ThreadViewStore {
  createThreadView(input: CreateThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>>;
  openThreadView(threadId: string, threadViewId: string): Promise<WorkbenchResult<ThreadViewSnapshot>>;
  listThreadViews(threadId: string): Promise<WorkbenchResult<ThreadViewRecord[]>>;
}
