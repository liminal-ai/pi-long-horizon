import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { runUserPromptSmoothingEval } from "../../scripts/eval-user-prompt-smoothing.js";
import { USER_PROMPT_SMOOTHING_PROMPT_VERSION } from "../../src/thread/async-thread/services/user-prompt-smoothing-service.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

test("runUserPromptSmoothingEval writes auditable JSONL without mutating thread state", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const before = await readFile(temp.resolveThreadPath(context.threadId, "turns.json"), "utf8");
    const outputPath = temp.resolveProjectPath("eval-results", "sample.jsonl");
    await mkdir(dirname(outputPath), { recursive: true });

    const result = await runUserPromptSmoothingEval(
      { threadId: context.threadId, sampleSize: 2, outputPath },
      {
        threadStore: context.threadStore,
        provider: {
          async smoothUserPrompt(input) {
            return {
              text: `smoothed: ${input.rawText}`,
              providerId: "openai-codex",
              modelId: "gpt-5.4-mini",
              reasoningEffort: "none",
              promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
              usage: { input: 1, output: 1 },
              elapsedMs: 3,
              generatedAt: "2026-05-15T00:00:00.000Z",
            };
          },
        },
      },
    );
    const after = await readFile(temp.resolveThreadPath(context.threadId, "turns.json"), "utf8");
    const rows = (await readFile(outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(before, after);
    assert.equal(result.rows.length, 2);
    assert.equal(rows[0].promptNumber, 1);
    assert.ok(rows[0].sourceMessageId);
    assert.ok(rows[0].original.length > 0);
    assert.ok(rows[0].smoothed.startsWith("smoothed: "));
    assert.equal(rows[0].provider, "openai-codex");
    assert.equal(rows[0].model, "gpt-5.4-mini");
    assert.equal(rows[0].reasoningEffort, "none");
    assert.deepEqual(rows[0].usage, { input: 1, output: 1 });
  });
});
