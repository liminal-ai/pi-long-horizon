import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { CHUNK_SCHEMA_VERSION, type ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { ensureLowerBandTurnProjection } from "../../src/thread/async-thread/services/lower-band-turn-projection-service.js";
import {
  LOWER_BAND_BRIEF_PROMPT_VERSION,
  LOWER_BAND_DETAIL_PROMPT_VERSION,
  LowerBandCompressionService,
  type LowerBandCompressionProviderInput,
} from "../../src/thread/async-thread/services/lower-band-compression-service.js";
import { ensureSmoothTurn } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { updateChunkState } from "../../src/thread/async-thread/services/chunk-service.js";
import { estimateDeterministicTokenCount } from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { fail, type StewardResult } from "../../src/thread/domain/errors.js";
import type { ActorRecord, MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import {
  assertTokenCountRecord,
  createMaterializedRepresentationHash,
  type TurnLowerBandProjectionMaterializedTokenCountRecord,
} from "../../src/token-accounting/index.js";
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

class FakeProjectionCounter {
  async countTurnLowerBandProjectionMaterialized(input: {
    text: string;
    sourceRevision?: number;
    model?: string;
  }): Promise<TurnLowerBandProjectionMaterializedTokenCountRecord> {
    return assertTokenCountRecord({
      count: estimateDeterministicTokenCount(input.text),
      scope: "turn_lower_band_projection_materialized",
      source: "provider_input_count",
      trustClass: "exact",
      provider: "openai",
      model: input.model ?? "gpt-test-lower-band",
      representationHash: createMaterializedRepresentationHash(input.text),
      sourceRevision: input.sourceRevision,
      createdAt: DEFAULT_TEST_TIMESTAMP,
      provenance: "tests.thread.lower-band-compression-service.fake-projection-counter",
    }) as TurnLowerBandProjectionMaterializedTokenCountRecord;
  }
}

const fakeProjectionCounter = new FakeProjectionCounter();

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

async function writeTurns(store: FileThreadStore, threadId: string, turns: TurnRecord[]) {
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

async function readTurns(store: FileThreadStore, threadId: string): Promise<TurnRecord[]> {
  return expectOk(await store.readTurns(threadId));
}

async function readTurn(store: FileThreadStore, threadId: string, turnId: string): Promise<TurnRecord> {
  const turn = (await readTurns(store, threadId)).find((candidate) => candidate.turnId === turnId);
  assert.ok(turn);
  return turn;
}

async function readChunks(store: FileThreadStore, threadId: string): Promise<ChunkState[]> {
  return expectOk(await store.readChunks(threadId));
}

async function readChunk(store: FileThreadStore, threadId: string, chunkId: string): Promise<ChunkState> {
  const chunk = (await readChunks(store, threadId)).find((candidate) => candidate.chunkId === chunkId);
  assert.ok(chunk);
  return chunk;
}

async function appendClosedProjectedTurn(
  store: FileThreadStore,
  input: {
    threadId: string;
    turnId: string;
    userText: string;
    assistantText?: string;
  },
): Promise<TurnRecord> {
  const user = makeActorRecord({ actorId: "actor-user", actorType: "human", displayName: "User" });
  const assistant = makeActorRecord({ actorId: "actor-assistant", actorType: "agent", displayName: "Assistant" });
  const prompt = await appendCanonicalMessage(
    store,
    input.threadId,
    user,
    toPendingMessage({
      messageId: `${input.turnId}-prompt`,
      actorId: user.actorId,
      actorType: user.actorType,
      messageKind: "prompt",
      createdAt: DEFAULT_TEST_TIMESTAMP,
      parts: [makePartRecord({ partId: `${input.turnId}-user-part`, content: input.userText })],
    }),
  );

  const messages = [prompt];
  if (input.assistantText) {
    const response = await appendCanonicalMessage(
      store,
      input.threadId,
      assistant,
      toPendingMessage({
        messageId: `${input.turnId}-response`,
        actorId: assistant.actorId,
        actorType: assistant.actorType,
        messageKind: "response",
        createdAt: DEFAULT_TEST_TIMESTAMP,
        parts: [makePartRecord({ partId: `${input.turnId}-assistant-part`, content: input.assistantText })],
      }),
    );
    messages.push(response);
  }

  const existingTurns = await readTurns(store, input.threadId);
  const lastMessage = messages[messages.length - 1]!;
  await writeTurns(store, input.threadId, [
    ...existingTurns,
    makeTurnRecord({
      turnId: input.turnId,
      threadId: input.threadId,
      turnOrder: existingTurns.length + 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: prompt.messageId,
      messageIds: messages.map((message) => message.messageId),
      sourceRange: {
        fromSourceOrder: prompt.sourceOrder,
        toSourceOrder: lastMessage.sourceOrder,
      },
      openedAt: prompt.createdAt ?? prompt.capturedAt,
      closedAt: lastMessage.createdAt ?? lastMessage.capturedAt,
      sourceRevision: lastMessage.sourceRevision,
    }),
  ]);

  await ensureSmoothTurn(
    {
      threadId: input.threadId,
      turnId: input.turnId,
    },
    {
      store,
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    },
  );
  await ensureLowerBandTurnProjection(
    {
      threadId: input.threadId,
      turnId: input.turnId,
    },
    {
      store,
      openAIInputTokenCounter: fakeProjectionCounter,
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    },
  );

  return readTurn(store, input.threadId, input.turnId);
}

async function seedClosedChunk(
  store: FileThreadStore,
  input: {
    threadId: string;
    chunkId: string;
    transcriptText: string;
    lowerBand?: {
      detailed?: { band: "detailed"; status: "ready" | "pending" | "failed"; text?: string; updatedAt?: string };
      brief?: { band: "brief"; status: "ready" | "pending" | "failed"; text?: string; updatedAt?: string };
    };
  },
): Promise<void> {
  const thread = expectOk(await store.assertCanMutate(input.threadId));
  expectOk(
    await store.writeChunks({
      threadId: input.threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      chunks: [
        {
          chunkId: input.chunkId,
          threadId: input.threadId,
          schemaVersion: CHUNK_SCHEMA_VERSION,
          lifecycleStatus: "closed",
          sourceTurnIds: ["turn-001"],
          smoothText: "Combined smooth text for the closed chunk.",
          openedAt: DEFAULT_TEST_TIMESTAMP,
          closedAt: DEFAULT_TEST_TIMESTAMP,
          closeReason: "hard_max",
          sourceRevision: 1,
          conversationTranscript: {
            status: "ready",
            text: input.transcriptText,
            sourceFingerprint: "sha256:test-closed-chunk-transcript",
            sourceRevision: 1,
            updatedAt: DEFAULT_TEST_TIMESTAMP,
          },
          lowerBand: input.lowerBand,
        },
      ],
    }),
  );
}

test("chunk close schedules async detailed and brief lower-band generation without waiting on provider latency", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-schedule";
    await createThread(store, threadId);
    const firstTurn = await appendClosedProjectedTurn(store, {
      threadId,
      turnId: "turn-close-trigger-a",
      userText: "Summarize this chunk close without blocking the close path.",
      assistantText: "The provider work should run in the background after close.",
    });
    const secondTurn = await appendClosedProjectedTurn(store, {
      threadId,
      turnId: "turn-close-trigger-b",
      userText: "Use the second turn only to force the first chunk to close.",
      assistantText: "The first chunk should close before this turn is appended.",
    });
    const originalWriteChunks = store.writeChunks.bind(store);
    let transientBriefReadyWriteFailures = 0;
    let injectTransientBriefReadyWriteFailure = false;
    store.writeChunks = (async (input) => {
      const closedChunk = input.chunks.find((chunk) => chunk.chunkId === "chunk-001");
      if (
        injectTransientBriefReadyWriteFailure &&
        transientBriefReadyWriteFailures === 0 &&
        closedChunk?.lowerBand?.brief?.status === "ready"
      ) {
        transientBriefReadyWriteFailures += 1;
        return fail({
          code: "STORE_UNAVAILABLE",
          message: "thread mutation failed.",
          threadId,
          cause: "simulated transient lower-band artifact write race",
        });
      }

      return originalWriteChunks(input);
    }) as FileThreadStore["writeChunks"];

    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          await providerGate;
          if (input.band === "brief") {
            injectTransientBriefReadyWriteFailure = true;
          }
          return {
            text: input.band === "detailed" ? "Detailed async lower-band output." : "Brief async lower-band output.",
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 75,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });
    let releaseProvider: () => void = () => {};
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const closePath = updateChunkState(
      { threadId },
      {
        store,
        settings: {
          targetMinSmoothTokens: firstTurn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 1,
          targetSoftMaxSmoothTokens:
            (firstTurn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 1) +
            (secondTurn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 1) -
            1,
          hardMaxSmoothTokens:
            (firstTurn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 1) +
            (secondTurn.smooth?.lowerBandProjection?.tokenCountMetadata?.count ?? 1) +
            10,
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
        lowerBandCompressionScheduler: service,
      },
    );
    const closePathResult = await Promise.race([
      closePath.then(() => "closed" as const),
      sleep(1_000).then(() => "blocked" as const),
    ]);
    releaseProvider();
    assert.equal(closePathResult, "closed", "expected close path to return while provider work was still blocked");
    await closePath;

    await waitForAssertion(async () => {
      const closedChunk = (await readChunks(store, threadId)).find((chunk) => chunk.chunkId === "chunk-001");
      assert.ok(closedChunk);
      assert.equal(closedChunk.lowerBand?.detailed?.status, "ready");
      assert.equal(closedChunk.lowerBand?.brief?.status, "ready");
      assert.equal(closedChunk.lowerBand?.detailed?.text, "Detailed async lower-band output.");
      assert.equal(closedChunk.lowerBand?.brief?.text, "Brief async lower-band output.");
    }, "expected async lower-band generation to finish after chunk close");
    assert.equal(transientBriefReadyWriteFailures, 1);
  });
});

