import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord } from "../../src/context-steward/domain/records.js";
import {
  appendSourceMessage,
  openOrCreateManagedThread,
} from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { ThreadViewActivationService } from "../../src/context-workbench/services/thread-view-activation-service.js";
import { WorkbenchQueryService } from "../../src/context-workbench/services/workbench-query-service.js";
import { WorkbenchSearchService } from "../../src/context-workbench/services/workbench-search-service.js";
import { FileThreadViewStore } from "../../src/context-workbench/store/file-thread-view-store.js";
import {
  makeBandRecord,
  makeThreadView,
  makeThreadViewMessage,
} from "../../src/context-workbench/test/fixtures.js";
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

async function appendThreadMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actorId: string;
  actorType: "human" | "agent";
  displayName: string;
  messageId: string;
  messageKind: MessageRecord["messageKind"];
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
        parts: [makePartRecord({ content: input.content })],
      }),
    }),
  );
}

async function writeTurns(store: FileThreadStore, threadId: string, turns: ReturnType<typeof makeTurnRecord>[]) {
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

async function seedPersistedWorkbenchThread(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-file-thread-view-store-integration",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const promptOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-integration",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-integration-001",
    messageKind: "prompt",
    content: "Pull the alpha rollout context into the active lane.",
  });
  const responseOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-integration",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-integration-002",
    messageKind: "response",
    content: "Alpha rollout context is stable enough for the active view.",
  });
  const promptTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-integration",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-integration-003",
    messageKind: "prompt",
    content: "Prepare the beta comparison in a draft.",
  });
  const responseTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-integration",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-integration-004",
    messageKind: "response",
    content: "Beta comparison can replace the active lane after review.",
  });

  const turns = await writeTurns(threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-integration-001",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: promptOne.messageId,
      messageIds: [promptOne.messageId, responseOne.messageId],
      sourceRange: {
        fromSourceOrder: promptOne.sourceOrder,
        toSourceOrder: responseOne.sourceOrder,
      },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptOne.capturedAt,
      closedAt: responseOne.capturedAt,
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-integration-002",
      turnOrder: 2,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: promptTwo.messageId,
      messageIds: [promptTwo.messageId, responseTwo.messageId],
      sourceRange: {
        fromSourceOrder: promptTwo.sourceOrder,
        toSourceOrder: responseTwo.sourceOrder,
      },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptTwo.capturedAt,
      closedAt: responseTwo.capturedAt,
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Active Alpha View",
    purpose: "Carry the approved alpha rollout context.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[0].turnId],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "active-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: `${turns[0].turnId}/${responseOne.messageId}`,
        content: "Active alpha context",
      }),
    ],
    status: "ready",
  });
  const draftView = makeThreadView({
    threadId: thread.threadId,
    state: "draft",
    name: "Draft Beta View",
    purpose: "Stage the beta comparison before activation.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[1].turnId],
      renderedStatus: "ready",
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: [turns[0].turnId],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "draft-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: `${turns[1].turnId}/${responseTwo.messageId}`,
        content: "Draft beta context",
      }),
      makeThreadViewMessage({
        threadViewId: "draft-temp",
        bandType: "smooth",
        messageOrder: 2,
        sourceReference: turns[0].turnId,
        content: "Smoothed alpha bridge",
      }),
    ],
    status: "ready",
  });
  const archivedView = makeThreadView({
    threadId: thread.threadId,
    state: "archived",
    name: "Archived Discovery View",
    purpose: "Retain the earlier discovery thread.",
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "archived-temp",
        bandType: "brief",
        messageOrder: 1,
        sourceReference: "chunk-archived-001",
        content: "Archived discovery summary",
      }),
    ],
    status: "ready",
  });

  expectOk(await threadViewStore.createThreadView({ view: activeView }));
  expectOk(await threadViewStore.createThreadView({ view: draftView }));
  expectOk(await threadViewStore.createThreadView({ view: archivedView }));

  return {
    thread,
    turns,
    views: {
      active: activeView,
      draft: draftView,
      archived: archivedView,
    },
  };
}

test("Thread Views survive process-style reopen", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const seeded = await seedPersistedWorkbenchThread(storeRootDir);

    const reopenedThreadStore = new FileThreadStore(storeRootDir);
    const reopenedThreadViewStore = new FileThreadViewStore(storeRootDir, reopenedThreadStore);
    const reopenedThread = expectOk(await reopenedThreadStore.openThread(seeded.thread.threadId));
    const listedViews = expectOk(await reopenedThreadViewStore.listThreadViews(seeded.thread.threadId));
    const reopenedDraft = expectOk(
      await reopenedThreadViewStore.openThreadView(seeded.thread.threadId, seeded.views.draft.threadViewId),
    );

    assert.equal(reopenedThread.thread.activeThreadViewId, undefined);
    assert.deepEqual(
      listedViews.map((view) => view.state),
      ["active", "draft", "archived"],
    );
    assert.deepEqual(
      reopenedDraft.view.emittedMessages.map((message) => message.content),
      ["Draft beta context", "Smoothed alpha bridge"],
    );
    assert.equal(reopenedDraft.view.purpose, seeded.views.draft.purpose);
  });
});

