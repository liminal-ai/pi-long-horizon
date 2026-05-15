import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord, TurnSmoothRecord } from "../../src/context-steward/domain/records.js";
import {
  appendSourceMessage,
  openOrCreateManagedThread,
} from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { ThreadViewMaterializer } from "../../src/context-workbench/services/thread-view-materializer.js";
import { makeBandRecord, makeThreadView } from "../../src/context-workbench/test/fixtures.js";
import { withTempWorkbenchStore } from "../../src/context-workbench/test/temp-workbench-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function makePendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const {
    sourceOrder: _sourceOrder,
    sourceRevision: _sourceRevision,
    capturedAt: _capturedAt,
    ...pendingMessage
  } = message;
  return pendingMessage;
}

function makeComponentSmooth(turnId: string, messages: readonly MessageRecord[], count: number): TurnSmoothRecord {
  return {
    schemaVersion: "component_smooth_turn_v1",
    status: "ready",
    strategy: "component_smooth_turn_v1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceRevision: messages.at(-1)?.sourceRevision ?? 1,
    tokenCountMetadata: { count, scope: "smooth_turn_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: `sha256:test-smooth-${count}`, createdAt: "2026-01-01T00:00:00.000Z" },
    components: messages.flatMap((message) =>
      message.parts.map((part) => {
        const kind = part.partType === "reasoning"
          ? "thinking"
          : part.partType === "tool_result" || message.messageKind === "tool_result" || message.actorType === "tool"
            ? "tool_exchange"
            : message.actorType === "human" || message.messageKind === "prompt"
              ? "user_prompt"
              : "assistant_message";
        return {
          componentId: `${turnId}:${kind}:${message.messageId}:${part.partId}`,
          kind,
          status: "ready",
          text: String(part.content).replace(/\s+/g, " ").trim(),
          quality: kind === "tool_exchange" ? "deterministic_rendered" : "deterministic_preserved",
          sourceMessageIds: [message.messageId],
          sourcePartIds: [part.partId],
          sourceRevision: message.sourceRevision,
          generatedAt: "2026-01-01T00:00:00.000Z",
          strategy: kind === "tool_exchange" ? "deterministic_tool_exchange_v1" : kind === "assistant_message" ? "deterministic_assistant_v1" : kind === "thinking" ? "thinking_plaintext_or_omitted_v1" : "deterministic_user_prompt_preserved_v1",
        } as NonNullable<TurnSmoothRecord["components"]>[number];
      }),
    ),
  };
}

async function appendThreadMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actorId: string;
  actorType: "human" | "agent" | "tool";
  displayName: string;
  messageId: string;
  messageKind: MessageRecord["messageKind"];
  parts: ReturnType<typeof makePartRecord>[];
}) {
  return expectOk(
    await appendSourceMessage({
      store: input.store,
      threadId: input.threadId,
      actor: makeActorRecord({
        actorId: input.actorId,
        actorType: input.actorType,
        displayName: input.displayName,
      }),
      message: makePendingMessage({
        threadId: input.threadId,
        messageId: input.messageId,
        actorId: input.actorId,
        actorType: input.actorType,
        messageKind: input.messageKind,
        parts: input.parts,
      }),
    }),
  );
}

