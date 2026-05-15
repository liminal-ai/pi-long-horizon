import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ensureSmoothTurn,
  materializeSmoothTurn,
  persistSmoothTurnState,
  readSmoothTurnState,
} from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ThreadSnapshot } from "../../src/thread/store/thread-store.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import type { SmoothTurnComponentState } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";

const SMOOTH_TURN_RACE_WORKER_PATH = fileURLToPath(new URL("./helpers/smooth-turn-race-worker.ts", import.meta.url));

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function toPendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
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

async function writeTurns(
  store: FileThreadStore,
  threadId: string,
  turns: TurnRecord[],
) {
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

async function readTurn(store: FileThreadStore, threadId: string, turnId: string) {
  const turns = expectOk(await store.readTurns(threadId));
  const turn = turns.find((candidate) => candidate.turnId === turnId);
  assert.ok(turn);
  return turn;
}

function buildGeneratedSmoothState(snapshot: ThreadSnapshot, turnId: string, generatedAt: string) {
  const turn = snapshot.turns.find((candidate) => candidate.turnId === turnId);
  assert.ok(turn);

  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message] as const));
  const messages = turn.messageIds
    .map((messageId) => messagesById.get(messageId))
    .filter((message) => message !== undefined)
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
  const components: SmoothTurnComponentState[] = messages.flatMap((message) =>
    [...message.parts]
      .sort((left, right) => left.partOrder - right.partOrder)
      .map((part) => {
        const text = typeof part.content === "string" ? part.content.replace(/\s+/g, " ").trim() : JSON.stringify(part.content);
        const kind: SmoothTurnComponentState["kind"] =
          part.partType === "reasoning"
            ? "thinking"
            : part.partType === "tool_call" || part.partType === "tool_result" || message.actorType === "tool" || message.messageKind === "tool_result"
              ? "tool_exchange"
              : message.actorType === "human" || message.messageKind === "prompt"
                ? "user_prompt"
                : "assistant_message";
        const omitted = kind === "thinking" && text.length === 0;
        if (text.length === 0 && !omitted) {
          return undefined;
        }
        const strategy: SmoothTurnComponentState["strategy"] =
          kind === "user_prompt"
            ? "deterministic_user_prompt_preserved_v1"
            : kind === "assistant_message"
              ? "deterministic_assistant_v1"
              : kind === "tool_exchange"
                ? "deterministic_tool_exchange_v1"
                : "thinking_plaintext_or_omitted_v1";

        return {
          componentId: `${turnId}:${kind}:${message.messageId}:${part.partId}`,
          kind,
          status: omitted ? "omitted" as const : "ready" as const,
          text: omitted ? undefined : text,
          quality: omitted ? "omitted_no_plaintext" as const : kind === "tool_exchange" ? "deterministic_rendered" as const : "deterministic_preserved" as const,
          sourceMessageIds: [message.messageId],
          sourcePartIds: [part.partId],
          sourceRevision: message.sourceRevision,
          generatedAt,
          strategy,
        };
      })
      .filter((component) => component !== undefined),
  );

  return {
    turnId,
    threadId: snapshot.thread.threadId,
    status: "ready" as const,
    schemaVersion: "component_smooth_turn_v1" as const,
    strategy: "component_smooth_turn_v1" as const,
    generatedAt,
    sourceRevision: turn.sourceRevision,
    components,
  };
}

function makeClosedTurn(input: {
  threadId: string;
  turnId: string;
  messages: MessageRecord[];
  smooth?: TurnRecord["smooth"];
}): TurnRecord {
  const first = input.messages[0]!;
  const last = input.messages[input.messages.length - 1]!;

  return makeTurnRecord({
    turnId: input.turnId,
    threadId: input.threadId,
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

async function waitForFile(filePath: string): Promise<void> {
  for (;;) {
    try {
      await access(filePath);
      return;
    } catch {
      await sleep(10);
    }
  }
}

async function runSmoothTurnRaceWorker(input: {
  storeRootDir: string;
  threadId: string;
  turnId: string;
  generatedAt: string;
  readyFilePath: string;
  goFilePath: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", SMOOTH_TURN_RACE_WORKER_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STORE_ROOT_DIR: input.storeRootDir,
        THREAD_ID: input.threadId,
        TURN_ID: input.turnId,
        GENERATED_AT: input.generatedAt,
        READY_FILE_PATH: input.readyFilePath,
        GO_FILE_PATH: input.goFilePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`smooth-turn race worker for ${input.turnId} exited with ${code}: ${stderr}`));
    });
  });
}

