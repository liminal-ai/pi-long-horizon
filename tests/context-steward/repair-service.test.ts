import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { fail, type StewardErrorCode, type StewardResult } from "../../src/context-steward/domain/errors.js";
import { createSourceRange } from "../../src/context-steward/domain/ids.js";
import type { TurnRecord } from "../../src/context-steward/domain/records.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { repairTurnState } from "../../src/context-steward/services/repair-service.js";
import {
  checkMaintenanceReadiness,
  checkTurnHealth,
} from "../../src/context-steward/services/turn-service.js";
import type { WriteTurnsInput } from "../../src/context-steward/store/thread-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makePartRecord,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function expectIssueCode<T>(result: StewardResult<T>, code: StewardErrorCode) {
  const issues = result.ok ? (result.issues ?? []) : result.issues;
  const issue = issues.find((candidate) => candidate.code === code);
  assert.ok(issue, `Expected ${code}, received ${issues.map((candidate) => candidate.code).join(", ") || "no issues"}`);
  return issue;
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n');
}

async function createManagedThread(storeRootDir: string, target = makeThreadTarget()) {
  await ensureTargetSessionFile(target);

  const store = new FileThreadStore(storeRootDir);
  const thread = expectOk(await openOrCreateManagedThread({ target }, store));
  const ctx = makePiExtensionContext(target);

  return { store, thread, ctx };
}

async function capturePiMessage(
  store: FileThreadStore,
  threadId: string,
  ctx: ReturnType<typeof makePiExtensionContext>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(mapPiMessageEnd({ message, ctx }));

  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
    }),
  );
}

async function clearTurnState(store: FileThreadStore, threadId: string) {
  const snapshot = expectOk(await store.openThread(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: [],
      turnState: "repair_needed",
    }),
  );
}

async function writeTurns(
  store: FileThreadStore,
  threadId: string,
  turns: TurnRecord[],
  turnState: "ready" | "repair_needed" | "repair_failed" | "unknown",
) {
  const snapshot = expectOk(await store.openThread(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns,
      turnState,
    }),
  );
}

async function captureThreeTurnConversation(store: FileThreadStore, threadId: string, ctx: ReturnType<typeof makePiExtensionContext>) {
  const promptOne = await capturePiMessage(store, threadId, ctx, makePiUserMessage({ content: "Prompt one" }));
  const responseOne = await capturePiMessage(
    store,
    threadId,
    ctx,
    makePiAssistantMessage({
      responseId: "response-repair-001",
      content: [{ type: "text", text: "Response one" }],
    }),
  );
  const promptTwo = await capturePiMessage(
    store,
    threadId,
    ctx,
    makePiUserMessage({
      content: "Prompt two",
      timestamp: Date.parse("2026-05-10T00:00:10.000Z"),
    }),
  );
  const responseTwo = await capturePiMessage(
    store,
    threadId,
    ctx,
    makePiAssistantMessage({
      responseId: "response-repair-002",
      timestamp: Date.parse("2026-05-10T00:00:11.000Z"),
      content: [{ type: "text", text: "Response two" }],
    }),
  );
  const promptThree = await capturePiMessage(
    store,
    threadId,
    ctx,
    makePiUserMessage({
      content: "Prompt three",
      timestamp: Date.parse("2026-05-10T00:00:20.000Z"),
    }),
  );
  const responseThree = await capturePiMessage(
    store,
    threadId,
    ctx,
    makePiAssistantMessage({
      responseId: "response-repair-003",
      timestamp: Date.parse("2026-05-10T00:00:21.000Z"),
      content: [{ type: "text", text: "Response three" }],
    }),
  );

  return {
    promptOne,
    responseOne,
    promptTwo,
    responseTwo,
    promptThree,
    responseThree,
  };
}

class FailingRepairWriteStore extends FileThreadStore {
  override async writeTurns(_input: WriteTurnsInput) {
    return fail({
      code: "STORE_UNAVAILABLE",
      message: "Simulated turn snapshot write failure.",
    });
  }
}

class StaleRepairStore extends FileThreadStore {
  private appendedDuringRepair = false;

