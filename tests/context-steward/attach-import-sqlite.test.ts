import assert from "node:assert/strict";
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { attachExistingPiSession } from "../../src/context-steward/services/import-service.js";
import {
  DEFAULT_PI_MESSAGE_TIMESTAMP,
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiSessionEntries,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { SqliteThreadStore, resolveThreadSqlitePath } from "../../src/context-steward/store/sqlite-thread-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function writePiSessionFile(input: {
  sessionFilePath: string;
  sessionId: string;
  cwd: string;
  entries: readonly SessionEntry[];
}): Promise<void> {
  await mkdir(dirname(input.sessionFilePath), { recursive: true });

  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.sessionId,
    timestamp: DEFAULT_TEST_TIMESTAMP,
    cwd: input.cwd,
  };

  const lines = [JSON.stringify(header), ...input.entries.map((entry) => JSON.stringify(entry))];
  await writeFile(input.sessionFilePath, `${lines.join("\n")}\n`, "utf8");
}

async function assertPathMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path));
}

test("attach/import writes canonical session history into SQLite-backed managed state", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveStorePath }) => {
    const sessionId = "session-attach-sqlite-001";
    const sessionFilePath = `${projectDir}/pi/${sessionId}.jsonl`;
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Imported prompt" }),
          makePiAssistantMessage({
            responseId: "response-attach-sqlite-001",
            content: [{ type: "text", text: "Imported response" }],
          }),
          makePiToolResultMessage({
            toolCallId: "call-attach-sqlite-001",
            toolName: "read",
            content: [{ type: "text", text: "Imported tool result" }],
          }),
        ],
      }),
    });

    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    const store = new SqliteThreadStore(storeRootDir);

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importedMessages, 3);
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt", "response", "tool_result"]);
    assert.equal(snapshot.thread.importSummary.count, 1);
    assert.equal(snapshot.thread.target.sessionId, sessionId);
    assert.equal(snapshot.thread.target.sessionFilePath, sessionFilePath);

    await stat(resolveThreadSqlitePath(storeRootDir, attached.thread.threadId));
    await assertPathMissing(resolveStorePath("threads", attached.thread.threadId, "messages.jsonl"));
    await assertPathMissing(resolveStorePath("threads", attached.thread.threadId, "thread.json"));
  });
});

test("attach/import detects an existing SQLite-backed session even when index.json is missing", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const sessionId = "session-attach-sqlite-duplicate";
    const sessionFilePath = `${projectDir}/pi/${sessionId}.jsonl`;
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Imported prompt" }),
          makePiAssistantMessage({
            responseId: "response-attach-sqlite-duplicate",
            content: [{ type: "text", text: "Imported response" }],
          }),
        ],
      }),
    });

    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    const store = new SqliteThreadStore(storeRootDir);

    const firstAttach = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath,
      }),
    );

    await rm(`${storeRootDir}/index.json`, { force: true });
    await rm(`${storeRootDir}/threadId-map.json`, { force: true });

    const duplicateAttach = await attachExistingPiSession({
      store,
      target,
      sessionFilePath,
    });

    assert.equal(duplicateAttach.ok, false);
    assert.equal(duplicateAttach.ok ? undefined : duplicateAttach.issues[0]?.code, "TARGET_ASSOCIATION_CONFLICT");
    assert.match(
      duplicateAttach.ok ? "" : duplicateAttach.issues[0]?.message ?? "",
      new RegExp(firstAttach.thread.threadId),
    );
  });
});

test("attach/import records partial SQLite import issues and leaves the affected turn repair_needed", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const sessionId = "session-attach-sqlite-partial";
    const sessionFilePath = `${projectDir}/pi/${sessionId}.jsonl`;
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Prompt one" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Healthy response one" }] }),
          makePiUserMessage({ content: "Prompt two", timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 2_000 }),
          makePiAssistantMessage({
            timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP + 3_000,
            content: [{ type: "mystery_partial", value: "partial response two" } as never],
          }),
        ],
      }),
    });

    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    const store = new SqliteThreadStore(storeRootDir);

    const attached = expectOk(
      await attachExistingPiSession({
        store,
        target,
        sessionFilePath,
      }),
    );
    const snapshot = expectOk(await store.openThread(attached.thread.threadId));

    assert.equal(attached.importRecord.status, "partial");
    assert.equal(snapshot.thread.status.turnState, "repair_needed");
    assert.deepEqual(snapshot.turns.map((turn) => turn.repairStatus), ["ready", "repair_needed"]);
    assert.deepEqual(
      attached.importRecord.issues
        ?.filter((issue) => issue.code === "UNMAPPED_PART_TYPE")
        .map((issue) => issue.sourceRange),
      [{ fromSourceOrder: 4, toSourceOrder: 4 }],
    );
  });
});
