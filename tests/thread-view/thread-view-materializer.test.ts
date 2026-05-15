import assert from "node:assert/strict";
import test from "node:test";

import {
  ThreadViewMaterializer,
  truncateRawThreadViewMessages,
} from "../../src/thread-view/services/thread-view-materializer.js";
import type { ThreadViewMessageRecord } from "../../src/thread-view/domain/thread-view-records.js";
import { truncatePiLiveContextMessages } from "../../src/context-steward/pi/pi-extension.js";
import { makePiToolResultMessage } from "../../src/context-steward/test/fixtures.js";
import {
  estimateLiveRawZoneTokenCount,
  stringifyPiVisibleContentForLiveEstimate,
} from "../../src/thread-view/services/live-tool-result-truncation.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { makeSelectedLowerBandView, seedDeterministicRebuildThread } from "./helpers.js";

test("materialized emitted sequence preserves band order", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
      smoothTurnId: context.turns.middleNewer.turnId,
      detailedChunkIds: [context.chunks.newerClosed],
      briefChunkIds: [context.chunks.oldestClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => ({
        bandType: message.bandType,
        sourceKind: message.sourceKind,
      })),
      [
        { bandType: "full_fidelity", sourceKind: "raw_turn_message" },
        { bandType: "full_fidelity", sourceKind: "raw_turn_message" },
        { bandType: "smooth", sourceKind: "smooth_turn" },
        { bandType: "detailed", sourceKind: "detailed_chunk_summary" },
        { bandType: "brief", sourceKind: "brief_chunk_summary" },
      ],
    );
    assert.match(String(result.value.emittedMessages[3]?.content), /\[deterministic-placeholder:detailed\]/);
    assert.match(String(result.value.emittedMessages[4]?.content), /\[deterministic-placeholder:brief\]/);
  });
});

test("empty band does not corrupt materialization", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
      detailedChunkIds: [context.chunks.newerClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => ({
        bandType: message.bandType,
        messageOrder: message.messageOrder,
      })),
      [
        { bandType: "full_fidelity", messageOrder: 1 },
        { bandType: "full_fidelity", messageOrder: 2 },
        { bandType: "smooth", messageOrder: 3 },
        { bandType: "smooth", messageOrder: 4 },
        { bandType: "smooth", messageOrder: 5 },
        { bandType: "detailed", messageOrder: 6 },
      ],
    );
    assert.equal(result.value.bandStatuses.smooth, "ready");
    assert.equal(result.value.bandStatuses.brief, "ready");
  });
});

test("band order is preserved when multiple middle or lower bands are empty", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      smoothTurnId: context.turns.middleNewer.turnId,
      briefChunkIds: [context.chunks.oldestClosed],
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.emittedMessages.map((message) => message.bandType),
      ["smooth", "brief"],
    );
  });
});

test("missing full-fidelity source messages surface explicit invalid materialization state", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const snapshot = await context.threadStore.openThread(context.threadId);
    assert.equal(snapshot.ok, true);

    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      turns: snapshot.value.turns.map((turn) =>
        turn.turnId === context.turns.newest.turnId
          ? {
              ...turn,
              messageIds: [...turn.messageIds, "message-missing-materialization"],
            }
          : turn),
      turnState: snapshot.value.thread.status.turnState,
    });

    const materializer = new ThreadViewMaterializer(context.threadStore);
    const draftView = makeSelectedLowerBandView({
      threadId: context.threadId,
      fullTurnId: context.turns.newest.turnId,
    });

    const result = await materializer.materializeThreadView({
      threadId: context.threadId,
      draftView,
    });

    assert.equal(result.ok, true);
    assert.equal(result.value.fullFidelityBand.renderedStatus, "blocked");
    assert.equal(result.value.bandStatuses.full_fidelity, "blocked");
    assert.equal(result.value.issues.some((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT"), true);
    assert.deepEqual(
      result.value.emittedMessages.filter((message) => message.bandType === "full_fidelity"),
      [],
    );
  });
});

