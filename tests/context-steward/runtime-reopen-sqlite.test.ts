import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { registerContextStewardExtension } from "../../src/context-steward/pi/pi-extension.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { createSourceRange } from "../../src/context-steward/domain/ids.js";
import { fail } from "../../src/context-steward/domain/errors.js";
import { SqliteThreadStore, seedSqliteThreadSnapshot } from "../../src/context-steward/store/sqlite-thread-store.js";
import type { ThreadStore } from "../../src/context-steward/store/thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeProjectionRevisionRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/context-steward/test/temp-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

class FakeExtensionApi {
  readonly handlers = new Map<string, Array<(event: any, ctx: any) => Promise<unknown> | unknown>>();

  on(eventName: string, handler: (event: any, ctx: any) => Promise<unknown> | unknown): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async emit(eventName: string, event: any, ctx: any): Promise<void> {
    for (const handler of this.handlers.get(eventName) ?? []) {
      await handler(event, ctx);
    }
  }
}

async function ensureSessionFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '{"type":"session"}\n', "utf8");
}

async function capturePiMessage(
  store: ThreadStore,
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

  return captureFinalizedActivity({
    store,
    threadId,
    activity,
  });
}

test("reopen restores canonical messages, turn state, and projection linkage from SQLite-backed state", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-runtime-reopen-sqlite-001",
      sessionFilePath: `${projectDir}/pi/session-runtime-reopen-sqlite-001.jsonl`,
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    expectOk(await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Reopen prompt" })));
    expectOk(
      await capturePiMessage(
        store,
        thread.threadId,
        target,
        makePiAssistantMessage({
          responseId: "response-runtime-reopen-sqlite-001",
          content: [{ type: "text", text: "Reopen response" }],
        }),
      ),
    );
    expectOk(
      await store.writeProjectionRevision(
        makeProjectionRevisionRecord({
          threadId: thread.threadId,
          revisionId: "projection-runtime-reopen-001",
          generatedSessionId: "generated-runtime-reopen-001",
          generatedFilePath: `${projectDir}/generated/projection-runtime-reopen-001.jsonl`,
          status: "available",
        }),
      ),
    );

    const reopenedStore = new SqliteThreadStore(storeRootDir);
    const reopenedThread = expectOk(await reopenedStore.findManagedThread(target));
    assert.ok(reopenedThread);

    const reopenedSnapshot = expectOk(await reopenedStore.openThread(thread.threadId));
    assert.deepEqual(reopenedSnapshot.messages.map((message) => message.messageKind), ["prompt", "response"]);
    assert.equal(reopenedSnapshot.turns.length, 1);
    assert.equal(reopenedSnapshot.turns[0]?.lifecycleStatus, "closed");
    assert.equal(reopenedSnapshot.thread.status.turnState, "ready");
    assert.equal(reopenedSnapshot.thread.threadViewOutputSummary.currentProjectionRevisionId, "projection-runtime-reopen-001");
    assert.equal(reopenedSnapshot.thread.threadViewOutputSummary.currentGeneratedSessionId, "generated-runtime-reopen-001");
    assert.equal(
      reopenedSnapshot.thread.threadViewOutputSummary.currentGeneratedFilePath,
      `${projectDir}/generated/projection-runtime-reopen-001.jsonl`,
    );
  });
});

test("reopen preserves canonical messages and repair-needed status after turn persistence fails", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-runtime-reopen-sqlite-002",
      sessionFilePath: `${projectDir}/pi/session-runtime-reopen-sqlite-002.jsonl`,
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Repair me" }),
        ctx: makePiExtensionContext(target),
      }),
    );
    const captured = await captureFinalizedActivity({
      store,
      threadId: thread.threadId,
      activity,
      turnWriter: async ({ message }) =>
        fail({
          code: "TURN_STATE_INCOMPLETE",
          message: `Turn state could not include message ${message.messageId}.`,
          threadId: thread.threadId,
          sourceRange: createSourceRange(message.sourceOrder),
        }),
    });
    if (!captured.ok) {
      assert.fail(captured.issues.map((issue) => issue.code).join(", "));
    }

    const issues = captured.issues ?? [];
    assert.ok(issues.some((issue) => issue.code === "TURN_STATE_INCOMPLETE"));

    const reopenedSnapshot = expectOk(await new SqliteThreadStore(storeRootDir).openThread(thread.threadId));
    assert.equal(reopenedSnapshot.messages.length, 1);
    assert.equal(reopenedSnapshot.messages[0]?.messageKind, "prompt");
    assert.equal(reopenedSnapshot.thread.status.turnState, "repair_needed");
  });
});

