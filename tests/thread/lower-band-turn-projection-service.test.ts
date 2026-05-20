import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureLowerBandTurnProjection,
  persistLowerBandTurnProjectionState,
} from "../../src/thread/async-thread/services/lower-band-turn-projection-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import {
  assertTokenCountRecord,
  createMaterializedRepresentationHash,
  type TurnLowerBandProjectionMaterializedTokenCountRecord,
} from "../../src/token-accounting/index.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function toPendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

class FakeProjectionCounter {
  readonly calls: Array<{ text: string; sourceRevision?: number; model?: string }> = [];
  failWith?: Error;

  async countTurnLowerBandProjectionMaterialized(input: {
    text: string;
    sourceRevision?: number;
    model?: string;
  }): Promise<TurnLowerBandProjectionMaterializedTokenCountRecord> {
    this.calls.push(input);
    if (this.failWith) {
      throw this.failWith;
    }

    return assertTokenCountRecord({
      count: 800 + this.calls.length,
      scope: "turn_lower_band_projection_materialized",
      source: "provider_input_count",
      trustClass: "exact",
      provider: "openai",
      model: input.model ?? "gpt-test-lower-band",
      representationHash: createMaterializedRepresentationHash(input.text),
      sourceRevision: input.sourceRevision,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      provenance: "tests.thread.lower-band-turn-projection-service.fake-counter",
    }) as TurnLowerBandProjectionMaterializedTokenCountRecord;
  }
}

async function createThread(store: FileThreadStore, threadId: string) {
  const target = makeThreadTarget({
    sessionId: `${threadId}-session`,
    sessionFilePath: `/tmp/${threadId}.jsonl`,
  });

  expectOk(
    await store.createThread({
      thread: makeThreadRecord({
        threadId,
        target,
      }),
      targetRef: {
        runtime: "pi",
        sessionId: target.sessionId,
      },
    }),
  );
}

async function appendCanonicalMessage(
  store: FileThreadStore,
  threadId: string,
  actor: ActorRecord,
  message: ReturnType<typeof toPendingMessage>,
) {
  expectOk(await store.upsertActor(threadId, actor));
  return expectOk(
    await store.appendMessage({
      threadId,
      actor,
      message,
    }),
  );
}

async function writeTurns(store: FileThreadStore, threadId: string, turns: TurnRecord[]) {
  const thread = expectOk(await store.assertCanMutate(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      turns,
      turnState: "ready",
    }),
  );
}

async function readTurns(store: FileThreadStore, threadId: string): Promise<TurnRecord[]> {
  return expectOk(await store.readTurns(threadId));
}

async function readTurn(store: FileThreadStore, threadId: string, turnId: string): Promise<TurnRecord> {
  const turn = (await readTurns(store, threadId)).find((candidate) => candidate.turnId === turnId);
  assert.ok(turn);
  return turn;
}

function makeClosedTurn(input: {
  threadId: string;
  turnId: string;
  messages: readonly MessageRecord[];
  smooth?: TurnRecord["smooth"];
}): TurnRecord {
  const first = input.messages[0]!;
  const last = input.messages[input.messages.length - 1]!;

  return makeTurnRecord({
    turnId: input.turnId,
    threadId: input.threadId,
    turnOrder: 1,
    lifecycleStatus: "closed",
    repairStatus: "ready",
    initiatingMessageId: first.messageId,
    messageIds: input.messages.map((message) => message.messageId),
    sourceRange: {
      fromSourceOrder: first.sourceOrder,
      toSourceOrder: last.sourceOrder,
    },
    openedAt: first.createdAt ?? first.capturedAt,
    closedAt: last.createdAt ?? last.capturedAt,
    sourceRevision: last.sourceRevision,
    smooth: input.smooth,
  });
}

