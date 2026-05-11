import { seedLargeSession, printLargeSessionSummary } from "./large-session-lib.js";

const targetTokenCount = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isFinite(targetTokenCount) || targetTokenCount <= 0) {
  console.error("Usage: npx tsx scripts/seed-large-session.ts <target-token-count> [store-root-dir]");
  process.exit(1);
}

const result = await seedLargeSession({
  targetTokenCount,
  storeRootDir: process.argv[3],
});

printLargeSessionSummary(result);