test("reopen reconciles generated rollout linkage after live activity appends through the compacted session target", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const originalTarget = makeThreadTarget({
      sessionId: "session-runtime-reopen-sqlite-generated-source",
      sessionFilePath: `${projectDir}/pi/session-runtime-reopen-sqlite-generated-source.jsonl`,
      cwd: projectDir,
    });
    const generatedFilePath = resolveProjectPath("generated", "runtime-reopen-generated-active.jsonl");
    await ensureSessionFile(originalTarget.sessionFilePath!);
    await ensureSessionFile(generatedFilePath);

    const store = new SqliteThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: originalTarget }, store));
    expectOk(
      await store.writeProjectionRevision(
        makeProjectionRevisionRecord({
          threadId: thread.threadId,
          revisionId: "projection-runtime-generated-001",
          generatedSessionId: "generated-runtime-generated-001",
          generatedFilePath,
          status: "available",
        }),
      ),
    );
    expectOk(
      await store.updateThreadMetadata({
        threadId: thread.threadId,
        expectedSourceRevision: thread.sourceRevision,
        patch: {
          target: {
            ...thread.target,
            currentGeneratedFilePath: generatedFilePath,
          },
          threadViewOutputSummary: {
            ...thread.threadViewOutputSummary,
            count: 1,
            currentProjectionRevisionId: "projection-runtime-generated-001",
            currentGeneratedSessionId: "generated-runtime-generated-001",
            currentGeneratedFilePath: generatedFilePath,
            lastRevisionStatus: "available",
          },
        },
      }),
    );

    const generatedTarget = makeThreadTarget({
      sessionId: "session-runtime-reopen-sqlite-generated-active",
      sessionFilePath: generatedFilePath,
      cwd: projectDir,
    });
    expectOk(
      await store.recordThreadIdMap({
        threadId: thread.threadId,
        target: generatedTarget,
      }),
    );

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI);
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiUserMessage({ content: "Post-compact live prompt" }),
      },
      makePiExtensionContext(generatedTarget),
    );

    const reopenedStore = new SqliteThreadStore(storeRootDir);
    const originalLookup = expectOk(await reopenedStore.findManagedThread(originalTarget));
    const generatedLookup = expectOk(await reopenedStore.findManagedThread(generatedTarget));
    assert.equal(originalLookup?.threadId, thread.threadId);
    assert.equal(generatedLookup?.threadId, thread.threadId);

    const reopenedSnapshot = expectOk(await reopenedStore.openThread(thread.threadId));
    assert.equal(reopenedSnapshot.thread.target.sessionId, originalTarget.sessionId);
    assert.equal(reopenedSnapshot.thread.target.sessionFilePath, originalTarget.sessionFilePath);
    assert.equal(reopenedSnapshot.thread.target.currentGeneratedFilePath, generatedFilePath);
    assert.equal(reopenedSnapshot.thread.threadViewOutputSummary.currentProjectionRevisionId, "projection-runtime-generated-001");
    assert.equal(reopenedSnapshot.thread.threadViewOutputSummary.currentGeneratedSessionId, "generated-runtime-generated-001");
    assert.equal(reopenedSnapshot.thread.threadViewOutputSummary.currentGeneratedFilePath, generatedFilePath);
    assert.equal(reopenedSnapshot.messages.length, 1);
    assert.equal(reopenedSnapshot.messages[0]?.targetMetadata?.sessionId, generatedTarget.sessionId);
    assert.equal(reopenedSnapshot.messages[0]?.targetMetadata?.sessionFilePath, generatedFilePath);
  });
});

test("reopen preserves persisted maintenance debt on SQLite-backed managed threads", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const thread = makeThreadRecord({
      threadId: "thread-runtime-reopen-sqlite-003",
      target: makeThreadTarget({
        sessionId: "session-runtime-reopen-sqlite-003",
        sessionFilePath: `${projectDir}/pi/session-runtime-reopen-sqlite-003.jsonl`,
        cwd: projectDir,
      }),
      status: {
        turnState: "repair_needed",
        tokenCounting: {
          status: "repair_needed",
          updatedAt: "2026-05-26T12:45:00.000Z",
          issueCount: 1,
          issues: [
            {
              code: "TOKEN_COUNT_DEGRADED",
              message: "Exact generated token count needs repair.",
            },
          ],
        },
      },
    });
    const actor = makeActorRecord({ actorId: "actor-runtime-reopen-sqlite-003", actorType: "human" });
    const message = makeMessageRecord({
      threadId: thread.threadId,
      actorId: actor.actorId,
      actorType: actor.actorType,
      messageId: "message-runtime-reopen-sqlite-003",
      sourceOrder: 1,
      sourceRevision: 1,
    });
    const turn = makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-runtime-reopen-sqlite-003",
      initiatingMessageId: message.messageId,
      messageIds: [message.messageId],
      sourceRange: { fromSourceOrder: 1, toSourceOrder: 1 },
      lifecycleStatus: "open",
      repairStatus: "repair_needed",
      sourceRevision: 1,
    });

    expectOk(
      await seedSqliteThreadSnapshot({
        rootDir: storeRootDir,
        thread,
        actors: [actor],
        messages: [message],
        turns: [turn],
      }),
    );

    const reopenedSnapshot = expectOk(await new SqliteThreadStore(storeRootDir).openThread(thread.threadId));
    assert.equal(reopenedSnapshot.thread.status.turnState, "repair_needed");
    assert.equal(reopenedSnapshot.thread.status.tokenCounting?.status, "repair_needed");
    assert.equal(reopenedSnapshot.thread.status.tokenCounting?.issueCount, 1);
    assert.equal(reopenedSnapshot.thread.status.tokenCounting?.issues?.[0]?.code, "TOKEN_COUNT_DEGRADED");
  });
});
