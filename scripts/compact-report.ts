#!/usr/bin/env tsx

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../src/thread-view/store/file-thread-view-store.js";
import {
  formatCompactionAuditReport,
  formatCompactionAuditReportJson,
} from "../src/workbench/services/compaction-report-formatter.js";
import { buildCompactionAuditReport } from "../src/workbench/services/compaction-report-service.js";

function usage(): never {
  console.error("Usage: tsx scripts/compact-report.ts <store-root-dir> <thread-id> [thread-view-id]");
  process.exit(1);
}

async function resolveThreadViewId(input: {
  threadId: string;
  requestedThreadViewId?: string;
  threadViewStore: FileThreadViewStore;
}): Promise<string> {
  if (input.requestedThreadViewId) {
    return input.requestedThreadViewId;
  }

  const listed = await input.threadViewStore.listThreadViews(input.threadId);
  if (!listed.ok) {
    throw new Error(listed.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  const mostRecent = [...listed.value].sort((left, right) => {
    const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedComparison !== 0) {
      return updatedComparison;
    }

    return right.threadViewId.localeCompare(left.threadViewId);
  })[0];

  if (!mostRecent) {
    throw new Error(`Thread ${input.threadId} has no thread views.`);
  }

  return mostRecent.threadViewId;
}

async function main(): Promise<void> {
  const [, , storeRootDir, threadId, requestedThreadViewId] = process.argv;
  if (!storeRootDir || !threadId) {
    usage();
  }

  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const threadViewId = await resolveThreadViewId({
    threadId,
    requestedThreadViewId,
    threadViewStore,
  });
  const report = await buildCompactionAuditReport(
    {
      threadId,
      threadViewId,
    },
    {
      threadStore,
      threadViewStore,
    },
  );

  console.log(formatCompactionAuditReport(report));
  console.log("");
  console.log("JSON");
  console.log(formatCompactionAuditReportJson(report));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
