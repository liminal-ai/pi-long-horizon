import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  return {
    projectDir,
    storeRootDir,
    resolveProjectPath: (...segments: string[]) => join(projectDir, ...segments),
    resolveStorePath: (...segments: string[]) => join(storeRootDir, ...segments),
    cleanup: async () => {
      await rm(projectDir, { recursive: true, force: true });
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

