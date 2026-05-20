import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { StewardErrorCode, StewardResult } from "../../src/context-steward/domain/errors.js";
import { fail } from "../../src/context-steward/domain/errors.js";
import { createSourceRange } from "../../src/context-steward/domain/ids.js";
import {
  capturePiEvent,
  mapPiCaptureEventToActivity,
  registerContextStewardExtension,
  truncatePiLiveContextMessages,
} from "../../src/context-steward/pi/pi-extension.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { checkTurnHealth } from "../../src/context-steward/services/turn-service.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  DEFAULT_PI_USAGE,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiSessionEntries,
  makePiToolResultMessage,
  makePiUserMessage,
  makeRuntimeNoteActivity,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TokenCountingMaintenanceRecord } from "../../src/thread/domain/records.js";
import type { UpdateThreadMetadataInput } from "../../src/thread/store/thread-store.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
} from "../../src/token-accounting/index.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function expectIssueCode<T>(
  result: StewardResult<T>,
  code: StewardErrorCode,
): T | undefined {
  const issues = result.ok ? (result.issues ?? []) : result.issues;
  assert.ok(issues.some((issue) => issue.code === code), `Expected issue ${code}, got ${issues.map((issue) => issue.code).join(", ")}`);
  return result.ok ? result.value : undefined;
}

class AppendFailingFileThreadStore extends FileThreadStore {
  failNextAppend = false;

  protected override async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    if (this.failNextAppend && filePath.endsWith("messages.jsonl")) {
      this.failNextAppend = false;
      throw new Error("simulated append failure");
    }

    await super.appendJsonLine(filePath, value);
  }
}

class FirstReadTurnsBlockingFileThreadStore extends FileThreadStore {
  private firstReadTurnsStarted = false;
  private secondReadTurnsStarted = false;
  private readonly firstReadTurnsStartedSignal: Promise<void>;
  private readonly releaseFirstReadTurnsSignal: Promise<void>;
  private resolveFirstReadTurnsStarted!: () => void;
  private resolveReleaseFirstReadTurns!: () => void;

  constructor(storeRootDir: string) {
    super(storeRootDir);
    this.firstReadTurnsStartedSignal = new Promise<void>((resolve) => {
      this.resolveFirstReadTurnsStarted = resolve;
    });
    this.releaseFirstReadTurnsSignal = new Promise<void>((resolve) => {
      this.resolveReleaseFirstReadTurns = resolve;
    });
  }

  async waitForFirstReadTurns(): Promise<void> {
    await this.firstReadTurnsStartedSignal;
  }

  releaseFirstReadTurns(): void {
    this.resolveReleaseFirstReadTurns();
  }

  async secondReadTurnsStartedWhileFirstBlocked(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.secondReadTurnsStarted) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return this.secondReadTurnsStarted;
  }

  override async readTurns(threadId: string) {
    if (!this.firstReadTurnsStarted) {
      this.firstReadTurnsStarted = true;
      this.resolveFirstReadTurnsStarted();
      await this.releaseFirstReadTurnsSignal;
    } else {
      this.secondReadTurnsStarted = true;
    }

    return super.readTurns(threadId);
  }
}

class ExactCountingTestCounter {
  rawCalls = 0;
  smoothCalls = 0;
  chunkSmoothCalls = 0;
  detailedCalls = 0;
  briefCalls = 0;

  async countRawTurnMaterialized(input: any) {
    this.rawCalls += 1;
    return exactTokenRecord(countRawTurnMaterialized(input), 10_000 + this.rawCalls, input.model);
  }

  async countSmoothTurnMaterialized(turn: any, options: any = {}) {
    this.smoothCalls += 1;
    return exactTokenRecord(countSmoothTurnMaterialized(turn), 20_000 + this.smoothCalls, options.model);
  }

  async countChunkSmoothMaterialized(chunk: any, options: any = {}) {
    this.chunkSmoothCalls += 1;
    return exactTokenRecord(countChunkSmoothMaterialized(chunk), 30_000 + this.chunkSmoothCalls, options.model);
  }

  async countDetailedChunkMaterialized(chunk: any, options: any = {}) {
    this.detailedCalls += 1;
    return exactTokenRecord(countDetailedChunkMaterialized(chunk), 40_000 + this.detailedCalls, options.model);
  }

  async countBriefChunkMaterialized(chunk: any, options: any = {}) {
    this.briefCalls += 1;
    return exactTokenRecord(countBriefChunkMaterialized(chunk), 50_000 + this.briefCalls, options.model);
  }
}

function exactTokenRecord(expected: any, count: number, model?: string) {
  return assertTokenCountRecord({
    ...expected,
    count,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: model ?? "gpt-test-exact-counter",
    createdAt: DEFAULT_TEST_TIMESTAMP,
    provenance: "tests.context-steward.capture-service.exact-counter",
  });
}

class TokenCountingTrackingStore extends FileThreadStore {
  private readonly waiters = new Map<string, Array<(value: TokenCountingMaintenanceRecord) => void>>();

  override async updateThreadMetadata(input: UpdateThreadMetadataInput) {
    const result = await super.updateThreadMetadata(input);
    if (result.ok && result.value.status.tokenCounting) {
      const queued = this.waiters.get(input.threadId);
      if (queued && queued.length > 0) {
        this.waiters.delete(input.threadId);
        for (const resolve of queued) {
          resolve(structuredClone(result.value.status.tokenCounting));
        }
      }
    }
    return result;
  }

  async waitForTokenCountingStatus(
    threadId: string,
    description: string,
    timeoutMs = 5_000,
  ): Promise<TokenCountingMaintenanceRecord> {
    const existing = await this.openThread(threadId);
    if (existing.ok && existing.value.thread.status.tokenCounting) {
      return existing.value.thread.status.tokenCounting;
    }

    return new Promise<TokenCountingMaintenanceRecord>((resolve, reject) => {
      const timer = setTimeout(async () => {
        const pending = this.waiters.get(threadId) ?? [];
        this.waiters.set(threadId, pending.filter((candidate) => candidate !== onResolve));
        const snapshot = await this.openThread(threadId);
        const detail = snapshot.ok
          ? JSON.stringify(snapshot.value.thread.status)
          : snapshot.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
        reject(new Error(`${description}: tokenCounting was never persisted. Final thread status: ${detail}`));
      }, timeoutMs);

      const onResolve = (value: TokenCountingMaintenanceRecord) => {
        clearTimeout(timer);
        resolve(value);
      };
      const queued = this.waiters.get(threadId) ?? [];
      queued.push(onResolve);
      this.waiters.set(threadId, queued);
    });
  }
}

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

