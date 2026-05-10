import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord, ThreadRecord } from "../../src/context-steward/domain/records.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
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
import { WorkbenchQueryService } from "../../src/context-workbench/services/workbench-query-service.js";
import { FileThreadViewStore } from "../../src/context-workbench/store/file-thread-view-store.js";
import type { ThreadViewStore } from "../../src/context-workbench/store/thread-view-store.js";
import {
  makeBandRecord,
  makeWorkbenchChunkRead,
  makeThreadView,
  makeThreadViewMessage,
} from "../../src/context-workbench/test/fixtures.js";
import type { WorkbenchChunkRead } from "../../src/context-workbench/domain/thread-view-records.js";
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

async function createManagedThread(storeRootDir: string, sessionId: string) {
  const store = new FileThreadStore(storeRootDir);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId,
          sessionFilePath: undefined,
        }),
      },
      store,
    ),
  );

  return { store, thread };
}

async function appendPromptWithoutTurn(store: FileThreadStore, threadId: string, content: string) {
  return expectOk(
    await appendSourceMessage({
      store,
      threadId,
      actor: makeActorRecord({
        actorId: "actor-human",
        actorType: "human",
        displayName: "Steward",
      }),
      message: makePendingMessage({
        actorId: "actor-human",
        actorType: "human",
        messageKind: "prompt",
        parts: [makePartRecord({ content })],
      }),
    }),
  );
}

class InMemoryChunkReader {
  constructor(private readonly chunksByThreadId: Record<string, readonly WorkbenchChunkRead[]> = {}) {}

  async listChunks(threadId: string): Promise<StewardResult<WorkbenchChunkRead[]>> {
    return {
      ok: true,
      value: (this.chunksByThreadId[threadId] ?? []).map((chunk) => structuredClone(chunk)),
      issues: [],
    };
  }
}

async function createQueryHarness(
  storeRootDir: string,
  options: { chunkReader?: InMemoryChunkReader } = {},
) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const queryService = new WorkbenchQueryService(
    threadStore,
    threadViewStore,
    options.chunkReader,
  );

  return { threadStore, threadViewStore, queryService };
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

async function seedDetailFixture(storeRootDir: string) {
  const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-detail-pivots",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const promptOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-detail",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-detail-001",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-detail-001",
        partOrder: 1,
        partType: "text",
        content: "Please pull the alpha architecture notes.",
      }),
    ],
  });
  const responseOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-detail",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-detail-002",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-detail-002",
        partOrder: 1,
        partType: "reasoning",
        content: "Thinking through the alpha architecture references.",
      }),
      makePartRecord({
        partId: "part-detail-003",
        partOrder: 2,
        partType: "text",
        content: "Alpha architecture notes point to the runtime bridge and capture seam.",
      }),
      makePartRecord({
        partId: "part-detail-004",
        partOrder: 3,
        partType: "tool_result",
        content: {
          summary: "alpha tool output",
          files: ["src/runtime-bridge.ts"],
        },
      }),
    ],
  });
  const promptTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-detail",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-detail-003",
    messageKind: "prompt",
    parts: [
      makePartRecord({
        partId: "part-detail-005",
        partOrder: 1,
        partType: "text",
        content: "Now compare the beta migration plan.",
      }),
    ],
  });
  const responseTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-detail",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-detail-004",
    messageKind: "response",
    parts: [
      makePartRecord({
        partId: "part-detail-006",
        partOrder: 1,
        partType: "text",
        content: "Beta migration keeps the active view small and stages the rest in a draft.",
      }),
    ],
  });

  const turns = await writeThreadTurns(threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-detail-001",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: promptOne.messageId,
      messageIds: [promptOne.messageId, responseOne.messageId],
      sourceRange: { fromSourceOrder: promptOne.sourceOrder, toSourceOrder: responseOne.sourceOrder },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptOne.capturedAt,
      closedAt: responseOne.capturedAt,
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-detail-002",
      turnOrder: 2,
      lifecycleStatus: "open",
      repairStatus: "ready",
      initiatingMessageId: promptTwo.messageId,
      messageIds: [promptTwo.messageId, responseTwo.messageId],
      sourceRange: { fromSourceOrder: promptTwo.sourceOrder, toSourceOrder: responseTwo.sourceOrder },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptTwo.capturedAt,
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Active Alpha View",
    purpose: "Keep alpha runtime context active.",
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
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: ["chunk-detail-001"],
      renderedStatus: "ready",
    }),
    briefBand: makeBandRecord({
      bandType: "brief",
      selectedIds: ["chunk-detail-002"],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: turns[0].turnId,
        content: "Full fidelity alpha context",
      }),
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "smooth",
        messageOrder: 2,
        sourceReference: turns[1].turnId,
        content: "Smooth beta context",
      }),
    ],
    status: "ready",
  });
  const draftView = makeThreadView({
    threadId: thread.threadId,
    state: "draft",
    name: "Draft Beta View",
    purpose: "Stage beta comparison before activation.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[1].turnId],
      renderedStatus: "ready",
    }),
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: ["chunk-detail-003"],
      renderedStatus: "unknown",
    }),
    status: "incomplete",
  });
  expectOk(await threadViewStore.createThreadView({ view: activeView }));
  expectOk(await threadViewStore.createThreadView({ view: draftView }));

  return {
    queryService,
    thread,
    messages: {
      promptOne,
      responseOne,
      promptTwo,
      responseTwo,
    },
    turns: {
      first: turns[0],
      second: turns[1],
    },
    views: {
      active: activeView,
      draft: draftView,
    },
  };
}