  override async writeTurns(input: WriteTurnsInput) {
    if (!this.appendedDuringRepair) {
      this.appendedDuringRepair = true;

      const actor = makeActorRecord({
        actorId: "actor-stale-repair-001",
        actorType: "agent",
      });
      await this.appendMessage({
        threadId: input.threadId,
        actor,
        targetEventKey: "pi:session-001:stale-repair-response",
        message: {
          messageId: "message-stale-repair-001",
          threadId: input.threadId,
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "response",
          createdAt: "2026-05-10T00:01:00.000Z",
          parts: [
            makePartRecord({
              partId: "part-stale-repair-001",
              partOrder: 1,
              partType: "text",
              content: "Response captured while repair was running.",
            }),
          ],
        },
      });
    }

    return super.writeTurns(input);
  }
}

test("detects missing turn state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Repair me." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Missing turn snapshot." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const health = checkTurnHealth(expectOk(await store.openThread(thread.threadId)));

    assert.equal(health.status, "repair_needed");
    assert.deepEqual(health.uncoveredRanges, [{ fromSourceOrder: 1, toSourceOrder: 2 }]);
    expectIssueCode({ ok: true, value: health, issues: health.issues }, "TURN_STATE_MISSING");
  });
});

test("detects incomplete turn membership", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt first." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response not covered." }] }),
    );

    await writeTurns(
      store,
      thread.threadId,
      [
        {
          ...expectOk(await store.readTurns(thread.threadId))[0]!,
          messageIds: [prompt.message.messageId],
          sourceRange: createSourceRange(prompt.message.sourceOrder),
          sourceRevision: prompt.message.sourceRevision,
        },
      ],
      "repair_needed",
    );

    const health = checkTurnHealth(expectOk(await store.openThread(thread.threadId)));

    assert.equal(health.status, "repair_needed");
    assert.deepEqual(health.uncoveredRanges, [{ fromSourceOrder: 2, toSourceOrder: 2 }]);
    expectIssueCode({ ok: true, value: health, issues: health.issues }, "TURN_STATE_INCOMPLETE");
  });
});

test("passes healthy turn state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Healthy prompt." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Healthy response." }] }),
    );

    const health = checkTurnHealth(expectOk(await store.openThread(thread.threadId)));

    assert.equal(health.status, "ready");
    assert.deepEqual(health.issues, []);
  });
});

test("repair creates turns from prompts", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt one" }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response one" }] }),
    );
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiUserMessage({
        content: "Prompt two",
        timestamp: Date.parse("2026-05-10T00:00:10.000Z"),
      }),
    );
    await clearTurnState(store, thread.threadId);

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.lifecycleStatus, "closed");
    assert.equal(turns[1]?.lifecycleStatus, "open");
  });
});

test("repair assigns between-boundary messages to the first prompt turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const promptOne = await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt one" }));
    const response = await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({
        stopReason: "toolUse",
        responseId: "response-between-001",
        content: [
          { type: "text", text: "Assistant between prompts." },
          { type: "toolCall", id: "call-between-001", name: "bash", arguments: { cmd: "pwd" } },
        ],
      }),
    );
    const toolResult = await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiToolResultMessage({
        toolCallId: "call-between-001",
        toolName: "bash",
        content: [{ type: "text", text: "Tool between prompts." }],
      }),
    );
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiUserMessage({
        content: "Prompt two",
        timestamp: Date.parse("2026-05-10T00:00:10.000Z"),
      }),
    );
    await clearTurnState(store, thread.threadId);

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.deepEqual(turns[0]?.messageIds, [
      promptOne.message.messageId,
      response.message.messageId,
      toolResult.message.messageId,
    ]);
  });
});

test("repair preserves the final open turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Leave this turn open." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Still open." },
          { type: "toolCall", id: "call-open-001", name: "bash", arguments: { cmd: "pwd" } },
        ],
      }),
    );
    await clearTurnState(store, thread.threadId);

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const turns = expectOk(await store.readTurns(thread.threadId));

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.lifecycleStatus, "open");
  });
});

test("repair preserves message source order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await captureThreeTurnConversation(store, thread.threadId, ctx);
    await clearTurnState(store, thread.threadId);
    const before = expectOk(await store.readMessages(thread.threadId));

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const after = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(
      after.map((message) => message.sourceOrder),
      before.map((message) => message.sourceOrder),
    );
  });
});

