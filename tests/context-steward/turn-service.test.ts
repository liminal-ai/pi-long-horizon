import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import {
  checkTurnHealth,
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
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";

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
  store: FileThreadStore,
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

test("keeps an assistant response inside the current open canonical turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Prompt first" }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Response inside the turn." }] }),
        ctx,
      }),
    );

    const promptCaptured = await captureActivity(store, thread.threadId, prompt);
    const responseCaptured = await captureActivity(store, thread.threadId, response);
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [promptCaptured.message.messageId, responseCaptured.message.messageId]);
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
          responseId: "response-turn-001",
          content: [{ type: "text", text: "First response" }],
        }),
        ctx,
      }),
    );
    const responseTwo = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
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
  });
});

test("keeps multiple tool cycles in one canonical turn in source order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Run two tool cycles." }), ctx }));
    const responseOne = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
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

test("records open lifecycle status when the latest prompt has no later initiating prompt", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(mapPiMessageEnd({ message: makePiUserMessage({ content: "Leave this turn open." }), ctx }));
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Still in the same turn." }] }),
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