async function seedLowerBandFixture(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-lower-band-awareness",
          sessionFilePath: undefined,
        }),
      },
      threadStore,
    ),
  );

  const promptOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-lower-band",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-lower-band-001",
    messageKind: "prompt",
    parts: [makePartRecord({ partId: "part-lower-band-001", content: "Keep the implementation seam clear." })],
  });
  const responseOne = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-lower-band",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-lower-band-002",
    messageKind: "response",
    parts: [makePartRecord({ partId: "part-lower-band-002", content: "The seam stays query-only for lower bands." })],
  });
  const promptTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-lower-band",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-lower-band-003",
    messageKind: "prompt",
    parts: [makePartRecord({ partId: "part-lower-band-003", content: "Keep open work in smooth context." })],
  });
  const responseTwo = await appendThreadMessage({
    store: threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-lower-band",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-lower-band-004",
    messageKind: "response",
    parts: [makePartRecord({ partId: "part-lower-band-004", content: "Open work remains outside chunk summaries." })],
  });

  const turns = await writeThreadTurns(threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-lower-band-001",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: promptOne.messageId,
      messageIds: [promptOne.messageId, responseOne.messageId],
      sourceRange: { fromSourceOrder: promptOne.sourceOrder, toSourceOrder: responseOne.sourceOrder },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptOne.capturedAt,
      closedAt: responseOne.capturedAt,
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-lower-band-002",
      turnOrder: 2,
      lifecycleStatus: "open",
      repairStatus: "ready",
      initiatingMessageId: promptTwo.messageId,
      messageIds: [promptTwo.messageId, responseTwo.messageId],
      sourceRange: { fromSourceOrder: promptTwo.sourceOrder, toSourceOrder: responseTwo.sourceOrder },
      sourceRevision: responseTwo.sourceRevision,
      openedAt: promptTwo.capturedAt,
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Lower Band View",
    purpose: "Inspect lower-band readiness without maintenance controls.",
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
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: ["chunk-lower-detailed-ready", "chunk-lower-open", "chunk-lower-missing"],
      renderedStatus: "unknown",
    }),
    briefBand: makeBandRecord({
      bandType: "brief",
      selectedIds: ["chunk-lower-brief-ready", "chunk-lower-open", "chunk-lower-missing"],
      renderedStatus: "unknown",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: turns[0].turnId,
        content: "Full fidelity implementation seam",
      }),
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "smooth",
        messageOrder: 2,
        sourceReference: turns[1].turnId,
        content: "Smooth open-work seam",
      }),
    ],
    status: "incomplete",
  });
  expectOk(await threadViewStore.createThreadView({ view: activeView }));

  const chunks = {
    detailedReady: makeWorkbenchChunkRead({
      chunkId: "chunk-lower-detailed-ready",
      lifecycleStatus: "closed",
      sourceTurnIds: [turns[0].turnId],
      smoothText: "Closed chunk smooth text",
      detailedSummary: "Detailed summary is ready.",
      detailedSummaryTokenCount: 42,
    }),
    briefReady: makeWorkbenchChunkRead({
      chunkId: "chunk-lower-brief-ready",
      lifecycleStatus: "closed",
      sourceTurnIds: [turns[0].turnId],
      smoothText: "Closed chunk smooth text",
      briefSummary: "Brief summary is ready.",
      briefSummaryTokenCount: 8,
    }),
    open: makeWorkbenchChunkRead({
      chunkId: "chunk-lower-open",
      lifecycleStatus: "open",
      sourceTurnIds: [turns[1].turnId],
      smoothText: "Open chunk smooth text",
      detailedSummary: "Errant detailed summary should still be ignored.",
      briefSummary: "Errant brief summary should still be ignored.",
    }),
    missing: makeWorkbenchChunkRead({
      chunkId: "chunk-lower-missing",
      lifecycleStatus: "closed",
      sourceTurnIds: [turns[0].turnId],
      smoothText: "Closed chunk missing lower-band artifacts",
    }),
  } as const;

  const chunkReader = new InMemoryChunkReader({
    [thread.threadId]: Object.values(chunks),
  });
  const queryService = new WorkbenchQueryService(threadStore, threadViewStore, chunkReader);

  return {
    queryService,
    thread,
    turns: {
      closed: turns[0],
      open: turns[1],
    },
    view: activeView,
    chunks,
  };
}

