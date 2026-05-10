import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { ThreadRecord } from "../../src/context-steward/domain/records.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import { makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { FileThreadViewStore } from "../../src/context-workbench/store/file-thread-view-store.js";
import {
  makeBandRecord,
  makeThreadView,
} from "../../src/context-workbench/test/fixtures.js";
import { withTempWorkbenchStore } from "../../src/context-workbench/test/temp-workbench-store.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

test("persists Thread Views under thread-views directories and supports list/open reads", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir, resolveThreadViewsPath, resolveThreadPath }) => {
    const threadStore = new FileThreadStore(storeRootDir);
    const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({
            sessionId: "session-thread-view-store",
            sessionFilePath: undefined,
          }),
        },
        threadStore,
      ),
    );

    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Active View",
      updatedAt: "2026-01-01T00:00:01.000Z",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: ["turn-001"],
        renderedStatus: "ready",
      }),
      status: "ready",
    });
    const draftView = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      name: "Draft View",
      updatedAt: "2026-01-01T00:00:02.000Z",
      status: "incomplete",
    });
    const archivedView = makeThreadView({
      threadId: thread.threadId,
      state: "archived",
      name: "Archived View",
      updatedAt: "2026-01-01T00:00:03.000Z",
      status: "unknown",
    });

    expectOk(await threadViewStore.createThreadView({ view: activeView }));
    expectOk(await threadViewStore.createThreadView({ view: draftView }));
    expectOk(await threadViewStore.createThreadView({ view: archivedView }));

    const listedViews = expectOk(await threadViewStore.listThreadViews(thread.threadId));
    const openedActiveView = expectOk(await threadViewStore.openThreadView(thread.threadId, activeView.threadViewId));
    const persistedThread = JSON.parse(await readFile(resolveThreadPath(thread.threadId, "thread.json"), "utf8")) as ThreadRecord;

    assert.equal(persistedThread.activeThreadViewId, activeView.threadViewId);
    assert.equal(
      JSON.parse(
        await readFile(
          resolveThreadViewsPath(thread.threadId, activeView.threadViewId, "thread-view.json"),
          "utf8",
        ),
      ).threadViewId,
      activeView.threadViewId,
    );
    assert.deepEqual(
      listedViews.map((view) => view.state),
      ["active", "draft", "archived"],
    );
    assert.equal(openedActiveView.view.threadViewId, activeView.threadViewId);
    assert.deepEqual(openedActiveView.view.fullFidelityBand.selectedIds, ["turn-001"]);
  });
});

test("active Thread View pointer and per-view state remain consistent on startup reconciliation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir, resolveThreadPath }) => {
    const threadStore = new FileThreadStore(storeRootDir);
    const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
    const thread = expectOk(
      await openOrCreateManagedThread(
        {
          target: makeThreadTarget({
            sessionId: "session-thread-view-reconcile",
            sessionFilePath: undefined,
          }),
        },
        threadStore,
      ),
    );

    const activeView = makeThreadView({
      threadId: thread.threadId,
      state: "active",
      name: "Only Active View",
      status: "ready",
    });
    expectOk(await threadViewStore.createThreadView({ view: activeView }));

    const threadJsonPath = resolveThreadPath(thread.threadId, "thread.json");
    const persistedThread = JSON.parse(await readFile(threadJsonPath, "utf8")) as ThreadRecord;
    persistedThread.activeThreadViewId = "thread_view_stale";
    await writeFile(threadJsonPath, `${JSON.stringify(persistedThread, null, 2)}\n`, "utf8");

    const listedViews = await threadViewStore.listThreadViews(thread.threadId);
    const reconciledThread = expectOk(await threadStore.openThread(thread.threadId));

    assert.equal(listedViews.ok, true);
    assert.equal(listedViews.issues?.[0]?.code, "THREAD_VIEW_STATE_CONFLICT");
    assert.equal(reconciledThread.thread.activeThreadViewId, activeView.threadViewId);
    assert.deepEqual(expectOk(listedViews).map((view) => view.threadViewId), [activeView.threadViewId]);
  });
});
