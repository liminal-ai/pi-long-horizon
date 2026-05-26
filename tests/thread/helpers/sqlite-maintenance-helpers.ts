import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { StewardResult } from "../../../src/thread/domain/errors.js";
import type { MessageRecord, TurnRecord } from "../../../src/thread/domain/records.js";
import type { ChunkState } from "../../../src/thread/async-thread/domain/chunk-state.js";
import { SqliteThreadStore } from "../../../src/thread/store/sqlite-thread-store.js";
import { createSmoothComponentSourceFingerprint } from "../../../src/thread/async-thread/domain/smooth-turn-state.js";
import { materializeSmoothTurnFromState } from "../../../src/thread/async-thread/services/smooth-turn-service.js";
import {
  makeChunkState,
  makeSmoothTurnState,
  makeTurnLowerBandProjection,
} from "../../../src/thread/async-thread/test/fixtures.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  countTurnLowerBandProjectionMaterialized,
  type TokenCountRecord,
} from "../../../src/token-accounting/index.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
  DEFAULT_TEST_TIMESTAMP,
} from "../../../src/context-steward/test/fixtures.js";

export interface SqliteMaintenanceFixture {
  store: SqliteThreadStore;
  threadId: string;
  turnIds: {
    oldest: string;
    middle: string;
    newest: string;
  };
  chunkIds: {
    oldestClosed: string;
    newestClosed: string;
  };
}

export function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function heuristicFromExpected<T extends TokenCountRecord>(expected: T): T {
  return assertTokenCountRecord({
    ...expected,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    provider: undefined,
    model: undefined,
    tokenizer: undefined,
    tokenizerVersion: undefined,
  }) as T;
}

function exactFromExpected<T extends TokenCountRecord>(expected: T, count: number, model = "gpt-test-maintenance"): T {
  return assertTokenCountRecord({
    ...expected,
    count,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model,
    createdAt: DEFAULT_TEST_TIMESTAMP,
    provenance: "tests.thread.sqlite-maintenance-helpers.exact-counter",
  }) as T;
}

function makePendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const { sourceOrder: _sourceOrder, sourceRevision: _sourceRevision, capturedAt: _capturedAt, ...pending } = message;
  return pending;
}

