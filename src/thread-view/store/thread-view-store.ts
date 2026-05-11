import type { WorkbenchResult } from "../domain/thread-view-errors.js";
import type {
  BandRecord,
  ThreadViewMessageRecord,
  ThreadViewRecord,
} from "../domain/thread-view-records.js";

export interface ThreadViewSnapshot {
  view: ThreadViewRecord;
}

export interface CreateThreadViewInput {
  view: ThreadViewRecord;
}

export interface UpdateThreadViewInput {
  threadId: string;
  threadViewId: string;
  expectedUpdatedAt?: string;
  patch: Partial<Pick<ThreadViewRecord, "state" | "name" | "purpose" | "sourceStateReference" | "status">> & {
    fullFidelityBand?: BandRecord;
    smoothBand?: BandRecord;
    detailedBand?: BandRecord;
    briefBand?: BandRecord;
    emittedMessages?: ThreadViewMessageRecord[];
    updatedAt?: string;
  };
}

export interface ActivateThreadViewInput {
  threadId: string;
  draftThreadViewId: string;
  activatedAt?: string;
}

export interface ThreadViewStore {
  createThreadView(input: CreateThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>>;
  openThreadView(threadId: string, threadViewId: string): Promise<WorkbenchResult<ThreadViewSnapshot>>;
  listThreadViews(threadId: string): Promise<WorkbenchResult<ThreadViewRecord[]>>;
  updateThreadView(input: UpdateThreadViewInput): Promise<WorkbenchResult<ThreadViewRecord>>;
  archiveThreadView(threadId: string, threadViewId: string): Promise<WorkbenchResult<ThreadViewRecord>>;
  activateThreadView(input: ActivateThreadViewInput): Promise<WorkbenchResult<{
    active: ThreadViewRecord;
    archived: ThreadViewRecord;
  }>>;
}
