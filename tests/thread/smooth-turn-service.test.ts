import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ensureSmoothTurn,
  persistSmoothTurnState,
  readSmoothTurnState,
} from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { buildSmoothTurnText } from "../../src/thread/async-thread/services/smooth-turn-format.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ThreadSnapshot } from "../../src/thread/store/thread-store.js";
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
  const formatted = buildSmoothTurnText(messages);

  return {
    turnId,
    threadId: snapshot.thread.threadId,
    status: "ready" as const,
    text: formatted.text,
    tokenCount: formatted.tokenCount,
    strategy: formatted.strategy,
    generatedAt,
    sourceRevision: turn.sourceRevision,
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
    assert.equal(persisted.smooth?.strategy, "deterministic_marker_sections_v1");
    assert.equal(persisted.smooth?.generatedAt, DEFAULT_TEST_TIMESTAMP);
    assert.equal(persisted.smooth?.sourceRevision, response.sourceRevision);
    assert.match(persisted.smooth?.text ?? "", /\[user\][\s\S]*\[assistant\]/);
    assert.equal(persisted.smooth?.tokenCount, result.smoothTokenCount);
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
    const persisted = await readTurn(store, "thread-smooth-markers", "turn-markers");

    assert.equal(
      persisted.smooth?.text,
      "[user]\nSummarize the flow.\n\n[assistant]\nI will inspect the thread.\n\n[thinking]\nChain of thought\n\n[tool]\ntool output",
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

    assert.equal(typeof persisted.smooth?.text, "string");
    assert.equal(persisted.smooth?.text?.includes("Answer part one.\nAnswer part two."), true);
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
    const first = await readTurn(store, "thread-smooth-whitespace", "turn-whitespace");

    await ensureSmoothTurn({ threadId: "thread-smooth-whitespace", turnId: "turn-whitespace" }, { store });
    const second = await readTurn(store, "thread-smooth-whitespace", "turn-whitespace");

    assert.equal(first.smooth?.text, second.smooth?.text);
    assert.equal(
      first.smooth?.text,
      "[user]\nNeed stable spacing\n\n[assistant]\nSpacing stays deterministic.",
    );
  });
});

test("tool-output handling follows fixed policy", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    await createThread(store, "thread-smooth-tool");

    const assistant = makeActorRecord({ actorId: "actor-assistant-tool", actorType: "agent" });
    const tool = makeActorRecord({ actorId: "actor-tool", actorType: "tool" });
    const response = await appendCanonicalMessage(
      store,
      "thread-smooth-tool",
      assistant,
      toPendingMessage({
        messageId: "message-tool-response",
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        parts: [makePartRecord({ content: "Running the command now." })],
      }),
    );
    const oversizedToolOutput = Array.from({ length: 100 }, (_, index) => `token${index + 1}`).join(" ");
    const toolResult = await appendCanonicalMessage(
      store,
      "thread-smooth-tool",
      tool,
      toPendingMessage({
        messageId: "message-tool-result",
        actorId: tool.actorId,
        actorType: tool.actorType,
        messageKind: "tool_result",
        parts: [makePartRecord({ partType: "tool_result", content: oversizedToolOutput })],
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
    const persisted = await readTurn(store, "thread-smooth-tool", "turn-tool");

    assert.equal(
      persisted.smooth?.text?.includes("[tool]\ntoken1 token2 token3"),
      true,
    );
    assert.equal(
      persisted.smooth?.text?.includes("[tool output truncated by deterministic policy]"),
      true,
    );
    assert.equal(persisted.smooth?.text?.includes("token100"), false);
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
          tokenCount: 99,
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
    assert.equal(before.smoothStatus, "invalid");

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
    assert.equal(persisted.smooth?.strategy, "deterministic_marker_sections_v1");
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

    assert.equal(persistedA.smooth?.text, smoothA.text);
    assert.equal(persistedA.smooth?.generatedAt, smoothA.generatedAt);
    assert.equal(persistedB.smooth?.text, smoothB.text);
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

    assert.equal(persistedA.smooth?.text, "[user]\nProcess question A.\n\n[assistant]\nProcess answer A.");
    assert.equal(persistedA.smooth?.generatedAt, DEFAULT_TEST_TIMESTAMP);
    assert.equal(persistedB.smooth?.text, "[user]\nProcess question B.\n\n[assistant]\nProcess answer B.");
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
    const persisted = await readTurn(store, "thread-smooth-noise", "turn-noise");

    assert.equal(
      persisted.smooth?.text,
      "[assistant]\nKeep this response.\n\n[tool]\ntool detail",
    );
    assert.equal(persisted.smooth?.text?.includes("[user]"), false);
    assert.equal(persisted.smooth?.text?.includes("[thinking]"), false);
  });
});