test("closed turn receives smooth text", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-001");

    const user = makeActorRecord({ actorId: "actor-user", actorType: "human", displayName: "User" });
    const assistant = makeActorRecord({ actorId: "actor-assistant", actorType: "agent", displayName: "Assistant" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-001",
      user,
      toPendingMessage({
        messageId: "message-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-user", content: "Please smooth this turn." })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-001",
      assistant,
      toPendingMessage({
        messageId: "message-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: "part-assistant", content: "Deterministic smoothing is ready." })],
      }),
    );

    await writeTurns(store, "thread-smooth-001", [
      makeClosedTurn({
        threadId: "thread-smooth-001",
        turnId: "turn-smooth-001",
        messages: [prompt, response],
      }),
    ]);

    const result = await ensureSmoothTurn(
      {
        threadId: "thread-smooth-001",
        turnId: "turn-smooth-001",
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    assert.equal(result.smoothStatus, "ready");
    assert.ok((result.smoothTokenCount ?? 0) > 0);

    const persisted = await readTurn(store, "thread-smooth-001", "turn-smooth-001");
    assert.equal(persisted.smooth?.status, "ready");
    assert.equal(persisted.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(persisted.smooth?.strategy, "component_smooth_turn_v1");
    assert.equal(persisted.smooth?.generatedAt, DEFAULT_TEST_TIMESTAMP);
    assert.equal(persisted.smooth?.sourceRevision, response.sourceRevision);
    assert.equal(persisted.smooth?.text, undefined);
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-001", turnId: "turn-smooth-001" },
      { store },
    );
    assert.match(materialized.text ?? "", /\[user\][\s\S]*\[assistant\]/);
    assert.equal(persisted.smooth?.tokenCountMetadata?.count, result.smoothTokenCount);
    assert.equal(persisted.smooth?.tokenCountMetadata?.scope, "smooth_turn_materialized");
    assert.equal(persisted.smooth?.tokenCountMetadata?.sourceRevision, response.sourceRevision);
    assert.match(persisted.smooth?.tokenCountMetadata?.representationHash ?? "", /^sha256:/);
  });
});

test("open turn does not receive final smooth text", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-open");

    const user = makeActorRecord({ actorId: "actor-user-open", actorType: "human" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-open",
      user,
      toPendingMessage({
        messageId: "message-open-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Still in progress." })],
      }),
    );

    await writeTurns(store, "thread-smooth-open", [
      makeTurnRecord({
        turnId: "turn-open",
        threadId: "thread-smooth-open",
        lifecycleStatus: "open",
        repairStatus: "ready",
        initiatingMessageId: prompt.messageId,
        messageIds: [prompt.messageId],
        sourceRange: { fromSourceOrder: prompt.sourceOrder, toSourceOrder: prompt.sourceOrder },
        openedAt: prompt.createdAt ?? prompt.capturedAt,
        sourceRevision: prompt.sourceRevision,
      }),
    ]);

    const result = await ensureSmoothTurn(
      {
        threadId: "thread-smooth-open",
        turnId: "turn-open",
      },
      { store },
    );

    assert.equal(result.smoothStatus, "missing");
    const persisted = await readTurn(store, "thread-smooth-open", "turn-open");
    assert.equal(persisted.smooth, undefined);
  });
});

test("smooth text preserves fixed actor section markers", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-markers");

    const user = makeActorRecord({ actorId: "actor-user-markers", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-markers", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool-markers", actorType: "tool" });

    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-markers",
      user,
      toPendingMessage({
        messageId: "message-markers-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "part-markers-user", content: "Summarize the flow." })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-markers",
      assistant,
      toPendingMessage({
        messageId: "message-markers-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({ partId: "part-markers-assistant", partOrder: 1, content: "I will inspect the thread." }),
          makePartRecord({ partId: "part-markers-thinking", partOrder: 2, partType: "reasoning", content: "Chain  of  thought" }),
        ],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-markers",
      tool,
      toPendingMessage({
        messageId: "message-markers-tool",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [makePartRecord({ partId: "part-markers-tool", partType: "tool_result", content: "tool output" })],
      }),
    );

    await writeTurns(store, "thread-smooth-markers", [
      makeClosedTurn({
        threadId: "thread-smooth-markers",
        turnId: "turn-markers",
        messages: [prompt, response, toolResult],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-markers", turnId: "turn-markers" }, { store });
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-markers", turnId: "turn-markers" },
      { store },
    );

    assert.equal(
      materialized.text,
      "[user]\nSummarize the flow.\n\n[assistant]\nI will inspect the thread.\n\n[thinking]\nChain of thought\n\n[tool]\n{\"output\":\"tool output\",\"status\":\"success\",\"type\":\"unpaired_tool_result\"}",
    );
  });
});

test("one smooth text field per turn", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-single");

    const user = makeActorRecord({ actorId: "actor-user-single", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-single", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-single",
      user,
      toPendingMessage({
        messageId: "message-single-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Question one." })],
      }),
    );
    const responseA = await appendCanonicalMessage(
      store,
      "thread-smooth-single",
      assistant,
      toPendingMessage({
        messageId: "message-single-response-a",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Answer part one." })],
      }),
    );
    const responseB = await appendCanonicalMessage(
      store,
      "thread-smooth-single",
      assistant,
      toPendingMessage({
        messageId: "message-single-response-b",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Answer part two." })],
      }),
    );

    await writeTurns(store, "thread-smooth-single", [
      makeClosedTurn({
        threadId: "thread-smooth-single",
        turnId: "turn-single",
        messages: [prompt, responseA, responseB],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-single", turnId: "turn-single" }, { store });
    const persisted = await readTurn(store, "thread-smooth-single", "turn-single");
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-single", turnId: "turn-single" },
      { store },
    );

    assert.equal(persisted.smooth?.text, undefined);
    assert.equal(materialized.text?.includes("Answer part one.\nAnswer part two."), true);
  });
});

