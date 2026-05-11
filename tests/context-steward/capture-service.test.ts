import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { dirname } from "node:path";

import type { StewardErrorCode, StewardResult } from "../../src/context-steward/domain/errors.js";
import { fail } from "../../src/context-steward/domain/errors.js";
import { createSourceRange } from "../../src/context-steward/domain/ids.js";
import {
  capturePiEvent,
  mapPiCaptureEventToActivity,
  registerContextStewardExtension,
} from "../../src/context-steward/pi/pi-extension.js";
import { createPiRuntimeNoteActivity, mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { checkTurnHealth } from "../../src/context-steward/services/turn-service.js";
import {
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

async function createManagedThread(storeRootDir: string, target = makeThreadTarget()) {
  await ensureTargetSessionFile(target);

  const store = new FileThreadStore(storeRootDir);
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
  });
});

test("captures a runtime note as a canonical runtime-event message", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const target = makeThreadTarget();
    const { store, thread, ctx } = await createManagedThread(storeRootDir, target);
    const activity = createPiRuntimeNoteActivity({
      ctx,
      createdAt: "2026-05-09T12:00:00.000Z",
      note: {
        note: "session_start",
        status: "capture_ready",
      },
    });

    const captured = expectOk(await captureFinalizedActivity({ store, threadId: thread.threadId, activity }));

    assert.equal(captured.message.messageKind, "runtime_event");
    assert.equal(captured.message.actorType, "runtime");
    assert.equal(captured.message.parts[0]?.partType, "runtime_note");
    assert.deepEqual(captured.message.parts[0]?.content, {
      note: "session_start",
      status: "capture_ready",
    });
    assert.equal(captured.message.targetMetadata?.sessionId, target.sessionId);
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

test("ignores tool execution lifecycle events until they become finalized messages or runtime notes", async () => {
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

test("production PI handlers create a managed thread on session_start for a fresh session", async () => {
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
    assert.ok(thread);
    const messages = expectOk(await store.readMessages(thread.threadId));

    assert.deepEqual(messages.map((message) => message.messageKind), ["runtime_event"]);
    assert.equal((messages[0]?.parts[0]?.content as { event?: string }).event, "session_start");
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

test("production PI handlers capture relevant session and turn lifecycle events as runtime notes", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-production-runtime",
      sessionFilePath: resolveProjectPath("pi", "session-production-runtime.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);
    const store = new FileThreadStore(storeRootDir);
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
    const messages = expectOk(await store.readMessages(thread.threadId));
    const runtimeEvents = messages.map((message) => message.parts[0]?.content as Record<string, unknown>);

    assert.deepEqual(runtimeEvents.map((content) => content.event), [
      "session_start",
      "session_before_switch",
      "turn_start",
      "turn_end",
      "session_shutdown",
    ]);
    assert.equal(runtimeEvents[2]?.turnIndex, 7);
    assert.equal(runtimeEvents[3]?.toolResultCount, 1);
    assert.ok(messages.every((message) => message.messageKind === "runtime_event"));
    assert.equal(messages[2]?.createdAt, "2026-05-09T13:00:00.000Z");
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