test("repair preserves raw message content and metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiUserMessage({
        content: [{ type: "text", text: "Keep my content exactly." }],
      }),
    );
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({
        responseId: "response-preserve-001",
        content: [
          { type: "text", text: "Preserve text." },
          { type: "thinking", thinking: "", thinkingSignature: "sig-preserve-001", redacted: true },
          { type: "toolCall", id: "call-preserve-001", name: "read", arguments: { path: "src/app.ts" } },
        ],
      }),
    );
    await clearTurnState(store, thread.threadId);
    const before = expectOk(await store.readMessages(thread.threadId));

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const after = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(after, before);
  });
});

test("missing turn state blocks maintenance readiness", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt first." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response blocked by missing turns." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const readiness = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));

    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.blockers[0]?.code, "TURN_STATE_MISSING");
    assert.deepEqual(readiness.blockers[0]?.sourceRange, { fromSourceOrder: 1, toSourceOrder: 2 });
  });
});

test("incomplete turn state blocks maintenance readiness", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const captured = await captureThreeTurnConversation(store, thread.threadId, ctx);
    const turns = expectOk(await store.readTurns(thread.threadId));
    const brokenTurns = turns.map((turn) =>
      turn.initiatingMessageId === captured.promptTwo.message.messageId
        ? {
            ...turn,
            messageIds: [captured.promptTwo.message.messageId],
            sourceRange: createSourceRange(captured.promptTwo.message.sourceOrder),
          }
        : turn,
    );
    await writeTurns(store, thread.threadId, brokenTurns, "repair_needed");

    const readiness = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));

    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.blockers[0]?.code, "TURN_STATE_INCOMPLETE");
    assert.deepEqual(readiness.blockers[0]?.sourceRange, { fromSourceOrder: 4, toSourceOrder: 4 });
  });
});

test("repaired turn state clears the maintenance blocker", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Repair this thread." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Then clear the blocker." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const before = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));
    assert.equal(before.status, "blocked");

    expectOk(await repairTurnState({ store, threadId: thread.threadId }));
    const after = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));

    assert.equal(after.status, "ready");
    assert.deepEqual(after.blockers, []);
  });
});

test("reports ambiguous prompt boundaries without trusting repaired turns", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread } = await createManagedThread(storeRootDir);
    const actor = makeActorRecord({ actorId: "actor-ambiguous-001", actorType: "runtime" });

    await appendSourceMessage({
      store,
      threadId: thread.threadId,
      actor: makeActorRecord({ actorId: "actor-human-001", actorType: "human" }),
      targetEventKey: "pi:session-001:prompt-ambiguous-001",
      message: {
        messageId: "message-ambiguous-prompt-001",
        threadId: thread.threadId,
        actorId: "actor-human-001",
        actorType: "human",
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-ambiguous-prompt-001", content: "Prompt before ambiguity." })],
      },
    });
    await appendSourceMessage({
      store,
      threadId: thread.threadId,
      actor,
      targetEventKey: "pi:session-001:ambiguous-boundary-001",
      message: {
        messageId: "message-ambiguous-001",
        threadId: thread.threadId,
        actorId: actor.actorId,
        actorType: actor.actorType,
        messageKind: "unknown",
        createdAt: "2026-05-10T00:00:05.000Z",
        parts: [makePartRecord({ partId: "part-ambiguous-001", partType: "unknown", content: { raw: "ambiguous" } })],
      },
    });
    await clearTurnState(store, thread.threadId);

    const repaired = await repairTurnState({ store, threadId: thread.threadId });

    assert.equal(repaired.ok, false);
    expectIssueCode(repaired, "TURN_REPAIR_AMBIGUOUS");
    const readiness = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));
    assert.equal(readiness.status, "blocked");
  });
});

test("reports repair write failures and keeps readiness blocked", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt before failed repair." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response before failed repair." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const failingStore = new FailingRepairWriteStore(storeRootDir);
    const repaired = await repairTurnState({ store: failingStore, threadId: thread.threadId });

    assert.equal(repaired.ok, false);
    expectIssueCode(repaired, "TURN_REPAIR_WRITE_FAILED");
    const readiness = checkMaintenanceReadiness(expectOk(await store.openThread(thread.threadId)));
    assert.equal(readiness.status, "blocked");
  });
});

