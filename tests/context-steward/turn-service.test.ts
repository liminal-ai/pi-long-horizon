import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { fail, type StewardResult } from "../../src/context-steward/domain/errors.js";
import {
  checkTurnHealth,
  finalizeOpenTurnOnTurnEnd,
  writeCapturedMessageTurns,
} from "../../src/context-steward/services/turn-service.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiToolResultMessage,
  makePiUserMessage,
  makeRuntimeNoteActivity,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore, withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import type { ThreadStore } from "../../src/context-steward/store/thread-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (target.sessionFilePath) {
    await mkdir(dirname(target.sessionFilePath), { recursive: true });
    await writeFile(target.sessionFilePath, '{"type":"session"}\n');
  }
}

async function createManagedThread(storeRootDir: string, target = makeThreadTarget()) {
  await ensureTargetSessionFile(target);

  const store = new FileThreadStore(storeRootDir);
  const thread = expectOk(await openOrCreateManagedThread({ target }, store));
  const ctx = makePiExtensionContext(target);

  return { store, thread, ctx };
}

async function captureActivity(
  store: ThreadStore,
  threadId: string,
  activity: Parameters<typeof captureFinalizedActivity>[0]["activity"],
) {
  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
      turnWriter: writeCapturedMessageTurns,
    }),
  );
}

async function createManagedThreadForStore<TStore extends ThreadStore>(store: TStore, target = makeThreadTarget()) {
  await ensureTargetSessionFile(target);

  const thread = expectOk(await openOrCreateManagedThread({ target }, store));
  const ctx = makePiExtensionContext(target);

  return { store, thread, ctx };
}

class RowLevelOnlySqliteTurnStore extends SqliteThreadStore {
  compatibilityWrites = 0;
  rowWrites = 0;

  override async writeTurns(_input: Parameters<ThreadStore["writeTurns"]>[0]) {
    this.compatibilityWrites += 1;
    return fail({
      code: "STORE_UNAVAILABLE",
      message: "Unexpected compatibility turn write in SQLite row-level path test.",
    });
  }

  override async writeTurnRows(input: Parameters<NonNullable<ThreadStore["writeTurnRows"]>>[0]) {
    this.rowWrites += 1;
    return super.writeTurnRows(input);
  }
}

class ObservingSqliteTurnStore extends SqliteThreadStore {
  compatibilityWrites = 0;
  rowWrites = 0;

  override async writeTurns(input: Parameters<ThreadStore["writeTurns"]>[0]) {
    this.compatibilityWrites += 1;
    return super.writeTurns(input);
  }

  override async writeTurnRows(input: Parameters<NonNullable<ThreadStore["writeTurnRows"]>>[0]) {
    this.rowWrites += 1;
    return super.writeTurnRows(input);
  }
}

test("opens the first canonical turn from the first agent-addressed prompt", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Open the first turn." }),
        ctx,
      }),
    );

    const captured = await captureActivity(store, thread.threadId, prompt);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.lifecycleStatus, "open");
    assert.equal(turns[0]?.initiatingMessageId, captured.message.messageId);
    assert.deepEqual(turns[0]?.messageIds, [captured.message.messageId]);
  });
});

test("closes the previous turn and opens a new one when the next prompt arrives", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const firstPrompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt one" }), ctx }));
    const secondPrompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Prompt two", timestamp: Date.parse("2026-05-10T00:00:10.000Z") }),
        ctx,
      }),
    );

    const firstCaptured = await captureActivity(store, thread.threadId, firstPrompt);
    const secondCaptured = await captureActivity(store, thread.threadId, secondPrompt);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.lifecycleStatus, "closed");
    assert.deepEqual(turns[0]?.messageIds, [firstCaptured.message.messageId]);
    assert.equal(turns[1]?.lifecycleStatus, "open");
    assert.deepEqual(turns[1]?.messageIds, [secondCaptured.message.messageId]);
  });
});

test("keeps a non-final assistant response inside the current open canonical turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Response inside the turn." },
            { type: "toolCall", id: "call-inside-turn", name: "read", arguments: { path: "a.ts" } },
          ],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns[0]?.lifecycleStatus, "open");
    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, responseCaptured.message.messageId]);
  });
});

