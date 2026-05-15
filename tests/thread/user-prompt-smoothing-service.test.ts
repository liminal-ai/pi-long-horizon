import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { ensureSmoothTurn, readSmoothTurnState } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import {
  USER_PROMPT_SMOOTHING_PROMPT_VERSION,
  UserPromptSmoothingService,
  type UserPromptSmoothingProvider,
} from "../../src/thread/async-thread/services/user-prompt-smoothing-service.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
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

async function seedUserTurn(input: {
  store: FileThreadStore;
  threadId: string;
  prompt: string;
  promptParts?: string[];
  assistantText?: string;
  lifecycleStatus?: TurnRecord["lifecycleStatus"];
}) {
  const target = makeThreadTarget({
    sessionId: `${input.threadId}-session`,
    sessionFilePath: `/tmp/${input.threadId}.jsonl`,
  });
  expectOk(
    await input.store.createThread({
      thread: makeThreadRecord({ threadId: input.threadId, target }),
      targetRef: { runtime: "pi", sessionId: target.sessionId },
    }),
  );

  const actor: ActorRecord = makeActorRecord({
    actorId: `${input.threadId}-user`,
    actorType: "human",
    displayName: "User",
  });
  expectOk(await input.store.upsertActor(input.threadId, actor));
  const seededMessage = makeMessageRecord({
    messageId: `${input.threadId}-message`,
    threadId: input.threadId,
    actorId: actor.actorId,
    actorType: "human",
    messageKind: "prompt",
    parts: (input.promptParts ?? [input.prompt]).map((content, index) =>
      makePartRecord({
        partId: `${input.threadId}-part-${index + 1}`,
        partOrder: index + 1,
        content,
      }),
    ),
    targetMetadata: { runtime: "pi", piRole: "user" },
  });
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pendingMessage } = seededMessage;
  const message = expectOk(
    await input.store.appendMessage({
      threadId: input.threadId,
      actor,
      message: pendingMessage,
    }),
  );

  let messages: MessageRecord[] = [message as MessageRecord];
  if (input.assistantText !== undefined) {
    const assistantActor = makeActorRecord({
      actorId: `${input.threadId}-assistant`,
      actorType: "agent",
      displayName: "Assistant",
    });
    expectOk(await input.store.upsertActor(input.threadId, assistantActor));
    const seededAssistant = makeMessageRecord({
      messageId: `${input.threadId}-assistant-message`,
      threadId: input.threadId,
      actorId: assistantActor.actorId,
      actorType: "agent",
      messageKind: "response",
      parts: [makePartRecord({ partId: `${input.threadId}-assistant-part`, content: input.assistantText })],
      targetMetadata: { runtime: "pi", piRole: "assistant" },
    });
    const {
      sourceOrder: _assistantSourceOrder,
      sourceRevision: _assistantSourceRevision,
      capturedAt: _assistantCapturedAt,
      ...pendingAssistant
    } = seededAssistant;
    const assistantMessage = expectOk(
      await input.store.appendMessage({
        threadId: input.threadId,
        actor: assistantActor,
        message: pendingAssistant,
      }),
    ) as MessageRecord;
    messages = [message as MessageRecord, assistantMessage];
  }

  const thread = expectOk(await input.store.assertCanMutate(input.threadId));
  const lastMessage = messages[messages.length - 1]!;
  const turn = makeTurnRecord({
    turnId: `${input.threadId}-turn`,
    threadId: input.threadId,
    lifecycleStatus: input.lifecycleStatus ?? "closed",
    repairStatus: "ready",
    initiatingMessageId: message.messageId,
    messageIds: messages.map((candidate) => candidate.messageId),
    sourceRange: { fromSourceOrder: message.sourceOrder, toSourceOrder: lastMessage.sourceOrder },
    sourceRevision: lastMessage.sourceRevision,
  });
  expectOk(
    await input.store.writeTurns({
      threadId: input.threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      turns: [turn],
      turnState: "ready",
    }),
  );

  return { message: message as MessageRecord, turn };
}

function providerReturning(text: string): UserPromptSmoothingProvider {
  return {
    async smoothUserPrompt() {
      return {
        text,
        providerId: "openai-codex",
        modelId: "gpt-5.4-mini",
        reasoningEffort: "none",
        promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
        usage: { inputTokens: 12, outputTokens: 8 },
        elapsedMs: 17,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
      };
    },
  };
}

test("stores mocked model-smoothed user prompt with provider metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message, turn } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-success",
      prompt: "I think maybe fix /tmp/app.ts and keep threshold 0.82",
    });
    const smoothed = "I think maybe fix /tmp/app.ts and keep threshold 0.82.";

    await new UserPromptSmoothingService({
      store,
      provider: providerReturning(smoothed),
    }).run({ threadId: message.threadId, messageId: message.messageId });

    const state = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store });
    const component = state.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.text, smoothed);
    assert.equal(component?.quality, "model_smoothed");
    assert.equal(component?.strategy, "gpt_5_4_mini_user_prompt_v1");
    assert.equal(component?.providerMetadata?.providerId, "openai-codex");
    assert.equal(component?.providerMetadata?.modelId, "gpt-5.4-mini");
    assert.equal(component?.providerMetadata?.reasoningEffort, "none");
    assert.equal(component?.providerMetadata?.promptVersion, USER_PROMPT_SMOOTHING_PROMPT_VERSION);
  });
});

