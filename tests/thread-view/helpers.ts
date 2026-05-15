import assert from "node:assert/strict";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import {
  assertTokenCountRecord,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  type TokenCountRecord,
  type TokenCountScope,
} from "../../src/token-accounting/index.js";
import type { TurnSmoothRecord } from "../../src/thread/domain/records.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { materializeSmoothTurnFromState } from "../../src/thread/async-thread/services/smooth-turn-service.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../../src/thread/services/thread-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import { estimateCompactedTextTokenCount } from "../../src/thread-view/services/pi-token-estimator.js";
import { DEFAULT_TEST_TIMESTAMP, makeBandRecord, makeThreadView } from "../../src/thread-view/test/fixtures.js";
import { makeChunkState, makePlaceholderArtifactState } from "../../src/thread/async-thread/test/fixtures.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";

interface SeededTurn {
  turnId: string;
  messages: MessageRecord[];
}

export interface SeededThreadContext {
  threadId: string;
  threadStore: FileThreadStore;
  threadViewStore: FileThreadViewStore;
  turns: {
    oldest: SeededTurn;
    middleOlder: SeededTurn;
    middleNewer: SeededTurn;
    newest: SeededTurn;
  };
  chunks: {
    oldestClosed: string;
    newerClosed: string;
    openRecent: string;
  };
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function makePendingMessage(overrides: Partial<MessageRecord> = {}) {
  const message = makeMessageRecord(overrides);
  const {
    sourceOrder: _sourceOrder,
    sourceRevision: _sourceRevision,
    capturedAt: _capturedAt,
    ...pendingMessage
  } = message;
  return pendingMessage;
}

function buildTokenText(prefix: string, tokenCount: number): string {
  return Array.from({ length: tokenCount }, (_, index) => `${index % 10}`).join(" ");
}

function estimatedTokenCount(text: string): number {
  return estimateCompactedTextTokenCount(text);
}

function makeComponentSmooth(input: {
  turnId: string;
  messages: readonly MessageRecord[];
  text?: string;
  sourceRevision?: number;
}): TurnSmoothRecord {
  const sourceRevision = input.sourceRevision ?? 1;
  const text = input.text ?? "s";
  const components = input.messages.flatMap((message) =>
    message.parts.map((part, partIndex) => {
      const kind = message.actorType === "human" || message.messageKind === "prompt"
        ? "user_prompt"
        : "assistant_message";
      return {
        componentId: `${input.turnId}:${kind}:${message.messageId}:${part.partId}`,
        kind,
        status: "ready",
        text: partIndex === 0 ? text : `${text} ${partIndex + 1}`,
        quality: "deterministic_preserved",
        sourceMessageIds: [message.messageId],
        sourcePartIds: [part.partId],
        sourceRevision: message.sourceRevision,
        generatedAt: DEFAULT_TEST_TIMESTAMP,
        strategy: kind === "assistant_message"
          ? "deterministic_assistant_v1"
          : "deterministic_user_prompt_preserved_v1",
      } as NonNullable<TurnSmoothRecord["components"]>[number];
    }),
  );
  return {
    schemaVersion: "component_smooth_turn_v1",
    status: "ready",
    strategy: "component_smooth_turn_v1",
    generatedAt: DEFAULT_TEST_TIMESTAMP,
    sourceRevision,
    components,
  };
}

function testTokenCountMetadata(count: number, scope: TokenCountScope, sourceRevision = 1) {
  return {
    count,
    scope,
    source: "pi_heuristic" as const,
    trustClass: "heuristic_estimate" as const,
    representationHash: `sha256:test-${scope}-${count}`,
    sourceRevision,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function providerInputCountFromExpected(expected: TokenCountRecord): TokenCountRecord {
  return assertTokenCountRecord({
    count: expected.count,
    scope: expected.scope,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: "gpt-test",
    representationHash: expected.representationHash,
    sourceRevision: expected.sourceRevision,
    createdAt: expected.createdAt,
    provenance: "tests.thread-view.helpers.provider-input-count",
  });
}

function withProviderInputCounts(
  turn: TurnRecord,
  messages: readonly MessageRecord[],
): TurnRecord {
  const raw = providerInputCountFromExpected(countRawTurnMaterialized({ turn, messages }));
  const materializedSmooth = materializeSmoothTurnFromState({ turn, messages });
  const turnWithSmoothText =
    turn.smooth && materializedSmooth.text
      ? { ...turn, smooth: { ...turn.smooth, text: materializedSmooth.text } }
      : turn;
  const smooth = turn.smooth
    ? {
        ...turn.smooth,
        tokenCountMetadata: providerInputCountFromExpected(countSmoothTurnMaterialized(turnWithSmoothText)),
      }
    : undefined;

  return {
    ...turn,
    rawTokenCountMetadata: raw,
    smooth,
  };
}

function withProviderInputChunkCounts(chunk: ChunkState): ChunkState {
  const placeholders = chunk.placeholders
    ? {
        ...chunk.placeholders,
        detailed: chunk.placeholders.detailed
          ? {
              ...chunk.placeholders.detailed,
              tokenCountMetadata: providerInputCountFromExpected(countDetailedChunkMaterialized(chunk)),
            }
          : undefined,
        brief: chunk.placeholders.brief
          ? {
              ...chunk.placeholders.brief,
              tokenCountMetadata: providerInputCountFromExpected(countBriefChunkMaterialized(chunk)),
            }
          : undefined,
      }
    : undefined;

  const nextChunk = {
    ...chunk,
    placeholders,
  };

  return {
    ...nextChunk,
    smoothTokenCountMetadata: chunk.smoothText
      ? providerInputCountFromExpected(countChunkSmoothMaterialized(nextChunk))
      : chunk.smoothTokenCountMetadata,
  };
}

async function appendThreadMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actorId: string;
  actorType: "human" | "agent";
  displayName: string;
  messageId: string;
  messageKind: MessageRecord["messageKind"];
  partId: string;
  content: string;
}) {
  return expectOk(
    await appendSourceMessage({
      store: input.store,
      threadId: input.threadId,
      actor: makeActorRecord({
        actorId: input.actorId,
        actorType: input.actorType,
        displayName: input.displayName,
      }),
      message: makePendingMessage({
        threadId: input.threadId,
        messageId: input.messageId,
        actorId: input.actorId,
        actorType: input.actorType,
        messageKind: input.messageKind,
        parts: [
          makePartRecord({
            partId: input.partId,
            content: input.content,
          }),
        ],
      }),
    }),
  );
}

async function seedTurn(input: {
  store: FileThreadStore;
  threadId: string;
  turnId: string;
  turnOrder: number;
  promptTokens: number;
  responseTokens: number;
  smoothText?: string;
  smoothTokenCount?: number;
}): Promise<SeededTurn> {
  const prompt = await appendThreadMessage({
    store: input.store,
    threadId: input.threadId,
    actorId: "actor-human-thread-view",
    actorType: "human",
    displayName: "Steward",
    messageId: `${input.turnId}-prompt`,
    messageKind: "prompt",
    partId: `${input.turnId}-prompt-part`,
    content: buildTokenText(`${input.turnId}-p`, input.promptTokens),
  });
  const response = await appendThreadMessage({
    store: input.store,
    threadId: input.threadId,
    actorId: "actor-agent-thread-view",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: `${input.turnId}-response`,
    messageKind: "response",
    partId: `${input.turnId}-response-part`,
    content: buildTokenText(`${input.turnId}-r`, input.responseTokens),
  });

  return {
    turnId: input.turnId,
    messages: [prompt, response],
  };
}

export async function seedDeterministicRebuildThread(storeRootDir: string): Promise<SeededThreadContext> {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-thread-view-builder",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const oldest = await seedTurn({
    store: threadStore,
    threadId: thread.threadId,
    turnId: "turn-oldest",
    turnOrder: 1,
    promptTokens: 2,
    responseTokens: 2,
  });
  const middleOlder = await seedTurn({
    store: threadStore,
    threadId: thread.threadId,
    turnId: "turn-middle-older",
    turnOrder: 2,
    promptTokens: 4,
    responseTokens: 4,
  });
  const middleNewer = await seedTurn({
    store: threadStore,
    threadId: thread.threadId,
    turnId: "turn-middle-newer",
    turnOrder: 3,
    promptTokens: 28,
    responseTokens: 28,
  });
  const newest = await seedTurn({
    store: threadStore,
    threadId: thread.threadId,
    turnId: "turn-newest",
    turnOrder: 4,
    promptTokens: 1,
    responseTokens: 1,
  });

  const initialSnapshot = expectOk(await threadStore.openThread(thread.threadId));
  expectOk(
    await threadStore.writeTurns({
      threadId: thread.threadId,
      expectedSourceRevision: initialSnapshot.thread.sourceRevision,
      expectedMessageHighWatermark: initialSnapshot.thread.messageHighWatermark,
      expectedTurnsRevision: initialSnapshot.thread.turnsRevision,
      turns: ([
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: oldest.turnId,
          turnOrder: 1,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: oldest.messages[0].messageId,
          messageIds: oldest.messages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: oldest.messages[0].sourceOrder,
            toSourceOrder: oldest.messages[1].sourceOrder,
          },
          sourceRevision: 1,
          openedAt: oldest.messages[0].capturedAt,
          closedAt: oldest.messages[1].capturedAt,
          smooth: makeComponentSmooth({
            turnId: oldest.turnId,
            messages: oldest.messages,
          }),
        }),
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: middleOlder.turnId,
          turnOrder: 2,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: middleOlder.messages[0].messageId,
          messageIds: middleOlder.messages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: middleOlder.messages[0].sourceOrder,
            toSourceOrder: middleOlder.messages[1].sourceOrder,
          },
          sourceRevision: 1,
          openedAt: middleOlder.messages[0].capturedAt,
          closedAt: middleOlder.messages[1].capturedAt,
          smooth: makeComponentSmooth({
            turnId: middleOlder.turnId,
            messages: middleOlder.messages,
          }),
        }),
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: middleNewer.turnId,
          turnOrder: 3,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: middleNewer.messages[0].messageId,
          messageIds: middleNewer.messages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: middleNewer.messages[0].sourceOrder,
            toSourceOrder: middleNewer.messages[1].sourceOrder,
          },
          sourceRevision: 1,
          openedAt: middleNewer.messages[0].capturedAt,
          closedAt: middleNewer.messages[1].capturedAt,
          smooth: makeComponentSmooth({
            turnId: middleNewer.turnId,
            messages: middleNewer.messages,
          }),
        }),
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: newest.turnId,
          turnOrder: 4,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: newest.messages[0].messageId,
          messageIds: newest.messages.map((message) => message.messageId),
          sourceRange: {
            fromSourceOrder: newest.messages[0].sourceOrder,
            toSourceOrder: newest.messages[1].sourceOrder,
          },
          sourceRevision: 1,
          openedAt: newest.messages[0].capturedAt,
          closedAt: newest.messages[1].capturedAt,
          smooth: makeComponentSmooth({
            turnId: newest.turnId,
            messages: newest.messages,
          }),
        }),
      ] as TurnRecord[]).map((turn) => {
        const seededTurn =
          turn.turnId === oldest.turnId
            ? oldest
            : turn.turnId === middleOlder.turnId
              ? middleOlder
              : turn.turnId === middleNewer.turnId
                ? middleNewer
                : newest;
        return withProviderInputCounts(turn, seededTurn.messages);
      }),
      turnState: "ready",
    }),
  );

  const postTurnsSnapshot = expectOk(await threadStore.openThread(thread.threadId));
  expectOk(
    await threadStore.writeChunks({
      threadId: thread.threadId,
      expectedSourceRevision: postTurnsSnapshot.thread.sourceRevision,
      expectedMessageHighWatermark: postTurnsSnapshot.thread.messageHighWatermark,
      expectedTurnsRevision: postTurnsSnapshot.thread.turnsRevision,
      chunks: ([
        makeChunkState({
          chunkId: "chunk-oldest-closed",
          threadId: thread.threadId,
          sourceTurnIds: [oldest.turnId],
          smoothText: "oldest closed chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("oldest closed chunk smooth text"), "chunk_smooth_materialized", 1),
          placeholders: makePlaceholderArtifactState({
            threadId: thread.threadId,
            chunkId: "chunk-oldest-closed",
            detailed: {
              kind: "detailed",
              status: "ready",
              text: "oldest detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]",
              tokenCountMetadata: testTokenCountMetadata(
                estimatedTokenCount("oldest detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]"),
                "detailed_chunk_materialized",
                1,
              ),
              strategy: "deterministic_truncate_30",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
            brief: {
              kind: "brief",
              status: "ready",
              text: "oldest brief [deterministic-placeholder:brief] [not-semantic-summary]",
              tokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("oldest brief [deterministic-placeholder:brief] [not-semantic-summary]"), "brief_chunk_materialized", 1),
              strategy: "deterministic_truncate_5",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
          }),
        }),
        makeChunkState({
          chunkId: "chunk-newer-closed",
          threadId: thread.threadId,
          sourceTurnIds: [middleOlder.turnId],
          smoothText: "newer closed chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("newer closed chunk smooth text"), "chunk_smooth_materialized", 1),
          placeholders: makePlaceholderArtifactState({
            threadId: thread.threadId,
            chunkId: "chunk-newer-closed",
            detailed: {
              kind: "detailed",
              status: "ready",
              text: "newer detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]",
              tokenCountMetadata: testTokenCountMetadata(
                estimatedTokenCount("newer detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]"),
                "detailed_chunk_materialized",
                1,
              ),
              strategy: "deterministic_truncate_30",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
            brief: {
              kind: "brief",
              status: "ready",
              text: "newer brief [deterministic-placeholder:brief] [not-semantic-summary]",
              tokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("newer brief [deterministic-placeholder:brief] [not-semantic-summary]"), "brief_chunk_materialized", 1),
              strategy: "deterministic_truncate_5",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
          }),
        }),
        makeChunkState({
          chunkId: "chunk-open-recent",
          threadId: thread.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [middleNewer.turnId],
          smoothText: "open recent chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("open recent chunk smooth text"), "chunk_smooth_materialized", 1),
          placeholders: undefined,
        }),
      ] as ChunkState[]).map(withProviderInputChunkCounts),
    }),
  );

  return {
    threadId: thread.threadId,
    threadStore,
    threadViewStore,
    turns: {
      oldest,
      middleOlder,
      middleNewer,
      newest,
    },
    chunks: {
      oldestClosed: "chunk-oldest-closed",
      newerClosed: "chunk-newer-closed",
      openRecent: "chunk-open-recent",
    },
  };
}

export async function seedNoClosedChunkThread(storeRootDir: string) {
  const context = await seedDeterministicRebuildThread(storeRootDir);
  const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
  expectOk(
    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: "chunk-open-only",
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.middleOlder.turnId],
          smoothText: "open only chunk",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("open only chunk"), "chunk_smooth_materialized", 1),
          placeholders: undefined,
        }),
      ],
    }),
  );

  return context;
}

