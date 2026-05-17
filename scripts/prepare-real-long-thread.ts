#!/usr/bin/env tsx

import {
  prepareRealLongThreadInPlace,
  REAL_LONG_THREAD_FIXTURE,
} from "../tests/thread-view/real-long-thread-fixture-prep.js";

function parseArgs(): { storeRootDir: string; backupRootDir?: string } {
  const args = process.argv.slice(2);
  let storeRootDir = ".context-steward";
  let backupRootDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--store-root") {
      storeRootDir = args[++index] ?? "";
      continue;
    }
    if (arg === "--backup-root") {
      backupRootDir = args[++index];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: npx tsx scripts/prepare-real-long-thread.ts [--store-root .context-steward] [--backup-root <dir>]");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!storeRootDir) {
    throw new Error("--store-root requires a non-empty path.");
  }

  return { storeRootDir, backupRootDir };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const result = await prepareRealLongThreadInPlace({
    storeRootDir: args.storeRootDir,
    backupRootDir: args.backupRootDir,
  });

  console.log(JSON.stringify({
    threadId: result.threadId,
    activeThreadViewId: result.activeThreadViewId,
    activeProjectionRevisionId: result.activeProjectionRevisionId,
    activeGeneratedFilePath: result.activeGeneratedFilePath,
    backupPath: result.backupPath,
    repairedClosedTurnCount: result.repairedClosedTurnCount,
    selectedChunkCount: result.selectedChunkIds.length,
    normalizedChunkCount: result.normalizedChunkIds.length,
    regeneratedPlaceholderChunkCount: result.regeneratedPlaceholderChunkIds.length,
    activatedGeneratedThreadView: result.activatedGeneratedThreadView,
    previousGeneratedThreadViewState: result.previousGeneratedThreadViewState,
    expected: REAL_LONG_THREAD_FIXTURE,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
