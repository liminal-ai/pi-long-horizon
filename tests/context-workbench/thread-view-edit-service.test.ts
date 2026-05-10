import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord } from "../../src/context-steward/domain/records.js";
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
import { ThreadViewEditService } from "../../src/context-workbench/services/thread-view-edit-service.js";
import { WorkbenchQueryService } from "../../src/context-workbench/services/workbench-query-service.js";
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

async function createLifecycleHarness(
  storeRootDir: string,
  options: { createThreadViewId?: () => string } = {},
) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const queryService = new WorkbenchQueryService(threadStore, threadViewStore);
  const editService = new ThreadViewEditService(threadStore, threadViewStore, options);

  return { threadStore, threadViewStore, queryService, editService };
}

async function createManagedThread(storeRootDir: string, sessionId: string) {
  const { threadStore } = await createLifecycleHarness(storeRootDir);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId,
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  return { threadStore, thread };
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
      turns,
      turnState: "ready",
    }),
  );
}

async function seedThreadWithTurns(storeRootDir: string, sessionId: string) {
  const harness = await createLifecycleHarness(storeRootDir);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId,
          sessionFilePath: undefined,
        }),
      },
      harness.threadStore,
    ),
  );

  const promptOne = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-lifecycle",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-lifecycle-001",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-lifecycle-001",
        partOrder: 1,
        partType: "text",
        content: "Please summarize the migration risks.",
      }),
    ],
  });
  const responseOne = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-lifecycle",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-lifecycle-002",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-lifecycle-002",
        partOrder: 1,
        partType: "text",
        content: "Migration risks center on stale state and activation timing.",
      }),
    ],
  });
  const promptTwo = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-lifecycle",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-lifecycle-003",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-lifecycle-003",
        partOrder: 1,
        partType: "text",
        content: "Now isolate the rollout fallback.",
      }),
    ],
  });
  const responseTwo = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-lifecycle",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-lifecycle-004",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-lifecycle-004",
        partOrder: 1,
        partType: "text",
        content: "The fallback keeps the active context intact while the draft is revised.",
      }),
    ],
  });

  const turns = await writeThreadTurns(harness.threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-lifecycle-001",
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
      turnId: "turn-lifecycle-002",
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

  return {
    ...harness,
    thread,
    turns: {
      first: turns[0],
      second: turns[1],
    },
  };
}

function assertSourceSnapshotUnchanged(before: ThreadSnapshot, after: ThreadSnapshot) {
  assert.deepEqual(after.thread, before.thread);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.turns, before.turns);
  assert.deepEqual(after.imports, before.imports);
  assert.deepEqual(after.projections, before.projections);
}

test("creates empty draft with empty bands", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread } = await createManagedThread(storeRootDir, "session-draft-empty");
    const { editService, threadStore } = await createLifecycleHarness(storeRootDir);
    const sourceSnapshot = expectOk(await threadStore.openThread(thread.threadId));

    const draft = expectOk(
      await editService.createDraftThreadView({
        threadId: thread.threadId,
        name: "Draft Empty View",
        purpose: "Start curation from zero.",
        now: () => new Date("2026-05-10T12:00:00.000Z"),
      }),
    );

    assert.equal(draft.state, "draft");
    assert.equal(draft.status, "incomplete");
    assert.equal(draft.name, "Draft Empty View");
    assert.equal(draft.purpose, "Start curation from zero.");
    assert.equal(
      draft.sourceStateReference,
      `${sourceSnapshot.thread.sourceRevision}:${sourceSnapshot.thread.messageHighWatermark}`,
    );
    assert.deepEqual(draft.fullFidelityBand.selectedIds, []);
    assert.deepEqual(draft.smoothBand.selectedIds, []);
    assert.deepEqual(draft.detailedBand.selectedIds, []);
    assert.deepEqual(draft.briefBand.selectedIds, []);
    assert.deepEqual(draft.emittedMessages, []);
  });
});

