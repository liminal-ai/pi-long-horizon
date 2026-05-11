import { dirname } from "node:path";

import { attachExistingPiSession } from "../src/thread/services/import-service.js";
import { prepareAsyncThread } from "../src/thread/async-thread/services/async-thread-run-service.js";
import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import { resolveStoreRootDir, summarizeLargeSession, printLargeSessionSummary } from "./large-session-lib.js";

function formatBlockers(blockers: readonly { code: string; message: string }[]): string {
  return blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join("\n");
}

const sessionFilePath = process.argv[2];
if (!sessionFilePath) {
  console.error("Usage: npx tsx scripts/import-pi-session.ts <pi-session-file-path> [store-root-dir]");
  process.exit(1);
}

const storeRootDir = await resolveStoreRootDir(process.argv[3]);
const threadStore = new FileThreadStore(storeRootDir);
const attached = await attachExistingPiSession({
  store: threadStore,
  sessionFilePath,
  target: {
    runtime: "pi",
    sessionFilePath,
  },
});

if (!attached.ok) {
  console.error(attached.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  process.exit(1);
}

if (!attached.value.thread.target.cwd) {
  const updated = await threadStore.updateThreadMetadata({
    threadId: attached.value.thread.threadId,
    expectedSourceRevision: attached.value.thread.sourceRevision,
    patch: {
      target: {
        ...attached.value.thread.target,
        cwd: dirname(sessionFilePath),
      },
    },
  });
  if (!updated.ok) {
    console.error(updated.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    process.exit(1);
  }
}

const readiness = await prepareAsyncThread(
  {
    threadId: attached.value.thread.threadId,
    mode: "prepare",
    requestedLowerBound: 30_000,
    requestedBandPercentages: { fullFidelity: 20, smooth: 30, detailed: 30, brief: 20 },
    requiredPlaceholderBands: { detailed: true, brief: true },
  },
  { store: threadStore },
);
if (readiness.blockers.length > 0) {
  console.error(`prepareAsyncThread blockers for ${attached.value.thread.threadId}:\n${formatBlockers(readiness.blockers)}`);
  process.exit(1);
}

printLargeSessionSummary(
  await summarizeLargeSession({
    storeRootDir,
    threadStore,
    threadId: attached.value.thread.threadId,
  }),
);