test("provider receives raw user prompt text while fallback remains deterministic-normalized", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-raw-provider",
      prompt: "",
      promptParts: ["first line  \n  second line", "  third   line  "],
    });
    let providerRawText = "";

    await new UserPromptSmoothingService({
      store,
      provider: {
        async smoothUserPrompt(input) {
          providerRawText = input.rawText;
          return {
            text: "First line second line third line.",
            providerId: "openai-codex",
            modelId: "gpt-5.4-mini",
            reasoningEffort: "none",
            promptVersion: input.promptVersion,
            elapsedMs: 2,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
    }).run({ threadId: message.threadId, messageId: message.messageId });

    assert.equal(providerRawText, "first line  \n  second line\n  third   line  ");
  });
});

test("failed smoothing logs visibly and writes degraded deterministic-preserved text", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message, turn } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-failure",
      prompt: "  CONTINUE   FUCKING   CONTINUE  ",
    });
    const errors: Array<{ message: string; details?: Record<string, unknown> }> = [];

    await new UserPromptSmoothingService({
      store,
      provider: {
        async smoothUserPrompt() {
          throw new Error("provider unavailable");
        },
      },
      logger: {
        error(message, details) {
          errors.push({ message, details });
        },
        debug() {},
      },
    }).run({ threadId: message.threadId, messageId: message.messageId });

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.message, "User prompt smoothing attempt failed.");
    assert.equal(errors[0]?.details?.cause, "provider unavailable");

    const state = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store });
    const component = state.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.text, "CONTINUE FUCKING CONTINUE");
    assert.equal(component?.status, "degraded");
    assert.equal(component?.quality, "deterministic_preserved");
  });
});

test("intentional skip writes deterministic-preserved text without provider failure", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message, turn } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-skip",
      prompt: "please keep /a/b.ts exactly as-is",
    });
    let calls = 0;

    await new UserPromptSmoothingService({
      store,
      provider: {
        async smoothUserPrompt() {
          calls += 1;
          throw new Error("should not be called");
        },
      },
      shouldSkip: () => true,
    }).run({ threadId: message.threadId, messageId: message.messageId });

    assert.equal(calls, 0);
    const state = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store });
    const component = state.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.text, "please keep /a/b.ts exactly as-is");
    assert.equal(component?.status, "ready");
    assert.equal(component?.quality, "deterministic_preserved");
  });
});

test("schedule dedupes in-flight user prompt smoothing and does not await provider", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-dedupe",
      prompt: "maybe smooth this",
    });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new UserPromptSmoothingService({
      store,
      provider: {
        async smoothUserPrompt() {
          calls += 1;
          await gate;
          return providerReturning("Maybe smooth this.").smoothUserPrompt({
            threadId: message.threadId,
            turnId: "unused",
            messageId: message.messageId,
            rawText: "maybe smooth this",
            sourceRevision: message.sourceRevision,
            promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
          });
        },
      },
    });

    assert.equal(service.schedule({ threadId: message.threadId, messageId: message.messageId }), true);
    assert.equal(service.schedule({ threadId: message.threadId, messageId: message.messageId }), false);
    for (let attempt = 0; attempt < 20 && calls === 0; attempt += 1) {
      await sleep(10);
    }
    assert.equal(calls, 1);
    release();
    await sleep(50);
  });
});

test("slow smoothing merges user component into latest smooth state without dropping deterministic components", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message, turn } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-merge-race",
      prompt: "maybe smooth this prompt",
      assistantText: "Deterministic assistant component should survive.",
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let providerCalls = 0;
    const service = new UserPromptSmoothingService({
      store,
      provider: {
        async smoothUserPrompt(input) {
          providerCalls += 1;
          await gate;
          return {
            text: "Maybe smooth this prompt.",
            providerId: "openai-codex",
            modelId: "gpt-5.4-mini",
            reasoningEffort: "none",
            promptVersion: input.promptVersion,
            elapsedMs: 3,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
    });

    const smoothing = service.run({ threadId: message.threadId, messageId: message.messageId });
    for (let attempt = 0; attempt < 20 && providerCalls === 0; attempt += 1) {
      await sleep(10);
    }
    assert.equal(providerCalls, 1);

    await ensureSmoothTurn({ threadId: message.threadId, turnId: turn.turnId }, { store });
    let duringRace = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store });
    assert.ok(duringRace.components?.some((component) => component.kind === "assistant_message"));

    release();
    await smoothing;

    const finalState = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store });
    const kinds = new Set(finalState.components?.map((component) => component.kind));
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("assistant_message"), true);
    const userComponent = finalState.components?.find((component) => component.kind === "user_prompt");
    const assistantComponent = finalState.components?.find((component) => component.kind === "assistant_message");
    assert.equal(userComponent?.quality, "model_smoothed");
    assert.equal(userComponent?.text, "Maybe smooth this prompt.");
    assert.equal(assistantComponent?.text, "Deterministic assistant component should survive.");
  });
});

test("user prompt smoothing status survives store reopen", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const { message, turn } = await seedUserTurn({
      store,
      threadId: "thread-user-smooth-reopen",
      prompt: "im not sure but preserve threshold 42",
    });

    await new UserPromptSmoothingService({
      store,
      provider: providerReturning("I'm not sure, but preserve threshold 42."),
    }).run({ threadId: message.threadId, messageId: message.messageId });

    const reopened = new FileThreadStore(storeRootDir);
    const state = await readSmoothTurnState({ threadId: message.threadId, turnId: turn.turnId }, { store: reopened });
    const component = state.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.text, "I'm not sure, but preserve threshold 42.");
    assert.equal(component?.quality, "model_smoothed");
  });
});