test("detailed and brief generation use separate prompts while reading the same transcript source", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-prompts";
    const chunkId = "chunk-prompts";
    const transcriptText = "> User asks for a semantic compression.\n\n● Assistant explains the chosen plan.";
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const calls: LowerBandCompressionProviderInput[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          calls.push(input);
          return {
            text: input.band === "detailed" ? "Detailed prose summary." : "Brief.",
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 5,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      mode: "async_close",
    });

    assert.equal(result.transcriptReady, true);
    assert.equal(result.detailedReady, true);
    assert.equal(result.briefReady, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.band, "detailed");
    assert.equal(calls[0]?.promptVersion, LOWER_BAND_DETAIL_PROMPT_VERSION);
    assert.equal(calls[1]?.band, "brief");
    assert.equal(calls[1]?.promptVersion, LOWER_BAND_BRIEF_PROMPT_VERSION);
    assert.equal(calls[0]?.transcriptText, transcriptText);
    assert.equal(calls[1]?.transcriptText, transcriptText);
    assert.notEqual(calls[1]?.transcriptText, "Detailed prose summary.");

    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.text, "Detailed prose summary.");
    assert.equal(persisted.lowerBand?.brief?.text, "Brief.");
  });
});

test("routing uses ceil(chars divided by 3.5) and persists lean semantic artifact state", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-routing";
    const chunkId = "chunk-routing";
    const transcriptText = "a".repeat(3_501);
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const calls: LowerBandCompressionProviderInput[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          calls.push(input);
          return {
            text: "D".repeat(700),
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 3,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.detailedReady, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.modelId, "gpt-5.4-mini");
    assert.equal(calls[0]?.reasoningEffort, "medium");

    const persisted = await readChunk(store, threadId, chunkId);
    assert.deepEqual(
      Object.keys(persisted.lowerBand?.detailed ?? {}).sort(),
      ["band", "status", "text", "tokenCountMetadata", "updatedAt"],
    );
  });
});