test("projection uses smooth conversation-visible components in order and persists an exact token count", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-visible");

    const user = makeActorRecord({ actorId: "actor-user-visible", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-visible", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool-visible", actorType: "tool" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-visible",
      user,
      toPendingMessage({
        messageId: "message-visible-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-visible-user", content: "RAW prompt should not appear" })],
      }),
    );
    const firstResponse = await appendCanonicalMessage(
      store,
      "thread-lower-band-visible",
      assistant,
      toPendingMessage({
        messageId: "message-visible-response-1",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [
          makePartRecord({ partId: "part-visible-assistant-1", content: "First visible update." }),
          makePartRecord({ partId: "part-visible-thinking", partOrder: 2, partType: "reasoning", content: "private notes" }),
          makePartRecord({ partId: "part-visible-tool-call", partOrder: 3, partType: "tool_call", content: { command: "npm test" } }),
        ],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-lower-band-visible",
      tool,
      toPendingMessage({
        messageId: "message-visible-tool-result",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-visible-tool-result", partType: "tool_result", content: "tool output" })],
      }),
    );
    const finalResponse = await appendCanonicalMessage(
      store,
      "thread-lower-band-visible",
      assistant,
      toPendingMessage({
        messageId: "message-visible-response-2",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-visible-assistant-2", content: "Final visible answer." })],
      }),
    );

    await writeTurns(store, "thread-lower-band-visible", [
      makeClosedTurn({
        threadId: "thread-lower-band-visible",
        turnId: "turn-visible",
        messages: [prompt, firstResponse, toolResult, finalResponse],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: finalResponse.sourceRevision,
          components: [
            {
              componentId: "turn-visible:user_prompt:message-visible-prompt:part-visible-user",
              kind: "user_prompt",
              status: "ready",
              text: "Smoothed user request",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-visible-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-visible:assistant_message:message-visible-response-1:part-visible-assistant-1",
              kind: "assistant_message",
              status: "ready",
              text: "First visible update.",
              quality: "deterministic_preserved",
              sourceMessageIds: [firstResponse.messageId],
              sourcePartIds: ["part-visible-assistant-1"],
              sourceRevision: firstResponse.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
            {
              componentId: "turn-visible:thinking:message-visible-response-1:part-visible-thinking",
              kind: "thinking",
              status: "ready",
              text: "private notes",
              quality: "deterministic_preserved",
              sourceMessageIds: [firstResponse.messageId],
              sourcePartIds: ["part-visible-thinking"],
              sourceRevision: firstResponse.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "thinking_plaintext_or_omitted_v1",
            },
            {
              componentId: "turn-visible:tool_exchange",
              kind: "tool_exchange",
              status: "ready",
              text: "{\"command\":\"npm test\"}\n{\"output\":\"tool output\"}",
              quality: "deterministic_rendered",
              sourceMessageIds: [firstResponse.messageId, toolResult.messageId],
              sourcePartIds: ["part-visible-tool-call", "part-visible-tool-result"],
              sourceRevision: toolResult.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_tool_exchange_v1",
            },
            {
              componentId: "turn-visible:assistant_message:message-visible-response-2:part-visible-assistant-2",
              kind: "assistant_message",
              status: "ready",
              text: "Final visible answer.",
              quality: "deterministic_preserved",
              sourceMessageIds: [finalResponse.messageId],
              sourcePartIds: ["part-visible-assistant-2"],
              sourceRevision: finalResponse.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-visible",
        turnId: "turn-visible",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        tokenCountModel: "gpt-5.4-mini",
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-visible", "turn-visible");
    const projection = persisted.smooth?.lowerBandProjection;

    assert.equal(result.projectionStatus, "ready");
    assert.equal(counter.calls.length, 1);
    assert.equal(counter.calls[0]?.text, "> Smoothed user request\n\n● First visible update.\n\n● Final visible answer.");
    assert.equal(projection?.text, "> Smoothed user request\n\n● First visible update.\n\n● Final visible answer.");
    assert.equal(projection?.text?.includes("RAW prompt should not appear"), false);
    assert.equal(projection?.text?.includes("private notes"), false);
    assert.equal(projection?.text?.includes("tool output"), false);
    assert.equal(projection?.tokenCountMetadata?.scope, "turn_lower_band_projection_materialized");
    assert.equal(projection?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(projection?.tokenCountMetadata?.trustClass, "exact");
    assert.match(projection?.sourceFingerprint ?? "", /^sha256:/);
  });
});

test("user-only projection remains valid after thinking and tool content are excluded", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-user-only");

    const user = makeActorRecord({ actorId: "actor-user-only", actorType: "human" });
    const tool = makeActorRecord({ actorId: "actor-tool-only", actorType: "tool" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-user-only",
      user,
      toPendingMessage({
        messageId: "message-user-only-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-user-only-user", content: "Keep only the prompt." })],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-lower-band-user-only",
      tool,
      toPendingMessage({
        messageId: "message-user-only-tool",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-user-only-tool", partType: "tool_result", content: "tool noise" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-user-only", [
      makeClosedTurn({
        threadId: "thread-lower-band-user-only",
        turnId: "turn-user-only",
        messages: [prompt, toolResult],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: toolResult.sourceRevision,
          components: [
            {
              componentId: "turn-user-only:user_prompt:message-user-only-prompt:part-user-only-user",
              kind: "user_prompt",
              status: "ready",
              text: "Keep only the prompt.",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-user-only-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-user-only:tool_exchange",
              kind: "tool_exchange",
              status: "ready",
              text: "tool noise",
              quality: "deterministic_rendered",
              sourceMessageIds: [toolResult.messageId],
              sourcePartIds: ["part-user-only-tool"],
              sourceRevision: toolResult.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_tool_exchange_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-user-only",
        turnId: "turn-user-only",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-user-only", "turn-user-only");
    assert.equal(result.projectionStatus, "ready");
    assert.equal(persisted.smooth?.lowerBandProjection?.text, "> Keep only the prompt.");
  });
});

test("projection stays pending when a ready smooth user prompt is missing", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-missing-user");

    const user = makeActorRecord({ actorId: "actor-user-missing-user", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-missing-user", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-missing-user",
      user,
      toPendingMessage({
        messageId: "message-missing-user-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-missing-user-user", content: "User prompt" })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-lower-band-missing-user",
      assistant,
      toPendingMessage({
        messageId: "message-missing-user-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-missing-user-assistant", content: "Assistant reply" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-missing-user", [
      makeClosedTurn({
        threadId: "thread-lower-band-missing-user",
        turnId: "turn-missing-user",
        messages: [prompt, response],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "pending",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: response.sourceRevision,
          components: [
            {
              componentId: "turn-missing-user:assistant_message:message-missing-user-response:part-missing-user-assistant",
              kind: "assistant_message",
              status: "ready",
              text: "Assistant reply",
              quality: "deterministic_preserved",
              sourceMessageIds: [response.messageId],
              sourcePartIds: ["part-missing-user-assistant"],
              sourceRevision: response.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-missing-user",
        turnId: "turn-missing-user",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-missing-user", "turn-missing-user");
    assert.equal(result.projectionStatus, "pending");
    assert.equal(counter.calls.length, 0);
    assert.equal(persisted.smooth?.lowerBandProjection?.status, "pending");
    assert.equal(persisted.smooth?.lowerBandProjection?.tokenCountMetadata, undefined);
  });
});

test("projection stays pending when assistant-visible output lacks a ready smooth assistant component", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-missing-assistant");

    const user = makeActorRecord({ actorId: "actor-user-missing-assistant", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-missing-assistant", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-missing-assistant",
      user,
      toPendingMessage({
        messageId: "message-missing-assistant-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-missing-assistant-user", content: "User prompt" })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-lower-band-missing-assistant",
      assistant,
      toPendingMessage({
        messageId: "message-missing-assistant-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-missing-assistant-assistant", content: "Assistant reply" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-missing-assistant", [
      makeClosedTurn({
        threadId: "thread-lower-band-missing-assistant",
        turnId: "turn-missing-assistant",
        messages: [prompt, response],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "pending",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: response.sourceRevision,
          components: [
            {
              componentId: "turn-missing-assistant:user_prompt:message-missing-assistant-prompt:part-missing-assistant-user",
              kind: "user_prompt",
              status: "ready",
              text: "User prompt",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-missing-assistant-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-missing-assistant",
        turnId: "turn-missing-assistant",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-missing-assistant", "turn-missing-assistant");
    assert.equal(result.projectionStatus, "pending");
    assert.equal(counter.calls.length, 0);
    assert.equal(persisted.smooth?.lowerBandProjection?.status, "pending");
  });
});

test("multiple user prompts are reported as invalid instead of flattened", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-invalid");

    const user = makeActorRecord({ actorId: "actor-user-invalid", actorType: "human" });
    const promptOne = await appendCanonicalMessage(
      store,
      "thread-lower-band-invalid",
      user,
      toPendingMessage({
        messageId: "message-invalid-prompt-1",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-invalid-user-1", content: "First prompt" })],
      }),
    );
    const promptTwo = await appendCanonicalMessage(
      store,
      "thread-lower-band-invalid",
      user,
      toPendingMessage({
        messageId: "message-invalid-prompt-2",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-invalid-user-2", content: "Second prompt" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-invalid", [
      makeClosedTurn({
        threadId: "thread-lower-band-invalid",
        turnId: "turn-invalid",
        messages: [promptOne, promptTwo],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "invalid",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: promptTwo.sourceRevision,
          components: [
            {
              componentId: "turn-invalid:user_prompt:message-invalid-prompt-1:part-invalid-user-1",
              kind: "user_prompt",
              status: "ready",
              text: "First prompt",
              quality: "deterministic_preserved",
              sourceMessageIds: [promptOne.messageId],
              sourcePartIds: ["part-invalid-user-1"],
              sourceRevision: promptOne.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-invalid:user_prompt:message-invalid-prompt-2:part-invalid-user-2",
              kind: "user_prompt",
              status: "ready",
              text: "Second prompt",
              quality: "deterministic_preserved",
              sourceMessageIds: [promptTwo.messageId],
              sourcePartIds: ["part-invalid-user-2"],
              sourceRevision: promptTwo.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-invalid",
        turnId: "turn-invalid",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-invalid", "turn-invalid");
    assert.equal(result.projectionStatus, "invalid");
    assert.equal(counter.calls.length, 0);
    assert.equal(persisted.smooth?.lowerBandProjection?.status, "invalid");
  });
});

test("projection survives reopen and skips re-counting when the same smooth state is already ready", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    await createThread(store, "thread-lower-band-reopen");

    const user = makeActorRecord({ actorId: "actor-user-reopen", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-reopen", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-reopen",
      user,
      toPendingMessage({
        messageId: "message-reopen-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-reopen-user", content: "Prompt text" })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-lower-band-reopen",
      assistant,
      toPendingMessage({
        messageId: "message-reopen-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-reopen-assistant", content: "Assistant text" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-reopen", [
      makeClosedTurn({
        threadId: "thread-lower-band-reopen",
        turnId: "turn-reopen",
        messages: [prompt, response],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: response.sourceRevision,
          components: [
            {
              componentId: "turn-reopen:user_prompt:message-reopen-prompt:part-reopen-user",
              kind: "user_prompt",
              status: "ready",
              text: "Prompt text",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-reopen-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-reopen:assistant_message:message-reopen-response:part-reopen-assistant",
              kind: "assistant_message",
              status: "ready",
              text: "Assistant text",
              quality: "deterministic_preserved",
              sourceMessageIds: [response.messageId],
              sourcePartIds: ["part-reopen-assistant"],
              sourceRevision: response.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
          ],
        },
      }),
    ]);

    const first = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-reopen",
        turnId: "turn-reopen",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );
    assert.equal(first.projectionStatus, "ready");

    const reopenedStore = new FileThreadStore(storeRootDir);
    const secondCounter = new FakeProjectionCounter();
    secondCounter.failWith = new Error("should not re-count");

    const second = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-reopen",
        turnId: "turn-reopen",
      },
      {
        store: reopenedStore,
        openAIInputTokenCounter: secondCounter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    assert.equal(second.projectionStatus, "ready");
    assert.equal(secondCounter.calls.length, 0);
    assert.equal(counter.calls.length, 1);
  });
});

test("exact token-count failure persists a failed projection state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const counter = new FakeProjectionCounter();
    counter.failWith = new Error("token counting unavailable");
    await createThread(store, "thread-lower-band-failed-count");

    const user = makeActorRecord({ actorId: "actor-user-failed-count", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-failed-count", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-failed-count",
      user,
      toPendingMessage({
        messageId: "message-failed-count-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-failed-count-user", content: "Prompt text" })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-lower-band-failed-count",
      assistant,
      toPendingMessage({
        messageId: "message-failed-count-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-failed-count-assistant", content: "Assistant text" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-failed-count", [
      makeClosedTurn({
        threadId: "thread-lower-band-failed-count",
        turnId: "turn-failed-count",
        messages: [prompt, response],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: response.sourceRevision,
          components: [
            {
              componentId: "turn-failed-count:user_prompt:message-failed-count-prompt:part-failed-count-user",
              kind: "user_prompt",
              status: "ready",
              text: "Prompt text",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-failed-count-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-failed-count:assistant_message:message-failed-count-response:part-failed-count-assistant",
              kind: "assistant_message",
              status: "ready",
              text: "Assistant text",
              quality: "deterministic_preserved",
              sourceMessageIds: [response.messageId],
              sourcePartIds: ["part-failed-count-assistant"],
              sourceRevision: response.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
          ],
        },
      }),
    ]);

    const result = await ensureLowerBandTurnProjection(
      {
        threadId: "thread-lower-band-failed-count",
        turnId: "turn-failed-count",
      },
      {
        store,
        openAIInputTokenCounter: counter,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    const persisted = await readTurn(store, "thread-lower-band-failed-count", "turn-failed-count");
    assert.equal(result.projectionStatus, "failed");
    assert.equal(persisted.smooth?.lowerBandProjection?.status, "failed");
    assert.equal(persisted.smooth?.lowerBandProjection?.text, "> Prompt text\n\n● Assistant text");
    assert.equal(persisted.smooth?.lowerBandProjection?.tokenCountMetadata, undefined);
  });
});

test("stale projection writes cannot clobber a fresher persisted lower-band projection", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-lower-band-stale");

    const user = makeActorRecord({ actorId: "actor-user-stale", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-stale", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-lower-band-stale",
      user,
      toPendingMessage({
        messageId: "message-stale-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-stale-user", content: "Prompt text" })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-lower-band-stale",
      assistant,
      toPendingMessage({
        messageId: "message-stale-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-stale-assistant", content: "Assistant text" })],
      }),
    );

    await writeTurns(store, "thread-lower-band-stale", [
      makeClosedTurn({
        threadId: "thread-lower-band-stale",
        turnId: "turn-stale",
        messages: [prompt, response],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          strategy: "component_smooth_turn_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: response.sourceRevision,
          components: [
            {
              componentId: "turn-stale:user_prompt:message-stale-prompt:part-stale-user",
              kind: "user_prompt",
              status: "ready",
              text: "Prompt text",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-stale-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
            {
              componentId: "turn-stale:assistant_message:message-stale-response:part-stale-assistant",
              kind: "assistant_message",
              status: "ready",
              text: "Assistant text",
              quality: "deterministic_preserved",
              sourceMessageIds: [response.messageId],
              sourcePartIds: ["part-stale-assistant"],
              sourceRevision: response.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_assistant_v1",
            },
          ],
        },
      }),
    ]);

    const snapshot = expectOk(await store.openThread("thread-lower-band-stale"));
    await persistLowerBandTurnProjectionState(
      {
        threadId: "thread-lower-band-stale",
        turnId: "turn-stale",
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        projection: {
          status: "pending",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          errorCode: "LOWER_BAND_PROJECTION_COMPONENTS_PENDING",
          errorMessage: "pending",
        },
      },
      { store },
    );

    const fresher = expectOk(await store.openThread("thread-lower-band-stale"));
    await persistLowerBandTurnProjectionState(
      {
        threadId: "thread-lower-band-stale",
        turnId: "turn-stale",
        expectedSourceRevision: fresher.thread.sourceRevision,
        expectedMessageHighWatermark: fresher.thread.messageHighWatermark,
        expectedTurnsRevision: fresher.thread.turnsRevision,
        projection: {
          status: "ready",
          text: "> Prompt text\n\n● Assistant text",
          tokenCountMetadata: assertTokenCountRecord({
            count: 901,
            scope: "turn_lower_band_projection_materialized",
            source: "provider_input_count",
            trustClass: "exact",
            provider: "openai",
            model: "gpt-test-lower-band",
            representationHash: createMaterializedRepresentationHash("> Prompt text\n\n● Assistant text"),
            sourceRevision: response.sourceRevision,
            createdAt: DEFAULT_TEST_TIMESTAMP,
          }),
          sourceFingerprint: "sha256:fresh",
          sourceRevision: response.sourceRevision,
          generatedAt: "2026-01-03T00:00:00.000Z",
        },
      },
      { store },
    );

    await assert.rejects(
      persistLowerBandTurnProjectionState(
        {
          threadId: "thread-lower-band-stale",
          turnId: "turn-stale",
          expectedSourceRevision: snapshot.thread.sourceRevision,
          expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
          expectedTurnsRevision: snapshot.thread.turnsRevision,
          projection: {
            status: "pending",
            generatedAt: "2026-01-02T00:00:00.000Z",
            errorCode: "LOWER_BAND_PROJECTION_COMPONENTS_PENDING",
            errorMessage: "stale retry",
          },
        },
        { store },
      ),
      /STALE_SOURCE_REVISION/,
    );

    const persisted = await readTurn(store, "thread-lower-band-stale", "turn-stale");
    assert.equal(persisted.smooth?.lowerBandProjection?.status, "ready");
    assert.equal(persisted.smooth?.lowerBandProjection?.tokenCountMetadata?.count, 901);
  });
});