test("final assistant stop response closes the current canonical turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "stop",
          content: [{ type: "text", text: "Final response." }],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns[0]?.lifecycleStatus, "closed");
    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, responseCaptured.message.messageId]);
  });
});

test("SQLite assistant capture quarantines compatibility writes to source-revision-advancing turn updates", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-turn-row-write-001",
      sessionFilePath: `${projectDir}/pi/session-turn-row-write-001.jsonl`,
      cwd: projectDir,
    });
    const seedStore = new SqliteThreadStore(storeRootDir);
    const { thread, ctx } = await createManagedThreadForStore(seedStore, target);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Seed prompt" }), ctx }));
    await captureActivity(seedStore, thread.threadId, prompt);

    const observedStore = new ObservingSqliteTurnStore(storeRootDir);
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "stop",
          responseId: "response-turn-row-write-001",
          content: [{ type: "text", text: "Close via row write." }],
        }),
        ctx,
      }),
    );

    const captured = await captureActivity(observedStore, thread.threadId, response);

    assert.equal(captured.turns[0]?.lifecycleStatus, "closed");
    assert.equal(observedStore.compatibilityWrites, 1);
    assert.equal(observedStore.rowWrites, 0);
  });
});

test("finalizes the latest open canonical turn on turn_end without appending messages", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Response inside the turn." },
            { type: "toolCall", id: "call-turn-end-finalizer", name: "read", arguments: { path: "a.ts" } },
          ],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    const beforeMessages = expectOk(await store.readMessages(thread.threadId));
    const finalized = expectOk(
      await finalizeOpenTurnOnTurnEnd({
        store,
        threadId: thread.threadId,
        closedAt: "2026-05-10T00:00:30.000Z",
      }),
    );

    assert.equal(finalized.finalized, true);
    assert.equal(finalized.finalizedTurnId, finalized.turns[0]?.turnId);
    assert.equal(finalized.turns[0]?.lifecycleStatus, "closed");
    assert.equal(finalized.turns[0]?.closedAt, "2026-05-10T00:00:30.000Z");
    assert.deepEqual(finalized.turns[0]?.messageIds, [
      promptCaptured.message.messageId,
      responseCaptured.message.messageId,
    ]);
    assert.deepEqual(expectOk(await store.readMessages(thread.threadId)), beforeMessages);
  });
});

test("SQLite turn_end finalization uses row-level turn writes when it only closes an existing turn", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-turn-finalize-row-write-001",
      sessionFilePath: `${projectDir}/pi/session-turn-finalize-row-write-001.jsonl`,
      cwd: projectDir,
    });
    const seedStore = new SqliteThreadStore(storeRootDir);
    const { thread, ctx } = await createManagedThreadForStore(seedStore, target);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Response inside the turn." },
            { type: "toolCall", id: "call-turn-end-row-write", name: "read", arguments: { path: "a.ts" } },
          ],
        }),
        ctx,
      }),
    );
    await captureActivity(seedStore, thread.threadId, prompt);
    await captureActivity(seedStore, thread.threadId, response);

    const rowLevelStore = new RowLevelOnlySqliteTurnStore(storeRootDir);
    const finalized = expectOk(
      await finalizeOpenTurnOnTurnEnd({
        store: rowLevelStore,
        threadId: thread.threadId,
        closedAt: "2026-05-10T00:00:30.000Z",
      }),
    );

    assert.equal(finalized.finalized, true);
    assert.equal(finalized.turns[0]?.closedAt, "2026-05-10T00:00:30.000Z");
    assert.equal(rowLevelStore.compatibilityWrites, 0);
    assert.equal(rowLevelStore.rowWrites, 1);
  });
});

test("turn_end finalization is idempotent when no open turn remains", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    await captureActivity(store, thread.threadId, prompt);

    const first = expectOk(
      await finalizeOpenTurnOnTurnEnd({
        store,
        threadId: thread.threadId,
        closedAt: "2026-05-10T00:00:30.000Z",
      }),
    );
    const second = expectOk(
      await finalizeOpenTurnOnTurnEnd({
        store,
        threadId: thread.threadId,
        closedAt: "2026-05-10T00:00:31.000Z",
      }),
    );

    assert.equal(first.finalized, true);
    assert.equal(second.finalized, false);
    assert.equal(second.turns[0]?.closedAt, "2026-05-10T00:00:30.000Z");
  });
});