test("oversized transcript warns on stderr and truncates provider input to the 4,000 estimated-token ceiling", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-truncate";
    const chunkId = "chunk-truncate";
    const transcriptText = "x".repeat(15_000);
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const warnings: string[] = [];
    let capturedTranscriptLength = 0;
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const service = new LowerBandCompressionService({
        store,
        provider: {
          async compress(input) {
            capturedTranscriptLength = input.transcriptText.length;
            return {
              text: "Brief truncated summary.",
              providerId: "openai-codex",
              modelId: input.modelId,
              reasoningEffort: input.reasoningEffort,
              promptVersion: input.promptVersion,
              elapsedMs: 2,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            };
          },
        },
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      });

      await service.run({
        threadId,
        chunkId,
        requiredBands: ["brief"],
        mode: "async_close",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.ok(warnings.some((warning) => warning.includes("exceeded 4000 estimated tokens")));
    assert.equal(capturedTranscriptLength, 14_000);
  });
});

test("detailed size misses retry with previous output text, target range, and landing feedback", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-detailed-size-retry";
    const chunkId = "chunk-detailed-size-retry";
    const transcriptText = "d".repeat(700);
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const calls: LowerBandCompressionProviderInput[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          calls.push({ ...input, retryContext: input.retryContext ? { ...input.retryContext } : undefined });
          return {
            text: calls.length === 1 ? "x".repeat(20) : "y".repeat(140),
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 3,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.detailedReady, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.retryContext, undefined);
    assert.equal(calls[1]?.retryContext?.previousAttempt, 1);
    assert.equal(calls[1]?.retryContext?.attempt, 2);
    assert.equal(calls[1]?.retryContext?.acceptedRange?.min, 30);
    assert.equal(calls[1]?.retryContext?.acceptedRange?.max, 100);
    assert.equal(calls[1]?.retryContext?.previousEstimatedTokens, 6);
    assert.equal(calls[1]?.retryContext?.rangeDisposition, "below_range");
    assert.equal(calls[1]?.retryContext?.previousOutputText, "x".repeat(20));
    assert.equal(calls[1]?.modelId, calls[0]?.modelId);
    assert.equal(calls[1]?.reasoningEffort, calls[0]?.reasoningEffort);

    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.status, "ready");
    assert.equal(persisted.lowerBand?.detailed?.text, "y".repeat(140));
  });
});

