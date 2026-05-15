import assert from "node:assert/strict";
import test from "node:test";

import { makeActorRecord, makeMessageRecord, makePartRecord, makeThreadTarget, makeTurnRecord } from "../../src/context-steward/test/fixtures.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../../src/thread/services/thread-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { inspectSmoothingStatus } from "../../src/workbench/services/smoothing-inspection-service.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";

test("inspectSmoothingStatus distinguishes message-end, deterministic, readiness, degraded, and pending states", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);
    const turns = snapshot.value.turns.map((turn, index) => {
      if (index === 0 && turn.smooth?.components?.[0]) {
        return {
          ...turn,
          smooth: {
            ...turn.smooth,
            status: "degraded" as const,
            components: turn.smooth.components.map((component, componentIndex) =>
              componentIndex === 0
                ? { ...component, status: "degraded" as const, quality: "deterministic_preserved" as const }
                : component,
            ),
          },
        };
      }
      if (index === 1 && turn.smooth?.components?.[0]) {
        return {
          ...turn,
          smooth: {
            ...turn.smooth,
            status: "pending" as const,
            components: [{ ...turn.smooth.components[0], status: "pending" as const }],
          },
        };
      }
      return turn;
    });
    const written = await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns,
      turnState: snapshot.value.thread.status.turnState,
    });
    assert.equal(written.ok, true);

    const report = await inspectSmoothingStatus(
      { threadId: context.threadId },
      { threadStore: context.threadStore },
    );

    assert.equal(report.threadId, context.threadId);
    assert.equal(report.turnCounts.total, turns.length);
    assert.ok(report.messageEndUserSmoothing.degraded >= 1);
    assert.ok(report.messageEndUserSmoothing.pending >= 1);
    assert.ok(report.closedTurnDeterministicComponents.missing >= 1);
    assert.ok(report.completeSmoothReadiness.pending >= 1 || report.completeSmoothReadiness.completeUnavailableCount >= 1);
    assert.ok(report.degraded.some((entry) => entry.quality === "deterministic_preserved"));
    assert.ok(report.pending.length >= 1);
    assert.equal(typeof report.openTurnPendingCount, "number");
  });
});

test("inspectSmoothingStatus does not invent missing thinking or tool components for assistant-only prose turns", async () => {
  await withTempFeature3Store(async (temp) => {
    const store = new FileThreadStore(temp.storeRootDir);
    const thread = await openOrCreateManagedThread({
      target: makeThreadTarget({ cwd: temp.projectDir, sessionId: "assistant-only" }),
    }, store);
    assert.equal(thread.ok, true);
    const actor = makeActorRecord({ actorId: "actor-assistant-only", actorType: "agent" });
    const message = await appendSourceMessage({
      store,
      threadId: thread.value.threadId,
      actor,
      message: makeMessageRecord({
        messageId: "message-assistant-only",
        threadId: thread.value.threadId,
        actorId: actor.actorId,
        actorType: "agent",
        messageKind: "response",
        parts: [
          makePartRecord({
            partId: "part-assistant-only",
            partType: "text",
            content: "Assistant prose only.",
          }),
        ],
      }),
    });
    assert.equal(message.ok, true);
    const snapshot = await store.openThread(thread.value.threadId);
    assert.equal(snapshot.ok, true);
    const turn = makeTurnRecord({
      turnId: "turn-assistant-only",
      threadId: thread.value.threadId,
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: message.value.messageId,
      messageIds: [message.value.messageId],
      sourceRange: { fromSourceOrder: message.value.sourceOrder, toSourceOrder: message.value.sourceOrder },
      sourceRevision: message.value.sourceRevision,
      smooth: {
        schemaVersion: "component_smooth_turn_v1",
        status: "pending",
        strategy: "component_smooth_turn_v1",
        sourceRevision: message.value.sourceRevision,
        components: [],
      },
    });
    const written = await store.writeTurns({
      threadId: thread.value.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: [turn],
      turnState: "ready",
    });
    assert.equal(written.ok, true);

    const report = await inspectSmoothingStatus({ threadId: thread.value.threadId }, { threadStore: store });

    assert.ok(report.pending.some((entry) => entry.kind === "assistant_message"));
    assert.ok(!report.pending.some((entry) => entry.kind === "thinking"));
    assert.ok(!report.pending.some((entry) => entry.kind === "tool_exchange"));
    assert.equal(report.closedTurnDeterministicComponents.missing, 1);
  });
});

test("inspectSmoothingStatus reports missing tool_exchange for structured tool calls and results", async () => {
  await withTempFeature3Store(async (temp) => {
    const store = new FileThreadStore(temp.storeRootDir);
    const thread = await openOrCreateManagedThread({
      target: makeThreadTarget({ cwd: temp.projectDir, sessionId: "structured-tool" }),
    }, store);
    assert.equal(thread.ok, true);
    const assistant = makeActorRecord({ actorId: "actor-structured-assistant", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-structured-tool", actorType: "tool" });
    const assistantMessage = await appendSourceMessage({
      store,
      threadId: thread.value.threadId,
      actor: assistant,
      message: makeMessageRecord({
        messageId: "message-structured-tool-call",
        threadId: thread.value.threadId,
        actorId: assistant.actorId,
        actorType: "agent",
        messageKind: "response",
        parts: [
          makePartRecord({
            partId: "part-structured-tool-call",
            partOrder: 1,
            partType: "tool_call",
            content: {
              id: "call-structured",
              name: "shell",
              arguments: { command: "pwd" },
            },
          }),
        ],
      }),
    });
    assert.equal(assistantMessage.ok, true);
    const toolMessage = await appendSourceMessage({
      store,
      threadId: thread.value.threadId,
      actor: tool,
      message: makeMessageRecord({
        messageId: "message-structured-tool-result",
        threadId: thread.value.threadId,
        actorId: tool.actorId,
        actorType: "tool",
        messageKind: "tool_result",
        parts: [
          makePartRecord({
            partId: "part-structured-tool-result",
            partOrder: 1,
            partType: "tool_result",
            content: {
              toolCallId: "call-structured",
              output: { cwd: "/Users/leemoore/code/pi-long-horizon" },
            },
          }),
        ],
      }),
    });
    assert.equal(toolMessage.ok, true);
    const snapshot = await store.openThread(thread.value.threadId);
    assert.equal(snapshot.ok, true);
    const turn = makeTurnRecord({
      turnId: "turn-structured-tool",
      threadId: thread.value.threadId,
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: assistantMessage.value.messageId,
      messageIds: [assistantMessage.value.messageId, toolMessage.value.messageId],
      sourceRange: {
        fromSourceOrder: assistantMessage.value.sourceOrder,
        toSourceOrder: toolMessage.value.sourceOrder,
      },
      sourceRevision: toolMessage.value.sourceRevision,
      smooth: {
        schemaVersion: "component_smooth_turn_v1",
        status: "pending",
        strategy: "component_smooth_turn_v1",
        sourceRevision: toolMessage.value.sourceRevision,
        components: [],
      },
    });
    const written = await store.writeTurns({
      threadId: thread.value.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: [turn],
      turnState: "ready",
    });
    assert.equal(written.ok, true);

    const report = await inspectSmoothingStatus({ threadId: thread.value.threadId }, { threadStore: store });

    assert.ok(report.pending.some((entry) => entry.kind === "tool_exchange" && entry.status === "missing"));
    assert.equal(report.closedTurnDeterministicComponents.missing, 1);
  });
});