test("activation updates active-view invariant atomically", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const seeded = await seedPersistedWorkbenchThread(storeRootDir);
    const threadStore = new FileThreadStore(storeRootDir);
    const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const activationService = new ThreadViewActivationService(threadViewStore);

    const activated = expectOk(
      await activationService.activateDraftThreadView({
        threadId: seeded.thread.threadId,
        draftThreadViewId: seeded.views.draft.threadViewId,
        now: () => new Date("2026-05-10T23:15:00.000Z"),
      }),
    );

    const reopenedThreadStore = new FileThreadStore(storeRootDir);
    const reopenedThreadViewStore = new FileThreadViewStore(storeRootDir, reopenedThreadStore);
    const reopenedThread = expectOk(await reopenedThreadStore.openThread(seeded.thread.threadId));
    const listedViews = await reopenedThreadViewStore.listThreadViews(seeded.thread.threadId);
    const persistedViews = expectOk(listedViews);

    assert.equal(activated.active.threadViewId, seeded.views.draft.threadViewId);
    assert.equal(reopenedThread.thread.activeThreadViewId, undefined);
    assert.equal(listedViews.issues?.length ?? 0, 0);
    assert.deepEqual(
      persistedViews.filter((view) => view.state === "active").map((view) => view.threadViewId),
      [seeded.views.draft.threadViewId],
    );
    assert.equal(
      persistedViews.find((view) => view.threadViewId === seeded.views.active.threadViewId)?.state,
      "archived",
    );
    assert.notEqual(reopenedThread.thread.updatedAt, undefined);
  });
});

test("workbench query ignores legacy ThreadViewStore state as active runtime truth", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const seeded = await seedPersistedWorkbenchThread(storeRootDir);
    const reopenedThreadStore = new FileThreadStore(storeRootDir);
    const reopenedThreadViewStore = new FileThreadViewStore(storeRootDir, reopenedThreadStore);
    const queryService = new WorkbenchQueryService(reopenedThreadStore, reopenedThreadViewStore);

    const openedThread = expectOk(await queryService.openThread({ threadId: seeded.thread.threadId }));
    const openedTurn = expectOk(
      await queryService.openTurnDetail({
        threadId: seeded.thread.threadId,
        turnId: seeded.turns[1].turnId,
      }),
    );

    assert.equal(openedThread.thread.threadId, seeded.thread.threadId);
    assert.equal(openedThread.activeThreadView, undefined);
    assert.deepEqual(openedThread.threadViews, []);
    assert.deepEqual(openedTurn.threadViewPlacements, []);
  });
});

test("search remains practical over large realistic thread data", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const threadStore = new FileThreadStore(storeRootDir);
    const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const searchService = new WorkbenchSearchService(threadStore, threadViewStore);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({
            sessionId: "session-search-large-realistic",
            sessionFilePath: undefined,
          }),
        },
        threadStore,
      ),
    );

    const turns: ReturnType<typeof makeTurnRecord>[] = [];
    let latestSourceRevision = 1;

    for (let index = 1; index <= 80; index += 1) {
      const prompt = await appendThreadMessage({
        store: threadStore,
        threadId: thread.threadId,
        actorId: "actor-human-large-search",
        actorType: "human",
        displayName: "Steward",
        messageId: `message-large-search-${String(index).padStart(3, "0")}-prompt`,
        messageKind: "prompt",
        content: `Search corpus prompt ${index} keeps the workbench realistic.`,
      });
      const response = await appendThreadMessage({
        store: threadStore,
        threadId: thread.threadId,
        actorId: "actor-agent-large-search",
        actorType: "agent",
        displayName: "Pair Agent",
        messageId: `message-large-search-${String(index).padStart(3, "0")}-response`,
        messageKind: "response",
        content:
          index === 80
            ? "The zeta needle stays searchable even in a large realistic thread."
            : `Routine response ${index} keeps the context workbench search corpus dense.`,
      });
      latestSourceRevision = response.sourceRevision;
      turns.push(
        makeTurnRecord({
          threadId: thread.threadId,
          turnId: `turn-large-search-${String(index).padStart(3, "0")}`,
          turnOrder: index,
          lifecycleStatus: "closed",
          repairStatus: "ready",
          initiatingMessageId: prompt.messageId,
          messageIds: [prompt.messageId, response.messageId],
          sourceRange: {
            fromSourceOrder: prompt.sourceOrder,
            toSourceOrder: response.sourceOrder,
          },
          sourceRevision: latestSourceRevision,
          openedAt: prompt.capturedAt,
          closedAt: response.capturedAt,
        }),
      );
    }

    await writeTurns(threadStore, thread.threadId, turns);
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "active",
          name: "Active Large View",
          purpose: "Carry the validated large search lane.",
          fullFidelityBand: makeBandRecord({
            bandType: "full_fidelity",
            selectedIds: [turns[0].turnId],
            renderedStatus: "ready",
          }),
          status: "ready",
        }),
      }),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "draft",
          name: "Draft Large View",
          purpose: "Stage zeta needle validation before activation.",
          fullFidelityBand: makeBandRecord({
            bandType: "full_fidelity",
            selectedIds: [turns[79].turnId],
            renderedStatus: "ready",
          }),
          status: "incomplete",
        }),
      }),
    );

    const startedAt = performance.now();
    const messageResults = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "message",
        query: "zeta needle",
      }),
    );
    const threadViewResults = expectOk(
      await searchService.search({
        threadId: thread.threadId,
        scope: "thread_view",
        query: "zeta needle validation",
      }),
    );
    const durationMs = performance.now() - startedAt;

    assert.equal(messageResults[0]?.resultType, "message");
    assert.match(messageResults[0]?.summaryText ?? "", /zeta needle/i);
    assert.deepEqual(threadViewResults, []);
    assert.ok(durationMs < 4000, `expected realistic search to stay practical, took ${durationMs}ms`);
  });
});
