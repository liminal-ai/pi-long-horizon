import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord, ThreadRecord } from "../../src/context-steward/domain/records.js";
import {
  appendSourceMessage,
  openOrCreateManagedThread,
} from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import type { ThreadSnapshot } from "../../src/context-steward/store/thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makePartRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { ThreadViewActivationService } from "../../src/context-workbench/services/thread-view-activation-service.js";
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

function assertSourceTruthUnchanged(before: ThreadSnapshot, after: ThreadSnapshot) {
  const normalizeThread = (thread: ThreadRecord) => {
    const { activeThreadViewId: _activeThreadViewId, updatedAt: _updatedAt, ...rest } = thread;
    return rest;
  };

  assert.deepEqual(normalizeThread(after.thread), normalizeThread(before.thread));
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.turns, before.turns);
  assert.deepEqual(after.imports, before.imports);
  assert.deepEqual(after.projections, before.projections);
}

async function seedActivationHarness(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const activationService = new ThreadViewActivationService(threadViewStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-activate-thread-view",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const prompt = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-activation",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-activation-001",
    messageKind: "prompt",
    content: "Activate the comparison draft after review.",
  });
  const response = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-activation",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-activation-002",
    messageKind: "response",
    content: "The draft can replace the active view without mutating source truth.",
  });
  const turns = await writeTurns(threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-activation-001",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: prompt.messageId,
      messageIds: [prompt.messageId, response.messageId],
      sourceRange: {
        fromSourceOrder: prompt.sourceOrder,
        toSourceOrder: response.sourceOrder,
      },
      sourceRevision: response.sourceRevision,
      openedAt: prompt.capturedAt,
      closedAt: response.capturedAt,
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Current Active View",
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
        sourceReference: `${turns[0].turnId}/${prompt.messageId}`,
        content: "Active emitted context",
      }),
    ],
    status: "ready",
  });
  const draftView = makeThreadView({
    threadId: thread.threadId,
    state: "draft",
    name: "Draft Replacement View",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[0].turnId],
      renderedStatus: "ready",
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: ["turn-activation-002"],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "draft-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: `${turns[0].turnId}/${response.messageId}`,
        content: "Draft emitted context",
      }),
    ],
    status: "ready",
  });

  expectOk(await threadViewStore.createThreadView({ view: activeView }));
  expectOk(await threadViewStore.createThreadView({ view: draftView }));

  return { activationService, threadStore, threadViewStore, thread, views: { active: activeView, draft: draftView } };
}

test("activating draft makes it the only active view", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, threadStore, threadViewStore, thread, views } = await seedActivationHarness(storeRootDir);

    const activation = expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: views.draft.threadViewId,
        now: () => new Date("2026-05-10T22:00:00.000Z"),
      }),
    );
    const refreshedThread = expectOk(await threadStore.openThread(thread.threadId));
    const listedViews = expectOk(await threadViewStore.listThreadViews(thread.threadId));

    assert.equal(activation.active.threadViewId, views.draft.threadViewId);
    assert.equal(refreshedThread.thread.activeThreadViewId, views.draft.threadViewId);
    assert.deepEqual(
      listedViews.filter((view) => view.state === "active").map((view) => view.threadViewId),
      [views.draft.threadViewId],
    );
  });
});

test("prior active view is preserved as archived", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, threadViewStore, thread, views } = await seedActivationHarness(storeRootDir);

    const activation = expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );
    const archivedView = expectOk(await threadViewStore.openThreadView(thread.threadId, views.active.threadViewId));

    assert.equal(activation.archived.threadViewId, views.active.threadViewId);
    assert.equal(activation.archived.state, "archived");
    assert.equal(archivedView.view.state, "archived");
    assert.deepEqual(
      archivedView.view.emittedMessages.map((message) => message.content),
      ["Active emitted context"],
    );
  });
});

test("activation does not mutate source Thread", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, threadStore, thread, views } = await seedActivationHarness(storeRootDir);
    const before = expectOk(await threadStore.openThread(thread.threadId));

    expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );
    const after = expectOk(await threadStore.openThread(thread.threadId));

    assertSourceTruthUnchanged(before, after);
  });
});

test("archived view remains readable after activation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, threadViewStore, thread, views } = await seedActivationHarness(storeRootDir);

    expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );
    const archivedView = expectOk(await threadViewStore.openThreadView(thread.threadId, views.active.threadViewId));

    assert.equal(archivedView.view.name, "Current Active View");
    assert.equal(archivedView.view.state, "archived");
    assert.equal(archivedView.view.emittedMessages[0]?.content, "Active emitted context");
  });
});

test("activation rejects draft when policy requires materialized output and it is missing", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, threadViewStore, thread, views } = await seedActivationHarness(storeRootDir);
    const unmaterializedDraft = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      name: "Unmaterialized Draft",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: ["turn-activation-001"],
      }),
      emittedMessages: [],
      status: "incomplete",
    });
    expectOk(await threadViewStore.createThreadView({ view: unmaterializedDraft }));

    const activation = await activationService.activateDraftThreadView({
      threadId: thread.threadId,
      draftThreadViewId: unmaterializedDraft.threadViewId,
      requireMaterializedOutput: true,
    });

    assert.equal(activation.ok, false);
    assert.equal(activation.issues[0]?.code, "THREAD_VIEW_MATERIALIZATION_REQUIRED");
    assert.equal(expectOk(await threadViewStore.openThreadView(thread.threadId, views.active.threadViewId)).view.state, "active");
  });
});
