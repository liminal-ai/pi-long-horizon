import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { registerContextStewardExtension } from "../../src/context-steward/pi/pi-extension.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiToolResultMessage,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  createGeneratedSessionTokenCountRecord,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  type TokenCountRecord,
} from "../../src/token-accounting/index.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import { seedDeterministicRebuildThread } from "../thread-view/helpers.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { TurnRecord } from "../../src/thread/domain/records.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import type { UserPromptSmoothingProvider } from "../../src/thread/async-thread/services/user-prompt-smoothing-service.js";

const READY_LOWER_BOUND = 2_000;
const SMOOTH_HEAVY_BANDS = { fullFidelity: 50, smooth: 50, detailed: 0, brief: 0 } as const;
const ONLY_SMOOTH_BANDS = { fullFidelity: 0, smooth: 100, detailed: 0, brief: 0 } as const;
const FORCE_SMOOTH_BANDS = { fullFidelity: 50, smooth: 4, detailed: 13, brief: 33 } as const;
const FORCE_LOWER_BANDS = { fullFidelity: 50, smooth: 0, detailed: 25, brief: 25 } as const;
const LOWER_BAND_HEAVY_BANDS = { fullFidelity: 10, smooth: 5, detailed: 70, brief: 15 } as const;
const PLAN_PROMPT_TEXT = "plan the fix";
const NON_FINAL_ASSISTANT_TEXT = "I need to inspect files first.";
const FINAL_ASSISTANT_TEXT = "Here is the completed plan.";
const NEXT_PROMPT_TEXT = "now apply it";
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

type SeededSmartCompactContext = Awaited<ReturnType<typeof seedDeterministicRebuildThread>>;
type SmartCompactTestContext = Pick<SeededSmartCompactContext, "threadId" | "threadStore" | "threadViewStore">;

function asProviderInputCount<TRecord extends TokenCountRecord>(record: TRecord): TRecord {
  return assertTokenCountRecord({
    ...record,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: "gpt-test",
    provenance: "tests.commands.smart-compact-lifecycle.exact-counter",
  }) as TRecord;
}

const exactMaterializedCounter = {
  async countRawTurnMaterialized(input: Parameters<typeof countRawTurnMaterialized>[0]) {
    return asProviderInputCount(countRawTurnMaterialized(input));
  },
  async countSmoothTurnMaterialized(input: Parameters<typeof countSmoothTurnMaterialized>[0]) {
    return asProviderInputCount(countSmoothTurnMaterialized(input));
  },
  async countChunkSmoothMaterialized(input: Parameters<typeof countChunkSmoothMaterialized>[0]) {
    return asProviderInputCount(countChunkSmoothMaterialized(input));
  },
  async countDetailedChunkMaterialized(input: Parameters<typeof countDetailedChunkMaterialized>[0]) {
    return asProviderInputCount(countDetailedChunkMaterialized(input));
  },
  async countBriefChunkMaterialized(input: Parameters<typeof countBriefChunkMaterialized>[0]) {
    return asProviderInputCount(countBriefChunkMaterialized(input));
  },
  async countGeneratedSession(input: { createdAt?: string; sourceRevision?: number }) {
    const result = createGeneratedSessionTokenCountRecord({
      count: 1,
      source: "provider_input_count",
      trustClass: "exact",
      provider: "openai",
      model: "gpt-test",
      representationHash: "sha256:test-generated-session",
      sourceRevision: input.sourceRevision,
      createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
      provenance: "tests.commands.smart-compact-lifecycle.generated-counter",
    });
    assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
    return result.value;
  },
};

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
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

