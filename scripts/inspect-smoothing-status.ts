#!/usr/bin/env tsx

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import {
  formatSmoothingInspectionJson,
  inspectSmoothingStatus,
} from "../src/workbench/services/smoothing-inspection-service.js";

function usage(): never {
  console.error("Usage: tsx scripts/inspect-smoothing-status.ts <store-root-dir> <thread-id>");
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , storeRootDir, threadId] = process.argv;
  if (!storeRootDir || !threadId) {
    usage();
  }

  const report = await inspectSmoothingStatus(
    { threadId },
    { threadStore: new FileThreadStore(storeRootDir) },
  );
  console.log(formatSmoothingInspectionJson(report));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
