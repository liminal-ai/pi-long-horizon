import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { persistSmoothTurnState } from "../../../src/thread/async-thread/services/smooth-turn-service.js";
import { buildSmoothTurnText } from "../../../src/thread/async-thread/services/smooth-turn-format.js";
import { FileThreadStore } from "../../../src/thread/store/file-thread-store.js";
import type { ThreadSnapshot } from "../../../src/thread/store/thread-store.js";

function env(name: string): string {
  const value = process.env[name];
  assert.ok(value, `Missing required env var ${name}`);
  return value;
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

function buildGeneratedSmoothState(snapshot: ThreadSnapshot, turnId: string, generatedAt: string) {
  const turn = snapshot.turns.find((candidate) => candidate.turnId === turnId);
  assert.ok(turn, `Turn ${turnId} not found.`);

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

async function main(): Promise<void> {
  const storeRootDir = env("STORE_ROOT_DIR");
  const threadId = env("THREAD_ID");
  const turnId = env("TURN_ID");
  const generatedAt = env("GENERATED_AT");
  const readyFilePath = env("READY_FILE_PATH");
  const goFilePath = env("GO_FILE_PATH");

  const store = new FileThreadStore(storeRootDir);
  const initialSnapshot = await store.openThread(threadId);
  assert.equal(initialSnapshot.ok, true, initialSnapshot.ok ? undefined : initialSnapshot.issues[0]?.message);

  const smooth = buildGeneratedSmoothState(initialSnapshot.value, turnId, generatedAt);
  const originalOpenThread = store.openThread.bind(store);
  let intercepted = false;

  store.openThread = async (candidateThreadId: string) => {
    const snapshotResult = await originalOpenThread(candidateThreadId);
    if (!intercepted && candidateThreadId === threadId) {
      intercepted = true;
      await writeFile(readyFilePath, `${turnId}\n`, "utf8");
      await waitForFile(goFilePath).catch(() => undefined);
    }

    return snapshotResult;
  };

  await persistSmoothTurnState(
    {
      threadId,
      turnId,
      expectedSourceRevision: initialSnapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: initialSnapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: initialSnapshot.value.thread.turnsRevision,
      smooth,
    },
    { store },
  );
}

await main();
