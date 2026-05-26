import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { FileThreadStore } from "../store/file-thread-store.js";
import { SqliteThreadStore, resolveThreadSqlitePath } from "../store/sqlite-thread-store.js";
import type { ThreadStore } from "../store/thread-store.js";

export type ThreadStoreBacking = "file" | "sqlite";

export interface TempThreadStoreContext {
  projectDir: string;
  storeRootDir: string;
  resolveProjectPath: (...segments: string[]) => string;
  resolveStorePath: (...segments: string[]) => string;
  cleanup: () => Promise<void>;
}

export async function createTempThreadStoreContext(prefix = "context-steward-"): Promise<TempThreadStoreContext> {
  const projectDir = await mkdtemp(join(tmpdir(), prefix));
  const storeRootDir = join(projectDir, ".context-steward");

  await mkdir(storeRootDir, { recursive: true });

  async function cleanupWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        return;
      } catch (error) {
        lastError = error;
        await sleep(25 * (attempt + 1));
      }
    }

    throw lastError;
  }

  return {
    projectDir,
    storeRootDir,
    resolveProjectPath: (...segments: string[]) => join(projectDir, ...segments),
    resolveStorePath: (...segments: string[]) => join(storeRootDir, ...segments),
    cleanup: async () => {
      await cleanupWithRetry();
    },
  };
}

export async function withTempThreadStore<T>(
  run: (context: TempThreadStoreContext) => Promise<T> | T,
): Promise<T> {
  const context = await createTempThreadStoreContext();

  try {
    return await run(context);
  } finally {
    await context.cleanup();
  }
}

export interface TempManagedThreadStoreContext extends TempThreadStoreContext {
  backing: ThreadStoreBacking;
  createStore: () => ThreadStore;
  resolveThreadSqlitePath: (threadId: string) => string;
}

export interface CreateTestThreadStoreInput {
  backing: ThreadStoreBacking;
  storeRootDir: string;
}

export function createTestThreadStore(input: CreateTestThreadStoreInput): ThreadStore {
  return input.backing === "sqlite"
    ? new SqliteThreadStore(input.storeRootDir)
    : new FileThreadStore(input.storeRootDir);
}

export async function withTempManagedThreadStore<T>(
  input: { backing: ThreadStoreBacking },
  run: (context: TempManagedThreadStoreContext) => Promise<T> | T,
): Promise<T> {
  return withTempThreadStore(async (context) =>
    run({
      ...context,
      backing: input.backing,
      createStore: () => createTestThreadStore({ backing: input.backing, storeRootDir: context.storeRootDir }),
      resolveThreadSqlitePath: (threadId: string) => resolveThreadSqlitePath(context.storeRootDir, threadId),
    }),
  );
}

export async function withTempSqliteThreadStore<T>(
  run: (context: TempManagedThreadStoreContext) => Promise<T> | T,
): Promise<T> {
  return withTempManagedThreadStore({ backing: "sqlite" }, run);
}
