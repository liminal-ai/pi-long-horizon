import { ThreadCatalog, defaultThreadCatalogPath } from "../../../packages/lh-context/src/threads/catalog.js";

export interface ThreadCatalogRefreshInput {
  threadId: string;
  threadDbPath: string;
}

export interface ThreadCatalogRefreshSchedulerOptions {
  catalogDbPath?: string;
  debounceMs?: number;
  refreshThreadDb?: (input: ThreadCatalogRefreshInput & { catalogDbPath: string }) => Promise<unknown> | unknown;
  logger?: (label: string, startedAt: number, parts?: Record<string, unknown>) => void;
}

interface PendingThreadCatalogRefresh {
  latest: ThreadCatalogRefreshInput;
  running: boolean;
  pending: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_THREAD_CATALOG_REFRESH_DEBOUNCE_MS = 250;

export class ThreadCatalogRefreshScheduler {
  private readonly catalogDbPath: string;
  private readonly debounceMs: number;
  private readonly refreshThreadDb: (input: ThreadCatalogRefreshInput & { catalogDbPath: string }) => Promise<unknown> | unknown;
  private readonly logger?: (label: string, startedAt: number, parts?: Record<string, unknown>) => void;
  private readonly pendingByThreadId = new Map<string, PendingThreadCatalogRefresh>();

  constructor(options: ThreadCatalogRefreshSchedulerOptions = {}) {
    this.catalogDbPath = options.catalogDbPath ?? process.env.LH_THREADS_CATALOG_DB ?? defaultThreadCatalogPath();
    this.debounceMs = normalizeDebounceMs(options.debounceMs ?? process.env.LH_THREAD_CATALOG_REFRESH_DEBOUNCE_MS);
    this.refreshThreadDb = options.refreshThreadDb ?? refreshThreadCatalogFromDb;
    this.logger = options.logger;
  }

  schedule(input: ThreadCatalogRefreshInput): void {
    const startedAt = Date.now();
    let state = this.pendingByThreadId.get(input.threadId);
    if (!state) {
      state = {
        latest: input,
        running: false,
        pending: false,
      };
      this.pendingByThreadId.set(input.threadId, state);
    }

    state.latest = input;
    state.pending = state.pending || state.running;
    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      state!.timer = undefined;
      void this.run(input.threadId);
    }, this.debounceMs);
    state.timer.unref?.();

    this.logger?.("threadCatalogRefreshSchedule", startedAt, {
      threadId: input.threadId,
      debounceMs: this.debounceMs,
      result: state.running ? "pending" : "scheduled",
    });
  }

  private async run(threadId: string): Promise<void> {
    const state = this.pendingByThreadId.get(threadId);
    if (!state || state.running) {
      return;
    }

    const startedAt = Date.now();
    const input = state.latest;
    let result = "completed";
    state.running = true;
    state.pending = false;

    try {
      await this.refreshThreadDb({
        ...input,
        catalogDbPath: this.catalogDbPath,
      });
    } catch (error) {
      result = "failed";
      this.logger?.("threadCatalogRefreshError", startedAt, {
        threadId,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.running = false;
      this.logger?.("threadCatalogRefreshRun", startedAt, {
        threadId,
        result,
      });

      if (state.pending) {
        if (!state.timer) {
          state.timer = setTimeout(() => {
            state!.timer = undefined;
            void this.run(threadId);
          }, this.debounceMs);
          state.timer.unref?.();
        }
        return;
      }

      if (!state.timer) {
        this.pendingByThreadId.delete(threadId);
      }
    }
  }
}

function refreshThreadCatalogFromDb(input: ThreadCatalogRefreshInput & { catalogDbPath: string }): void {
  const catalog = new ThreadCatalog({ catalogDbPath: input.catalogDbPath });
  try {
    catalog.refreshFromThreadDb({ threadDbPath: input.threadDbPath });
  } finally {
    catalog.close();
  }
}

function normalizeDebounceMs(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_THREAD_CATALOG_REFRESH_DEBOUNCE_MS;
}