test("empty draft is explicit in readback", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread } = await createManagedThread(storeRootDir, "session-draft-readback");
    const { editService, queryService } = await createLifecycleHarness(storeRootDir);
    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.equal(detail.view.threadViewId, draft.threadViewId);
    assert.deepEqual(detail.view.fullFidelityBand.selectedIds, []);
    assert.deepEqual(detail.view.smoothBand.selectedIds, []);
    assert.deepEqual(detail.view.detailedBand.selectedIds, []);
    assert.deepEqual(detail.view.briefBand.selectedIds, []);
    assert.deepEqual(detail.view.emittedMessages, []);
    assert.deepEqual(detail.sourcePivots, []);
  });
});

test("empty source Thread still permits draft creation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, thread } = await createManagedThread(storeRootDir, "session-draft-no-turns");
    const { editService } = await createLifecycleHarness(storeRootDir);

    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));
    const snapshot = expectOk(await threadStore.openThread(thread.threadId));

    assert.equal(snapshot.turns.length, 0);
    assert.equal(draft.state, "draft");
    assert.deepEqual(draft.fullFidelityBand.selectedIds, []);
  });
});

test("draft creation does not change source Thread", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, threadStore, thread } = await seedThreadWithTurns(
      storeRootDir,
      "session-draft-source-safety",
    );
    const before = expectOk(await threadStore.openThread(thread.threadId));

    expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));

    const after = expectOk(await threadStore.openThread(thread.threadId));
    assertSourceSnapshotUnchanged(before, after);
  });
});

test("draft creation does not copy active view", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, threadViewStore, thread, turns } = await seedThreadWithTurns(
      storeRootDir,
      "session-draft-no-copy",
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Existing Active View",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.first.turnId],
        renderedStatus: "ready",
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.second.turnId],
        renderedStatus: "ready",
      }),
      emittedMessages: [
        makeThreadViewMessage({
          threadViewId: "thread-view-temp",
          bandType: "full_fidelity",
          sourceReference: `${turns.first.turnId}/message-lifecycle-001`,
          content: "Existing active content",
        }),
      ],
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));

    assert.notEqual(draft.threadViewId, activeView.threadViewId);
    assert.deepEqual(draft.fullFidelityBand.selectedIds, []);
    assert.deepEqual(draft.smoothBand.selectedIds, []);
    assert.deepEqual(draft.emittedMessages, []);
  });
});

test("draft state is explicit", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread } = await createManagedThread(storeRootDir, "session-draft-state");
    const { editService, queryService } = await createLifecycleHarness(storeRootDir);
    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.equal(detail.view.state, "draft");
  });
});

test("archived state is explicit", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread } = await createManagedThread(storeRootDir, "session-archived-state");
    const { editService, queryService } = await createLifecycleHarness(storeRootDir);
    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));

    expectOk(
      await editService.archiveDraftThreadView({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
        now: () => new Date("2026-05-10T12:05:00.000Z"),
      }),
    );

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.equal(detail.view.state, "archived");
  });
});

test("one active view invariant preserved in store reads", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, threadViewStore, thread } = await seedThreadWithTurns(
      storeRootDir,
      "session-one-active",
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "active",
          name: "Only Active View",
          status: "ready",
        }),
      }),
    );
    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));
    expectOk(
      await editService.archiveDraftThreadView({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    const views = expectOk(await threadViewStore.listThreadViews(thread.threadId));

    assert.equal(views.filter((view) => view.state === "active").length, 1);
    assert.deepEqual(views.map((view) => view.state), ["active", "archived"]);
  });
});

test("creating draft does not create second active view", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, threadViewStore, thread } = await seedThreadWithTurns(
      storeRootDir,
      "session-draft-no-second-active",
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Pinned Active View",
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));
    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.activeThreadView?.threadViewId, activeView.threadViewId);
    assert.equal(openedThread.thread.activeThreadViewId, activeView.threadViewId);
    assert.equal(openedThread.threadViews.filter((view) => view.state === "active").length, 1);
  });
});