function transcriptFingerprint(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function buildSmoothState(input: {
  threadId: string;
  turnId: string;
  sourceRevision: number;
  promptMessage: MessageRecord;
  responseMessage: MessageRecord;
}): TurnRecord["smooth"] {
  const smoothText = `Prompt ${input.turnId}\n\nResponse ${input.turnId}`;
  const projectionText = `> Prompt ${input.turnId}\n\n● Response ${input.turnId}`;
  const derivedSourceRevision = input.responseMessage.sourceRevision;
  const projectionExpected = countTurnLowerBandProjectionMaterialized({
    text: projectionText,
    sourceRevision: derivedSourceRevision,
    createdAt: DEFAULT_TEST_TIMESTAMP,
  });
  return makeSmoothTurnState({
    threadId: input.threadId,
    turnId: input.turnId,
    sourceRevision: derivedSourceRevision,
    text: smoothText,
    components: [
      {
        componentId: `${input.turnId}:user_prompt:${input.promptMessage.messageId}:${input.promptMessage.parts[0]!.partId}`,
        kind: "user_prompt",
        status: "ready",
        text: `Prompt ${input.turnId}`,
        quality: "deterministic_preserved",
        sourceMessageIds: [input.promptMessage.messageId],
        sourcePartIds: [input.promptMessage.parts[0]!.partId],
        sourceRevision: input.promptMessage.sourceRevision,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
        strategy: "deterministic_user_prompt_preserved_v1",
      },
      {
        componentId: `${input.turnId}:assistant_message:${input.responseMessage.messageId}:${input.responseMessage.parts[0]!.partId}`,
        kind: "assistant_message",
        status: "ready",
        text: `Response ${input.turnId}`,
        quality: "deterministic_preserved",
        sourceMessageIds: [input.responseMessage.messageId],
        sourcePartIds: [input.responseMessage.parts[0]!.partId],
        sourceRevision: input.responseMessage.sourceRevision,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
        strategy: "deterministic_assistant_v1",
      },
    ],
    lowerBandProjection: makeTurnLowerBandProjection({
      text: projectionText,
      sourceRevision: derivedSourceRevision,
      sourceFingerprint: createSmoothComponentSourceFingerprint([
        {
          componentId: `${input.turnId}:user_prompt:${input.promptMessage.messageId}:${input.promptMessage.parts[0]!.partId}`,
          kind: "user_prompt",
          status: "ready",
          text: `Prompt ${input.turnId}`,
          quality: "deterministic_preserved",
          sourceMessageIds: [input.promptMessage.messageId],
          sourcePartIds: [input.promptMessage.parts[0]!.partId],
          sourceRevision: input.promptMessage.sourceRevision,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          strategy: "deterministic_user_prompt_preserved_v1",
        },
        {
          componentId: `${input.turnId}:assistant_message:${input.responseMessage.messageId}:${input.responseMessage.parts[0]!.partId}`,
          kind: "assistant_message",
          status: "ready",
          text: `Response ${input.turnId}`,
          quality: "deterministic_preserved",
          sourceMessageIds: [input.responseMessage.messageId],
          sourcePartIds: [input.responseMessage.parts[0]!.partId],
          sourceRevision: input.responseMessage.sourceRevision,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          strategy: "deterministic_assistant_v1",
        },
      ]),
      tokenCountMetadata: exactFromExpected(projectionExpected, projectionExpected.count),
    }),
  });
}

export class FakeOpenAIInputTokenCounter {
  readonly calls: string[] = [];
  pauseRawTurnIds = new Set<string>();
  rawTurnGate: Promise<void> | undefined;
  failRawTurnIds = new Set<string>();

  async countRawTurnMaterialized(input: { turn: TurnRecord; messages: readonly MessageRecord[]; model?: string }) {
    this.calls.push(`raw:${input.turn.turnId}`);
    if (this.failRawTurnIds.has(input.turn.turnId)) {
      throw new Error(`simulated raw token failure for ${input.turn.turnId}`);
    }
    if (this.pauseRawTurnIds.has(input.turn.turnId) && this.rawTurnGate) {
      await this.rawTurnGate;
    }
    return exactFromExpected(countRawTurnMaterialized({ turn: input.turn, messages: input.messages }), 1_000 + this.calls.length, input.model);
  }

  async countSmoothTurnMaterialized(turn: TurnRecord, options: { model?: string } = {}) {
    this.calls.push(`smooth:${turn.turnId}`);
    return exactFromExpected(countSmoothTurnMaterialized(turn), 2_000 + this.calls.length, options.model);
  }

  async countTurnLowerBandProjectionMaterialized(input: { text: string; sourceRevision?: number; model?: string }) {
    this.calls.push(`projection:${input.sourceRevision ?? "unknown"}`);
    return exactFromExpected(countTurnLowerBandProjectionMaterialized(input), 3_000 + this.calls.length, input.model);
  }

  async countChunkSmoothMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`chunk:${chunk.chunkId}`);
    return exactFromExpected(countChunkSmoothMaterialized(chunk), 4_000 + this.calls.length, options.model);
  }

  async countDetailedChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`detailed:${chunk.chunkId}`);
    return exactFromExpected(countDetailedChunkMaterialized(chunk), 5_000 + this.calls.length, options.model);
  }

  async countBriefChunkMaterialized(chunk: ChunkState, options: { model?: string } = {}) {
    this.calls.push(`brief:${chunk.chunkId}`);
    return exactFromExpected(countBriefChunkMaterialized(chunk), 6_000 + this.calls.length, options.model);
  }
}

