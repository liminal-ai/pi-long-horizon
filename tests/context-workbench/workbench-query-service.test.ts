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
} from "../../src/context-steward/test/fixtures.js";
import { WorkbenchQueryService } from "../../src/context-workbench/services/workbench-query-service.js";
import { FileThreadViewStore } from "../../src/context-workbench/store/file-thread-view-store.js";
import type { ThreadViewStore } from "../../src/context-workbench/store/thread-view-store.js";
import {
  makeBandRecord,
  makeThreadView,
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

async function createQueryHarness(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const queryService = new WorkbenchQueryService(threadStore, threadViewStore);

  return { threadStore, threadViewStore, queryService };
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