class CountingThreadViewStore implements ThreadViewStore {
  openCount = 0;
  listCount = 0;

  constructor(private readonly delegate: ThreadViewStore) {}

  createThreadView(input: Parameters<ThreadViewStore["createThreadView"]>[0]) {
    return this.delegate.createThreadView(input);
  }

  openThreadView(threadId: string, threadViewId: string) {
    this.openCount += 1;
    return this.delegate.openThreadView(threadId, threadViewId);
  }

  listThreadViews(threadId: string) {
    this.listCount += 1;
    return this.delegate.listThreadViews(threadId);
  }

  updateThreadView(input: Parameters<ThreadViewStore["updateThreadView"]>[0]) {
    return this.delegate.updateThreadView(input);
  }

  archiveThreadView(threadId: string, threadViewId: string) {
    return this.delegate.archiveThreadView(threadId, threadViewId);
  }
}

test("shows source Thread and active view separately", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-open-source-active", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Active Workbench View",
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.thread.threadId, thread.threadId);
    assert.equal(openedThread.thread.activeThreadViewId, activeView.threadViewId);
    assert.equal(openedThread.activeThreadView?.threadViewId, activeView.threadViewId);
    assert.notEqual(openedThread.thread.threadId, openedThread.activeThreadView?.threadViewId);
  });
});

test("reads Thread with no active view and makes the absence explicit", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService } = await createQueryHarness(storeRootDir);
    const { thread } = await createManagedThread(storeRootDir, "session-open-no-active");

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.thread.threadId, thread.threadId);
    assert.equal(openedThread.activeThreadView, undefined);
    assert.deepEqual(openedThread.threadViews, []);
  });
});

test("reports usable status for a ready Thread", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-usable-ready", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "active",
          name: "Ready View",
          status: "ready",
        }),
      }),
    );

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.usableStatus, "ready");
    assert.deepEqual(openedThread.blockers, []);
  });
});

test("reports degraded Thread state and names the blocker", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir, resolveThreadPath }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-degraded", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Reconciled View",
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    const threadJsonPath = resolveThreadPath(thread.threadId, "thread.json");
    const persistedThread = JSON.parse(await readFile(threadJsonPath, "utf8")) as ThreadRecord;
    persistedThread.activeThreadViewId = "thread_view_missing";
    await writeFile(threadJsonPath, `${JSON.stringify(persistedThread, null, 2)}\n`, "utf8");

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.usableStatus, "degraded");
    assert.equal(openedThread.blockers[0]?.code, "THREAD_VIEW_STATE_CONFLICT");
    assert.match(openedThread.blockers[0]?.message ?? "", /reconciled/i);
    assert.equal(openedThread.thread.activeThreadViewId, activeView.threadViewId);
  });
});

