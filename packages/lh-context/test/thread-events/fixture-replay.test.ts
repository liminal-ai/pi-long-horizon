import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ThreadEventStore } from "../../src/thread-events/store.js";
import { countLocalTokens } from "../../src/token-counting/local-token-counter.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/thread-events/basic-session/events.json", import.meta.url),
);

interface BasicSessionFixture {
  clientThreadId: string;
  events: readonly unknown[];
}

function tempThreadDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "lhx-thread-events-fixture-")), "thread.sqlite");
}

function loadFixture(): BasicSessionFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as BasicSessionFixture;
}

function expectLocalTokenizerMetadata(metadata: unknown): void {
  expect(metadata).toMatchObject({
    source: "local_tokenizer",
    trustClass: "tokenizer_count",
    encodingMethod: "tiktoken:o200k_base",
    tokenizerModel: "o200k_base",
  });
  expect((metadata as { count?: unknown } | undefined)?.count).toEqual(expect.any(Number));
  expect((metadata as { count?: number } | undefined)?.count).toBeGreaterThan(0);
}

describe("thread-events fixture replay", () => {
  it("replays the canonical basic-session fixture, materializes turns/chunks, and remains idempotent after reopen", async () => {
    const fixture = loadFixture();
    const dbPath = tempThreadDbPath();
    const store = new ThreadEventStore({
      eventDbPath: dbPath,
      worker: {
        lowerBandProjectionTokenCounter: {
          async countTurnLowerBandProjection(input) {
            return { count: countLocalTokens(input.text) };
          },
        },
      },
    });

    try {
      const created = await store.createThread({
        clientThreadId: fixture.clientThreadId,
        title: "Basic fixture session",
      });
      expect(created.created).toBe(true);

      const append = await store.appendMany(fixture);
      expect(append.ok).toBe(true);
      expect(append.results).toHaveLength(fixture.events.length);
      expect(append.results.every((result) => result.ok && !result.duplicate)).toBe(true);

      expect((await store.list()).map((event) => event.eventKind)).toEqual([
        "thread_created",
        "user_prompt",
        "assistant_thinking",
        "tool_call",
        "tool_result",
        "assistant_text",
        "turn_end",
        "user_prompt",
        "assistant_text",
        "turn_end",
      ]);

      const firstProcessed = await store.processNextTurnEndTrigger();
      const secondProcessed = await store.processNextTurnEndTrigger();
      expect(firstProcessed).toMatchObject({ completed: true, retryable: false });
      expect(secondProcessed).toMatchObject({ completed: true, retryable: false });
      expect(await store.processNextTurnEndTrigger()).toMatchObject({
        completed: false,
        reason: "no_pending_trigger",
      });

      const read = await store.readThread(fixture.clientThreadId);
      expect(read?.messages.map((message) => message.messageKind)).toEqual([
        "user",
        "assistant",
        "assistant",
        "tool_result",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(read?.messages.flatMap((message) => message.blocks.map((block) => block.blockKind))).toEqual([
        "text",
        "thinking",
        "tool_call",
        "tool_result",
        "text",
        "text",
        "text",
      ]);

      const triggers = await store.listTurnProcessingTriggers();
      expect(triggers.map((trigger) => trigger.status)).toEqual(["complete", "complete"]);
      expect(triggers.map((trigger) => trigger.turnEndEventOrder)).toEqual([7, 10]);

      const turns = await store.readTurns(fixture.clientThreadId);
      expect(turns).toHaveLength(2);
      expect(turns.map((turn) => turn.processingStatus)).toEqual(["ready", "ready"]);
      expect(turns.map((turn) => turn.messageIds.length)).toEqual([5, 2]);
      for (const turn of turns) {
        expectLocalTokenizerMetadata(turn.rawTokenCountMetadata);
        expectLocalTokenizerMetadata(turn.smooth?.tokenCountMetadata);
      }

      const chunks = await store.readChunks(fixture.clientThreadId);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        chunkOrder: 1,
        lifecycleStatus: "open",
        sourceTurnIds: turns.map((turn) => turn.turnId),
      });
      expectLocalTokenizerMetadata(chunks[0]?.smoothTokenCountMetadata);

      const countsBeforeReplay = {
        events: (await store.list()).length,
        messages: read?.messages.length,
        blocks: read?.messages.reduce((sum, message) => sum + message.blocks.length, 0),
        triggers: triggers.length,
        turns: turns.length,
        chunks: chunks.length,
      };

      store.close();

      const reopened = new ThreadEventStore({ eventDbPath: dbPath });
      try {
        expect((await reopened.list()).length).toBe(countsBeforeReplay.events);
        expect((await reopened.readThread(fixture.clientThreadId))?.messages).toHaveLength(countsBeforeReplay.messages ?? 0);
        expect(await reopened.readTurns(fixture.clientThreadId)).toHaveLength(countsBeforeReplay.turns);
        expect(await reopened.readChunks(fixture.clientThreadId)).toHaveLength(countsBeforeReplay.chunks);

        const replay = await reopened.appendMany(fixture);
        expect(replay.ok).toBe(true);
        expect(replay.results).toHaveLength(fixture.events.length);
        expect(replay.results.every((result) => result.ok && result.duplicate)).toBe(true);

        const replayRead = await reopened.readThread(fixture.clientThreadId);
        expect((await reopened.list()).length).toBe(countsBeforeReplay.events);
        expect(replayRead?.messages).toHaveLength(countsBeforeReplay.messages ?? 0);
        expect(replayRead?.messages.reduce((sum, message) => sum + message.blocks.length, 0)).toBe(
          countsBeforeReplay.blocks,
        );
        expect(await reopened.listTurnProcessingTriggers()).toHaveLength(countsBeforeReplay.triggers);
        expect(await reopened.readTurns(fixture.clientThreadId)).toHaveLength(countsBeforeReplay.turns);
        expect(await reopened.readChunks(fixture.clientThreadId)).toHaveLength(countsBeforeReplay.chunks);
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });
});