test("raw Thread View materialization applies the live tool-result truncation policy", () => {
  const longOutput = "T".repeat(120_000);
  const messages: ThreadViewMessageRecord[] = [
    {
      threadViewMessageId: "thread-view-message-old-tool",
      threadViewId: "thread-view-live-truncation",
      bandType: "full_fidelity",
      sourceKind: "raw_turn_message",
      sourceReference: "turn-1/message-tool",
      messageOrder: 1,
      content: {
        messageId: "message-tool",
        actorId: "actor-tool",
        actorType: "tool",
        messageKind: "tool_result",
        capturedAt: "2026-05-13T00:00:00.000Z",
        parts: [
          {
            partId: "part-tool",
            partOrder: 1,
            partType: "tool_result",
            content: {
              output: longOutput,
              toolCallId: "call-thread-view-truncate",
              toolName: "bash",
            },
          },
        ],
        targetMetadata: {
          runtime: "pi",
          piRole: "toolResult",
          toolCallId: "call-thread-view-truncate",
          toolName: "bash",
        },
      },
    },
    {
      threadViewMessageId: "thread-view-message-newer-user",
      threadViewId: "thread-view-live-truncation",
      bandType: "full_fidelity",
      sourceKind: "raw_turn_message",
      sourceReference: "turn-2/message-user",
      messageOrder: 2,
      content: {
        messageId: "message-user",
        actorId: "actor-user",
        actorType: "human",
        messageKind: "prompt",
        capturedAt: "2026-05-13T00:00:01.000Z",
        parts: [{ partId: "part-user", partOrder: 1, partType: "text", content: "newer prompt" }],
        targetMetadata: { runtime: "pi", piRole: "user" },
      },
    },
  ];

  const truncated = truncateRawThreadViewMessages(messages);
  const toolContent = truncated[0]?.content;

  assert.notEqual(truncated[0], messages[0]);
  assert.equal(typeof toolContent, "object");
  if (typeof toolContent === "string") {
    throw new Error("Expected structured raw content.");
  }
  assert.equal(
    ((toolContent.parts as Array<{ content: { output: string } }>)[0]?.content.output),
    `${"T".repeat(500)}...`,
  );
  assert.equal(
    (((messages[0]?.content as Record<string, unknown>).parts as Array<{ content: { output: string } }>)[0]?.content.output),
    longOutput,
  );
});

test("raw Thread View and live PI use the same threshold-edge estimate for equivalent tool results", () => {
  const output = "E".repeat(300);
  const piContent: Array<{ type: "text"; text: string }> = [{ type: "text", text: output }];
  const threshold = estimateLiveRawZoneTokenCount(stringifyPiVisibleContentForLiveEstimate(piContent));
  const rawMessages: ThreadViewMessageRecord[] = [
    {
      threadViewMessageId: "thread-view-message-threshold-tool",
      threadViewId: "thread-view-threshold-parity",
      bandType: "full_fidelity",
      sourceKind: "raw_turn_message",
      sourceReference: "turn-1/message-tool",
      messageOrder: 1,
      content: {
        messageId: "message-tool",
        actorId: "actor-tool",
        actorType: "tool",
        messageKind: "tool_result",
        capturedAt: "2026-05-13T00:00:00.000Z",
        parts: [
          {
            partId: "part-tool",
            partOrder: 1,
            partType: "tool_result",
            content: {
              output,
              toolCallId: "call-threshold-parity",
              toolName: "bash",
            },
          },
        ],
        targetMetadata: {
          runtime: "pi",
          piRole: "toolResult",
          toolCallId: "call-threshold-parity",
          toolName: "bash",
        },
      },
    },
  ];
  const liveMessages = [
    makePiToolResultMessage({
      toolCallId: "call-threshold-parity",
      toolName: "bash",
      content: piContent,
    }),
  ];

  const liveAtThreshold = truncatePiLiveContextMessages(liveMessages, {
    rawZoneTokenThreshold: threshold,
    truncatedCharLimit: 24,
  });
  const rawAtThreshold = truncateRawThreadViewMessages(rawMessages, {
    rawZoneTokenThreshold: threshold,
    truncatedCharLimit: 24,
  });
  const livePastThreshold = truncatePiLiveContextMessages(liveMessages, {
    rawZoneTokenThreshold: threshold - 1,
    truncatedCharLimit: 24,
  });
  const rawPastThreshold = truncateRawThreadViewMessages(rawMessages, {
    rawZoneTokenThreshold: threshold - 1,
    truncatedCharLimit: 24,
  });

  assert.equal(((liveAtThreshold[0] as ReturnType<typeof makePiToolResultMessage>).content[0] as { text: string }).text, output);
  assert.equal(
    (((rawAtThreshold[0]?.content as Record<string, unknown>).parts as Array<{ content: { output: string } }>)[0]?.content.output),
    output,
  );
  assert.equal(
    ((livePastThreshold[0] as ReturnType<typeof makePiToolResultMessage>).content[0] as { text: string }).text,
    `${"E".repeat(24)}...`,
  );
  assert.equal(
    (((rawPastThreshold[0]?.content as Record<string, unknown>).parts as Array<{ content: { output: string } }>)[0]?.content.output),
    `${"E".repeat(24)}...`,
  );
});
