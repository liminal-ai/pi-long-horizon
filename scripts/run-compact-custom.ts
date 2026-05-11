import { join } from "node:path";

import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../src/thread-view/store/file-thread-view-store.js";
import { runSmartCompact } from "../src/commands/smart-compact.js";

const storeRootDir = process.argv[2]!;
const threadId = process.argv[3]!;
const lowerBound = Number.parseInt(process.argv[4] ?? "180000", 10);
const full = Number.parseFloat(process.argv[5] ?? "25");
const smooth = Number.parseFloat(process.argv[6] ?? "45");
const detailed = Number.parseFloat(process.argv[7] ?? "20");
const brief = Number.parseFloat(process.argv[8] ?? "10");

if (!storeRootDir || !threadId) {
  console.error("Usage: npx tsx scripts/run-compact-custom.ts <storeRootDir> <threadId> [lowerBound] [full] [smooth] [detailed] [brief]");
  process.exit(1);
}

const store = new FileThreadStore(storeRootDir);
const threadViewStore = new FileThreadViewStore(storeRootDir, store);

const result = await runSmartCompact({
  threadId,
  requestedLowerBound: lowerBound,
  requestedBandPercentages: { fullFidelity: full, smooth, detailed, brief },
  mode: "prepare",
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