test("shows active view band regions in full_fidelity smooth detailed brief order", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-band-order", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Band View",
      status: "ready",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: ["turn-001"],
        renderedStatus: "ready",
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: ["turn-002"],
        renderedStatus: "ready",
      }),
      detailedBand: makeBandRecord({
        bandType: "detailed",
        selectedIds: ["chunk-001"],
        renderedStatus: "ready",
      }),
      briefBand: makeBandRecord({
        bandType: "brief",
        selectedIds: ["chunk-002"],
        renderedStatus: "ready",
      }),
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));
    const bandOrder = [
      openedThread.activeThreadView?.fullFidelityBand.bandType,
      openedThread.activeThreadView?.smoothBand.bandType,
      openedThread.activeThreadView?.detailedBand.bandType,
      openedThread.activeThreadView?.briefBand.bandType,
    ];

    assert.deepEqual(bandOrder, ["full_fidelity", "smooth", "detailed", "brief"]);
  });
});

test("shows empty active-view bands explicitly instead of omitting them", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-empty-band", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "active",
          name: "Sparse View",
          status: "ready",
          fullFidelityBand: makeBandRecord({
            bandType: "full_fidelity",
            selectedIds: ["turn-001"],
            renderedStatus: "ready",
          }),
          detailedBand: makeBandRecord({
            bandType: "detailed",
            selectedIds: [],
            renderedStatus: "unknown",
          }),
          briefBand: makeBandRecord({
            bandType: "brief",
            selectedIds: [],
            renderedStatus: "unknown",
          }),
        }),
      }),
    );

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.deepEqual(openedThread.activeThreadView?.detailedBand.selectedIds, []);
    assert.deepEqual(openedThread.activeThreadView?.briefBand.selectedIds, []);
    assert.equal(openedThread.activeThreadView?.detailedBand.bandType, "detailed");
    assert.equal(openedThread.activeThreadView?.briefBand.bandType, "brief");
  });
});

test("lists active, draft, and archived Thread Views with their current state", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-list-view-states", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "active",
          name: "Active View",
          status: "ready",
        }),
      }),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "draft",
          name: "Draft View",
          status: "incomplete",
        }),
      }),
    );
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "archived",
          name: "Archived View",
          status: "unknown",
        }),
      }),
    );

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.deepEqual(
      openedThread.threadViews.map((view) => view.state),
      ["active", "draft", "archived"],
    );
  });
});

test("shows the one-active-view invariant in the Thread View listing", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, threadViewStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-one-active", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Single Active View",
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));
    expectOk(
      await threadViewStore.createThreadView({
        view: makeThreadView({
          threadId: thread.threadId,
          state: "draft",
          name: "Secondary Draft View",
          status: "incomplete",
        }),
      }),
    );

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));
    const activeViews = openedThread.threadViews.filter((view) => view.state === "active");

    assert.equal(activeViews.length, 1);
    assert.equal(activeViews[0]?.threadViewId, activeView.threadViewId);
    assert.equal(openedThread.activeThreadView?.threadViewId, activeView.threadViewId);
  });
});

test("opens a fixture Thread through the same inspection surface", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, queryService } = await createQueryHarness(storeRootDir);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-fixture-open", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    await appendPromptWithoutTurn(threadStore, thread.threadId, "Fixture source prompt");

    const fixture = expectOk(
      await createRealSessionFixture({
        store: threadStore,
        source: {
          type: "managed_thread",
          threadId: thread.threadId,
        },
      }),
    );

    const openedFixture = expectOk(await queryService.openFixtureThread({ fixtureId: fixture.fixtureId }));

    assert.equal(openedFixture.fixture.fixtureId, fixture.fixtureId);
    assert.equal(openedFixture.thread.threadId, thread.threadId);
    assert.equal(openedFixture.activeThreadView, undefined);
    assert.deepEqual(openedFixture.threadViews, []);
  });
});

