import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord } from "../../src/context-steward/domain/records.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { WorkbenchSearchService } from "../../src/context-workbench/services/workbench-search-service.js";
import { FileThreadViewStore } from "../../src/context-workbench/store/file-thread-view-store.js";
import {
  makeBandRecord,
  makeThreadView,
  makeThreadViewMessage,
} from "../../src/context-workbench/test/fixtures.js";
import type { SearchResultSummary, ThreadViewRecord } from "../../src/context-workbench/domain/thread-view-records.js";
import { withTempWorkbenchStore } from "../../src/context-workbench/test/temp-workbench-store.js";

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

function assertSummaryShape(result: SearchResultSummary) {
  assert.deepEqual(
    Object.keys(result).sort(),
    ["relationshipHints", "resultId", "resultType", "status", "summaryText", "title"],
  );
}

async function appendThreadMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actorId: string;
  actorType: "human" | "agent";
  displayName: string;
  messageId: string;
  messageKind: MessageRecord["messageKind"];
  parts: ReturnType<typeof makePartRecord>[];
}): Promise<MessageRecord> {
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
        parts: input.parts,
      }),
    }),
  );
}

async function writeThreadTurns(store: FileThreadStore, threadId: string, turns: ReturnType<typeof makeTurnRecord>[]) {
  const snapshot = expectOk(await store.openThread(threadId));
  return expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns,
      turnState: "ready",
    }),
  );
}

async function writeProjectionForView(store: FileThreadStore, view: ThreadViewRecord) {
  return expectOk(
    await store.writeProjectionRevision({
      revisionId: `projection_${view.threadViewId}`,
      threadId: view.threadId,
      threadViewId: view.threadViewId,
      targetRuntime: "pi",
      generatedFilePath: `/tmp/${view.threadViewId}.jsonl`,
      createdAt: view.updatedAt,
      sourceStateReference: view.sourceStateReference,
      status: view.status === "ready" ? "available" : "stale",
      compactSnapshot: {
        schemaVersion: "projection.compact-snapshot.v1",
        sourceStateReference: view.sourceStateReference,
        bands: {
          full_fidelity: view.fullFidelityBand,
          smooth: view.smoothBand,
          detailed: view.detailedBand,
          brief: view.briefBand,
        },
        generatedEntries: view.emittedMessages.map((message, index) => ({
          index,
          generatedSource: message.sourceKind,
          role: message.sourceKind === "raw_turn_message" ? "custom" : "assistant",
          sourceReference: message.sourceReference,
          threadViewMessageId: message.threadViewMessageId,
          metadata: {
            bandType: message.bandType,
            sourceKind: message.sourceKind,
            sourceReference: message.sourceReference,
            threadViewMessageId: message.threadViewMessageId,
          },
        })),
      },
    }),
  );
}

async function seedSearchFixture(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const searchService = new WorkbenchSearchService(threadStore, threadViewStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-search-skim",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const longSummaryText =
    "Skim summary starts here and stays recognizable even when the result row truncates the trailing payload. ".repeat(4);

  const promptOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-search",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-search-001",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-search-001",
        partOrder: 1,
        partType: "text",
        content: "Alpha architecture question opens the search surface.",
      }),
    ],
  });
  const responseOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-search",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-search-002",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-search-002",
        partOrder: 1,
        partType: "text",
        content: "Alpha architecture answer points to the runtime bridge and capture seam.",
      }),
    ],
  });
  const promptTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-search",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-search-003",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-search-003",
        partOrder: 1,
        partType: "text",
        content: "Beta migration question needs follow-up in the draft view.",
      }),
    ],
  });
  const responseTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-search",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-search-004",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-search-004",
        partOrder: 1,
        partType: "text",
        content: "Beta migration response keeps the active view lean and stages the rest in a draft.",
      }),
    ],
  });
  const promptThree = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-search",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-search-005",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-search-005",
        partOrder: 1,
        partType: "text",
        content: longSummaryText,
      }),
    ],
  });

  const turns = await writeThreadTurns(threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-search-001",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: promptOne.messageId,
      messageIds: [promptOne.messageId, responseOne.messageId],
      sourceRange: { fromSourceOrder: promptOne.sourceOrder, toSourceOrder: responseOne.sourceOrder },
      sourceRevision: promptThree.sourceRevision,
      openedAt: promptOne.capturedAt,
      closedAt: responseOne.capturedAt,
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-search-002",
      turnOrder: 2,
      lifecycleStatus: "open",
      repairStatus: "ready",
      initiatingMessageId: promptTwo.messageId,
      messageIds: [promptTwo.messageId, responseTwo.messageId],
      sourceRange: { fromSourceOrder: promptTwo.sourceOrder, toSourceOrder: responseTwo.sourceOrder },
      sourceRevision: promptThree.sourceRevision,
      openedAt: promptTwo.capturedAt,
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-search-003",
      turnOrder: 3,
      lifecycleStatus: "open",
      repairStatus: "ready",
      initiatingMessageId: promptThree.messageId,
      messageIds: [promptThree.messageId],
      sourceRange: { fromSourceOrder: promptThree.sourceOrder, toSourceOrder: promptThree.sourceOrder },
      sourceRevision: promptThree.sourceRevision,
      openedAt: promptThree.capturedAt,
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Active Alpha View",
    purpose: "Track alpha runtime context in the active lane.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[0].turnId],
      renderedStatus: "ready",
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: [turns[1].turnId],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: turns[0].turnId,
        content: "Alpha active context output",
      }),
    ],
    status: "ready",
  });
  const draftView = makeThreadView({
    threadId: thread.threadId,
    state: "draft",
    name: "Draft Beta View",
    purpose: "Stage beta comparison output before activation.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[1].turnId],
      renderedStatus: "ready",
    }),
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: ["chunk-search-001"],
      renderedStatus: "unknown",
    }),
    status: "incomplete",
  });
  const archivedView = makeThreadView({
    threadId: thread.threadId,
    state: "archived",
    name: "Archived Research View",
    purpose: "Historical gamma context for earlier experiments.",
    status: "unknown",
  });
  expectOk(await threadViewStore.createThreadView({ view: activeView }));
  expectOk(await threadViewStore.createThreadView({ view: draftView }));
  expectOk(await threadViewStore.createThreadView({ view: archivedView }));
  await writeProjectionForView(threadStore, draftView);
  await writeProjectionForView(threadStore, archivedView);
  await writeProjectionForView(threadStore, activeView);

  return {
    searchService,
    thread,
    messages: {
      promptOne,
      responseOne,
      promptTwo,
      responseTwo,
      promptThree,
    },
    turns: {
      first: turns[0],
      second: turns[1],
      third: turns[2],
    },
    views: {
      active: activeView,
      draft: draftView,
      archived: archivedView,
    },
    longSummaryText,
  };
}