function providerEchoingReadablePrompt(): UserPromptSmoothingProvider {
  return {
    async smoothUserPrompt(input) {
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

function createPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(
        input.threadId,
        `${stamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

async function writeTurns(
  context: SmartCompactTestContext,
  turns: TurnRecord[],
) {
  const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
  expectOk(
    await context.threadStore.writeTurns({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns,
      turnState: snapshot.thread.status.turnState,
    }),
  );
}

async function runCompact(
  context: SmartCompactTestContext,
  temp: {
    resolveGeneratedPath(threadId: string, ...segments: string[]): string;
    resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
  },
  input: {
    mode: "strict" | "prepare";
    requestedBandPercentages:
      | typeof SMOOTH_HEAVY_BANDS
      | typeof ONLY_SMOOTH_BANDS
      | typeof FORCE_SMOOTH_BANDS
      | typeof FORCE_LOWER_BANDS
      | typeof LOWER_BAND_HEAVY_BANDS;
    requestedLowerBound?: number;
  },
) {
  return runSmartCompact(
    {
      threadId: context.threadId,
      requestedLowerBound: input.requestedLowerBound ?? READY_LOWER_BOUND,
      requestedBandPercentages: input.requestedBandPercentages,
      mode: input.mode,
    },
    {
      threadStore: context.threadStore,
      threadViewStore: context.threadViewStore,
      openAIInputTokenCounter: exactMaterializedCounter,
      asyncThreadDependencies: {
        tokenCountModel: "gpt-test",
      },
      piThreadViewWriterOptions: {
        pathResolver: createPathResolver(temp),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
      piCliHarnessAdapter: createPiCliHarnessAdapter({
        switchSession: async () => ({ cancelled: false }),
      }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  );
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n', "utf8");
}

async function createLifecycleCaptureContext(input: {
  storeRootDir: string;
  projectDir: string;
  sessionName: string;
}): Promise<SmartCompactTestContext & {
  target: ReturnType<typeof makeThreadTarget>;
  ctx: ReturnType<typeof makePiExtensionContext>;
  pi: FakeExtensionApi;
}> {
  const target = makeThreadTarget({
    sessionId: input.sessionName,
    sessionFilePath: `${input.projectDir}/pi/${input.sessionName}.jsonl`,
    cwd: input.projectDir,
  });
  await ensureTargetSessionFile(target);

  const threadStore = new FileThreadStore(input.storeRootDir);
  const threadViewStore = new FileThreadViewStore(input.storeRootDir, threadStore);
  const pi = new FakeExtensionApi();
  registerContextStewardExtension(pi as unknown as ExtensionAPI, {
    createStore: () => threadStore,
    createThreadViewStore: () => threadViewStore,
    userPromptSmoothing: {
      enabled: true,
      provider: providerEchoingReadablePrompt(),
    },
  });

  return {
    target,
    ctx: makePiExtensionContext(target),
    pi,
    threadId: "",
    threadStore,
    threadViewStore,
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

async function findLifecycleThread(context: Awaited<ReturnType<typeof createLifecycleCaptureContext>>) {
  const thread = expectOk(await context.threadStore.findManagedThread(context.target));
  assert.ok(thread);
  context.threadId = thread.threadId;
  return thread;
}

async function emitStopClosedTurnScenario(
  context: Awaited<ReturnType<typeof createLifecycleCaptureContext>>,
): Promise<SmartCompactTestContext & { closedTurnId: string }> {
  await context.pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: PLAN_PROMPT_TEXT }) }, context.ctx);
  await context.pi.emit("message_end", { type: "message_end", message: makeFinalAssistantStopMessage() }, context.ctx);

  const thread = await findLifecycleThread(context);
  await waitForAssertion(async () => {
    const snapshot = expectOk(await context.threadStore.openThread(thread.threadId));
    const component = snapshot.turns[0]?.smooth?.components?.find((candidate) => candidate.kind === "user_prompt");
    assert.equal(component?.text, PLAN_PROMPT_TEXT);
    assert.equal(component?.quality, "model_smoothed");
  }, "stop-closed lifecycle capture should persist mocked user prompt smoothing");
  const snapshot = expectOk(await context.threadStore.openThread(thread.threadId));
  assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
  return { threadId: thread.threadId, threadStore: context.threadStore, threadViewStore: context.threadViewStore, closedTurnId: snapshot.turns[0]!.turnId };
}

async function emitFallbackClosedTurnScenario(
  context: Awaited<ReturnType<typeof createLifecycleCaptureContext>>,
): Promise<SmartCompactTestContext & { closedTurnId: string; laterTurnId: string }> {
  await context.pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: PLAN_PROMPT_TEXT }) }, context.ctx);
  await context.pi.emit("message_end", { type: "message_end", message: makeNonFinalAssistantToolUseMessage() }, context.ctx);
  await context.pi.emit("message_end", { type: "message_end", message: makePlanToolResultMessage() }, context.ctx);
  await context.pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: NEXT_PROMPT_TEXT }) }, context.ctx);
  await context.pi.emit("message_end", { type: "message_end", message: makeFinalAssistantStopMessage() }, context.ctx);

  const thread = await findLifecycleThread(context);
  await waitForAssertion(async () => {
    const snapshot = expectOk(await context.threadStore.openThread(thread.threadId));
    const userComponents = snapshot.turns.flatMap((turn) =>
      turn.smooth?.components?.filter((component) => component.kind === "user_prompt") ?? [],
    );
    assert.equal(userComponents.length, 2);
    assert.equal(userComponents[0]?.quality, "model_smoothed");
  }, "fallback lifecycle capture should persist mocked user prompt smoothing");
  const snapshot = expectOk(await context.threadStore.openThread(thread.threadId));
  assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
  assert.equal(snapshot.turns[1]?.lifecycleStatus, "closed");
  return {
    threadId: thread.threadId,
    threadStore: context.threadStore,
    threadViewStore: context.threadViewStore,
    closedTurnId: snapshot.turns[0]!.turnId,
    laterTurnId: snapshot.turns[1]!.turnId,
  };
}

test("prepare catches up deterministic components for a stop-closed turn created through lifecycle capture", async () => {
  await withTempFeature3Store(async (temp) => {
    const lifecycle = await createLifecycleCaptureContext({
      storeRootDir: temp.storeRootDir,
      projectDir: temp.projectDir,
      sessionName: "session-smart-compact-stop-closed",
    });
    const context = await emitStopClosedTurnScenario(lifecycle);
    const before = expectOk(await context.threadStore.openThread(context.threadId));
    const beforeTurn = before.turns.find((turn) => turn.turnId === context.closedTurnId);
    assert.equal(beforeTurn?.lifecycleStatus, "closed");
    assert.deepEqual(beforeTurn?.smooth?.components?.map((component) => component.kind), ["user_prompt"]);

    const result = await runCompact(context, temp, {
      mode: "prepare",
      requestedBandPercentages: ONLY_SMOOTH_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    const after = expectOk(await context.threadStore.openThread(context.threadId));
    const closedTurn = after.turns.find((turn) => turn.turnId === context.closedTurnId);
    const kinds = new Set(closedTurn?.smooth?.components?.map((component) => component.kind));
    assert.equal(closedTurn?.lifecycleStatus, "closed");
    assert.equal(closedTurn?.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("assistant_message"), true);
    assert.equal(kinds.has("thinking"), false);
    assert.equal(kinds.has("tool_exchange"), false);

    const generated = await readFile(result.generatedFilePath!, "utf8");
    assert.match(generated, new RegExp(`"generatedSource":"smooth_turn"[\\s\\S]*"sourceReference":"${context.closedTurnId}"`));
    assert.match(generated, /plan the fix/);
    assert.match(generated, /Here is the completed plan\./);
  });
});

test("prepare catches up deterministic components for a next-prompt-fallback-closed turn created through lifecycle capture", async () => {
  await withTempFeature3Store(async (temp) => {
    const lifecycle = await createLifecycleCaptureContext({
      storeRootDir: temp.storeRootDir,
      projectDir: temp.projectDir,
      sessionName: "session-smart-compact-fallback-closed",
    });
    const context = await emitFallbackClosedTurnScenario(lifecycle);
    const before = expectOk(await context.threadStore.openThread(context.threadId));
    const beforeTurn = before.turns.find((turn) => turn.turnId === context.closedTurnId);
    assert.equal(beforeTurn?.lifecycleStatus, "closed");
    assert.deepEqual(beforeTurn?.smooth?.components?.map((component) => component.kind), ["user_prompt"]);

    const result = await runCompact(context, temp, {
      mode: "prepare",
      requestedBandPercentages: ONLY_SMOOTH_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    const after = expectOk(await context.threadStore.openThread(context.threadId));
    const closedTurn = after.turns.find((turn) => turn.turnId === context.closedTurnId);
    const laterTurn = after.turns.find((turn) => turn.turnId === context.laterTurnId);
    const kinds = new Set(closedTurn?.smooth?.components?.map((component) => component.kind));
    assert.equal(closedTurn?.lifecycleStatus, "closed");
    assert.equal(laterTurn?.lifecycleStatus, "closed");
    assert.equal(closedTurn?.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("assistant_message"), true);
    assert.equal(kinds.has("tool_exchange"), true);
    assert.equal(kinds.has("thinking"), false);

    const generated = await readFile(result.generatedFilePath!, "utf8");
    assert.match(generated, new RegExp(`"generatedSource":"smooth_turn"[\\s\\S]*"sourceReference":"${context.closedTurnId}"`));
    assert.match(generated, /plan the fix/);
    assert.match(generated, /I need to inspect files first\./);
    assert.match(generated, /README contents/);
  });
});

test("smart compact consumes assembled smooth components instead of stale persisted text", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const targetTurnId = context.turns.middleNewer.turnId;
    const nextTurns = snapshot.turns.map((turn) => {
      if (turn.turnId !== targetTurnId || !turn.smooth?.components) {
        return turn;
      }

      return {
        ...turn,
        smooth: {
          ...turn.smooth,
          text: "STALE_LEGACY_SMOOTH_TEXT_SHOULD_NOT_RENDER",
          components: turn.smooth.components.map((component) =>
            component.kind === "user_prompt"
              ? { ...component, text: "ASSEMBLED_COMPONENT_PROMPT" }
              : component.kind === "assistant_message"
                ? { ...component, text: "ASSEMBLED_COMPONENT_ASSISTANT" }
                : component),
        },
      };
    });
    await writeTurns(context, nextTurns);

    const result = await runCompact(context, temp, {
      mode: "strict",
      requestedLowerBound: 180,
      requestedBandPercentages: FORCE_SMOOTH_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    const generated = await readFile(result.generatedFilePath!, "utf8");
    assert.match(generated, new RegExp(`"generatedSource":"smooth_turn"[\\s\\S]*"sourceReference":"${targetTurnId}"`));
    assert.match(generated, /ASSEMBLED_COMPONENT_PROMPT/);
    assert.match(generated, /ASSEMBLED_COMPONENT_ASSISTANT/);
    assert.equal(generated.includes("STALE_LEGACY_SMOOTH_TEXT_SHOULD_NOT_RENDER"), false);
  });
});

test("prepare smart compact catches up missing deterministic components", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const targetTurnId = context.turns.middleNewer.turnId;
    const nextTurns = snapshot.turns.map((turn) => {
      if (turn.turnId !== targetTurnId || !turn.smooth?.components) {
        return turn;
      }

      return {
        ...turn,
        smooth: {
          ...turn.smooth,
          status: "pending" as const,
          text: undefined,
          tokenCountMetadata: undefined,
          materialized: undefined,
          components: turn.smooth.components
            .filter((component) => component.kind === "user_prompt")
            .map((component) => ({
              ...component,
              text: "MODEL_SMOOTHED_USER_PROMPT_ONLY",
              quality: "model_smoothed" as const,
              strategy: "gpt_5_4_mini_user_prompt_v1" as const,
            })),
        },
      };
    });
    await writeTurns(context, nextTurns);

    const result = await runCompact(context, temp, {
      mode: "prepare",
      requestedLowerBound: 220,
      requestedBandPercentages: FORCE_SMOOTH_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    const after = expectOk(await context.threadStore.openThread(context.threadId));
    const targetTurn = after.turns.find((turn) => turn.turnId === targetTurnId);
    const kinds = new Set(targetTurn?.smooth?.components?.map((component) => component.kind));
    assert.equal(kinds.has("user_prompt"), true);
    assert.equal(kinds.has("assistant_message"), true);

    const generated = await readFile(result.generatedFilePath!, "utf8");
    assert.match(generated, new RegExp(`"generatedSource":"smooth_turn"[\\s\\S]*"sourceReference":"${targetTurnId}"`));
    assert.match(generated, /MODEL_SMOOTHED_USER_PROMPT_ONLY/);
    assert.match(generated, /\[assistant\]/);
  });
});

test("smart compact does not mutate canonical raw messages", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const before = expectOk(await context.threadStore.openThread(context.threadId)).messages;

    const result = await runCompact(context, temp, {
      mode: "prepare",
      requestedBandPercentages: SMOOTH_HEAVY_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    const after = expectOk(await context.threadStore.openThread(context.threadId)).messages;
    assert.deepEqual(after, before);
  });
});

test("prepare regenerates lower-band placeholders after component source changes", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const changedTurnId = context.turns.oldest.turnId;
    const changedText = "UPDATED_COMPONENT_SOURCE_FOR_LOWER_BAND";
    const nextTurns = snapshot.turns.map((turn) =>
      turn.turnId === changedTurnId && turn.smooth?.components
        ? {
            ...turn,
            sourceRevision: turn.sourceRevision + 1,
            smooth: {
              ...turn.smooth,
              sourceRevision: turn.sourceRevision + 1,
              tokenCountMetadata: undefined,
              materialized: undefined,
              components: turn.smooth.components.map((component) =>
                component.kind === "assistant_message"
                  ? { ...component, text: changedText, sourceRevision: turn.sourceRevision + 1 }
                  : { ...component, sourceRevision: turn.sourceRevision + 1 }),
            },
          }
        : turn);
    await writeTurns(context, nextTurns);

    const result = await runCompact(context, temp, {
      mode: "prepare",
      requestedLowerBound: 180,
      requestedBandPercentages: FORCE_LOWER_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    const refreshedChunk = chunks.find((chunk) => chunk.chunkId === context.chunks.oldestClosed);
    assert.ok(refreshedChunk);
    assert.match(refreshedChunk.smoothText ?? "", new RegExp(changedText));
    assert.equal(refreshedChunk.placeholders?.brief?.generatedFromComponentSmooth, true);
    assert.equal(refreshedChunk.placeholders?.brief?.smoothSourceRevision, refreshedChunk.sourceRevision);
    assert.equal(
      refreshedChunk.placeholders?.brief?.smoothSourceTokenCount,
      refreshedChunk.smoothTokenCountMetadata?.count,
    );

    const generated = await readFile(result.generatedFilePath!, "utf8");
    assert.match(generated, /"generatedSource":"detailed_chunk_summary"/);
    assert.match(generated, /deterministic-placeholder:brief|deterministic-placeholder:detailed/);
  });
});

test("strict ignores stale selected lower-band provenance", async () => {
  await withTempFeature3Store(async (temp) => {
    const context = await seedDeterministicRebuildThread(temp.storeRootDir);
    const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
    const chunks = expectOk(await context.threadStore.readChunks(context.threadId));
    expectOk(
      await context.threadStore.writeChunks({
        threadId: context.threadId,
        expectedSourceRevision: snapshot.thread.sourceRevision,
        expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
        expectedTurnsRevision: snapshot.thread.turnsRevision,
        chunks: chunks.map((chunk) =>
          chunk.chunkId === context.chunks.newerClosed && chunk.placeholders?.detailed
            ? {
                ...chunk,
                placeholders: {
                  ...chunk.placeholders,
                  detailed: {
                    ...chunk.placeholders.detailed,
                    smoothSourceRevision: 999,
                  },
                },
              }
            : chunk),
      }),
    );

    const result = await runCompact(context, temp, {
      mode: "strict",
      requestedLowerBound: 180,
      requestedBandPercentages: FORCE_LOWER_BANDS,
    });

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);
    assert.equal(result.blockers.some((issue) => issue.code === "CHUNK_PLACEHOLDER_MISSING"), false);
  });
});