test("brief size misses retry with previous output text, target range, and landing feedback", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-brief-size-retry";
    const chunkId = "chunk-brief-size-retry";
    const transcriptText = "b".repeat(700);
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const calls: LowerBandCompressionProviderInput[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          calls.push({ ...input, retryContext: input.retryContext ? { ...input.retryContext } : undefined });
          return {
            text: calls.length === 1 ? "x".repeat(200) : "z".repeat(70),
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 3,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["brief"],
      mode: "async_close",
    });

    assert.equal(result.briefReady, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.retryContext?.previousAttempt, 1);
    assert.equal(calls[1]?.retryContext?.attempt, 2);
    assert.equal(calls[1]?.retryContext?.acceptedRange?.min, 2);
    assert.equal(calls[1]?.retryContext?.acceptedRange?.max, 40);
    assert.equal(calls[1]?.retryContext?.previousEstimatedTokens, 58);
    assert.equal(calls[1]?.retryContext?.rangeDisposition, "above_range");
    assert.equal(calls[1]?.retryContext?.previousOutputText, "x".repeat(200));
    assert.equal(calls[1]?.modelId, calls[0]?.modelId);
    assert.equal(calls[1]?.reasoningEffort, calls[0]?.reasoningEffort);

    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.brief?.status, "ready");
    assert.equal(persisted.lowerBand?.brief?.text, "z".repeat(70));
  });
});