test("message search returns matching messages", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, messages } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        query: "alpha architecture answer",
      }),
    );

    assert.equal(results[0]?.resultId, messages.responseOne.messageId);
  });
});

test("turn search returns matching turns", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, turns } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "turn",
        query: "beta migration response",
      }),
    );

    assert.equal(results[0]?.resultId, turns.second.turnId);
  });
});

test("Thread View search returns matching views", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, views } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "thread_view",
        query: views.draft.threadViewId,
      }),
    );

    assert.equal(results[0]?.resultId, views.draft.threadViewId);
  });
});

test("metadata filters narrow message, turn, and Thread View results", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, messages, turns, views } = await seedSearchFixture(storeRootDir);

    const messageResults = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        filters: {
          actorType: "human",
          sourceOrderFrom: messages.promptTwo.sourceOrder,
        },
      }),
    );
    const turnResults = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "turn",
        filters: {
          lifecycleStatus: "open",
          turnOrderFrom: 2,
        },
      }),
    );
    const viewResults = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "thread_view",
        filters: {
          state: "archived",
        },
      }),
    );

    assert.deepEqual(
      messageResults.map((result) => result.resultId),
      [messages.promptTwo.messageId, messages.promptThree.messageId],
    );
    assert.deepEqual(
      turnResults.map((result) => result.resultId),
      [turns.second.turnId, turns.third.turnId],
    );
    assert.deepEqual(
      viewResults.map((result) => result.resultId),
      [views.draft.threadViewId, views.archived.threadViewId],
    );
  });
});

test("message skim rows show leading recognizable content instead of the full payload", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, messages, longSummaryText } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        query: "Skim summary starts here",
      }),
    );
    const summary = results.find((result) => result.resultId === messages.promptThree.messageId);

    assert.ok(summary);
    assert.match(summary.summaryText, /^Skim summary starts here/);
    assert.ok(summary.summaryText.length < longSummaryText.length);
  });
});

test("turn skim rows stay summary-shaped rather than returning raw turn payloads", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread } = await seedSearchFixture(storeRootDir);

    const [summary] = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "turn",
        query: "beta migration response",
      }),
    );

    assertSummaryShape(summary);
    assert.match(summary.summaryText, /^2 messages • Beta migration question/);
    assert.equal("messages" in summary, false);
  });
});

test("Thread View results show state and purpose for quick skim decisions", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, views } = await seedSearchFixture(storeRootDir);

    const [summary] = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "thread_view",
        query: views.draft.threadViewId,
      }),
    );

    assert.equal(summary.resultId, views.draft.threadViewId);
    assert.equal(summary.status, "archived");
    assert.match(summary.summaryText, /Projection compact snapshot/);
  });
});

test("message search results include a turn relationship hint", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, turns } = await seedSearchFixture(storeRootDir);

    const [summary] = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        query: "alpha architecture answer",
      }),
    );

    assert.ok(summary.relationshipHints?.some((hint) => hint.includes(`Turn 1 (${turns.first.turnId})`)));
  });
});

test("turn search results include current Thread View relationship hints when applicable", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, views } = await seedSearchFixture(storeRootDir);

    const [summary] = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "turn",
        query: "beta migration response",
      }),
    );

    assert.ok(summary.relationshipHints?.some((hint) => hint.includes(`active view Projection projection_${views.active.threadViewId}`)));
    assert.ok(summary.relationshipHints?.some((hint) => hint.includes(`archived view Projection projection_${views.draft.threadViewId}`)));
  });
});

test("long result sets stay summary-shaped without forcing full-detail payloads", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
      }),
    );

    assert.ok(results.length >= 5);
    results.forEach(assertSummaryShape);
  });
});

test("empty search results are explicit and return an empty list", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        query: "no matching search phrase",
      }),
    );

    assert.deepEqual(results, []);
  });
});

test("equal-score metadata matches keep a stable source-order ordering", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, messages } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        filters: {
          messageKind: "prompt",
        },
      }),
    );

    assert.deepEqual(
      results.map((result) => result.resultId),
      [messages.promptOne.messageId, messages.promptTwo.messageId, messages.promptThree.messageId],
    );
  });
});

test("skim summaries omit full-detail payloads from long result sets", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { searchService, thread, messages, longSummaryText } = await seedSearchFixture(storeRootDir);

    const results = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
      }),
    );
    const summary = results.find((result) => result.resultId === messages.promptThree.messageId);

    assert.ok(summary);
    assert.notEqual(summary.summaryText, longSummaryText);
    assert.equal("parts" in summary, false);
    assert.equal("message" in summary, false);
  });
});