export async function seedSqliteMaintenanceFixture(storeRootDir: string): Promise<SqliteMaintenanceFixture> {
  const store = new SqliteThreadStore(storeRootDir);
  const threadId = "thread-sqlite-maintenance-001";
  expectOk(
    await store.createThread({
      thread: makeThreadRecord({
        threadId,
        target: makeThreadTarget({
          sessionId: "session-sqlite-maintenance-001",
          sessionFilePath: `${storeRootDir}/generated/session-sqlite-maintenance-001.jsonl`,
        }),
        status: { turnState: "ready" },
      }),
      targetRef: {
        runtime: "pi",
        sessionId: "session-sqlite-maintenance-001",
      },
    }),
  );

  const human = makeActorRecord({ actorId: "actor-human", actorType: "human" });
  const agent = makeActorRecord({ actorId: "actor-agent", actorType: "agent" });
  expectOk(await store.upsertActor(threadId, human));
  expectOk(await store.upsertActor(threadId, agent));

  const prompts: MessageRecord[] = [];
  const responses: MessageRecord[] = [];
  for (const turnId of ["turn-oldest", "turn-middle", "turn-newest"] as const) {
    prompts.push(expectOk(await store.appendMessage({
      threadId,
      actor: human,
      message: makePendingMessage({
        threadId,
        messageId: `message-${turnId}-prompt`,
        actorId: human.actorId,
        actorType: human.actorType,
        messageKind: "prompt",
        parts: [makePartRecord({ partId: `part-${turnId}-prompt`, content: `Prompt ${turnId}` })],
      }),
    })));
    responses.push(expectOk(await store.appendMessage({
      threadId,
      actor: agent,
      message: makePendingMessage({
        threadId,
        messageId: `message-${turnId}-response`,
        actorId: agent.actorId,
        actorType: agent.actorType,
        messageKind: "response",
        parts: [makePartRecord({ partId: `part-${turnId}-response`, content: `Response ${turnId}` })],
      }),
    })));
  }

  const sourceRevision = responses.at(-1)!.sourceRevision;
  const promptByTurn = new Map([
    ["turn-oldest", prompts[0]!],
    ["turn-middle", prompts[1]!],
    ["turn-newest", prompts[2]!],
  ]);
  const responseByTurn = new Map([
    ["turn-oldest", responses[0]!],
    ["turn-middle", responses[1]!],
    ["turn-newest", responses[2]!],
  ]);

  const turns = (["turn-oldest", "turn-middle", "turn-newest"] as const).map((turnId, index) => {
    const prompt = promptByTurn.get(turnId)!;
    const response = responseByTurn.get(turnId)!;
    const smooth = buildSmoothState({
      threadId,
      turnId,
      sourceRevision,
      promptMessage: prompt,
      responseMessage: response,
    });
    const turnWithSmooth = makeTurnRecord({
      threadId,
      turnId,
      turnOrder: index + 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: prompt.messageId,
      messageIds: [prompt.messageId, response.messageId],
      sourceRange: { fromSourceOrder: prompt.sourceOrder, toSourceOrder: response.sourceOrder },
      openedAt: DEFAULT_TEST_TIMESTAMP,
      closedAt: DEFAULT_TEST_TIMESTAMP,
      sourceRevision,
      smooth,
    });
    return {
      ...turnWithSmooth,
      rawTokenCountMetadata: heuristicFromExpected(countRawTurnMaterialized({ turn: turnWithSmooth, messages: [prompt, response] })),
      smooth: {
        ...smooth,
        tokenCountMetadata: heuristicFromExpected(countSmoothTurnMaterialized({
          ...turnWithSmooth,
          smooth: {
            ...smooth,
            text: `Prompt ${turnId}\n\nResponse ${turnId}`,
          },
        })),
      },
    };
  });
  expectOk(await store.writeTurns({
    threadId,
    expectedSourceRevision: sourceRevision,
    expectedMessageHighWatermark: responses.at(-1)!.sourceOrder,
    expectedTurnsRevision: 0,
    turns,
    turnState: "ready",
  }));

  const oldestSmoothText = [
    materializeSmoothTurnFromState({ turn: turns[0]!, messages: [prompts[0]!, responses[0]!] }).text!,
    materializeSmoothTurnFromState({ turn: turns[1]!, messages: [prompts[1]!, responses[1]!] }).text!,
  ].join("\n\n");
  const newestSmoothText = materializeSmoothTurnFromState({
    turn: turns[2]!,
    messages: [prompts[2]!, responses[2]!],
  }).text!;
  const oldestTranscriptText = [
    turns[0]!.smooth!.lowerBandProjection!.text,
    turns[1]!.smooth!.lowerBandProjection!.text,
  ].join("\n\n");
  const newestTranscriptText = turns[2]!.smooth!.lowerBandProjection!.text!;

  const chunkOldest = makeChunkState({
    threadId,
    chunkId: "chunk-oldest-closed",
    sourceTurnIds: ["turn-oldest", "turn-middle"],
    sourceRevision,
    smoothText: oldestSmoothText,
    conversationTranscript: {
      status: "ready",
      text: oldestTranscriptText,
      sourceRevision,
      sourceFingerprint: transcriptFingerprint(oldestTranscriptText),
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
  });
  const chunkNewest = makeChunkState({
    threadId,
    chunkId: "chunk-newest-closed",
    sourceTurnIds: ["turn-newest"],
    sourceRevision,
    smoothText: newestSmoothText,
    conversationTranscript: {
      status: "ready",
      text: newestTranscriptText,
      sourceRevision,
      sourceFingerprint: transcriptFingerprint(newestTranscriptText),
      updatedAt: DEFAULT_TEST_TIMESTAMP,
    },
  });
  const chunks = [chunkOldest, chunkNewest].map((chunk) => ({
    ...chunk,
    smoothTokenCountMetadata: heuristicFromExpected(countChunkSmoothMaterialized(chunk)),
    lowerBand: {
      ...(chunk.lowerBand ?? {}),
      detailed: chunk.lowerBand?.detailed
        ? {
            ...chunk.lowerBand.detailed,
            tokenCountMetadata: heuristicFromExpected(countDetailedChunkMaterialized(chunk)),
          }
        : undefined,
      brief: chunk.lowerBand?.brief
        ? {
            ...chunk.lowerBand.brief,
            tokenCountMetadata: heuristicFromExpected(countBriefChunkMaterialized(chunk)),
          }
        : undefined,
    },
  }));
  expectOk(await store.writeChunks({
    threadId,
    expectedSourceRevision: sourceRevision,
    expectedMessageHighWatermark: responses.at(-1)!.sourceOrder,
    expectedTurnsRevision: 1,
    chunks,
  }));

  return {
    store,
    threadId,
    turnIds: {
      oldest: "turn-oldest",
      middle: "turn-middle",
      newest: "turn-newest",
    },
    chunkIds: {
      oldestClosed: "chunk-oldest-closed",
      newestClosed: "chunk-newest-closed",
    },
  };
}
