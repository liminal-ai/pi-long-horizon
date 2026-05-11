import {
  createTempThreadStoreContext as createLegacyTempThreadStoreContext,
  withTempThreadStore as withLegacyTempThreadStore,
  type TempThreadStoreContext,
} from "../../../context-steward/test/temp-store.js";

export interface TempAsyncThreadStoreContext extends TempThreadStoreContext {
  resolveThreadPath: (threadId: string, ...segments: string[]) => string;
  resolveTurnsPath: (threadId: string, ...segments: string[]) => string;
  resolveChunksPath: (threadId: string, ...segments: string[]) => string;
}

export async function createTempThreadStoreContext(
  prefix = "thread-async-",
): Promise<TempAsyncThreadStoreContext> {
  const context = await createLegacyTempThreadStoreContext(prefix);

  return {
    ...context,
    resolveThreadPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, ...segments),
    resolveTurnsPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "turns.json", ...segments),
    resolveChunksPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "chunks.json", ...segments),
  };
}

export async function withTempThreadStore<T>(
  run: (context: TempAsyncThreadStoreContext) => Promise<T> | T,
): Promise<T> {
  return withLegacyTempThreadStore(async (context) =>
    run({
      ...context,
      resolveThreadPath: (threadId: string, ...segments: string[]) =>
        context.resolveStorePath("threads", threadId, ...segments),
      resolveTurnsPath: (threadId: string, ...segments: string[]) =>
        context.resolveStorePath("threads", threadId, "turns.json", ...segments),
      resolveChunksPath: (threadId: string, ...segments: string[]) =>
        context.resolveStorePath("threads", threadId, "chunks.json", ...segments),
    }),
  );
}