async function seedMaterializerThread(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const materializer = new ThreadViewMaterializer(threadStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-upper-band-materializer",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const alphaPrompt = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-materializer",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-materializer-001",
    messageKind: "prompt",
    parts: [makePartRecord({ partId: "part-materializer-001", content: "Bring in the alpha context." })],
  });
  const alphaResponse = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-materializer",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-materializer-002",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-materializer-002",
        partOrder: 1,
        partType: "reasoning",
        content: { text: "Tracing the alpha thread." },
      }),
      makePartRecord({
        partId: "part-materializer-003",
        partOrder: 2,
        partType: "text",
        content: "Alpha context highlights the runtime seam.",
      }),
    ],
  });
  const alphaTool = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-tool-materializer",
    actorType: "tool",
    displayName: "Search Tool",
    messageId: "message-materializer-003",
    messageKind: "tool_result",
    parts: [
      makePartRecord({
        partId: "part-materializer-004",
        partType: "tool_result",
        content: { summary: "tool output", files: ["src/runtime-bridge.ts"] },
      }),
    ],
  });

  const betaPrompt = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-materializer",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-materializer-004",
    messageKind: "prompt",
    parts: [makePartRecord({ partId: "part-materializer-005", content: "Compare the beta plan." })],
  });
  const betaResponse = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-materializer",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-materializer-005",
    messageKind: "response",
    parts: [makePartRecord({ partId: "part-materializer-006", content: "Beta keeps the draft isolated." })],
  });

  const gammaPrompt = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-materializer",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-materializer-006",
    messageKind: "prompt",
    parts: [makePartRecord({ partId: "part-materializer-007", content: "Lock the rollout order." })],
  });
  const gammaResponse = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-materializer",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-materializer-007",
    messageKind: "response",
    parts: [makePartRecord({ partId: "part-materializer-008", content: "Rollout order is now stable." })],
  });

  const snapshot = expectOk(await threadStore.openThread(thread.threadId));
  const alphaMessages = [alphaPrompt, alphaResponse, alphaTool];
  const betaMessages = [betaPrompt, betaResponse];
  const gammaMessages = [gammaPrompt, gammaResponse];
  const turns = expectOk(
    await threadStore.writeTurns({
      threadId: thread.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: [
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: "turn-materializer-alpha",
          turnOrder: 1,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: alphaPrompt.messageId,
          messageIds: alphaMessages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: alphaPrompt.sourceOrder,
            toSourceOrder: alphaTool.sourceOrder,
          },
          sourceRevision: gammaResponse.sourceRevision,
          openedAt: alphaPrompt.capturedAt,
          closedAt: alphaTool.capturedAt,
          smooth: makeComponentSmooth("turn-materializer-alpha", alphaMessages, 21),
        }),
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: "turn-materializer-beta",
          turnOrder: 2,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: betaPrompt.messageId,
          messageIds: betaMessages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: betaPrompt.sourceOrder,
            toSourceOrder: betaResponse.sourceOrder,
          },
          sourceRevision: gammaResponse.sourceRevision,
          openedAt: betaPrompt.capturedAt,
          closedAt: betaResponse.capturedAt,
          smooth: makeComponentSmooth("turn-materializer-beta", betaMessages, 12),
        }),
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: "turn-materializer-gamma",
          turnOrder: 3,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: gammaPrompt.messageId,
          messageIds: gammaMessages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: gammaPrompt.sourceOrder,
            toSourceOrder: gammaResponse.sourceOrder,
          },
          sourceRevision: gammaResponse.sourceRevision,
          openedAt: gammaPrompt.capturedAt,
          closedAt: gammaResponse.capturedAt,
        }),
      ],
      turnState: "ready",
    }),
  );

  return {
    thread,
    threadStore,
    materializer,
    turns: {
      alpha: turns[0],
      beta: turns[1],
      gamma: turns[2],
    },
  };
}

test("full-fidelity selection is turn-based", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.alpha.turnId],
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(result.fullFidelityBand.selectedIds, [turns.alpha.turnId]);
    assert.equal(new Set(result.emittedMessages.map((message) => message.sourceReference.split("/")[0])).size, 1);
  });
});

test("full-fidelity does not split turns", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.alpha.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "full_fidelity")
        .map((message) => message.sourceReference),
      [
        "turn-materializer-alpha/message-materializer-001",
        "turn-materializer-alpha/message-materializer-002",
        "turn-materializer-alpha/message-materializer-003",
      ],
    );
  });
});

test("selected full-fidelity turns emit raw messages in source order", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.alpha.turnId, turns.beta.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "full_fidelity")
        .map((message) => message.sourceReference),
      [
        "turn-materializer-alpha/message-materializer-001",
        "turn-materializer-alpha/message-materializer-002",
        "turn-materializer-alpha/message-materializer-003",
        "turn-materializer-beta/message-materializer-004",
        "turn-materializer-beta/message-materializer-005",
      ],
    );
  });
});

