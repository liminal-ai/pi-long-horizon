#!/usr/bin/env tsx

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import {
  formatLowerBandInspectionJson,
  WorkbenchQueryService,
} from "../src/workbench/services/workbench-query-service.js";

function usage(): never {
  console.error("Usage: tsx scripts/inspect-lower-band-status.ts <store-root-dir> <thread-id> [--thread-view <id>]");
  process.exit(1);
}

function parseArgs(argv: readonly string[]): { storeRootDir: string; threadId: string; threadViewId?: string } {
  const [, , storeRootDir, threadId, ...rest] = argv;
  if (!storeRootDir || !threadId) {
    usage();
  }

  let threadViewId: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token !== "--thread-view") {
      usage();
    }

    const value = rest[index + 1]?.trim();
    index += 1;
    if (!value) {
      usage();
    }
    threadViewId = value;
  }

  return { storeRootDir, threadId, threadViewId };
}

async function main(): Promise<void> {
  const { storeRootDir, threadId, threadViewId } = parseArgs(process.argv);
  const report = await new WorkbenchQueryService(new FileThreadStore(storeRootDir)).inspectLowerBandStatus({
    threadId,
    threadViewId,
  });
  if (!report.ok) {
    throw new Error(report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  console.log(formatLowerBandInspectionJson(report.value));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
