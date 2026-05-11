import {
  makeBandRecord,
  makeThreadSnapshot,
  makeThreadView,
  makeThreadViewMessage,
  makeWorkbenchChunkRead,
  makeWorkbenchSearchInput,
  DEFAULT_TEST_TIMESTAMP,
  type ThreadSnapshotFixture,
} from "../../context-workbench/test/fixtures.js";
import { createTempThreadStoreContext } from "../../thread/async-thread/test/temp-thread-store.js";
import {
  makeChunkState,
  makePlaceholderArtifactState,
  makeSmoothTurnState,
} from "../../thread/async-thread/test/fixtures.js";
import type { PiThreadViewEntry, PiThreadViewFile } from "../domain/pi-thread-view-file.js";

export {
  DEFAULT_TEST_TIMESTAMP,
  makeBandRecord,
  makeChunkState,
  makePlaceholderArtifactState,
  makeSmoothTurnState,
  makeThreadSnapshot,
  makeThreadView,
  makeThreadViewMessage,
  makeWorkbenchChunkRead,
  makeWorkbenchSearchInput,
};
export type { ThreadSnapshotFixture };

export interface TempFeature3StoreContext {
  projectDir: string;
  storeRootDir: string;
  resolveProjectPath: (...segments: string[]) => string;
  resolveStorePath: (...segments: string[]) => string;
  resolveThreadPath: (threadId: string, ...segments: string[]) => string;
  resolveThreadViewsPath: (threadId: string, ...segments: string[]) => string;
  resolveGeneratedPath: (threadId: string, ...segments: string[]) => string;
  resolveGeneratedArchivePath: (threadId: string, ...segments: string[]) => string;
  cleanup: () => Promise<void>;
}

export async function createTempFeature3StoreContext(
  prefix = "feature3-",
): Promise<TempFeature3StoreContext> {
  const context = await createTempThreadStoreContext(prefix);

  return {
    ...context,
    resolveThreadPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, ...segments),
    resolveThreadViewsPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "thread-views", ...segments),
    resolveGeneratedPath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "generated", ...segments),
    resolveGeneratedArchivePath: (threadId: string, ...segments: string[]) =>
      context.resolveStorePath("threads", threadId, "archives", "pi-thread-views", ...segments),
  };
}

export async function withTempFeature3Store<T>(
  run: (context: TempFeature3StoreContext) => Promise<T> | T,
): Promise<T> {
  const context = await createTempFeature3StoreContext();

  try {
    return await run(context);
  } finally {
    await context.cleanup();
  }
}

export function makePiThreadViewFile(
  overrides: Partial<PiThreadViewFile> & Pick<PiThreadViewFile, "threadId" | "threadViewId">,
): PiThreadViewFile {
  const entries = overrides.entries
    ? overrides.entries.map((entry) => ({
        ...entry,
        metadata: entry.metadata ? structuredClone(entry.metadata) : undefined,
      }))
    : [
        {
          entryType: "message",
          role: "assistant",
          content: "Generated PI Thread View content",
          generatedSource: "smooth_turn",
          metadata: {
            placeholderExplicit: true,
          },
        } satisfies PiThreadViewEntry,
      ];

  return {
    threadId: overrides.threadId,
    threadViewId: overrides.threadViewId,
    fileName: overrides.fileName ?? `${overrides.threadId}-${overrides.threadViewId}.jsonl`,
    entries,
    entryCount: overrides.entryCount ?? entries.length,
  };
}