test("opening a Thread with many archived views keeps active-view lookup cheap", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const threadStore = new FileThreadStore(storeRootDir);
    const baseThreadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const countingThreadViewStore = new CountingThreadViewStore(baseThreadViewStore);
    const queryService = new WorkbenchQueryService(threadStore, countingThreadViewStore);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({ sessionId: "session-cheap-active-view", sessionFilePath: undefined }),
        },
        threadStore,
      ),
    );
    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Cheap Active View",
      status: "ready",
    });
    expectOk(await countingThreadViewStore.createThreadView({ view: activeView }));

    for (let index = 1; index <= 40; index += 1) {
      expectOk(
        await countingThreadViewStore.createThreadView({
          view: makeThreadView({
            threadId: thread.threadId,
            state: "archived",
            name: `Archived View ${String(index).padStart(2, "0")}`,
            createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
            updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
            status: "unknown",
          }),
        }),
      );
    }

    const openedThread = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(openedThread.activeThreadView?.threadViewId, activeView.threadViewId);
    assert.equal(countingThreadViewStore.listCount, 1);
    assert.equal(countingThreadViewStore.openCount, 0);
  });
});

test("opens full message detail and preserves all ordered parts", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, messages } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openMessageDetail({
        threadId: thread.threadId,
        messageId: messages.responseOne.messageId,
      }),
    );

    assert.deepEqual(
      detail.message.parts.map((part) => ({ partOrder: part.partOrder, partType: part.partType })),
      [
        { partOrder: 1, partType: "reasoning" },
        { partOrder: 2, partType: "text" },
        { partOrder: 3, partType: "tool_result" },
      ],
    );
  });
});

test("message detail includes source metadata needed to place the Message in Thread context", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, messages } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openMessageDetail({
        threadId: thread.threadId,
        messageId: messages.responseOne.messageId,
      }),
    );

    assert.equal(detail.message.sourceOrder, messages.responseOne.sourceOrder);
    assert.equal(detail.message.actorType, "agent");
    assert.equal(detail.message.messageKind, "response");
  });
});

test("opens full Turn detail with member Messages in source order", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, messages, turns } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openTurnDetail({
        threadId: thread.threadId,
        turnId: turns.first.turnId,
      }),
    );

    assert.equal(detail.turn.turnId, turns.first.turnId);
    assert.deepEqual(
      detail.messages.map((message) => message.messageId),
      [messages.promptOne.messageId, messages.responseOne.messageId],
    );
  });
});

test("Turn detail includes current Thread View relationships", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, turns, views } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openTurnDetail({
        threadId: thread.threadId,
        turnId: turns.second.turnId,
      }),
    );

    assert.deepEqual(detail.threadViewPlacements, [
      {
        threadViewId: views.active.threadViewId,
        state: "active",
        bandType: "smooth",
      },
      {
        threadViewId: views.draft.threadViewId,
        state: "draft",
        bandType: "full_fidelity",
      },
    ]);
  });
});

test("Thread View detail shows all band regions in order", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, views } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: views.active.threadViewId,
      }),
    );

    assert.deepEqual(
      [
        detail.view.fullFidelityBand.bandType,
        detail.view.smoothBand.bandType,
        detail.view.detailedBand.bandType,
        detail.view.briefBand.bandType,
      ],
      ["full_fidelity", "smooth", "detailed", "brief"],
    );
  });
});

test("Thread View detail includes the emitted context result", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, views } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: views.active.threadViewId,
      }),
    );

    assert.deepEqual(
      detail.view.emittedMessages.map((message) => message.content),
      ["Full fidelity alpha context", "Smooth beta context"],
    );
  });
});

test("message detail provides a pivot back to the owning Turn", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, messages, turns } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openMessageDetail({
        threadId: thread.threadId,
        messageId: messages.responseOne.messageId,
      }),
    );

    assert.equal(detail.owningTurnId, turns.first.turnId);
  });
});

test("Turn detail provides pivots to relevant Thread View placements", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, turns, views } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openTurnDetail({
        threadId: thread.threadId,
        turnId: turns.second.turnId,
      }),
    );

    assert.equal(detail.threadViewPlacements[0]?.threadViewId, views.active.threadViewId);
    assert.equal(detail.threadViewPlacements[1]?.threadViewId, views.draft.threadViewId);
  });
});

