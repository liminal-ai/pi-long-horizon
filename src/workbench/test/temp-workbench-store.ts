import {
  createTempThreadStoreContext,
  type TempThreadStoreContext,
} from "../../context-steward/test/temp-store.js";

export interface TempWorkbenchStoreContext extends TempThreadStoreContext {
  resolveThreadPath: (threadId: string, ...segments: string[]) => string;
  resolveThreadViewsPath: (threadId: string, ...segments: string[]) => string;
}

export async function createTempWorkbenchStoreContext(prefix = "context-workbench-"): Promise<TempWorkbenchStoreContext> {
  const context = await createTempThreadStoreContext(prefix);

  return {
    ...context,
    resolveThreadPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, ...segments),
    resolveThreadViewsPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "thread-views", ...segments),
  };
}

export async function withTempWorkbenchStore<T>(
  run: (context: TempWorkbenchStoreContext) => Promise<T> | T,
): Promise<T> {
  const context = await createTempWorkbenchStoreContext();

  try {
    return await run(context);
  } finally {
    await context.cleanup();
  }
}