test("turn_end finalization reports a non-latest open turn instead of guessing", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const promptOne = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt one" }), ctx }));
    const promptTwo = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt two" }), ctx }));
    await captureActivity(store, thread.threadId, promptOne);
    await captureActivity(store, thread.threadId, promptTwo);

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const corruptedTurns = snapshot.turns.map((turn, index) =>
      index === 0
        ? {
            ...turn,
            lifecycleStatus: "open" as const,
            closedAt: undefined,
          }
        : {
            ...turn,
            lifecycleStatus: "closed" as const,
            closedAt: "2026-05-10T00:00:20.000Z",
          });
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        turns: corruptedTurns,
        turnState: snapshot.thread.status.turnState,
      }),
    );

    const result = await finalizeOpenTurnOnTurnEnd({
      store,
      threadId: thread.threadId,
      closedAt: "2026-05-10T00:00:30.000Z",
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.issues[0]?.code, "TURN_STATE_INCOMPLETE");
    assert.match(result.ok ? "" : result.issues[0]?.message ?? "", /the open canonical turn is not the latest turn/);
  });
});

test("turn_end finalization reports multiple open turns instead of guessing", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const promptOne = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt one" }), ctx }));
    const promptTwo = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt two" }), ctx }));
    await captureActivity(store, thread.threadId, promptOne);
    await captureActivity(store, thread.threadId, promptTwo);

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const corruptedTurns = snapshot.turns.map((turn, index) =>
      index === 0
        ? {
            ...turn,
            lifecycleStatus: "open" as const,
            closedAt: undefined,
          }
        : turn);
    expectOk(
      await store.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        turns: corruptedTurns,
        turnState: snapshot.thread.status.turnState,
      }),
    );

    const result = await finalizeOpenTurnOnTurnEnd({
      store,
      threadId: thread.threadId,
      closedAt: "2026-05-10T00:00:30.000Z",
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.issues[0]?.code, "TURN_STATE_INCOMPLETE");
    assert.match(result.ok ? "" : result.issues[0]?.message ?? "", /multiple canonical turns are marked open/);
  });
});

test("keeps tool-result activity inside the current open canonical turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Run the tool." }), ctx }));
    const toolResult = expectOk(
      mapPiMessageEnd({
        message: makePiToolResultMessage({
          toolCallId: "call-turn-001",
          toolName: "bash",
          content: [{ type: "text", text: "tool output" }],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const toolCaptured = await captureActivity(store, thread.threadId, toolResult);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, toolCaptured.message.messageId]);
  });
});

test("keeps runtime notes inside the current open canonical turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Track runtime notes." }), ctx }));
    const runtimeNote = makeRuntimeNoteActivity();

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const runtimeCaptured = await captureActivity(
      store,
      thread.threadId,
      makeRuntimeNoteActivity({
        targetMetadata: {
          ...runtimeNote.targetMetadata,
          sessionId: ctx.sessionManager.getSessionId() || undefined,
          sessionFilePath: ctx.sessionManager.getSessionFile(),
        },
      }),
    );
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, runtimeCaptured.message.messageId]);
  });
});

test("keeps multiple assistant responses in one canonical turn in source order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Collect responses." }), ctx }));
    const responseOne = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          responseId: "response-turn-001",
          content: [
            { type: "text", text: "First response" },
            { type: "toolCall", id: "call-response-001", name: "read", arguments: { path: "a.ts" } },
          ],
        }),
        ctx,
      }),
    );
    const responseTwo = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "stop",
          responseId: "response-turn-002",
          content: [{ type: "text", text: "Second response" }],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const firstResponseCaptured = await captureActivity(store, thread.threadId, responseOne);
    const secondResponseCaptured = await captureActivity(store, thread.threadId, responseTwo);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [
      promptCaptured.message.messageId,
      firstResponseCaptured.message.messageId,
      secondResponseCaptured.message.messageId,
    ]);
    assert.equal(turns[0]?.lifecycleStatus, "closed");
  });
});

