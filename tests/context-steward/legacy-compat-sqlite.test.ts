import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { inspectReadiness, inspectSummary } from "../../packages/lh-context/src/index.js";
import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { exportLegacyThreadDebugBundle } from "../../src/context-steward/services/snapshot-export-service.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
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

test("SQLite-backed managed threads still support legacy fixture export without introducing live JSON source files", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-legacy-compat-001",
      sessionFilePath: resolveProjectPath("pi", "session-legacy-compat-001.jsonl"),
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Compatibility prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-legacy-compat-001",
        content: [{ type: "text", text: "Compatibility response" }],
      }),
    );

    const sourceThreadFilesBefore = (await readdir(resolveStorePath("threads", thread.threadId))).sort();
    assert.deepEqual(sourceThreadFilesBefore, ["thread.sqlite"]);

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );

    const sourceThreadFilesAfter = (await readdir(resolveStorePath("threads", thread.threadId))).sort();
    assert.deepEqual(sourceThreadFilesAfter, ["thread.sqlite"]);

    const fixtureFiles = (await readdir(resolveStorePath("fixtures", fixture.fixtureId))).sort();
    assert.deepEqual(fixtureFiles, [
      "actors.json",
      "fixture.json",
      "imports.json",
      "messages.jsonl",
      "projections.json",
      "thread.json",
      "turns.json",
    ]);
  });
});

test("explicit legacy debug export writes outside the live SQLite thread directory and avoids split-brain source files", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-legacy-split-brain-001",
      sessionFilePath: resolveProjectPath("pi", "session-legacy-split-brain-001.jsonl"),
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Split-brain guard prompt" }));

    const exportDir = resolveProjectPath("exports", "legacy-debug-guard-001");
    expectOk(
      await exportLegacyThreadDebugBundle({
        store,
        storeRootDir,
        threadId: thread.threadId,
        outputDir: exportDir,
      }),
    );

    const liveThreadFiles = (await readdir(resolveStorePath("threads", thread.threadId))).sort();
    assert.deepEqual(liveThreadFiles, ["thread.sqlite"]);

    const exportFiles = (await readdir(exportDir)).sort();
    assert.deepEqual(exportFiles, ["legacy-debug", "manifest.json", "thread.sqlite"]);
  });
});

test("inspection prefers SQLite and warns explicitly when legacy JSON shadows a live managed thread", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-legacy-inspection-001",
      sessionFilePath: resolveProjectPath("pi", "session-legacy-inspection-001.jsonl"),
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Inspection prompt" }));

    const liveThreadDir = resolveStorePath("threads", thread.threadId);
    await writeFile(
      join(liveThreadDir, "thread.json"),
      `${JSON.stringify({
        threadId: thread.threadId,
        sourceRevision: -1,
        messageHighWatermark: -1,
        updatedAt: "1999-01-01T00:00:00.000Z",
        target: { runtime: "pi", sessionId: "legacy-shadow-session" },
        status: { turnState: "repair_failed" },
      }, null, 2)}\n`,
      "utf8",
    );

    const summary = await inspectSummary({ rootDir: projectDir, threadId: thread.threadId });
    const readiness = await inspectReadiness({ rootDir: projectDir, threadId: thread.threadId });

    assert.equal(summary.backing, "sqlite");
    assert.equal(readiness.backing, "sqlite");
    assert.equal(summary.messageHighWatermark, 1);
    assert.equal(summary.messages.total, 1);
    assert.equal(summary.sourceRevision, 1);
    assert.equal(readiness.turnState, "ready");
    assert.match(
      summary.warnings.join("\n"),
      /Treating thread\.sqlite as authoritative; remove or quarantine the legacy JSON files before active runtime use\./,
    );
    assert.match(
      readiness.warnings.join("\n"),
      /Treating thread\.sqlite as authoritative; remove or quarantine the legacy JSON files before active runtime use\./,
    );
  });
});
