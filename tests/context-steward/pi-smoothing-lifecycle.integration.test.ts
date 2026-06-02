import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { registerContextStewardExtension } from "../../src/context-steward/pi/pi-extension.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/context-steward/test/temp-store.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { materializeSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import type { UserPromptSmoothingProvider } from "../../src/thread/async-thread/services/user-prompt-smoothing-service.js";

const PLAN_PROMPT_TEXT = "plan the fix";
const NON_FINAL_ASSISTANT_TEXT = "I need to inspect files first.";
const FINAL_ASSISTANT_TEXT = "Here is the completed plan.";
const NEXT_PROMPT_TEXT = "now apply it";
const USER_ONLY_FALLBACK_PROMPT_TEXT = "actually never mind, do this instead";
const TOOL_CALL_ID = "call-plan-read";
const TOOL_NAME = "read";
const TOOL_PATH = "README.md";
const TOOL_RESULT_TEXT = "README contents";

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

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n', "utf8");
}

async function waitForAssertion(
  assertion: () => Promise<void> | void,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(10);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${description}: ${lastError.message}`;
    throw lastError;
  }

  throw new Error(description);
}

function providerReturning(text: string, onCall?: () => void): UserPromptSmoothingProvider {
  return {
    async smoothUserPrompt(input) {
      onCall?.();
      return {
        text,
        providerId: "openai-codex",
        modelId: "gpt-5.4-mini",
        reasoningEffort: "none",
        promptVersion: input.promptVersion,
        usage: { inputTokens: 9, outputTokens: 4 },
        elapsedMs: 3,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
      };
    },
  };
}

function providerEchoingReadablePrompt(onCall?: () => void): UserPromptSmoothingProvider {
  return {
    async smoothUserPrompt(input) {
      onCall?.();
      return {
        text: input.rawText,
        providerId: "openai-codex",
        modelId: "gpt-5.4-mini",
        reasoningEffort: "none",
        promptVersion: input.promptVersion,
        usage: { inputTokens: 9, outputTokens: 4 },
        elapsedMs: 3,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
      };
    },
  };
}

async function createRegisteredContext(input: {
  storeRootDir: string;
  projectDir: string;
  sessionName: string;
  provider: UserPromptSmoothingProvider;
}) {
  const target = makeThreadTarget({
    sessionId: input.sessionName,
    sessionFilePath: `${input.projectDir}/pi/${input.sessionName}.jsonl`,
    cwd: input.projectDir,
  });
  await ensureTargetSessionFile(target);

  const store = new SqliteThreadStore(input.storeRootDir);
  const pi = new FakeExtensionApi();
  registerContextStewardExtension(pi as unknown as ExtensionAPI, {
    createStore: () => store,
    userPromptSmoothing: {
      enabled: true,
      provider: input.provider,
    },
  });

  return {
    target,
    ctx: makePiExtensionContext(target),
    store,
    pi,
  };
}

function makeNonFinalAssistantToolUseMessage() {
  return makePiAssistantMessage({
    responseId: "response-plan-tool-use",
    stopReason: "toolUse",
    content: [
      { type: "text", text: NON_FINAL_ASSISTANT_TEXT },
      { type: "toolCall", id: TOOL_CALL_ID, name: TOOL_NAME, arguments: { path: TOOL_PATH } },
    ],
  });
}

function makeFinalAssistantStopMessage() {
  return makePiAssistantMessage({
    responseId: "response-plan-stop",
    stopReason: "stop",
    content: [{ type: "text", text: FINAL_ASSISTANT_TEXT }],
  });
}

function makePlanToolResultMessage() {
  return makePiToolResultMessage({
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    content: [{ type: "text", text: TOOL_RESULT_TEXT }],
  });
}

async function findScenarioThread(input: Awaited<ReturnType<typeof createRegisteredContext>>) {
  const thread = expectOk(await input.store.findManagedThread(input.target));
  assert.ok(thread);
  return thread;
}

async function waitForUserPromptComponentCount(input: {
  store: SqliteThreadStore;
  threadId: string;
  count: number;
  description: string;
}) {
  await waitForAssertion(async () => {
    const snapshot = expectOk(await input.store.openThread(input.threadId));
    const userComponents = snapshot.turns.flatMap((turn) =>
      turn.smooth?.components?.filter((component) => component.kind === "user_prompt") ?? [],
    );
    assert.equal(userComponents.length, input.count);
  }, input.description);
}

async function emitStopClosedTurnScenario(input: Awaited<ReturnType<typeof createRegisteredContext>>) {
  const user = makePiUserMessage({ content: PLAN_PROMPT_TEXT });
  const assistant = makeFinalAssistantStopMessage();

  await input.pi.emit("message_end", { type: "message_end", message: user }, input.ctx);
  await input.pi.emit("message_end", { type: "message_end", message: assistant }, input.ctx);

  const thread = await findScenarioThread(input);
  await waitForUserPromptComponentCount({
    store: input.store,
    threadId: thread.threadId,
    count: 1,
    description: "stop-closed scenario should finish user prompt smoothing",
  });
  return { thread, user, assistant };
}

async function emitFallbackClosedTurnScenario(input: Awaited<ReturnType<typeof createRegisteredContext>>) {
  const user = makePiUserMessage({ content: PLAN_PROMPT_TEXT });
  const assistant = makeNonFinalAssistantToolUseMessage();
  const toolResult = makePlanToolResultMessage();
  const nextUser = makePiUserMessage({ content: NEXT_PROMPT_TEXT });

  await input.pi.emit("message_end", { type: "message_end", message: user }, input.ctx);
  await input.pi.emit("message_end", { type: "message_end", message: assistant }, input.ctx);
  await input.pi.emit("message_end", { type: "message_end", message: toolResult }, input.ctx);
  await input.pi.emit("message_end", { type: "message_end", message: nextUser }, input.ctx);

  const thread = await findScenarioThread(input);
  await waitForUserPromptComponentCount({
    store: input.store,
    threadId: thread.threadId,
    count: 2,
    description: "fallback-closed scenario should finish both user prompt smoothing writes",
  });
  return { thread, user, assistant, toolResult, nextUser };
}

async function emitAlreadyClosedThenNextPromptScenario(input: Awaited<ReturnType<typeof createRegisteredContext>>) {
  const stopScenario = await emitStopClosedTurnScenario(input);
  const beforeNextPrompt = expectOk(await input.store.openThread(stopScenario.thread.threadId));
  const closedTurnBeforeNextPrompt = structuredClone(beforeNextPrompt.turns[0]);
  const nextUser = makePiUserMessage({ content: NEXT_PROMPT_TEXT });

  await input.pi.emit("message_end", { type: "message_end", message: nextUser }, input.ctx);
  await waitForUserPromptComponentCount({
    store: input.store,
    threadId: stopScenario.thread.threadId,
    count: 2,
    description: "already-closed scenario should finish next prompt smoothing",
  });

  return { ...stopScenario, nextUser, closedTurnBeforeNextPrompt };
}

async function emitUserOnlyFallbackClosureScenario(input: Awaited<ReturnType<typeof createRegisteredContext>>) {
  const user = makePiUserMessage({ content: USER_ONLY_FALLBACK_PROMPT_TEXT });
  const nextUser = makePiUserMessage({ content: NEXT_PROMPT_TEXT });

  await input.pi.emit("message_end", { type: "message_end", message: user }, input.ctx);
  await input.pi.emit("message_end", { type: "message_end", message: nextUser }, input.ctx);

  const thread = await findScenarioThread(input);
  await waitForUserPromptComponentCount({
    store: input.store,
    threadId: thread.threadId,
    count: 2,
    description: "user-only fallback scenario should finish both user prompt smoothing writes",
  });
  return { thread, user, nextUser };
}

test("message_end writes model-smoothed user_prompt component to canonical thread", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const rawPrompt = "maybe smooth this exact lifecycle prompt";
    const smoothedPrompt = "Please smooth this exact lifecycle prompt.";
    const { target, ctx, store, pi } = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-user-smooth",
      provider: providerReturning(smoothedPrompt),
    });

    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: rawPrompt }) }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    await waitForAssertion(async () => {
      const snapshot = expectOk(await store.openThread(thread.threadId));
      const component = snapshot.turns[0]?.smooth?.components?.find((candidate) => candidate.kind === "user_prompt");
      assert.equal(component?.text, smoothedPrompt);
      assert.equal(component?.quality, "model_smoothed");
    }, "user prompt smoothing should be persisted after production message_end");

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const component = snapshot.turns[0]?.smooth?.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.providerMetadata?.providerId, "openai-codex");
    assert.equal(component?.providerMetadata?.modelId, "gpt-5.4-mini");
    assert.equal(component?.providerMetadata?.reasoningEffort, "none");
    assert.equal(component?.providerMetadata?.usage?.inputTokens, 9);
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0]?.parts[0]?.content, rawPrompt);
  });
});

test("replayed message_end does not duplicate messages or user_prompt smoothing components", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    let providerCalls = 0;
    const event = {
      type: "message_end",
      message: makePiUserMessage({ content: "dedupe this lifecycle prompt" }),
    };
    const { target, ctx, store, pi } = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-user-dedupe",
      provider: providerReturning("Dedupe this lifecycle prompt.", () => {
        providerCalls += 1;
      }),
    });

    await pi.emit("message_end", event, ctx);
    await pi.emit("message_end", event, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    await waitForAssertion(async () => {
      const snapshot = expectOk(await store.openThread(thread.threadId));
      assert.equal(snapshot.messages.length, 1);
      const userComponents = snapshot.turns.flatMap((turn) =>
        turn.smooth?.components?.filter((component) => component.kind === "user_prompt") ?? [],
      );
      assert.equal(userComponents.length, 1);
      assert.equal(userComponents[0]?.text, "Dedupe this lifecycle prompt.");
      assert.equal(providerCalls, 1);
    }, "replayed production message_end should not duplicate persisted smoothing state");
  });
});

test("message_end and turn_end create complete component-first smooth turn", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const { target, ctx, store, pi } = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-complete-turn",
      provider: providerReturning("Use the lifecycle tool flow."),
    });
    const assistant = makePiAssistantMessage({
      responseId: "response-lifecycle-complete",
      content: [
        { type: "text", text: "I will inspect the file." },
        { type: "thinking", thinking: "Need to read the file first.", thinkingSignature: "sig-lifecycle-hidden" },
        { type: "toolCall", id: "call-lifecycle-read", name: "read", arguments: { path: "README.md" } },
      ],
    });
    const toolResult = makePiToolResultMessage({
      toolCallId: "call-lifecycle-read",
      toolName: "read",
      content: [{ type: "text", text: "README contents" }],
    });

    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "use the lifecycle tool flow" }) }, ctx);
    await pi.emit("message_end", { type: "message_end", message: assistant }, ctx);
    await pi.emit("message_end", { type: "message_end", message: toolResult }, ctx);
    await pi.emit("turn_end", { type: "turn_end", turnIndex: 1, message: assistant, toolResults: [toolResult] }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    await waitForAssertion(async () => {
      const snapshot = expectOk(await store.openThread(thread.threadId));
      const turn = snapshot.turns[0];
      assert.equal(turn?.lifecycleStatus, "closed");
      const kinds = new Set(turn?.smooth?.components?.map((component) => component.kind));
      assert.equal(kinds.has("user_prompt"), true);
      assert.equal(kinds.has("assistant_message"), true);
      assert.equal(kinds.has("thinking"), true);
      assert.equal(kinds.has("tool_exchange"), true);
      assert.equal(typeof snapshot.thread.status.tokenCounting?.status, "string");
    }, "production turn_end should close and smooth the completed turn", 10_000);

    const snapshot = expectOk(await store.openThread(thread.threadId));
    const materialized = await materializeSmoothTurn(
      { threadId: thread.threadId, turnId: snapshot.turns[0]!.turnId },
      { store },
    );
    assert.match(materialized.text ?? "", /\[user\]\nUse the lifecycle tool flow\./);
    assert.match(materialized.text ?? "", /\[assistant\]\nI will inspect the file\./);
    assert.match(materialized.text ?? "", /\[thinking\]\nNeed to read the file first\./);
    assert.match(materialized.text ?? "", /\[tool\]/);
    assert.equal(materialized.text?.includes("sig-lifecycle-hidden"), false);
  });
});

test("message_end with final assistant stop closes the canonical turn without turn_end", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const scenario = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-stop-closes",
      provider: providerEchoingReadablePrompt(),
    });

    const { thread } = await emitStopClosedTurnScenario(scenario);
    const snapshot = expectOk(await scenario.store.openThread(thread.threadId));

    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.messages[0]?.parts[0]?.content, PLAN_PROMPT_TEXT);
    assert.equal(snapshot.messages[1]?.parts[0]?.content, FINAL_ASSISTANT_TEXT);
    assert.equal(snapshot.turns.length, 1);
    assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
    assert.deepEqual(snapshot.turns[0]?.messageIds, [
      snapshot.messages[0]?.messageId,
      snapshot.messages[1]?.messageId,
    ]);
    assert.equal(snapshot.turns[0]?.sourceRange.fromSourceOrder, 1);
    assert.equal(snapshot.turns[0]?.sourceRange.toSourceOrder, 2);
    assert.equal(snapshot.turns[0]?.closedAt, snapshot.messages[1]?.createdAt);
  });
});

test("next user prompt closes a still-open prior turn after non-final assistant/tool activity", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const scenario = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-next-prompt-fallback",
      provider: providerEchoingReadablePrompt(),
    });

    const { thread } = await emitFallbackClosedTurnScenario(scenario);
    const snapshot = expectOk(await scenario.store.openThread(thread.threadId));

    assert.equal(snapshot.messages.length, 4);
    assert.deepEqual(snapshot.messages.map((message) => message.parts[0]?.content), [
      PLAN_PROMPT_TEXT,
      NON_FINAL_ASSISTANT_TEXT,
      {
        output: TOOL_RESULT_TEXT,
        toolCallId: TOOL_CALL_ID,
        toolName: TOOL_NAME,
        isError: false,
      },
      NEXT_PROMPT_TEXT,
    ]);
    assert.equal(snapshot.turns.length, 2);
    assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
    assert.equal(snapshot.turns[1]?.lifecycleStatus, "open");
    assert.deepEqual(snapshot.turns[0]?.messageIds, snapshot.messages.slice(0, 3).map((message) => message.messageId));
    assert.deepEqual(snapshot.turns[1]?.messageIds, [snapshot.messages[3]?.messageId]);
    assert.equal(snapshot.turns[0]?.sourceRange.fromSourceOrder, 1);
    assert.equal(snapshot.turns[0]?.sourceRange.toSourceOrder, 3);
    assert.equal(snapshot.turns[1]?.sourceRange.fromSourceOrder, 4);
    assert.equal(snapshot.turns[1]?.sourceRange.toSourceOrder, 4);
    assert.equal(snapshot.turns[0]?.closedAt, snapshot.messages[3]?.createdAt);
  });
});

test("next user prompt after stop-closed turn leaves prior turn unchanged and opens a new turn", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const scenario = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-stop-then-next",
      provider: providerEchoingReadablePrompt(),
    });

    const { thread, closedTurnBeforeNextPrompt } = await emitAlreadyClosedThenNextPromptScenario(scenario);
    const snapshot = expectOk(await scenario.store.openThread(thread.threadId));

    assert.equal(snapshot.messages.length, 3);
    assert.deepEqual(snapshot.messages.map((message) => message.parts[0]?.content), [
      PLAN_PROMPT_TEXT,
      FINAL_ASSISTANT_TEXT,
      NEXT_PROMPT_TEXT,
    ]);
    assert.equal(snapshot.turns.length, 2);
    assert.deepEqual(snapshot.turns[0], closedTurnBeforeNextPrompt);
    assert.equal(snapshot.turns[1]?.lifecycleStatus, "open");
    assert.deepEqual(snapshot.turns[1]?.messageIds, [snapshot.messages[2]?.messageId]);
  });
});

test("fallback-closed incomplete turn does not invent assistant or tool smooth components", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const scenario = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-user-only-fallback",
      provider: providerEchoingReadablePrompt(),
    });

    const { thread } = await emitUserOnlyFallbackClosureScenario(scenario);
    const snapshot = expectOk(await scenario.store.openThread(thread.threadId));
    const closedTurn = snapshot.turns[0];
    const componentKinds = new Set(closedTurn?.smooth?.components?.map((component) => component.kind) ?? []);

    assert.equal(snapshot.messages.length, 2);
    assert.equal(closedTurn?.lifecycleStatus, "closed");
    assert.deepEqual(closedTurn?.messageIds, [snapshot.messages[0]?.messageId]);
    assert.equal(componentKinds.has("user_prompt"), true);
    assert.equal(componentKinds.has("assistant_message"), false);
    assert.equal(componentKinds.has("thinking"), false);
    assert.equal(componentKinds.has("tool_exchange"), false);
  });
});

test("open turns do not get deterministic assistant/thinking/tool components before closure", async () => {
  await withTempSqliteThreadStore(async ({ storeRootDir, projectDir }) => {
    const { target, ctx, store, pi } = await createRegisteredContext({
      storeRootDir,
      projectDir,
      sessionName: "session-lifecycle-open-turn",
      provider: providerReturning("Keep this turn open."),
    });

    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "keep this turn open" }) }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    await waitForAssertion(async () => {
      const snapshot = expectOk(await store.openThread(thread.threadId));
      const userComponent = snapshot.turns[0]?.smooth?.components?.find((component) => component.kind === "user_prompt");
      assert.equal(userComponent?.text, "Keep this turn open.");
    }, "user prompt smoothing may persist while turn remains open");

    const snapshot = expectOk(await store.openThread(thread.threadId));
    assert.equal(snapshot.turns[0]?.lifecycleStatus, "open");
    const deterministicKinds = new Set(
      snapshot.turns[0]?.smooth?.components
        ?.filter((component) => component.kind !== "user_prompt")
        .map((component) => component.kind) ?? [],
    );
    assert.deepEqual([...deterministicKinds], []);
  });
});
