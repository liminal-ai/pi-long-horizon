import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import { makePiAssistantMessage, makePiExtensionContext, makePiUserMessage, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/context-steward/test/temp-store.js";

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

test("fixture export snapshots SQLite-backed managed threads without requiring legacy thread JSON source files", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveStorePath }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-snapshot-sqlite-001",
      sessionFilePath: `${projectDir}/pi/session-snapshot-sqlite-001.jsonl`,
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Snapshot prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-snapshot-sqlite-001",
        content: [{ type: "text", text: "Snapshot response" }],
      }),
    );

    const sourceThreadFiles = (await readdir(resolveStorePath("threads", thread.threadId))).sort();
    assert.deepEqual(sourceThreadFiles, ["thread.sqlite"]);

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );

    const exportedFiles = (await readdir(resolveStorePath("fixtures", fixture.fixtureId))).sort();
    const exportedThread = JSON.parse(
      await readFile(resolveStorePath("fixtures", fixture.fixtureId, "thread.json"), "utf8"),
    ) as { threadId: string; target: { sessionId?: string } };
    const exportedMessages = (await readFile(resolveStorePath("fixtures", fixture.fixtureId, "messages.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { messageKind: string });

    assert.deepEqual(exportedFiles, [
      "actors.json",
      "fixture.json",
      "imports.json",
      "messages.jsonl",
      "projections.json",
      "thread.json",
      "turns.json",
    ]);
    assert.equal(exportedThread.threadId, thread.threadId);
    assert.equal(exportedThread.target.sessionId, "session-snapshot-sqlite-001");
    assert.deepEqual(exportedMessages.map((message) => message.messageKind), ["prompt", "response"]);
  });
});