test("keeps multiple tool cycles in one canonical turn in source order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Run two tool cycles." }), ctx }));
    const responseOne = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          responseId: "response-cycle-001",
          content: [{ type: "toolCall", id: "call-cycle-001", name: "read", arguments: { path: "a.ts" } }],
        }),
        ctx,
      }),
    );
    const toolResultOne = expectOk(
      mapPiMessageEnd({
        message: makePiToolResultMessage({
          toolCallId: "call-cycle-001",
          toolName: "read",
          content: [{ type: "text", text: "result one" }],
        }),
        ctx,
      }),
    );
    const responseTwo = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          responseId: "response-cycle-002",
          content: [{ type: "toolCall", id: "call-cycle-002", name: "read", arguments: { path: "b.ts" } }],
        }),
        ctx,
      }),
    );
    const toolResultTwo = expectOk(
      mapPiMessageEnd({
        message: makePiToolResultMessage({
          toolCallId: "call-cycle-002",
          toolName: "read",
          content: [{ type: "text", text: "result two" }],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseOneCaptured = await captureActivity(store, thread.threadId, responseOne);
    const toolResultOneCaptured = await captureActivity(store, thread.threadId, toolResultOne);
    const responseTwoCaptured = await captureActivity(store, thread.threadId, responseTwo);
    const toolResultTwoCaptured = await captureActivity(store, thread.threadId, toolResultTwo);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [
      promptCaptured.message.messageId,
      responseOneCaptured.message.messageId,
      toolResultOneCaptured.message.messageId,
      responseTwoCaptured.message.messageId,
      toolResultTwoCaptured.message.messageId,
    ]);
  });
});

test("records open lifecycle status when the latest prompt has no final assistant response", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Leave this turn open." }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Still in the same turn." },
            { type: "toolCall", id: "call-still-open", name: "read", arguments: { path: "a.ts" } },
          ],
        }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns[0]?.lifecycleStatus, "open");
    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, responseCaptured.message.messageId]);
  });
});

test("records closed lifecycle status for the prior turn after a later prompt arrives", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const firstPrompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "First prompt" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Response before the next prompt." }] }),
        ctx,
      }),
    );
    const secondPrompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Second prompt" }), ctx }));

    const firstPromptCaptured = await captureActivity(store, thread.threadId, firstPrompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    await captureActivity(store, thread.threadId, secondPrompt);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns[0]?.lifecycleStatus, "closed");
    assert.deepEqual(turns[0]?.messageIds, [firstPromptCaptured.message.messageId, responseCaptured.message.messageId]);
  });
});

test("retains pre-turn runtime notes in source history without forcing them into turn membership", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const runtimeNote = await captureActivity(
      store,
      thread.threadId,
      makeRuntimeNoteActivity({
        targetMetadata: {
          runtime: "pi",
          sessionId: ctx.sessionManager.getSessionId() || undefined,
          sessionFilePath: ctx.sessionManager.getSessionFile(),
          rawType: "runtime_note",
        },
      }),
    );
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "First real prompt." }), ctx }));
    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const turns = expectOk(await store.readTurns(thread.threadId));
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.messageId, runtimeNote.message.messageId);
    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId]);
    assert.ok(!turns[0]?.messageIds.includes(runtimeNote.message.messageId));
  });
});

test("reports pre-turn source record ranges during turn health checks", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await captureActivity(
      store,
      thread.threadId,
      makeRuntimeNoteActivity({
        targetEventKey: "pi:session-001:runtime-note-pre-001",
        targetMetadata: {
          runtime: "pi",
          sessionId: ctx.sessionManager.getSessionId() || undefined,
          sessionFilePath: ctx.sessionManager.getSessionFile(),
          rawType: "runtime_note",
        },
      }),
    );
    await captureActivity(
      store,
      thread.threadId,
      makeRuntimeNoteActivity({
        targetEventKey: "pi:session-001:runtime-note-pre-002",
        targetMetadata: {
          runtime: "pi",
          sessionId: ctx.sessionManager.getSessionId() || undefined,
          sessionFilePath: ctx.sessionManager.getSessionFile(),
          rawType: "runtime_note",
        },
      }),
    );
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt after pre-turn notes." }), ctx }));
    await captureActivity(store, thread.threadId, prompt);

    const health = checkTurnHealth(expectOk(await store.openThread(thread.threadId)));

    assert.equal(health.status, "ready");
    assert.deepEqual(health.preTurnRanges, [{ fromSourceOrder: 1, toSourceOrder: 2 }]);
    assert.deepEqual(health.uncoveredRanges, []);
  });
});