test("whitespace normalization is deterministic", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-whitespace");

    const user = makeActorRecord({ actorId: "actor-user-whitespace", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-whitespace", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-whitespace",
      user,
      toPendingMessage({
        messageId: "message-whitespace-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "  Need\n\nstable\tspacing   " })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-whitespace",
      assistant,
      toPendingMessage({
        messageId: "message-whitespace-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "  Spacing\n stays\t deterministic. " })],
      }),
    );

    await writeTurns(store, "thread-smooth-whitespace", [
      makeClosedTurn({
        threadId: "thread-smooth-whitespace",
        turnId: "turn-whitespace",
        messages: [prompt, response],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-whitespace", turnId: "turn-whitespace" }, { store });
    const first = await materializeSmoothTurn(
      { threadId: "thread-smooth-whitespace", turnId: "turn-whitespace" },
      { store },
    );

    await ensureSmoothTurn({ threadId: "thread-smooth-whitespace", turnId: "turn-whitespace" }, { store });
    const second = await materializeSmoothTurn(
      { threadId: "thread-smooth-whitespace", turnId: "turn-whitespace" },
      { store },
    );

    assert.equal(first.text, second.text);
    assert.equal(
      first.text,
      "[user]\nNeed stable spacing\n\n[assistant]\nSpacing stays deterministic.",
    );
  });
});

test("thinking renders plaintext only and excludes signatures", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-thinking");

    const assistant = makeActorRecord({ actorId: "actor-assistant-thinking", actorType: "agent" });
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-thinking",
      assistant,
      toPendingMessage({
        messageId: "message-thinking-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({
            partId: "part-thinking-plain",
            partOrder: 1,
            partType: "reasoning",
            content: {
              text: "Plain reasoning survives.",
              thinkingSignature: "signature-must-not-render",
              encryptedContent: "encrypted-must-not-render",
            },
          }),
          makePartRecord({
            partId: "part-thinking-encrypted-only",
            partOrder: 2,
            partType: "reasoning",
            content: {
              thinkingSignature: "signature-only-must-not-render",
              encryptedContent: "encrypted-only-must-not-render",
            },
          }),
        ],
      }),
    );

    await writeTurns(store, "thread-smooth-thinking", [
      makeClosedTurn({
        threadId: "thread-smooth-thinking",
        turnId: "turn-thinking",
        messages: [response],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-thinking", turnId: "turn-thinking" }, { store });
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-thinking", turnId: "turn-thinking" },
      { store },
    );

    assert.match(materialized.text ?? "", /\[thinking\]\nPlain reasoning survives\./);
    assert.equal(materialized.text?.includes("signature-must-not-render"), false);
    assert.equal(materialized.text?.includes("encrypted-must-not-render"), false);
    assert.equal(materialized.text?.includes("signature-only-must-not-render"), false);
  });
});