test("Thread View detail provides pivots from band selections back to source detail", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, turns, views } = await seedDetailFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: views.active.threadViewId,
      }),
    );

    assert.deepEqual(detail.sourcePivots, [
      {
        bandType: "full_fidelity",
        sourceUnitId: turns.first.turnId,
        sourceUnitType: "turn",
      },
      {
        bandType: "smooth",
        sourceUnitId: turns.second.turnId,
        sourceUnitType: "turn",
      },
      {
        bandType: "detailed",
        sourceUnitId: "chunk-detail-001",
        sourceUnitType: "chunk",
      },
      {
        bandType: "brief",
        sourceUnitId: "chunk-detail-002",
        sourceUnitType: "chunk",
      },
    ]);
  });
});

test("detailed band uses chunk selections", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.deepEqual(detail.view.detailedBand.sourceUnitType, "chunk");
    assert.deepEqual(detail.sourcePivots.filter((pivot) => pivot.bandType === "detailed"), [
      {
        bandType: "detailed",
        sourceUnitId: "chunk-lower-detailed-ready",
        sourceUnitType: "chunk",
      },
      {
        bandType: "detailed",
        sourceUnitId: "chunk-lower-open",
        sourceUnitType: "chunk",
      },
      {
        bandType: "detailed",
        sourceUnitId: "chunk-lower-missing",
        sourceUnitType: "chunk",
      },
    ]);
  });
});

test("brief band uses chunk selections", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.deepEqual(detail.view.briefBand.sourceUnitType, "chunk");
    assert.deepEqual(detail.sourcePivots.filter((pivot) => pivot.bandType === "brief"), [
      {
        bandType: "brief",
        sourceUnitId: "chunk-lower-brief-ready",
        sourceUnitType: "chunk",
      },
      {
        bandType: "brief",
        sourceUnitId: "chunk-lower-open",
        sourceUnitType: "chunk",
      },
      {
        bandType: "brief",
        sourceUnitId: "chunk-lower-missing",
        sourceUnitType: "chunk",
      },
    ]);
  });
});

test("open chunk does not enter detailed-band eligibility", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.equal(
      readiness.detailedBand.find((entry) => entry.chunkId === "chunk-lower-open")?.status,
      "ineligible_open_chunk",
    );
  });
});

test("open chunk does not enter brief-band eligibility", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.equal(
      readiness.briefBand.find((entry) => entry.chunkId === "chunk-lower-open")?.status,
      "ineligible_open_chunk",
    );
  });
});

test("closed chunk with detailed artifact is shown as eligible for the detailed band", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.equal(
      readiness.detailedBand.find((entry) => entry.chunkId === "chunk-lower-detailed-ready")?.status,
      "eligible",
    );
  });
});

test("closed chunk missing a required lower-band artifact is shown as not ready", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, view } = await seedLowerBandFixture(storeRootDir);

    const readiness = expectOk(
      await queryService.inspectLowerBandReadiness({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.equal(
      readiness.detailedBand.find((entry) => entry.chunkId === "chunk-lower-missing")?.status,
      "missing_artifacts",
    );
    assert.equal(
      readiness.briefBand.find((entry) => entry.chunkId === "chunk-lower-missing")?.status,
      "missing_artifacts",
    );
  });
});

test("chunk detail can be opened without exposing the full chunk-maintenance workflow", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread } = await seedLowerBandFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openChunkDetail({
        threadId: thread.threadId,
        chunkId: "chunk-lower-detailed-ready",
      }),
    );

    assert.equal(detail.chunk.lifecycleStatus, "closed");
    assert.deepEqual(detail.chunk.sourceTurnIds, ["turn-lower-band-001"]);
    assert.equal("jobId" in detail.chunk, false);
    assert.equal("dependencyChain" in detail.chunk, false);
    assert.equal("retryState" in detail.chunk, false);
  });
});

test("missing chunk data does not block upper-band inspection", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, turns, view } = await seedLowerBandFixture(storeRootDir);

    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: view.threadViewId,
      }),
    );

    assert.deepEqual(detail.view.fullFidelityBand.selectedIds, [turns.closed.turnId]);
    assert.deepEqual(detail.view.smoothBand.selectedIds, [turns.open.turnId]);
    assert.deepEqual(
      detail.view.emittedMessages.map((message) => message.content),
      ["Full fidelity implementation seam", "Smooth open-work seam"],
    );
  });
});
