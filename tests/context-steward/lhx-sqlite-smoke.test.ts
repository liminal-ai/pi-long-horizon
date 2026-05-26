import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import { makePiAssistantMessage, makePiExtensionContext, makePiUserMessage, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/context-steward/test/temp-store.js";
import { runCli } from "../../packages/lh-context/src/commands/run.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function capturePiMessage(
  store: SqliteThreadStore,
  threadId: string,
  target: ReturnType<typeof makeThreadTarget>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(
    mapPiMessageEnd({
      message,
      ctx: makePiExtensionContext(target),
    }),
  );

  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
    }),
  );
}

test("lhx inspect summary returns structured output for SQLite-backed managed threads", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-lhx-sqlite-001",
      sessionFilePath: `${projectDir}/pi/session-lhx-sqlite-001.jsonl`,
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Inspect me" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-lhx-sqlite-001",
        content: [{ type: "text", text: "Inspection response" }],
      }),
    );

    const result = await runCli(["inspect", "summary", "--root", projectDir, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout) as {
      kind: string;
      threadId: string;
      messages: { total: number };
      turns: { total: number };
      warnings: string[];
    };
    assert.equal(parsed.kind, "summary");
    assert.equal(parsed.threadId, thread.threadId);
    assert.equal(parsed.messages.total, 2);
    assert.equal(parsed.turns.total, 1);
    assert.deepEqual(parsed.warnings, ["No generated thread-view file path found on input or thread target metadata."]);
  });
});