test("duplicate and missing tool ids render explicit unpaired records", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-tool-unpaired");

    const assistant = makeActorRecord({ actorId: "actor-assistant-tool-unpaired", actorType: "agent" });
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-tool-unpaired",
      assistant,
      toPendingMessage({
        messageId: "message-tool-unpaired-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({ partId: "part-missing-id", partOrder: 1, partType: "tool_call", content: { toolName: "bash", arguments: { cmd: "pwd" } } }),
          makePartRecord({ partId: "part-dup-a", partOrder: 2, partType: "tool_call", content: { toolCallId: "dup", toolName: "read", arguments: { path: "a" } } }),
          makePartRecord({ partId: "part-dup-b", partOrder: 3, partType: "tool_call", content: { toolCallId: "dup", toolName: "read", arguments: { path: "b" } } }),
          makePartRecord({ partId: "part-unpaired-result", partOrder: 4, partType: "tool_result", content: { toolCallId: "orphan", output: "orphaned" } }),
        ],
      }),
    );

    await writeTurns(store, "thread-smooth-tool-unpaired", [
      makeClosedTurn({
        threadId: "thread-smooth-tool-unpaired",
        turnId: "turn-tool-unpaired",
        messages: [response],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-tool-unpaired", turnId: "turn-tool-unpaired" }, { store });
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-tool-unpaired", turnId: "turn-tool-unpaired" },
      { store },
    );
    const records = (materialized.text?.split("[tool]\n")[1] ?? "").split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.deepEqual(records.map((record) => record.type), [
      "unpaired_tool_call",
      "unpaired_tool_call",
      "unpaired_tool_call",
      "unpaired_tool_result",
    ]);
    assert.equal(records[1]?.toolCallId, "dup");
    assert.equal(records[2]?.toolCallId, "dup");
    assert.equal(records[3]?.toolCallId, "orphan");
  });
});

test("tool exchanges use compact JSON with recursive string caps and retained failures", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-tool");

    const assistant = makeActorRecord({ actorId: "actor-assistant-tool", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool", actorType: "tool" });
    const largeArgument = "x".repeat(620);
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-tool",
      assistant,
      toPendingMessage({
        messageId: "message-tool-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({ partId: "part-tool-prose", partOrder: 1, content: "Running the command now." }),
          makePartRecord({
            partId: "part-tool-call",
            partOrder: 2,
            partType: "tool_call",
            content: {
              toolCallId: "call-large",
              toolName: "write",
              arguments: { path: "/tmp/large.txt", body: largeArgument },
            },
          }),
        ],
      }),
    );
    const oversizedToolOutput = "y".repeat(701);
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-tool",
      tool,
      toPendingMessage({
        messageId: "message-tool-result",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [
          makePartRecord({
            partId: "part-tool-result",
            partType: "tool_result",
            content: {
              toolCallId: "call-large",
              toolName: "write",
              output: oversizedToolOutput,
              isError: true,
            },
          }),
        ],
      }),
    );

    await writeTurns(store, "thread-smooth-tool", [
      makeClosedTurn({
        threadId: "thread-smooth-tool",
        turnId: "turn-tool",
        messages: [response, toolResult],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-tool", turnId: "turn-tool" }, { store });
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-tool", turnId: "turn-tool" },
      { store },
    );

    const toolText = materialized.text?.split("[tool]\n")[1] ?? "";
    const records = toolText.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(materialized.text?.includes("Running the command now."), true);
    assert.equal(materialized.text?.includes("toolCallId"), false);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], {
      arguments: {
        body: `${"x".repeat(500)}[omitted: 120 chars]`,
        path: "/tmp/large.txt",
      },
      name: "write",
      type: "tool_call",
    });
    assert.deepEqual(records[1], {
      output: `${"y".repeat(500)}[omitted: 201 chars]`,
      status: "error",
      type: "tool_result",
    });
  });
});

test("missing smooth output is explicit", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-missing");

    const user = makeActorRecord({ actorId: "actor-user-missing", actorType: "human" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-missing",
      user,
      toPendingMessage({
        messageId: "message-missing-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "No derived smooth state yet." })],
      }),
    );

    await writeTurns(store, "thread-smooth-missing", [
      makeClosedTurn({
        threadId: "thread-smooth-missing",
        turnId: "turn-missing",
        messages: [prompt],
      }),
    ]);

    const state = await readSmoothTurnState(
      {
        threadId: "thread-smooth-missing",
        turnId: "turn-missing",
      },
      { store },
    );

    assert.equal(state.smoothStatus, "missing");
    assert.equal(state.smoothText, undefined);
  });
});