async function createManagedThread(
  storeRootDir: string,
  target = makeThreadTarget(),
  store = new FileThreadStore(storeRootDir),
) {
  await ensureTargetSessionFile(target);
  const thread = expectOk(await openOrCreateManagedThread({ target }, store));
  const ctx = makePiExtensionContext(target);

  return { store, thread, ctx };
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (target.sessionFilePath) {
    await mkdir(dirname(target.sessionFilePath), { recursive: true });
    await writeFile(target.sessionFilePath, '{"type":"session"}\n');
  }
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${description}: ${lastError.message}`;
    throw lastError;
  }

  throw new Error(description);
}

function makeImportCapableContext(
  target: ReturnType<typeof makeThreadTarget>,
  options: {
    entries: ReturnType<typeof makePiSessionEntries>;
    activeBranch?: ReturnType<typeof makePiSessionEntries>;
    activeLeafId?: string;
  },
) {
  const base = makePiExtensionContext(target);
  const activeLeafId = options.activeLeafId ?? options.entries.at(-1)?.id ?? null;

  return {
    ...base,
    sessionManager: {
      ...base.sessionManager,
      getBranch: () => options.activeBranch ?? options.entries,
      getCwd: () => target.cwd,
      getEntries: () => options.entries,
      getLeafId: () => activeLeafId,
    },
  };
}

test("captures a finalized PI prompt with actor identity, source order, parts, and target metadata", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const { store, thread, ctx } = await createManagedThread(storeRootDir, target);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({
          content: [
            { type: "text", text: "Plan the next steps." },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          ],
        }),
        ctx,
      }),
    );

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.equal(captured.message.messageKind, "prompt");
    assert.equal(captured.message.actorType, "human");
    assert.equal(captured.message.sourceOrder, 1);
    assert.equal(captured.message.parts[0]?.partType, "text");
    assert.equal(captured.message.parts[1]?.partType, "image_ref");
    assert.equal(captured.message.targetMetadata?.sessionId, target.sessionId);
    assert.equal(captured.message.targetMetadata?.sessionFilePath, target.sessionFilePath);
    assert.equal(captured.message.tokenTelemetry, undefined);
    assert.equal(messages.length, 1);
  });
});

test("defaults finalized capture to canonical turn persistence when no turn writer override is supplied", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const prompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Open the default capture turn." }),
        ctx,
      }),
    );
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          content: [{ type: "text", text: "Stay in the same canonical turn." }],
        }),
        ctx,
      }),
    );

    const promptCaptured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: prompt }));
    const responseCaptured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: response }));
    const turns = expectOk(await store.readTurns(thread.threadId));
    const snapshot = expectOk(await store.openThread(thread.threadId));

    assert.equal(promptCaptured.turnStateOutcome, "updated");
    assert.equal(responseCaptured.turnStateOutcome, "updated");
    assert.equal(snapshot.thread.status.turnState, "ready");
    assert.deepEqual(turns.map((turn) => turn.messageIds), [[promptCaptured.message.messageId, responseCaptured.message.messageId]]);
  });
});

test("captures a finalized PI agent response with ordered text, reasoning, and tool-call parts", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          responseId: "response-001",
          content: [
            { type: "text", text: "I inspected the repo." },
            { type: "thinking", thinking: "Need to inspect the capture seam.", thinkingSignature: "sig-001" },
            { type: "toolCall", id: "call-001", name: "read", arguments: { path: "README.md" } },
          ],
        }),
        ctx,
      }),
    );

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));

    assert.equal(captured.message.messageKind, "response");
    assert.equal(captured.message.actorType, "agent");
    assert.deepEqual(
      captured.message.parts.map((part) => ({ partOrder: part.partOrder, partType: part.partType })),
      [
        { partOrder: 1, partType: "text" },
        { partOrder: 2, partType: "reasoning" },
        { partOrder: 3, partType: "tool_call" },
      ],
    );
    assert.deepEqual(captured.message.parts[1]?.content, {
      text: "Need to inspect the capture seam.",
      thinkingSignature: "sig-001",
    });
    assert.equal(captured.message.targetMetadata?.responseId, "response-001");
  });
});

test("captures provider usage telemetry from finalized PI assistant responses", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const usage = {
      ...DEFAULT_PI_USAGE,
      input: 400,
      output: 125,
      cacheRead: 32,
      cacheWrite: 8,
      totalTokens: 565,
      cost: {
        input: 0.004,
        output: 0.0025,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0068,
      },
    };
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.4-mini",
          responseId: "response-usage-001",
          usage,
          content: [{ type: "text", text: "Usage should persist as telemetry." }],
        }),
        ctx,
      }),
    );

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));
    const persisted = expectOk(await store.readMessages(thread.threadId))[0];
    const providerUsage = captured.message.tokenTelemetry?.providerUsage;

    assert.deepEqual(providerUsage, persisted?.tokenTelemetry?.providerUsage);
    assert.equal(providerUsage?.source, "pi_assistant_message_usage");
    assert.equal(providerUsage?.provider, "openai-codex");
    assert.equal(providerUsage?.model, "gpt-5.4-mini");
    assert.equal(providerUsage?.api, "openai-codex-responses");
    assert.equal(providerUsage?.responseId, "response-usage-001");
    assert.deepEqual(providerUsage?.usage, usage);
    assert.deepEqual(Object.keys(captured.message.tokenTelemetry ?? {}), ["providerUsage"]);
    assert.equal(providerUsage?.tokenCountRecord?.scope, "provider_usage_telemetry");
    assert.equal(providerUsage?.tokenCountRecord?.source, "provider_usage");
    assert.equal(providerUsage?.tokenCountRecord?.trustClass, "provider_reported");
    assert.equal(providerUsage?.tokenCountRecord?.count, 565);
    assert.equal(providerUsage?.tokenCountRecord?.provider, "openai-codex");
    assert.equal(providerUsage?.tokenCountRecord?.model, "gpt-5.4-mini");
  });
});

test("captures a finalized PI tool result with tool metadata and typed parts", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiToolResultMessage({
          toolCallId: "call-777",
          toolName: "bash",
          content: [
            { type: "text", text: "stdout line 1" },
            { type: "image", data: "c2NyZWVuc2hvdA==", mimeType: "image/png" },
          ],
        }),
        ctx,
      }),
    );

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));

    assert.equal(captured.message.messageKind, "tool_result");
    assert.equal(captured.message.actorType, "tool");
    assert.equal(captured.message.parts[0]?.partType, "tool_result");
    assert.equal(captured.message.parts[1]?.partType, "image_ref");
    assert.deepEqual(captured.message.parts[0]?.content, {
      output: "stdout line 1",
      toolCallId: "call-777",
      toolName: "bash",
      isError: false,
      textSignature: undefined,
    });
    assert.equal(captured.message.targetMetadata?.toolCallId, "call-777");
    assert.equal(captured.message.targetMetadata?.toolName, "bash");
    assert.equal(captured.message.tokenTelemetry, undefined);
  });
});

test("live PI context truncates older tool results after the raw-zone threshold", () => {
  const oldToolResult = makePiToolResultMessage({
    toolCallId: "call-live-truncate",
    content: [{ type: "text", text: "A".repeat(500) }],
  });
  const messages = [
    makePiUserMessage({ content: "start" }),
    oldToolResult,
    makePiAssistantMessage({ content: [{ type: "text", text: "newer response" }] }),
  ];

  const truncated = truncatePiLiveContextMessages(messages, {
    rawZoneTokenThreshold: 10,
    truncatedCharLimit: 24,
  });
  const truncatedTool = truncated[1] as ReturnType<typeof makePiToolResultMessage>;

  assert.equal((truncatedTool.content[0] as { text: string }).text, `${"A".repeat(24)}...`);
  assert.equal((oldToolResult.content[0] as { text: string }).text, "A".repeat(500));
});

test("live PI context leaves tool results untouched before the raw-zone threshold", () => {
  const messages = [
    makePiUserMessage({ content: "start" }),
    makePiToolResultMessage({
      toolCallId: "call-live-no-truncate",
      content: [{ type: "text", text: "short output" }],
    }),
    makePiAssistantMessage({ content: [{ type: "text", text: "newer response" }] }),
  ];

  const truncated = truncatePiLiveContextMessages(messages, {
    rawZoneTokenThreshold: 10_000,
    truncatedCharLimit: 24,
  });
  const tool = truncated[1] as ReturnType<typeof makePiToolResultMessage>;

  assert.equal((tool.content[0] as { text: string }).text, "short output");
});

test("production hooks preserve canonical tool output when PI-visible tool result was truncated", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const pi = new FakeExtensionApi();
    const fullOutput = "canonical tool output ".repeat(40);

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 10,
        truncatedCharLimit: 24,
      },
    });
    await pi.emit(
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "call-side-channel",
        toolName: "bash",
        input: {},
        content: [{ type: "text", text: fullOutput }],
        details: undefined,
        isError: false,
      },
      ctx,
    );
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiToolResultMessage({
          toolCallId: "call-side-channel",
          toolName: "bash",
          content: [{ type: "text", text: "canonical tool output..." }],
        }),
      },
      ctx,
    );

    const messages = expectOk(await store.readMessages(thread.threadId));
    const output = (messages[0]?.parts[0]?.content as { output?: string }).output;

    assert.equal(output, fullOutput);
  });
});

test("preserves rapid finalized event order across sequential captures", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const first = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ timestamp: Date.parse("2026-05-09T12:00:00.000Z"), content: "First prompt" }),
        ctx,
      }),
    );
    const second = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          timestamp: Date.parse("2026-05-09T12:00:00.001Z"),
          content: [{ type: "text", text: "Second response" }],
        }),
        ctx,
      }),
    );

    const firstCaptured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: first }));
    const secondCaptured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: second }));

    assert.equal(firstCaptured.message.sourceOrder, 1);
    assert.equal(secondCaptured.message.sourceOrder, 2);
    assert.ok(firstCaptured.message.sourceOrder < secondCaptured.message.sourceOrder);
  });
});

test("returns the persisted message instead of appending a duplicate finalized event", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          responseId: "duplicate-response",
          content: [{ type: "text", text: "Same response twice." }],
        }),
        ctx,
      }),
    );

    const firstCapture = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));
    const secondResult = await captureFinalizedActivity({ store, threadId: thread.threadId, activity });
    const secondCapture = expectIssueCode(secondResult, "CAPTURE_DUPLICATE_EVENT");
    const messages = expectOk(await store.readMessages(thread.threadId));

    if (!secondCapture) {
      throw new Error("Expected duplicate capture result.");
    }
    assert.equal(secondCapture.duplicate, true);
    assert.equal(secondCapture.message.messageId, firstCapture.message.messageId);
    assert.equal(messages.length, 1);
  });
});

test("stores supported content as specific typed parts across finalized PI activity", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const { store, thread, ctx } = await createManagedThread(storeRootDir, target);
    const prompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({
          content: [
            { type: "text", text: "Inspect these artifacts." },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
            { type: "fileRef", path: "/tmp/artifact.log", mimeType: "text/plain" } as never,
          ],
        }),
        ctx,
      }),
    );
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          content: [
            { type: "thinking", thinking: "Need the artifact contents.", thinkingSignature: "sig-002" },
            { type: "toolCall", id: "call-002", name: "read", arguments: { path: "/tmp/artifact.log" } },
          ],
        }),
        ctx,
      }),
    );
    const toolResult = expectOk(
      mapPiMessageEnd({
        message: makePiToolResultMessage({
          content: [{ type: "text", text: "artifact contents" }],
        }),
        ctx,
      }),
    );
    const runtimeNote = makeRuntimeNoteActivity();

    expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: prompt }));
    expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: response }));
    expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: toolResult }));
    expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity: runtimeNote }));

    const messages = expectOk(await store.readMessages(thread.threadId));
    const partTypes = messages.flatMap((message) => message.parts.map((part) => part.partType));

    assert.deepEqual(
      new Set(partTypes),
      new Set(["text", "image_ref", "file_ref", "reasoning", "tool_call", "tool_result", "runtime_note"]),
    );
  });
});

test("surfaces unsupported content types with explicit status while preserving the source payload", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activityResult = mapPiMessageEnd({
      message: makePiAssistantMessage({
        content: [
          { type: "text", text: "Known text." },
          { type: "audio", url: "/tmp/audio.wav" } as never,
        ],
      }),
      ctx,
    });
    const activity = expectIssueCode(activityResult, "UNMAPPED_PART_TYPE");
    if (!activity) {
      throw new Error("Expected mapped activity for unsupported part type.");
    }

    const capturedResult = await captureFinalizedActivity({ store, threadId: thread.threadId, activity });
    const captured = expectOk(capturedResult);
    const unknownPart = captured.message.parts.find((part) => part.partType === "unknown");

    assert.ok(unknownPart);
    assert.deepEqual(unknownPart.content, {
      raw: { type: "audio", url: "/tmp/audio.wav" },
    });
  });
});

test("reports CAPTURE_APPEND_FAILED with target, actor, kind, timestamp, and cause when append fails", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const store = new AppendFailingFileThreadStore(storeRootDir);
    await ensureTargetSessionFile(target);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const ctx = makePiExtensionContext(target);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          timestamp: Date.parse("2026-05-09T12:30:00.000Z"),
          content: [{ type: "text", text: "Will fail to append." }],
        }),
        ctx,
      }),
    );

    store.failNextAppend = true;
    const result = await captureFinalizedActivity({ store, threadId: thread.threadId, activity });
    const issues = result.ok ? (result.issues ?? []) : result.issues;
    const appendIssue = issues[0];

    assert.equal(result.ok, false);
    assert.equal(appendIssue?.code, "CAPTURE_APPEND_FAILED");
    assert.equal(appendIssue?.targetRuntime, "pi");
    assert.equal(appendIssue?.targetSessionId, target.sessionId);
    assert.match(appendIssue?.message ?? "", /response/);
    assert.match(appendIssue?.message ?? "", /agent:/);
    assert.match(appendIssue?.message ?? "", /2026-05-09T12:30:00.000Z/);
    assert.match(appendIssue?.cause ?? "", /simulated append failure/);
  });
});

test("does not represent a failed append as a captured source message", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const store = new AppendFailingFileThreadStore(storeRootDir);
    await ensureTargetSessionFile(target);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const activity = makeRuntimeNoteActivity({
      targetMetadata: {
        runtime: "pi",
        sessionId: target.sessionId,
        sessionFilePath: target.sessionFilePath,
        rawType: "runtime_note",
      },
    });

    store.failNextAppend = true;
    expectIssueCode(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }), "CAPTURE_APPEND_FAILED");

    const messages = expectOk(await store.readMessages(thread.threadId));
    assert.deepEqual(messages, []);
  });
});

test("preserves signature-only reasoning without inventing hidden text", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          content: [
            {
              type: "thinking",
              thinking: "",
              thinkingSignature: "sig-redacted-001",
              redacted: true,
            },
          ],
        }),
        ctx,
      }),
    );

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));

    assert.deepEqual(captured.message.parts, [
      {
        ...captured.message.parts[0],
        content: {
          thinkingSignature: "sig-redacted-001",
          redacted: true,
        },
      },
    ]);
  });
});

test("marks the thread repair_needed when message capture succeeds but downstream turn persistence fails", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Start a new captured turn." }),
        ctx,
      }),
    );

    const result = await captureFinalizedActivity({
      store,
      threadId: thread.threadId,
      activity,
      turnWriter: async ({ message }) =>
        fail({
          code: "TURN_STATE_INCOMPLETE",
          message: `Turn state could not include message ${message.messageId}.`,
          threadId: thread.threadId,
          sourceRange: createSourceRange(message.sourceOrder),
        }),
    });
    const captured = expectIssueCode(result, "TURN_STATE_INCOMPLETE");
    if (!captured) {
      throw new Error("Expected partial-success capture result.");
    }
    const snapshot = expectOk(await store.openThread(thread.threadId));

    assert.equal(captured.turnStateOutcome, "repair_needed");
    assert.equal(snapshot.thread.status.turnState, "repair_needed");
    assert.equal(snapshot.messages.length, 1);
  });
});

test("serializes overlapping finalized prompt and response capture through default turn persistence", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    await ensureTargetSessionFile(target);

    const store = new FirstReadTurnsBlockingFileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const ctx = makePiExtensionContext(target);
    const prompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Open the serialized capture turn." }),
        ctx,
      }),
    );
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          content: [{ type: "text", text: "This response overlaps the prompt capture." }],
        }),
        ctx,
      }),
    );

    const promptCapturePromise = captureFinalizedActivity({ store, threadId: thread.threadId, activity: prompt });
    await store.waitForFirstReadTurns();

    const responseCapturePromise = captureFinalizedActivity({ store, threadId: thread.threadId, activity: response });
    assert.equal(await store.secondReadTurnsStartedWhileFirstBlocked(50), false);

    store.releaseFirstReadTurns();

    const promptCaptured = expectOk(await promptCapturePromise);
    const responseCaptured = expectOk(await responseCapturePromise);
    const snapshot = expectOk(await store.openThread(thread.threadId));
    const health = checkTurnHealth(snapshot);

    assert.equal(promptCaptured.turnStateOutcome, "updated");
    assert.equal(responseCaptured.turnStateOutcome, "updated");
    assert.equal(snapshot.thread.status.turnState, "ready");
    assert.deepEqual(snapshot.messages.map((message) => message.sourceOrder), [1, 2]);
    assert.deepEqual(snapshot.turns.map((turn) => turn.messageIds), [
      [promptCaptured.message.messageId, responseCaptured.message.messageId],
    ]);
    assert.deepEqual(health.issues, []);
  });
});

test("ignores tool execution lifecycle events until they become finalized messages", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const { store, thread, ctx } = await createManagedThread(storeRootDir, target);

    const ignoredStart = expectOk(
      mapPiCaptureEventToActivity({
        event: {
          type: "tool_execution_start",
          toolCallId: "call-001",
          toolName: "bash",
          args: { command: "pwd" },
        },
        ctx,
      }),
    );
    const ignoredUpdate = expectOk(
      mapPiCaptureEventToActivity({
        event: {
          type: "tool_execution_update",
          toolCallId: "call-001",
          toolName: "bash",
          args: { command: "pwd" },
          partialResult: "working",
        },
        ctx,
      }),
    );
    const ignoredEnd = expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: {
          type: "tool_execution_end",
          toolCallId: "call-001",
          toolName: "bash",
          result: "done",
          isError: false,
        },
        ctx,
      }),
    );

    assert.equal(ignoredStart, undefined);
    assert.equal(ignoredUpdate, undefined);
    assert.equal(ignoredEnd, undefined);
    assert.deepEqual(expectOk(await store.readMessages(thread.threadId)), []);
  });
});

test("captures message_end events through the thin PI extension helper", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const { store, thread, ctx } = await createManagedThread(storeRootDir, target);

    const captured = expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-extension-001",
            content: [{ type: "text", text: "Captured via extension helper." }],
          }),
        },
        ctx,
      }),
    );

    assert.equal(captured?.message.messageKind, "response");
    assert.equal(captured?.message.targetMetadata?.responseId, "response-extension-001");
  });
});

test("production PI handlers schedule user prompt smoothing on non-duplicate message_end without blocking capture", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-user-smoothing",
      sessionFilePath: resolveProjectPath("pi", "session-production-user-smoothing.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new FileThreadStore(storeRootDir);
    const pi = new FakeExtensionApi();
    let providerCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      userPromptSmoothing: {
        enabled: true,
        provider: {
          async smoothUserPrompt(input) {
            providerCalls += 1;
            await gate;
            return {
              text: `${input.rawText}.`,
              providerId: "openai-codex",
              modelId: "gpt-5.4-mini",
              reasoningEffort: "none",
              promptVersion: input.promptVersion,
              elapsedMs: 1,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            };
          },
        },
      },
    });

    const event = {
      type: "message_end",
      message: makePiUserMessage({
        content: "maybe smooth this",
      }),
    };
    await pi.emit("message_end", event, makePiExtensionContext(target));
    await pi.emit("message_end", event, makePiExtensionContext(target));

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    const messages = expectOk(await store.readMessages(thread.threadId));
    assert.equal(messages.length, 1);
    await sleep(20);
    assert.equal(providerCalls, 1);
    release();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turns = expectOk(await store.readTurns(thread.threadId));
      if (turns.some((turn) => turn.smooth?.components?.some((component) => component.kind === "user_prompt"))) {
        break;
      }
      await sleep(10);
    }
  });
});

test("registers production PI handlers that capture live message_end prompt, response, and tool result events", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-001",
      sessionFilePath: resolveProjectPath("pi", "session-production-001.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new FileThreadStore(storeRootDir);
    const ctx = makePiExtensionContext(target);
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Live prompt" }) }, ctx);
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiAssistantMessage({
          responseId: "response-production-001",
          content: [{ type: "text", text: "Live response" }],
        }),
      },
      ctx,
    );
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiToolResultMessage({
          toolCallId: "call-production-001",
          toolName: "bash",
          content: [{ type: "text", text: "Live tool output" }],
        }),
      },
      ctx,
    );

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(
      messages.map((message) => message.messageKind),
      ["prompt", "response", "tool_result"],
    );
    assert.deepEqual(
      messages.map((message) => message.sourceOrder),
      [1, 2, 3],
    );
    assert.equal(messages[0]?.targetMetadata?.sessionId, "session-production-001");
    assert.equal(messages[1]?.targetMetadata?.responseId, "response-production-001");
    assert.equal(messages[2]?.targetMetadata?.toolCallId, "call-production-001");
  });
});

test("production PI handlers ignore session_start without creating runtime messages", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-fresh",
      sessionFilePath: resolveProjectPath("pi", "session-production-fresh.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new FileThreadStore(storeRootDir);
    const ctx = makeImportCapableContext(target, {
      entries: [],
    });
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.equal(thread, undefined);
  });
});

test("production PI handlers do not auto-manage pre-populated sessions before attach/import", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-prepopulated",
      sessionFilePath: resolveProjectPath("pi", "session-production-prepopulated.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const entries = makePiSessionEntries({
      messages: [
        makePiUserMessage({ content: "Imported prompt" }),
        makePiAssistantMessage({ content: [{ type: "text", text: "Imported response" }] }),
      ],
    });
    const store = new FileThreadStore(storeRootDir);
    const ctx = makeImportCapableContext(target, {
      entries,
    });
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiAssistantMessage({
          timestamp: Date.parse("2026-05-09T13:30:00.000Z"),
          content: [{ type: "text", text: "Live response after pre-populated history" }],
        }),
      },
      ctx,
    );

    const thread = expectOk(await store.findManagedThread(target));
    assert.equal(thread, undefined);
  });
});

test("production PI handlers resolve a fresh managed thread when the PI session target changes", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const targetOne = makeThreadTarget({
      sessionId: "session-production-cache-a",
      sessionFilePath: resolveProjectPath("pi", "session-production-cache-a.jsonl"),
      cwd: projectDir,
    });
    const targetTwo = makeThreadTarget({
      sessionId: "session-production-cache-b",
      sessionFilePath: resolveProjectPath("pi", "session-production-cache-b.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(targetOne);
    await ensureTargetSessionFile(targetTwo);
    const store = new FileThreadStore(storeRootDir);
    const ctxOne = makePiExtensionContext(targetOne);
    const ctxTwo = makePiExtensionContext(targetTwo);
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Session A prompt" }) }, ctxOne);
    await pi.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Session B prompt" }) }, ctxTwo);

    const threadOne = expectOk(await store.findManagedThread(targetOne));
    const threadTwo = expectOk(await store.findManagedThread(targetTwo));
    assert.ok(threadOne);
    assert.ok(threadTwo);
    assert.notEqual(threadOne.threadId, threadTwo.threadId);

    const messagesOne = expectOk(await store.readMessages(threadOne.threadId));
    const messagesTwo = expectOk(await store.readMessages(threadTwo.threadId));

    assert.deepEqual(messagesOne.map((message) => message.targetMetadata?.sessionId), ["session-production-cache-a"]);
    assert.deepEqual(messagesTwo.map((message) => message.targetMetadata?.sessionId), ["session-production-cache-b"]);
  });
});

test("production PI handlers resolve generated rollout sessions through the threadId-map", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const originalTarget = makeThreadTarget({
      sessionId: "session-production-original",
      sessionFilePath: resolveProjectPath("pi", "session-production-original.jsonl"),
      cwd: projectDir,
    });
    const generatedFilePath = resolveProjectPath("generated", "session-production-generated.jsonl");
    await ensureTargetSessionFile(originalTarget);
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(generatedFilePath, '{"type":"generated"}\n');

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target: originalTarget }, store));
    expectOk(
      await store.updateThreadMetadata({
        threadId: thread.threadId,
        expectedSourceRevision: thread.sourceRevision,
        patch: {
          target: {
            ...thread.target,
            currentGeneratedFilePath: generatedFilePath,
          },
          threadViewOutputSummary: {
            ...thread.threadViewOutputSummary,
            count: 1,
            currentGeneratedFilePath: generatedFilePath,
            lastRevisionStatus: "available",
          },
        },
      }),
    );

    const generatedTarget = makeThreadTarget({
      sessionId: "session-production-generated",
      sessionFilePath: generatedFilePath,
      cwd: projectDir,
    });
    expectOk(
      await store.recordThreadIdMap({
        threadId: thread.threadId,
        target: generatedTarget,
      }),
    );

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });

    await pi.emit(
      "message_end",
      {
        type: "message_end",
        message: makePiUserMessage({ content: "Post-compact live prompt" }),
      },
      makePiExtensionContext(generatedTarget),
    );

    const originalLookup = expectOk(await store.findManagedThread(originalTarget));
    const generatedLookup = expectOk(await store.findManagedThread(generatedTarget));
    assert.equal(originalLookup?.threadId, thread.threadId);
    assert.equal(generatedLookup?.threadId, thread.threadId);

    const messages = expectOk(await store.readMessages(thread.threadId));
    assert.deepEqual(
      messages.map((message) => message.parts.map((part) => part.content).join("")),
      ["Post-compact live prompt"],
    );
    assert.equal(messages[0]?.targetMetadata?.sessionId, "session-production-generated");
  });
});

test("production PI handlers suppress duplicate live message_end events without appending another source record", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-duplicate",
      sessionFilePath: resolveProjectPath("pi", "session-production-duplicate.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new FileThreadStore(storeRootDir);
    const ctx = makePiExtensionContext(target);
    const pi = new FakeExtensionApi();
    const event = {
      type: "message_end",
      message: makePiAssistantMessage({
        responseId: "response-production-duplicate",
        content: [{ type: "text", text: "Duplicate live response" }],
      }),
    };

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("message_end", event, ctx);
    await pi.emit("message_end", event, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(
      messages.map((message) => message.messageKind),
      ["response"],
    );
  });
});

test("production PI handlers do not store session and turn lifecycle events as messages", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-runtime",
      sessionFilePath: resolveProjectPath("pi", "session-production-runtime.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new TokenCountingTrackingStore(storeRootDir);
    const ctx = makePiExtensionContext(target);
    const pi = new FakeExtensionApi();
    expectOk(await openOrCreateManagedThread({ target }, store));

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
    });
    await pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await pi.emit(
      "session_before_switch",
      {
        type: "session_before_switch",
        reason: "resume",
        targetSessionFile: resolveProjectPath("pi", "next-session.jsonl"),
      },
      ctx,
    );
    await pi.emit("turn_start", { type: "turn_start", turnIndex: 7, timestamp: Date.parse("2026-05-09T13:00:00.000Z") }, ctx);
    await pi.emit(
      "turn_end",
      {
        type: "turn_end",
        turnIndex: 7,
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Done" }] }),
        toolResults: [makePiToolResultMessage({ toolCallId: "call-runtime-001" })],
      },
      ctx,
    );
    await pi.emit("session_shutdown", { type: "session_shutdown", reason: "resume", targetSessionFile: "next-session" }, ctx);

    const thread = expectOk(await store.findManagedThread(target));
    assert.ok(thread);
    await store.waitForTokenCountingStatus(
      thread.threadId,
      "background turn_end maintenance should finish after lifecycle-only turn_end",
    );
    const messages = expectOk(await store.readMessages(thread.threadId));
    assert.deepEqual(messages, []);
  });
});

test("production turn_end handler closes the latest open turn and smooths closed turns", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-turn-end-smooth",
      sessionFilePath: resolveProjectPath("pi", "session-production-turn-end-smooth.jsonl"),
      cwd: projectDir,
    });
    const store = new TokenCountingTrackingStore(storeRootDir);
    const { thread, ctx } = await createManagedThread(storeRootDir, target, store);

    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: { type: "message_end", message: makePiUserMessage({ content: "First prompt" }) },
        ctx,
      }),
    );
    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-turn-end-smooth-001",
            content: [{ type: "text", text: "First response" }],
          }),
        },
        ctx,
      }),
    );
    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: { type: "message_end", message: makePiUserMessage({ content: "Second prompt" }) },
        ctx,
      }),
    );

    const before = expectOk(await store.openThread(thread.threadId));
    assert.equal(before.turns.length, 2);
    assert.equal(before.turns[0]?.lifecycleStatus, "closed");
    assert.equal(before.turns[1]?.lifecycleStatus, "open");
    assert.equal(before.turns[0]?.smooth, undefined);
    assert.equal(before.turns[1]?.smooth, undefined);

    const pi = new FakeExtensionApi();
    const tokenCounter = new ExactCountingTestCounter();
    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      openAIInputTokenCounter: tokenCounter as any,
    });
    await pi.emit(
      "turn_end",
      {
        type: "turn_end",
        turnIndex: 2,
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Turn finished" }] }),
        toolResults: [],
      },
      ctx,
    );

    await store.waitForTokenCountingStatus(
      thread.threadId,
      "background turn_end maintenance should close latest turn and smooth eligible closed turns",
    );
    const deadline = Date.now() + 5_000;
    while ((tokenCounter.rawCalls < 2 || tokenCounter.smoothCalls < 2) && Date.now() < deadline) {
      await sleep(10);
    }

    const after = expectOk(await store.openThread(thread.threadId));
    assert.equal(after.turns[0]?.lifecycleStatus, "closed");
    assert.equal(after.turns[1]?.lifecycleStatus, "closed");
    assert.equal(after.turns[0]?.smooth?.text, undefined);
    assert.equal(after.turns[0]?.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(Array.isArray(after.turns[0]?.smooth?.components), true);
    assert.equal(after.turns[0]?.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(after.turns[0]?.rawTokenCountMetadata?.trustClass, "exact");
    assert.equal(after.turns[0]?.smooth?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(after.turns[0]?.smooth?.tokenCountMetadata?.trustClass, "exact");
    assert.equal(after.thread.status.tokenCounting?.status, "ready");
    assert.equal(tokenCounter.rawCalls >= 2, true);
    assert.equal(tokenCounter.smoothCalls >= 2, true);
    const secondKinds = new Set(after.turns[1]?.smooth?.components?.map((component) => component.kind) ?? []);
    assert.equal(secondKinds.has("assistant_message"), false);
    assert.equal(secondKinds.has("thinking"), false);
    assert.equal(secondKinds.has("tool_exchange"), false);
  });
});

test("production turn_end handler refreshes the active generated session file for known prompt truncations", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const generatedFilePath = resolveProjectPath(".context-steward", "threads", "thread-active-prompt", "generated", "active.jsonl");
    const target = makeThreadTarget({
      sessionId: "session-active-prompt",
      sessionFilePath: generatedFilePath,
      cwd: projectDir,
      currentGeneratedFilePath: generatedFilePath,
    });
    const oldToolResult = makePiToolResultMessage({
      toolCallId: "call-active-prompt-001",
      toolName: "read",
      content: [{ type: "text", text: "A".repeat(200) }],
    });
    const newerAssistant = makePiAssistantMessage({
      responseId: "response-active-prompt-001",
      content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
    });
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-active-prompt",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: projectDir,
        }),
        JSON.stringify({
          type: "message",
          id: "entry-001",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: oldToolResult,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const store = new TokenCountingTrackingStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const ctx = makePiExtensionContext(target);
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 100,
        truncatedCharLimit: 12,
      },
    });
    await pi.emit("message_end", { type: "message_end", message: oldToolResult }, ctx);
    await pi.emit("message_end", { type: "message_end", message: newerAssistant }, ctx);
    await pi.emit(
      "turn_end",
      {
        type: "turn_end",
        turnIndex: 1,
        message: newerAssistant,
        toolResults: [],
      },
      ctx,
    );

    const sessionLines = (await readFile(generatedFilePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const activeToolEntry = sessionLines[1] as {
      message: { content: Array<{ text: string }> };
    };
    const canonicalMessages = expectOk(await store.readMessages(thread.threadId));
    const canonicalTool = canonicalMessages.find((message) => message.targetMetadata?.toolCallId === "call-active-prompt-001");

    assert.equal(activeToolEntry.message.content[0]?.text, `${"A".repeat(12)}...`);
    assert.deepEqual(canonicalTool?.parts[0]?.content, {
      output: "A".repeat(200),
      toolCallId: "call-active-prompt-001",
      toolName: "read",
      isError: false,
    });

    await store.waitForTokenCountingStatus(
      thread.threadId,
      "background turn_end maintenance should finish after prompt projection refresh",
    );
  });
});

test("production prompt projection does not reset when PI leaf advances during ordinary appends", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const generatedFilePath = resolveProjectPath(".context-steward", "threads", "thread-leaf-advance-prompt", "generated", "active.jsonl");
    const target = makeThreadTarget({
      sessionId: "session-leaf-advance-prompt",
      sessionFilePath: generatedFilePath,
      cwd: projectDir,
      currentGeneratedFilePath: generatedFilePath,
    });
    const oldToolResult = makePiToolResultMessage({
      toolCallId: "call-leaf-advance-001",
      toolName: "read",
      content: [{ type: "text", text: "L".repeat(200) }],
    });
    const newerAssistant = makePiAssistantMessage({
      responseId: "response-leaf-advance-001",
      content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
    });
    const entries: ReturnType<typeof makePiSessionEntries> = [];
    let activeLeafId: string | undefined;
    const ctx = makeImportCapableContext(target, {
      entries,
      activeBranch: entries,
      activeLeafId,
    });
    const appendEntry = (message: typeof oldToolResult | typeof newerAssistant) => {
      const id = `entry-${String(entries.length + 1).padStart(3, "0")}`;
      entries.push({
        type: "message",
        id,
        parentId: activeLeafId ?? null,
        timestamp: new Date(Date.parse("2026-01-01T00:00:00.000Z") + entries.length * 1_000).toISOString(),
        message,
      });
      activeLeafId = id;
    };
    const leafAdvancingCtx = {
      ...ctx,
      sessionManager: {
        ...ctx.sessionManager,
        getBranch: () => entries,
        getEntries: () => entries,
        getLeafId: () => activeLeafId ?? null,
      },
    };
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-leaf-advance-prompt",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: projectDir,
        }),
        JSON.stringify({
          type: "message",
          id: "entry-001",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: oldToolResult,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const store = new TokenCountingTrackingStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 100,
        truncatedCharLimit: 12,
      },
    });

    appendEntry(oldToolResult);
    await pi.emit("message_end", { type: "message_end", message: oldToolResult }, leafAdvancingCtx);
    appendEntry(newerAssistant);
    await pi.emit("message_end", { type: "message_end", message: newerAssistant }, leafAdvancingCtx);
    await pi.emit(
      "turn_end",
      {
        type: "turn_end",
        turnIndex: 1,
        message: newerAssistant,
        toolResults: [],
      },
      leafAdvancingCtx,
    );

    const sessionLines = (await readFile(generatedFilePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const activeToolEntry = sessionLines[1] as {
      message: { content: Array<{ text: string }> };
    };

    assert.equal(activeToolEntry.message.content[0]?.text, `${"L".repeat(12)}...`);

    await store.waitForTokenCountingStatus(
      thread.threadId,
      "background turn_end maintenance should finish after leaf-advance prompt projection refresh",
    );
  });
});

test("production session_start handler refreshes an oversized active generated session file before the next turn", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const generatedFilePath = resolveProjectPath(".context-steward", "threads", "thread-startup-prompt", "generated", "active.jsonl");
    const target = makeThreadTarget({
      sessionId: "session-startup-prompt",
      sessionFilePath: generatedFilePath,
      cwd: projectDir,
      currentGeneratedFilePath: generatedFilePath,
    });
    const oldToolResult = makePiToolResultMessage({
      toolCallId: "call-startup-prompt-001",
      toolName: "read",
      content: [{ type: "text", text: "S".repeat(200) }],
    });
    const newerAssistant = makePiAssistantMessage({
      responseId: "response-startup-prompt-001",
      content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
    });
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-startup-prompt",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: projectDir,
        }),
        JSON.stringify({
          type: "message",
          id: "entry-001",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: oldToolResult,
        }),
        JSON.stringify({
          type: "message",
          id: "entry-002",
          parentId: "entry-001",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: newerAssistant,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const store = new FileThreadStore(storeRootDir);
    await openOrCreateManagedThread({ target }, store);
    const entries = makePiSessionEntries({ messages: [oldToolResult, newerAssistant] });
    const ctx = makeImportCapableContext(target, { entries });
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 100,
        truncatedCharLimit: 12,
      },
    });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    const sessionLines = (await readFile(generatedFilePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const activeToolEntry = sessionLines[1] as {
      message: { content: Array<{ text: string }> };
    };

    assert.equal(activeToolEntry.message.content[0]?.text, `${"S".repeat(12)}...`);
  });
});

test("production context projection state is scoped to the active PI session branch", async () => {
  await withTempThreadStore(async ({ projectDir, resolveProjectPath }) => {
    const sharedToolCallId = "call-shared-scope-001";
    const firstTarget = makeThreadTarget({
      sessionId: "session-prompt-scope-one",
      sessionFilePath: resolveProjectPath("pi", "session-prompt-scope-one.jsonl"),
      cwd: projectDir,
    });
    const secondTarget = makeThreadTarget({
      sessionId: "session-prompt-scope-two",
      sessionFilePath: resolveProjectPath("pi", "session-prompt-scope-two.jsonl"),
      cwd: projectDir,
    });
    const firstToolResult = makePiToolResultMessage({
      toolCallId: sharedToolCallId,
      content: [{ type: "text", text: "P".repeat(200) }],
    });
    const firstNewerAssistant = makePiAssistantMessage({
      responseId: "response-prompt-scope-one",
      content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
    });
    const secondToolResult = makePiToolResultMessage({
      toolCallId: sharedToolCallId,
      content: [{ type: "text", text: "Q".repeat(200) }],
    });
    const firstMessages = [firstToolResult, firstNewerAssistant];
    const secondMessages = [secondToolResult];
    const firstCtx = makeImportCapableContext(firstTarget, {
      entries: makePiSessionEntries({ messages: firstMessages }),
    });
    const secondCtx = makeImportCapableContext(secondTarget, {
      entries: makePiSessionEntries({ messages: secondMessages }),
    });
    const pi = new FakeExtensionApi();

    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 100,
        truncatedCharLimit: 12,
      },
    });

    const contextHandler = pi.handlers.get("context")?.[0];
    assert.ok(contextHandler);

    await pi.emit("session_start", { type: "session_start", reason: "resume" }, firstCtx);
    const firstResult = await contextHandler(
      { type: "context", messages: firstMessages },
      firstCtx,
    ) as { messages: typeof firstMessages };
    const firstAppliedToolResult = firstResult.messages[0] as typeof firstToolResult;

    assert.equal((firstAppliedToolResult.content[0] as { text: string }).text, `${"P".repeat(12)}...`);

    await pi.emit("session_start", { type: "session_start", reason: "resume" }, secondCtx);
    const secondResult = await contextHandler(
      { type: "context", messages: secondMessages },
      secondCtx,
    ) as { messages: typeof secondMessages };
    const secondAppliedToolResult = secondResult.messages[0] as typeof secondToolResult;

    assert.equal((secondAppliedToolResult.content[0] as { text: string }).text, "Q".repeat(200));
  });
});

test("production turn_end handler persists token-count maintenance failures", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-turn-end-token-count-failure",
      sessionFilePath: resolveProjectPath("pi", "session-production-turn-end-token-count-failure.jsonl"),
      cwd: projectDir,
    });
    const store = new TokenCountingTrackingStore(storeRootDir);
    const { thread, ctx } = await createManagedThread(storeRootDir, target, store);

    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: { type: "message_end", message: makePiUserMessage({ content: "First prompt" }) },
        ctx,
      }),
    );
    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-turn-end-token-count-failure-001",
            content: [{ type: "text", text: "First response" }],
          }),
        },
        ctx,
      }),
    );
    expectOk(
      await capturePiEvent({
        store,
        threadId: thread.threadId,
        event: { type: "message_end", message: makePiUserMessage({ content: "Second prompt" }) },
        ctx,
      }),
    );

    const pi = new FakeExtensionApi();
    registerContextStewardExtension(pi as unknown as ExtensionAPI, {
      createStore: () => store,
      openAIInputTokenCounter: {
        async countRawTurnMaterialized() {
          throw new Error("simulated OpenAI count failure");
        },
        async countSmoothTurnMaterialized() {
          throw new Error("simulated OpenAI count failure");
        },
        async countChunkSmoothMaterialized() {
          throw new Error("simulated OpenAI count failure");
        },
        async countDetailedChunkMaterialized() {
          throw new Error("simulated OpenAI count failure");
        },
        async countBriefChunkMaterialized() {
          throw new Error("simulated OpenAI count failure");
        },
        async countGeneratedSession() {
          throw new Error("simulated OpenAI count failure");
        },
      },
    });
    await pi.emit(
      "turn_end",
      {
        type: "turn_end",
        turnIndex: 2,
        message: makePiAssistantMessage({ content: [{ type: "text", text: "Turn finished" }] }),
        toolResults: [],
      },
      ctx,
    );

    await store.waitForTokenCountingStatus(
      thread.threadId,
      "background turn_end maintenance should persist token-count failures",
    );

    const after = expectOk(await store.openThread(thread.threadId));
    assert.equal(after.thread.status.tokenCounting?.status, "repair_needed");
    assert.ok((after.thread.status.tokenCounting?.issueCount ?? 0) >= 1);
    assert.equal(after.thread.status.tokenCounting?.issues?.some((issue) => issue.code === "TOKEN_COUNT_BLOCKED"), true);
    assert.equal(after.turns[0]?.rawTokenCountMetadata?.source, "pi_heuristic");
    assert.equal(after.turns[0]?.smooth?.tokenCountMetadata?.source, "pi_heuristic");
  });
});

test("returns updated turn data when a downstream turn writer succeeds", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const { store, thread, ctx } = await createManagedThread(storeRootDir);
    const activity = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Open a tracked turn." }),
        ctx,
      }),
    );

    const result = expectOk(
      await captureFinalizedActivity({
        store,
        threadId: thread.threadId,
        activity,
        turnWriter: async ({ store: turnStore, threadId, message }) => {
          const turns = [
            makeTurnRecord({
              threadId,
              turnId: "turn-capture-001",
              initiatingMessageId: message.messageId,
              messageIds: [message.messageId],
              sourceRange: createSourceRange(message.sourceOrder),
              sourceRevision: message.sourceRevision,
              lifecycleStatus: "open",
              repairStatus: "ready",
            }),
          ];
          const written = await turnStore.writeTurns({
            threadId,
            expectedSourceRevision: message.sourceRevision,
            expectedMessageHighWatermark: message.sourceOrder,
            expectedTurnsRevision: thread.turnsRevision,
            turns,
            turnState: "ready",
          });
          if (!written.ok) {
            return written;
          }

          return {
            ok: true,
            value: {
              turns: written.value,
            },
          };
        },
      }),
    );

    assert.equal(result.turnStateOutcome, "updated");
    assert.equal(result.turns[0]?.turnId, "turn-capture-001");
  });
});
