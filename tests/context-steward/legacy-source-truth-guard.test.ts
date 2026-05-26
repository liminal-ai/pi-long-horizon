import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ACTIVE_PATHS = [
  "src/context-steward/pi/pi-extension.ts",
  "src/thread/services/capture-service.ts",
  "src/thread/services/turn-service.ts",
  "src/thread/services/repair-service.ts",
  "src/thread/async-thread/services/async-thread-run-service.ts",
  "src/thread/async-thread/services/thread-maintenance-repair-service.ts",
  "src/thread-view/services/thread-view-builder.ts",
];

const FORBIDDEN_PATTERNS = [
  "FileThreadStore",
  "thread.json",
  "actors.json",
  "messages.jsonl",
  "turns.json",
  "chunks.json",
  "imports.json",
  "projections.json",
];

test("active runtime, maintenance, and compact paths do not hard-code legacy managed JSON sources", async () => {
  for (const relativePath of ACTIVE_PATHS) {
    const absolutePath = resolve(relativePath);
    const content = await readFile(absolutePath, "utf8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.equal(
        content.includes(pattern),
        false,
        `${relativePath} should not reference legacy managed source pattern ${pattern}`,
      );
    }
  }
});