test("stale or invalid smooth output can be regenerated", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-repair");

    const user = makeActorRecord({ actorId: "actor-user-repair", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-repair", actorType: "agent" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-repair",
      user,
      toPendingMessage({
        messageId: "message-repair-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Repair this smooth state." })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-repair",
      assistant,
      toPendingMessage({
        messageId: "message-repair-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Fresh content replaces stale output." })],
      }),
    );

    await writeTurns(store, "thread-smooth-repair", [
      makeClosedTurn({
        threadId: "thread-smooth-repair",
        turnId: "turn-repair",
        messages: [prompt, response],
        smooth: {
          status: "invalid",
          text: "Old smooth",
          tokenCountMetadata: { count: 99, scope: "smooth_turn_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-smooth-99", createdAt: DEFAULT_TEST_TIMESTAMP },
          sourceRevision: response.sourceRevision - 1,
        },
      }),
    ]);

    const before = await readSmoothTurnState(
      {
        threadId: "thread-smooth-repair",
        turnId: "turn-repair",
      },
      { store },
    );
    assert.equal(before.smoothStatus, "missing");

    const repaired = await ensureSmoothTurn(
      {
        threadId: "thread-smooth-repair",
        turnId: "turn-repair",
      },
      {
        store,
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      },
    );

    assert.equal(repaired.smoothStatus, "ready");
    const persisted = await readTurn(store, "thread-smooth-repair", "turn-repair");
    assert.equal(persisted.smooth?.sourceRevision, response.sourceRevision);
    assert.equal(persisted.smooth?.strategy, "component_smooth_turn_v1");
    assert.notEqual(persisted.smooth?.text, "Old smooth");
  });
});

test("stale whole-snapshot smooth writes do not clobber another turn's derived state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-stale-write");

    const user = makeActorRecord({ actorId: "actor-user-stale-write", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-stale-write", actorType: "agent" });

    const promptA = await appendCanonicalMessage(
      store,
      "thread-smooth-stale-write",
      user,
      toPendingMessage({
        messageId: "message-stale-write-prompt-a",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "First question." })],
      }),
    );
    const responseA = await appendCanonicalMessage(
      store,
      "thread-smooth-stale-write",
      assistant,
      toPendingMessage({
        messageId: "message-stale-write-response-a",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "First answer." })],
      }),
    );
    const promptB = await appendCanonicalMessage(
      store,
      "thread-smooth-stale-write",
      user,
      toPendingMessage({
        messageId: "message-stale-write-prompt-b",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Second question." })],
      }),
    );
    const responseB = await appendCanonicalMessage(
      store,
      "thread-smooth-stale-write",
      assistant,
      toPendingMessage({
        messageId: "message-stale-write-response-b",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Second answer." })],
      }),
    );

    await writeTurns(store, "thread-smooth-stale-write", [
      makeClosedTurn({
        threadId: "thread-smooth-stale-write",
        turnId: "turn-stale-write-a",
        messages: [promptA, responseA],
      }),
      makeClosedTurn({
        threadId: "thread-smooth-stale-write",
        turnId: "turn-stale-write-b",
        messages: [promptB, responseB],
      }),
    ]);

    const initialSnapshot = expectOk(await store.openThread("thread-smooth-stale-write"));
    const smoothA = buildGeneratedSmoothState(initialSnapshot, "turn-stale-write-a", DEFAULT_TEST_TIMESTAMP);
    const smoothB = buildGeneratedSmoothState(initialSnapshot, "turn-stale-write-b", "2026-01-02T00:00:00.000Z");

    await persistSmoothTurnState(
      {
        threadId: "thread-smooth-stale-write",
        turnId: "turn-stale-write-a",
        expectedSourceRevision: initialSnapshot.thread.sourceRevision,
        expectedMessageHighWatermark: initialSnapshot.thread.messageHighWatermark,
        expectedTurnsRevision: initialSnapshot.thread.turnsRevision,
        smooth: smoothA,
      },
      { store },
    );

    await persistSmoothTurnState(
      {
        threadId: "thread-smooth-stale-write",
        turnId: "turn-stale-write-b",
        expectedSourceRevision: initialSnapshot.thread.sourceRevision,
        expectedMessageHighWatermark: initialSnapshot.thread.messageHighWatermark,
        expectedTurnsRevision: initialSnapshot.thread.turnsRevision,
        smooth: smoothB,
      },
      { store },
    );

    const persistedA = await readTurn(store, "thread-smooth-stale-write", "turn-stale-write-a");
    const persistedB = await readTurn(store, "thread-smooth-stale-write", "turn-stale-write-b");

    assert.equal(persistedA.smooth?.text, undefined);
    assert.equal(persistedA.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(persistedA.smooth?.generatedAt, smoothA.generatedAt);
    assert.equal(persistedB.smooth?.text, undefined);
    assert.equal(persistedB.smooth?.schemaVersion, "component_smooth_turn_v1");
    assert.equal(persistedB.smooth?.generatedAt, smoothB.generatedAt);
  });
});