test("archives draft without activation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, thread } = await seedThreadWithTurns(
      storeRootDir,
      "session-archive-draft",
    );
    const draft = expectOk(
      await editService.createDraftThreadView({
        threadId: thread.threadId,
        name: "Abandoned Draft",
        purpose: "Try another curation path.",
      }),
    );

    const archived = expectOk(
      await editService.archiveDraftThreadView({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.equal(archived.state, "archived");
    assert.equal(detail.view.state, "archived");
    assert.equal(detail.view.name, "Abandoned Draft");
    assert.equal(detail.view.purpose, "Try another curation path.");
  });
});

test("excludes turn from draft view composition", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, threadViewStore, thread, turns } = await seedThreadWithTurns(
      storeRootDir,
      "session-exclude-turn",
    );
    const draftView = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.first.turnId, turns.second.turnId],
        renderedStatus: "ready",
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [turns.second.turnId],
        renderedStatus: "ready",
      }),
      emittedMessages: [
        makeThreadViewMessage({
          threadViewId: "thread-view-temp",
          bandType: "full_fidelity",
          sourceReference: `${turns.second.turnId}/message-lifecycle-003`,
          content: "Stale emitted content",
        }),
      ],
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: draftView }));

    const updated = expectOk(
      await editService.excludeTurnFromThreadView({
        threadId: thread.threadId,
        threadViewId: draftView.threadViewId,
        turnId: turns.second.turnId,
        now: () => new Date("2026-05-10T12:10:00.000Z"),
      }),
    );
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draftView.threadViewId,
      }),
    );

    assert.deepEqual(updated.fullFidelityBand.selectedIds, [turns.first.turnId]);
    assert.deepEqual(updated.smoothBand.selectedIds, []);
    assert.deepEqual(updated.fullFidelityBand.exclusions, [turns.second.turnId]);
    assert.deepEqual(updated.smoothBand.exclusions, [turns.second.turnId]);
    assert.deepEqual(updated.emittedMessages, []);
    assert.equal(updated.status, "incomplete");
    assert.equal(
      detail.sourcePivots.some((pivot) => pivot.sourceUnitId === turns.second.turnId),
      false,
    );
  });
});

test("exclusion does not mutate source Thread", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, threadStore, threadViewStore, thread, turns } = await seedThreadWithTurns(
      storeRootDir,
      "session-exclude-source-safety",
    );
    const draftView = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [turns.first.turnId, turns.second.turnId],
        renderedStatus: "ready",
      }),
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: draftView }));
    const before = expectOk(await threadStore.openThread(thread.threadId));

    expectOk(
      await editService.excludeTurnFromThreadView({
        threadId: thread.threadId,
        threadViewId: draftView.threadViewId,
        turnId: turns.second.turnId,
      }),
    );

    const after = expectOk(await threadStore.openThread(thread.threadId));
    assertSourceSnapshotUnchanged(before, after);
  });
});

test("draft creation is idempotently rejected when a duplicate threadViewId is injected", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread } = await createManagedThread(storeRootDir, "session-duplicate-draft-id");
    const { editService } = await createLifecycleHarness(storeRootDir, {
      createThreadViewId: () => "thread_view_duplicate",
    });

    const firstDraft = await editService.createDraftThreadView({ threadId: thread.threadId });
    const secondDraft = await editService.createDraftThreadView({ threadId: thread.threadId });

    assert.equal(firstDraft.ok, true);
    assert.equal(secondDraft.ok, false);
    assert.equal(secondDraft.issues[0]?.code, "THREAD_VIEW_DUPLICATE");
  });
});

