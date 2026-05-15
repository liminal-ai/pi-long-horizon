#!/usr/bin/env tsx

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import {
  formatActiveRolloutInspectionJson,
  inspectActiveThreadView,
} from "../src/workbench/services/active-rollout-inspection-service.js";

function usage(): never {
  console.error("Usage: tsx scripts/inspect-active-thread-view.ts <store-root-dir> <thread-id>");
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , storeRootDir, threadId] = process.argv;
  if (!storeRootDir || !threadId) {
    usage();
  }

  const report = await inspectActiveThreadView(
    { threadId },
    { threadStore: new FileThreadStore(storeRootDir) },
  );
  console.log(formatActiveRolloutInspectionJson(report));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