test("isolated smooth-turn writers retry instead of clobbering stale whole-snapshot state", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveThreadPath }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-process-race");

    const user = makeActorRecord({ actorId: "actor-user-process-race", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-process-race", actorType: "agent" });

    const promptA = await appendCanonicalMessage(
      store,
      "thread-smooth-process-race",
      user,
      toPendingMessage({
        messageId: "message-process-race-prompt-a",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Process question A." })],
      }),
    );
    const responseA = await appendCanonicalMessage(
      store,
      "thread-smooth-process-race",
      assistant,
      toPendingMessage({
        messageId: "message-process-race-response-a",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Process answer A." })],
      }),
    );
    const promptB = await appendCanonicalMessage(
      store,
      "thread-smooth-process-race",
      user,
      toPendingMessage({
        messageId: "message-process-race-prompt-b",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Process question B." })],
      }),
    );
    const responseB = await appendCanonicalMessage(
      store,
      "thread-smooth-process-race",
      assistant,
      toPendingMessage({
        messageId: "message-process-race-response-b",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Process answer B." })],
      }),
    );

    await writeTurns(store, "thread-smooth-process-race", [
      makeClosedTurn({
        threadId: "thread-smooth-process-race",
        turnId: "turn-process-race-a",
        messages: [promptA, responseA],
      }),
      makeClosedTurn({
        threadId: "thread-smooth-process-race",
        turnId: "turn-process-race-b",
        messages: [promptB, responseB],
      }),
    ]);

    const goFilePath = resolveThreadPath("thread-smooth-process-race", "smooth-process-race.go");
    const readyFileAPath = resolveThreadPath("thread-smooth-process-race", "smooth-process-race-a.ready");
    const readyFileBPath = resolveThreadPath("thread-smooth-process-race", "smooth-process-race-b.ready");

    const workerA = runSmoothTurnRaceWorker({
      storeRootDir,
      threadId: "thread-smooth-process-race",
      turnId: "turn-process-race-a",
      generatedAt: DEFAULT_TEST_TIMESTAMP,
      readyFilePath: readyFileAPath,
      goFilePath,
    });
    const workerB = runSmoothTurnRaceWorker({
      storeRootDir,
      threadId: "thread-smooth-process-race",
      turnId: "turn-process-race-b",
      generatedAt: "2026-01-02T00:00:00.000Z",
      readyFilePath: readyFileBPath,
      goFilePath,
    });

    await Promise.all([waitForFile(readyFileAPath), waitForFile(readyFileBPath)]);
    await writeFile(goFilePath, "go\n", "utf8");
    await Promise.all([workerA, workerB]);

    const persistedA = await readTurn(store, "thread-smooth-process-race", "turn-process-race-a");
    const persistedB = await readTurn(store, "thread-smooth-process-race", "turn-process-race-b");
    const thread = expectOk(await store.assertCanMutate("thread-smooth-process-race"));
    const materializedA = await materializeSmoothTurn(
      { threadId: "thread-smooth-process-race", turnId: "turn-process-race-a" },
      { store },
    );
    const materializedB = await materializeSmoothTurn(
      { threadId: "thread-smooth-process-race", turnId: "turn-process-race-b" },
      { store },
    );

    assert.equal(persistedA.smooth?.text, undefined);
    assert.equal(materializedA.text, "[user]\nProcess question A.\n\n[assistant]\nProcess answer A.");
    assert.equal(persistedA.smooth?.generatedAt, DEFAULT_TEST_TIMESTAMP);
    assert.equal(persistedB.smooth?.text, undefined);
    assert.equal(materializedB.text, "[user]\nProcess question B.\n\n[assistant]\nProcess answer B.");
    assert.equal(persistedB.smooth?.generatedAt, "2026-01-02T00:00:00.000Z");
    assert.equal(thread.turnsRevision, 3);
  });
});

test("empty or noise-only sections are omitted without collapsing section order incorrectly", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-noise");

    const user = makeActorRecord({ actorId: "actor-user-noise", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-noise", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool-noise", actorType: "tool" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-noise",
      user,
      toPendingMessage({
        messageId: "message-noise-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "   \n\t   " })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-noise",
      assistant,
      toPendingMessage({
        messageId: "message-noise-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({ partOrder: 1, content: "Keep this response." }),
          makePartRecord({ partOrder: 2, partType: "reasoning", content: "   " }),
        ],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-noise",
      tool,
      toPendingMessage({
        messageId: "message-noise-tool",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [makePartRecord({ partType: "tool_result", content: "tool detail" })],
      }),
    );

    await writeTurns(store, "thread-smooth-noise", [
      makeClosedTurn({
        threadId: "thread-smooth-noise",
        turnId: "turn-noise",
        messages: [prompt, response, toolResult],
      }),
    ]);

    await ensureSmoothTurn({ threadId: "thread-smooth-noise", turnId: "turn-noise" }, { store });
    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-noise", turnId: "turn-noise" },
      { store },
    );

    assert.equal(
      materialized.text,
      "[assistant]\nKeep this response.\n\n[tool]\n{\"output\":\"tool detail\",\"status\":\"success\",\"type\":\"unpaired_tool_result\"}",
    );
    assert.equal(materialized.text?.includes("[user]"), false);
    assert.equal(materialized.text?.includes("[thinking]"), false);
  });
});