test("rejects stale repair input when source messages change during repair", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Prompt before stale repair." }));
    await capturePiMessage(
      store,
      thread.threadId,
      ctx,
      makePiAssistantMessage({ content: [{ type: "text", text: "Response before stale repair." }] }),
    );
    await clearTurnState(store, thread.threadId);

    const staleStore = new StaleRepairStore(storeRootDir);
    const repaired = await repairTurnState({ store: staleStore, threadId: thread.threadId });

    assert.equal(repaired.ok, false);
    expectIssueCode(repaired, "STALE_SOURCE_REVISION");
    const readiness = checkMaintenanceReadiness(expectOk(await staleStore.openThread(thread.threadId)));
    assert.equal(readiness.status, "blocked");
  });
});

test("range-limited repair does not rewrite unaffected turns", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const captured = await captureThreeTurnConversation(store, thread.threadId, ctx);
    const turns = expectOk(await store.readTurns(thread.threadId));
    const beforeFirstTurn = structuredClone(turns[0]!);
    const beforeThirdTurn = structuredClone(turns[2]!);
    const brokenTurns = turns.map((turn) =>
      turn.initiatingMessageId === captured.promptTwo.message.messageId
        ? {
            ...turn,
            messageIds: [captured.promptTwo.message.messageId],
            sourceRange: createSourceRange(captured.promptTwo.message.sourceOrder),
          }
        : turn,
    );
    await writeTurns(store, thread.threadId, brokenTurns, "repair_needed");

    expectOk(
      await repairTurnState({
        store,
        threadId: thread.threadId,
        range: createSourceRange(captured.responseTwo.message.sourceOrder),
      }),
    );
    const repairedTurns = expectOk(await store.readTurns(thread.threadId));
    const repairedFirstTurn = repairedTurns.find((turn) => turn.initiatingMessageId === beforeFirstTurn.initiatingMessageId);
    const repairedThirdTurn = repairedTurns.find((turn) => turn.initiatingMessageId === beforeThirdTurn.initiatingMessageId);
    const repairedSecondTurn = repairedTurns.find((turn) => turn.initiatingMessageId === captured.promptTwo.message.messageId);

    assert.deepEqual(repairedFirstTurn, beforeFirstTurn);
    assert.deepEqual(repairedThirdTurn, beforeThirdTurn);
    assert.deepEqual(repairedSecondTurn?.messageIds, [
      captured.promptTwo.message.messageId,
      captured.responseTwo.message.messageId,
    ]);
  });
});

test("health report ranges are sorted by source order", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const captured = await captureThreeTurnConversation(store, thread.threadId, ctx);
    const turns = expectOk(await store.readTurns(thread.threadId));
    const brokenTurns = turns.map((turn) =>
      turn.initiatingMessageId === captured.promptOne.message.messageId
        ? {
            ...turn,
            messageIds: [captured.promptOne.message.messageId],
            sourceRange: createSourceRange(captured.promptOne.message.sourceOrder),
          }
        : turn.initiatingMessageId === captured.promptTwo.message.messageId
          ? {
              ...turn,
              messageIds: [captured.promptTwo.message.messageId],
              sourceRange: createSourceRange(captured.promptTwo.message.sourceOrder),
            }
        : turn.initiatingMessageId === captured.promptThree.message.messageId
          ? {
              ...turn,
              messageIds: [captured.promptThree.message.messageId],
              sourceRange: createSourceRange(captured.promptThree.message.sourceOrder),
            }
          : turn,
    );
    await writeTurns(store, thread.threadId, brokenTurns, "repair_needed");

    const health = checkTurnHealth(expectOk(await store.openThread(thread.threadId)));

    assert.deepEqual(health.uncoveredRanges, [
      { fromSourceOrder: 2, toSourceOrder: 2 },
      { fromSourceOrder: 4, toSourceOrder: 4 },
      { fromSourceOrder: 6, toSourceOrder: 6 },
    ]);
  });
});