test("full-fidelity preserves actor back-and-forth", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.alpha.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "full_fidelity")
        .map((message) => (typeof message.content === "string" ? message.content : message.content.actorType)),
      ["human", "agent", "tool"],
    );
  });
});

test("smooth band uses turn selections", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.alpha.turnId, turns.beta.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(result.smoothBand.selectedIds, [turns.alpha.turnId, turns.beta.turnId]);
    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "smooth")
        .map((message) => message.sourceReference),
      [turns.alpha.turnId, turns.beta.turnId],
    );
  });
});

test("smooth band follows full-fidelity boundary by default", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.gamma.turnId],
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(result.smoothBand.selectedIds, [turns.alpha.turnId, turns.beta.turnId]);
    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "smooth")
        .map((message) => message.sourceReference),
      [turns.alpha.turnId, turns.beta.turnId],
    );
  });
});

test("selected smooth turn emits one smooth representation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.alpha.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));
    const smoothMessage = result.emittedMessages.find((message) => message.bandType === "smooth");

    assert.equal(typeof smoothMessage?.content, "string");
    assert.equal(smoothMessage?.sourceReference, turns.alpha.turnId);
    assert.match(String(smoothMessage?.content), /\[user\]/);
    assert.match(String(smoothMessage?.content), /\[assistant\]/);
    assert.match(String(smoothMessage?.content), /\[thinking\]/);
    assert.match(String(smoothMessage?.content), /\[tool\]/);
  });
});

test("missing smooth artifact is visible", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.alpha.turnId, turns.gamma.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.equal(result.smoothBand.renderedStatus, "missing_artifacts");
    assert.equal(result.issues[0]?.code, "WORKBENCH_ARTIFACT_MISSING");
    assert.equal(result.issues[0]?.sourceRange?.fromSourceOrder, turns.gamma.sourceRange.fromSourceOrder);
    assert.deepEqual(
      result.emittedMessages
        .filter((message) => message.bandType === "smooth")
        .map((message) => message.sourceReference),
      [turns.alpha.turnId],
    );
  });
});

test("incomplete component smooth state is not emitted as partial smooth text", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, threadStore, turns } = await seedMaterializerThread(storeRootDir);
    const snapshot = expectOk(await threadStore.openThread(thread.threadId));
    const alpha = snapshot.turns.find((turn) => turn.turnId === turns.alpha.turnId);
    assert.ok(alpha);
    const onlyUserPrompt = alpha.smooth?.components?.filter((component) => component.kind === "user_prompt");

    expectOk(
      await threadStore.writeTurns({
        threadId: thread.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        turnState: snapshot.thread.status.turnState,
        turns: snapshot.turns.map((turn) =>
          turn.turnId === turns.alpha.turnId
            ? {
                ...turn,
                smooth: {
                  ...turn.smooth,
                  schemaVersion: "component_smooth_turn_v1",
                  status: "ready",
                  strategy: "component_smooth_turn_v1",
                  components: onlyUserPrompt,
                },
              }
            : turn,
        ),
      }),
    );

    const draftView = makeThreadView({
      threadId: thread.threadId,
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.alpha.turnId],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.equal(result.smoothBand.renderedStatus, "missing_artifacts");
    assert.equal(result.issues[0]?.code, "WORKBENCH_ARTIFACT_MISSING");
    assert.deepEqual(
      result.emittedMessages.filter((message) => message.bandType === "smooth"),
      [],
    );
  });
});

test("materializer preserves band order when one band is empty", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { materializer, thread, turns } = await seedMaterializerThread(storeRootDir);
    const draftView = makeThreadView({
      threadId: thread.threadId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.alpha.turnId],
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [],
      }),
    });

    const result = expectOk(await materializer.materializeThreadView({ threadId: thread.threadId, draftView }));

    assert.deepEqual(
      result.emittedMessages.map((message) => ({
        bandType: message.bandType,
        messageOrder: message.messageOrder,
      })),
      [
        { bandType: "full_fidelity", messageOrder: 1 },
        { bandType: "full_fidelity", messageOrder: 2 },
        { bandType: "full_fidelity", messageOrder: 3 },
      ],
    );
    assert.equal(result.smoothBand.renderedStatus, "ready");
  });
});