test("component-first smooth state exposes readiness, provenance, and materialization", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-components");

    const user = makeActorRecord({ actorId: "actor-user-components", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-components", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool-components", actorType: "tool" });

    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-components",
      user,
      toPendingMessage({
        messageId: "message-components-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "part-components-user", content: "Run the check." })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-components",
      assistant,
      toPendingMessage({
        messageId: "message-components-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [
          makePartRecord({ partId: "part-components-assistant", partOrder: 1, content: "I will run it." }),
          makePartRecord({ partId: "part-components-thinking", partOrder: 2, partType: "reasoning", content: "   " }),
          makePartRecord({ partId: "part-components-tool-call", partOrder: 3, partType: "tool_call", content: { command: "npm test" } }),
        ],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-components",
      tool,
      toPendingMessage({
        messageId: "message-components-tool-result",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [makePartRecord({ partId: "part-components-tool-result", partType: "tool_result", content: "ok" })],
      }),
    );

    await writeTurns(store, "thread-smooth-components", [
      makeClosedTurn({
        threadId: "thread-smooth-components",
        turnId: "turn-components",
        messages: [prompt, response, toolResult],
      }),
    ]);

    const missing = await readSmoothTurnState({ threadId: "thread-smooth-components", turnId: "turn-components" }, { store });
    assert.equal(missing.smoothStatus, "missing");

    const ensured = await ensureSmoothTurn(
      { threadId: "thread-smooth-components", turnId: "turn-components" },
      { store, now: () => new Date(DEFAULT_TEST_TIMESTAMP) },
    );
    assert.equal(ensured.smoothStatus, "ready");

    const state = await readSmoothTurnState({ threadId: "thread-smooth-components", turnId: "turn-components" }, { store });
    assert.equal(state.schemaVersion, "component_smooth_turn_v1");
    assert.equal(state.smoothStatus, "ready");
    const persisted = await readTurn(store, "thread-smooth-components", "turn-components");
    assert.equal(persisted.smooth?.text, undefined);
    assert.deepEqual(state.components?.map((component) => component.kind), [
      "user_prompt",
      "assistant_message",
      "thinking",
      "tool_exchange",
    ]);
    assert.equal(state.components?.find((component) => component.kind === "thinking")?.status, "omitted");
    assert.equal(state.components?.find((component) => component.kind === "assistant_message")?.actorLabel, undefined);
    assert.ok(state.components?.every((component) => component.sourceMessageIds.length > 0));
    assert.ok(state.components?.every((component) => typeof component.sourceRevision === "number"));
    assert.ok(state.components?.every((component) => component.generatedAt === DEFAULT_TEST_TIMESTAMP));

    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-components", turnId: "turn-components" },
      { store },
    );
    assert.equal(materialized.status, "ready");
    assert.match(materialized.text ?? "", /\[user\][\s\S]*\[assistant\][\s\S]*\[tool\]/);
    assert.ok((materialized.tokenCount ?? 0) > 0);
    assert.match(materialized.sourceFingerprint ?? "", /^sha256:/);
    assert.equal(materialized.tokenCountMetadata?.scope, "smooth_turn_materialized");

    const reopened = new FileThreadStore(storeRootDir);
    const persistedState = await readSmoothTurnState(
      { threadId: "thread-smooth-components", turnId: "turn-components" },
      { store: reopened },
    );
    assert.equal(persistedState.components?.find((component) => component.kind === "thinking")?.status, "omitted");
    assert.match(persistedState.materialized?.sourceFingerprint ?? "", /^sha256:/);
  });
});