test("third lower-band size attempt escalates to GPT-5.5 medium and accepts the first escalated response", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-escalation";
    const chunkId = "chunk-escalation";
    const transcriptText = "e".repeat(700);
    await createThread(store, threadId);
    await seedClosedChunk(store, { threadId, chunkId, transcriptText });

    const calls: LowerBandCompressionProviderInput[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress(input) {
          calls.push({ ...input, retryContext: input.retryContext ? { ...input.retryContext } : undefined });
          return {
            text: calls.length < 3 ? "x".repeat(20) : "q".repeat(10),
            providerId: "openai-codex",
            modelId: input.modelId,
            reasoningEffort: input.reasoningEffort,
            promptVersion: input.promptVersion,
            elapsedMs: 3,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.detailedReady, true);
    assert.equal(result.blockers.length, 0);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.modelId, "gpt-5.4-mini");
    assert.equal(calls[0]?.reasoningEffort, "low");
    assert.equal(calls[1]?.modelId, "gpt-5.4-mini");
    assert.equal(calls[1]?.reasoningEffort, "low");
    assert.equal(calls[2]?.modelId, "gpt-5.5");
    assert.equal(calls[2]?.reasoningEffort, "medium");
    assert.equal(calls[2]?.retryContext?.previousAttempt, 2);
    assert.equal(calls[2]?.retryContext?.acceptedRange?.min, 30);
    assert.equal(calls[2]?.retryContext?.acceptedRange?.max, 100);
    assert.equal(calls[2]?.retryContext?.rangeDisposition, "below_range");
    assert.equal(calls[2]?.retryContext?.previousOutputText, "x".repeat(20));

    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.status, "ready");
    assert.equal(persisted.lowerBand?.detailed?.text, "q".repeat(10));
    assert.deepEqual(
      Object.keys(persisted.lowerBand?.detailed ?? {}).sort(),
      ["band", "status", "text", "tokenCountMetadata", "updatedAt"],
    );
  });
});

test("provider failures leave pending state during retries before succeeding", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-retry-pending";
    const chunkId = "chunk-retry-pending";
    await createThread(store, threadId);
    await seedClosedChunk(store, {
      threadId,
      chunkId,
      transcriptText: "> User asks for retry behavior.\n\n● Assistant wants the band to stay pending until retry succeeds.",
    });

    let attempts = 0;
    const debugMessages: string[] = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress() {
          attempts += 1;
          if (attempts === 1) {
            const persisted = await readChunk(store, threadId, chunkId);
            assert.equal(persisted.lowerBand?.detailed?.status, "pending");
            throw new Error("temporary provider outage");
          }

          return {
            text: "Detailed retry success summary.",
            providerId: "openai-codex",
            modelId: "gpt-5.4-mini",
            reasoningEffort: "low",
            promptVersion: LOWER_BAND_DETAIL_PROMPT_VERSION,
            elapsedMs: 4,
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          };
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      logger: {
        error() {
          assert.fail("did not expect an exhausted error log");
        },
        debug(message) {
          debugMessages.push(message);
        },
      },
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.detailedReady, true);
    assert.equal(attempts, 2);
    assert.ok(debugMessages.some((message) => message.includes("will retry")));
    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.status, "ready");
    assert.equal(persisted.lowerBand?.detailed?.text, "Detailed retry success summary.");
  });
});

test("exhausted provider failures persist failed lower-band state with the last error", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-lower-band-failed";
    const chunkId = "chunk-failed";
    await createThread(store, threadId);
    await seedClosedChunk(store, {
      threadId,
      chunkId,
      transcriptText: "> User asks for explicit failure state.\n\n● Assistant expects the final error to persist.",
    });

    let attempts = 0;
    const debugMessages: string[] = [];
    const errorMessages: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const service = new LowerBandCompressionService({
      store,
      provider: {
        async compress() {
          attempts += 1;
          throw Object.assign(new Error("provider refused request"), { code: "MODEL_UNAVAILABLE" });
        },
      },
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      logger: {
        debug(message) {
          debugMessages.push(message);
        },
        error(message, details) {
          errorMessages.push({ message, details });
        },
      },
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.detailedReady, false);
    assert.equal(result.briefReady, false);
    assert.equal(result.blockers.length, 1);
    assert.equal(attempts, 3);
    assert.equal(debugMessages.filter((message) => message.includes("will retry")).length, 2);
    assert.equal(errorMessages.length, 1);

    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.status, "failed");
    assert.equal(persisted.lowerBand?.detailed?.errorCode, "MODEL_UNAVAILABLE");
    assert.equal(persisted.lowerBand?.detailed?.errorMessage, "provider refused request");
    assert.equal(persisted.lowerBand?.detailed?.text, undefined);
  });
});
