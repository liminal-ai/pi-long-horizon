import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { persistSmoothTurnState } from "../../../src/thread/async-thread/services/smooth-turn-service.js";
import { FileThreadStore } from "../../../src/thread/store/file-thread-store.js";
import type { ThreadSnapshot } from "../../../src/thread/store/thread-store.js";
import type { SmoothTurnComponentState } from "../../../src/thread/async-thread/domain/smooth-turn-state.js";

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