test("component-first readiness requires canonical assistant and tool source records", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-missing-required-source");

    const user = makeActorRecord({ actorId: "actor-user-missing-required", actorType: "human" });
    const assistant = makeActorRecord({ actorId: "actor-assistant-missing-required", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool-missing-required", actorType: "tool" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-missing-required-source",
      user,
      toPendingMessage({
        messageId: "message-missing-required-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "part-missing-required-user", content: "Run the missing-components case." })],
      }),
    );
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-missing-required-source",
      assistant,
      toPendingMessage({
        messageId: "message-missing-required-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ partId: "part-missing-required-assistant", content: "Running it now." })],
      }),
    );
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-missing-required-source",
      tool,
      toPendingMessage({
        messageId: "message-missing-required-tool",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [makePartRecord({ partId: "part-missing-required-tool", partType: "tool_result", content: "tool result" })],
      }),
    );

    await writeTurns(store, "thread-smooth-missing-required-source", [
      makeClosedTurn({
        threadId: "thread-smooth-missing-required-source",
        turnId: "turn-missing-required",
        messages: [prompt, response, toolResult],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "ready",
          sourceRevision: toolResult.sourceRevision,
          components: [
            {
              componentId: "turn-missing-required:user_prompt:message-missing-required-prompt:part-missing-required-user",
              kind: "user_prompt",
              status: "ready",
              text: "Run the missing-components case.",
              quality: "deterministic_preserved",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-missing-required-user"],
              sourceRevision: prompt.sourceRevision,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
          ],
        },
      }),
    ]);

    const state = await readSmoothTurnState(
      { threadId: "thread-smooth-missing-required-source", turnId: "turn-missing-required" },
      { store },
    );
    assert.equal(state.smoothStatus, "pending");

    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-missing-required-source", turnId: "turn-missing-required" },
      { store },
    );
    assert.equal(materialized.status, "pending");
    assert.equal(materialized.text, undefined);
    assert.deepEqual(materialized.missingComponentIds?.sort(), ["assistant_message", "tool_exchange"]);
  });
});

test("incomplete component-first smooth state does not materialize partial text", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-incomplete-components");

    const user = makeActorRecord({ actorId: "actor-user-incomplete", actorType: "human" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-incomplete-components",
      user,
      toPendingMessage({
        messageId: "message-incomplete-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ partId: "part-incomplete-user", content: "Needs smoothing." })],
      }),
    );

    await writeTurns(store, "thread-smooth-incomplete-components", [
      makeClosedTurn({
        threadId: "thread-smooth-incomplete-components",
        turnId: "turn-incomplete-components",
        messages: [prompt],
        smooth: {
          schemaVersion: "component_smooth_turn_v1",
          status: "pending",
          sourceRevision: prompt.sourceRevision,
          components: [
            {
              componentId: "turn-incomplete-components:user_prompt:message-incomplete-prompt:part-incomplete-user",
              kind: "user_prompt",
              status: "pending",
              sourceMessageIds: [prompt.messageId],
              sourcePartIds: ["part-incomplete-user"],
              sourceRevision: prompt.sourceRevision,
              strategy: "deterministic_user_prompt_preserved_v1",
            },
          ],
        },
      }),
    ]);

    const materialized = await materializeSmoothTurn(
      { threadId: "thread-smooth-incomplete-components", turnId: "turn-incomplete-components" },
      { store },
    );
    assert.equal(materialized.status, "pending");
    assert.equal(materialized.text, undefined);
    assert.deepEqual(materialized.missingComponentIds, [
      "user_prompt",
      "turn-incomplete-components:user_prompt:message-incomplete-prompt:part-incomplete-user",
    ]);
  });
});

test("obsolete monolithic smooth text is treated as missing and replaced", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-obsolete-text");

    const user = makeActorRecord({ actorId: "actor-user-obsolete-text", actorType: "human" });
    const prompt = await appendCanonicalMessage(
      store,
      "thread-smooth-obsolete-text",
      user,
      toPendingMessage({
        messageId: "message-obsolete-text-prompt",
        actorId: user.actorId,
        actorType: user.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ content: "Obsolete input." })],
      }),
    );

    await writeTurns(store, "thread-smooth-obsolete-text", [
      makeClosedTurn({
        threadId: "thread-smooth-obsolete-text",
        turnId: "turn-obsolete-text",
        messages: [prompt],
        smooth: {
          status: "ready",
          text: "[user]\nObsolete input.",
          strategy: "deterministic_marker_sections_v1",
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          sourceRevision: prompt.sourceRevision,
        },
      }),
    ]);

    const state = await readSmoothTurnState(
      { threadId: "thread-smooth-obsolete-text", turnId: "turn-obsolete-text" },
      { store },
    );
    assert.equal(state.smoothStatus, "missing");
    assert.equal(state.smoothText, undefined);

    await ensureSmoothTurn(
      { threadId: "thread-smooth-obsolete-text", turnId: "turn-obsolete-text" },
      { store, now: () => new Date(DEFAULT_TEST_TIMESTAMP) },
    );
    const regenerated = await readSmoothTurnState(
      { threadId: "thread-smooth-obsolete-text", turnId: "turn-obsolete-text" },
      { store },
    );
    assert.equal(regenerated.schemaVersion, "component_smooth_turn_v1");
    assert.equal(regenerated.components?.[0]?.kind, "user_prompt");
    const persisted = await readTurn(store, "thread-smooth-obsolete-text", "turn-obsolete-text");
    assert.equal(persisted.smooth?.text, undefined);
  });
});
