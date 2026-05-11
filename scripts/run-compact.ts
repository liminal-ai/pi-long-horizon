import { join } from "node:path";

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../src/thread-view/store/file-thread-view-store.js";
import { runSmartCompact } from "../src/commands/smart-compact.js";

const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
const storeRootDir = positionalArgs[0];
const threadId = positionalArgs[1];
const lowerBound = Number.parseInt(positionalArgs[2] ?? "25000", 10);
const modeFlag = args.find((arg) => arg.startsWith("--mode="));
const mode = modeFlag === "--mode=strict" ? "strict" : "prepare";

if (!storeRootDir || !threadId) {
  console.error("Usage: npx tsx scripts/run-compact.ts <storeRootDir> <threadId> [lowerBound] [--mode=prepare|strict]");
  process.exit(1);
}

const store = new FileThreadStore(storeRootDir);
const threadViewStore = new FileThreadViewStore(storeRootDir, store);

const result = await runSmartCompact({
  threadId,
  requestedLowerBound: lowerBound,
  requestedBandPercentages: { fullFidelity: 40, smooth: 30, detailed: 20, brief: 10 },
  mode,
}, {
  threadStore: store,
  threadViewStore,
  piThreadViewWriterOptions: {
    pathResolver: {
      resolveGeneratedFilePath: (input) => join(storeRootDir, "generated", `${input.threadViewId}.jsonl`),
      resolveArchiveFilePath: (input) => join(storeRootDir, "archives", `${input.archivedAt}-${input.threadViewId}.jsonl`),
    },
  },
  piCliHarnessAdapter: { loadThreadViewFile: async () => ({ ok: true }) },
});

console.log(JSON.stringify(result, null, 2));