test("archival preserves emitted messages for later readback", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, threadViewStore, thread } = await seedThreadWithTurns(
      storeRootDir,
      "session-archive-preserves-emitted",
    );
    const draftView = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      emittedMessages: [
        makeThreadViewMessage({
          threadViewId: "thread-view-temp",
          bandType: "full_fidelity",
          sourceReference: "turn-lifecycle-001/message-lifecycle-001",
          content: "Preserved emitted content",
        }),
      ],
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: draftView }));

    expectOk(
      await editService.archiveDraftThreadView({
        threadId: thread.threadId,
        threadViewId: draftView.threadViewId,
      }),
    );
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draftView.threadViewId,
      }),
    );

    assert.equal(detail.view.state, "archived");
    assert.deepEqual(
      detail.view.emittedMessages.map((message) => message.content),
      ["Preserved emitted content"],
    );
  });
});

test("band updates persist upper-band selections and materialized emitted output", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, threadStore, thread, turns } = await seedThreadWithTurns(
      storeRootDir,
      "session-update-upper-bands",
    );
    await writeThreadTurns(threadStore, thread.threadId, [
      makeTurnRecord({
        ...turns.first,
        smooth: {
          text: "[user]\nPlease summarize the migration risks.\n\n[assistant]\nMigration risks center on stale state and activation timing.",
          tokenCount: 18,
        },
      }),
      makeTurnRecord({
        ...turns.second,
        smooth: {
          text: "[user]\nNow isolate the rollout fallback.\n\n[assistant]\nThe fallback keeps the active context intact while the draft is revised.",
          tokenCount: 19,
        },
      }),
    ]);

    const draft = expectOk(await editService.createDraftThreadView({ threadId: thread.threadId }));
    const updated = expectOk(
      await editService.updateThreadViewBands({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
        fullFidelityBand: makeBandRecord({
          bandType: "full_fidelity",
          selectedIds: [turns.first.turnId],
        }),
        smoothBand: makeBandRecord({
          bandType: "smooth",
          selectedIds: [turns.second.turnId],
        }),
        now: () => new Date("2026-05-10T12:15:00.000Z"),
      }),
    );
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.deepEqual(updated.fullFidelityBand.selectedIds, [turns.first.turnId]);
    assert.deepEqual(updated.smoothBand.selectedIds, [turns.second.turnId]);
    assert.equal(updated.fullFidelityBand.renderedStatus, "ready");
    assert.equal(updated.smoothBand.renderedStatus, "ready");
    assert.equal(updated.status, "ready");
    assert.deepEqual(
      updated.emittedMessages.map((message) => ({
        bandType: message.bandType,
        sourceReference: message.sourceReference,
      })),
      [
        {
          bandType: "full_fidelity",
          sourceReference: `${turns.first.turnId}/message-lifecycle-001`,
        },
        {
          bandType: "full_fidelity",
          sourceReference: `${turns.first.turnId}/message-lifecycle-002`,
        },
        {
          bandType: "smooth",
          sourceReference: turns.second.turnId,
        },
      ],
    );
    assert.equal(detail.view.sourceStateReference, updated.sourceStateReference);
    assert.deepEqual(
      detail.view.emittedMessages.map((message) => ({
        bandType: message.bandType,
        sourceKind: message.sourceKind,
        sourceReference: message.sourceReference,
        messageOrder: message.messageOrder,
        contentSummary:
          typeof message.content === "string"
            ? message.content
            : {
                actorType: (message.content as { actorType?: string }).actorType,
                partTypes: (
                  message.content as { parts: Array<{ partType: string }> }
                ).parts.map((part) => part.partType),
              },
      })),
      updated.emittedMessages.map((message) => ({
        bandType: message.bandType,
        sourceKind: message.sourceKind,
        sourceReference: message.sourceReference,
        messageOrder: message.messageOrder,
        contentSummary:
          typeof message.content === "string"
            ? message.content
            : {
                actorType: (message.content as { actorType?: string }).actorType,
                partTypes: (
                  message.content as { parts: Array<{ partType: string }> }
                ).parts.map((part) => part.partType),
              },
      })),
    );
  });
});