export async function seedMissingDetailedPlaceholderThread(storeRootDir: string) {
  const context = await seedDeterministicRebuildThread(storeRootDir);
  const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
  expectOk(
    await context.threadStore.writeChunks({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      chunks: [
        makeChunkState({
          chunkId: context.chunks.oldestClosed,
          threadId: context.threadId,
          sourceTurnIds: [context.turns.oldest.turnId],
          smoothText: "oldest closed chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("oldest closed chunk smooth text"), "chunk_smooth_materialized", 1),
        }),
        makeChunkState({
          chunkId: context.chunks.newerClosed,
          threadId: context.threadId,
          sourceTurnIds: [context.turns.middleOlder.turnId],
          smoothText: "newer closed chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("newer closed chunk smooth text"), "chunk_smooth_materialized"),
          placeholders: {
            chunkId: context.chunks.newerClosed,
            threadId: context.threadId,
            detailed: {
              kind: "detailed",
              status: "missing",
              strategy: "deterministic_truncate_30",
            },
            brief: {
              kind: "brief",
              status: "ready",
              text: "newer brief [deterministic-placeholder:brief] [not-semantic-summary]",
              tokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("newer brief [deterministic-placeholder:brief] [not-semantic-summary]"), "brief_chunk_materialized"),
              strategy: "deterministic_truncate_5",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
          },
        }),
        makeChunkState({
          chunkId: context.chunks.openRecent,
          threadId: context.threadId,
          lifecycleStatus: "open",
          sourceTurnIds: [context.turns.middleNewer.turnId],
          smoothText: "open recent chunk smooth text",
          smoothTokenCountMetadata: testTokenCountMetadata(estimatedTokenCount("open recent chunk smooth text"), "chunk_smooth_materialized", 1),
          placeholders: undefined,
        }),
      ],
    }),
  );

  return context;
}

export function makeSelectedLowerBandView(input: {
  threadId: string;
  threadViewId?: string;
  fullTurnId?: string;
  smoothTurnId?: string;
  detailedChunkIds?: string[];
  briefChunkIds?: string[];
}) {
  return makeThreadView({
    threadId: input.threadId,
    threadViewId: input.threadViewId,
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: input.fullTurnId ? [input.fullTurnId] : [],
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: input.smoothTurnId ? [input.smoothTurnId] : [],
    }),
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: input.detailedChunkIds ?? [],
      sourceUnitType: "chunk",
    }),
    briefBand: makeBandRecord({
      bandType: "brief",
      selectedIds: input.briefChunkIds ?? [],
      sourceUnitType: "chunk",
    }),
  });
}
