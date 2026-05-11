import assert from "node:assert/strict";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { MessageRecord } from "../../src/thread/domain/records.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../../src/thread/services/thread-service.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import { DEFAULT_TEST_TIMESTAMP, makeBandRecord, makeThreadView } from "../../src/thread-view/test/fixtures.js";
import { makeChunkState, makePlaceholderArtifactState } from "../../src/thread/async-thread/test/fixtures.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { formatSmoothTurnFromMessages } from "../../src/thread-view/services/thread-view-materializer.js";

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
  return Array.from({ length: tokenCount }, (_, index) => `${prefix}${index + 1}`).join(" ");
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
      turns: [
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
          sourceRevision: newest.messages[1].sourceRevision,
          openedAt: oldest.messages[0].capturedAt,
          closedAt: oldest.messages[1].capturedAt,
          smooth: {
            text: formatSmoothTurnFromMessages(oldest.messages),
            tokenCount: 4,
            strategy: "deterministic_marker_sections_v1",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            sourceRevision: newest.messages[1].sourceRevision,
          },
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
          sourceRevision: newest.messages[1].sourceRevision,
          openedAt: middleOlder.messages[0].capturedAt,
          closedAt: middleOlder.messages[1].capturedAt,
          smooth: {
            text: "middle older smooth compact",
            tokenCount: 4,
            strategy: "deterministic_marker_sections_v1",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            sourceRevision: newest.messages[1].sourceRevision,
          },
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
          sourceRevision: newest.messages[1].sourceRevision,
          openedAt: middleNewer.messages[0].capturedAt,
          closedAt: middleNewer.messages[1].capturedAt,
          smooth: {
            text: "middle newer smooth compact",
            tokenCount: 3,
            strategy: "deterministic_marker_sections_v1",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            sourceRevision: newest.messages[1].sourceRevision,
          },
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
          sourceRevision: newest.messages[1].sourceRevision,
          openedAt: newest.messages[0].capturedAt,
          closedAt: newest.messages[1].capturedAt,
          smooth: {
            text: "newest smooth compact",
            tokenCount: 3,
            strategy: "deterministic_marker_sections_v1",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            sourceRevision: newest.messages[1].sourceRevision,
          },
        }),
      ],
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
      chunks: [
        makeChunkState({
          chunkId: "chunk-oldest-closed",
          threadId: thread.threadId,
          sourceTurnIds: [oldest.turnId],
          smoothText: "oldest closed chunk smooth text",
          smoothTokenCount: 6,
          placeholders: makePlaceholderArtifactState({
            threadId: thread.threadId,
            chunkId: "chunk-oldest-closed",
            detailed: {
              kind: "detailed",
              status: "ready",
              text: "oldest detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]",
              tokenCount: 7,
              strategy: "deterministic_truncate_30",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
            brief: {
              kind: "brief",
              status: "ready",
              text: "oldest brief [deterministic-placeholder:brief] [not-semantic-summary]",
              tokenCount: 4,
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
          smoothTokenCount: 7,
          placeholders: makePlaceholderArtifactState({
            threadId: thread.threadId,
            chunkId: "chunk-newer-closed",
            detailed: {
              kind: "detailed",
              status: "ready",
              text: "newer detailed placeholder [deterministic-placeholder:detailed] [not-semantic-summary]",
              tokenCount: 8,
              strategy: "deterministic_truncate_30",
              generatedAt: DEFAULT_TEST_TIMESTAMP,
            },
            brief: {
              kind: "brief",
              status: "ready",
              text: "newer brief [deterministic-placeholder:brief] [not-semantic-summary]",
              tokenCount: 4,
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
          smoothTokenCount: 5,
          placeholders: undefined,
        }),
      ],
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
          smoothTokenCount: 4,
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
          smoothTokenCount: 6,
        }),
        makeChunkState({
          chunkId: context.chunks.newerClosed,
          threadId: context.threadId,
          sourceTurnIds: [context.turns.middleOlder.turnId],
          smoothText: "newer closed chunk smooth text",
          smoothTokenCount: 7,
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
              tokenCount: 4,
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
          smoothTokenCount: 5,
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
