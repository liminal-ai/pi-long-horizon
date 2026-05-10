import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import { makeThreadTarget } from "../../src/context-steward/test/fixtures.js";
import { ThreadViewCompareService } from "../../src/context-workbench/services/thread-view-compare-service.js";
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

async function seedComparisonHarness(storeRootDir: string) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const compareService = new ThreadViewCompareService(threadViewStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-compare-thread-views",
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
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "active-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: "turn-001/message-001",
        content: "Active full fidelity message",
      }),
      makeThreadViewMessage({
        threadViewId: "active-temp",
        bandType: "smooth",
        messageOrder: 2,
        sourceReference: "turn-002",
        content: "Active smooth message",
      }),
    ],
    status: "ready",
  });
  const draftView = makeThreadView({
    threadId: thread.threadId,
    state: "draft",
    name: "Draft View",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: ["turn-002"],
      renderedStatus: "ready",
    }),
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: ["turn-003"],
      renderedStatus: "ready",
    }),
    detailedBand: makeBandRecord({
      bandType: "detailed",
      selectedIds: ["chunk-002"],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "draft-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: "turn-002/message-009",
        content: "Draft full fidelity message",
      }),
      makeThreadViewMessage({
        threadViewId: "draft-temp",
        bandType: "smooth",
        messageOrder: 2,
        sourceReference: "turn-003",
        content: "Draft smooth message",
      }),
    ],
    status: "ready",
  });

  expectOk(await threadViewStore.createThreadView({ view: activeView }));
  expectOk(await threadViewStore.createThreadView({ view: draftView }));

  return { thread, compareService, threadViewStore, views: { active: activeView, draft: draftView } };
}

test("compares band-level differences", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread, compareService, views } = await seedComparisonHarness(storeRootDir);

    const result = expectOk(
      await compareService.compareThreadViews({
        threadId: thread.threadId,
        activeThreadViewId: views.active.threadViewId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );

    assert.deepEqual(
      result.bandDifferences.map((difference) => difference.bandType),
      ["full_fidelity", "smooth", "detailed"],
    );
  });
});

test("compares selected source-unit differences", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread, compareService, views } = await seedComparisonHarness(storeRootDir);

    const result = expectOk(
      await compareService.compareThreadViews({
        threadId: thread.threadId,
        activeThreadViewId: views.active.threadViewId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );

    assert.deepEqual(result.bandDifferences, [
      {
        bandType: "full_fidelity",
        addedIds: ["turn-002"],
        removedIds: ["turn-001"],
      },
      {
        bandType: "smooth",
        addedIds: ["turn-003"],
        removedIds: ["turn-002"],
      },
      {
        bandType: "detailed",
        addedIds: ["chunk-002"],
        removedIds: ["chunk-001"],
      },
    ]);
  });
});

test("draft emitted message sequence is inspectable before activation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread, compareService, views } = await seedComparisonHarness(storeRootDir);

    const result = expectOk(
      await compareService.compareThreadViews({
        threadId: thread.threadId,
        activeThreadViewId: views.active.threadViewId,
        draftThreadViewId: views.draft.threadViewId,
      }),
    );

    assert.deepEqual(
      result.emittedMessageDifferences.map((difference) => ({
        messageOrder: difference.messageOrder,
        draft: difference.draft?.content,
      })),
      [
        { messageOrder: 1, draft: "Draft full fidelity message" },
        { messageOrder: 2, draft: "Draft smooth message" },
      ],
    );
  });
});

test("missing materialized output is explicit", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread, compareService, threadViewStore, views } = await seedComparisonHarness(storeRootDir);
    const unmaterializedDraft = makeThreadView({
      threadId: thread.threadId,
      state: "draft",
      name: "Unmaterialized Draft",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: ["turn-002"],
      }),
      emittedMessages: [],
      status: "incomplete",
    });
    expectOk(await threadViewStore.createThreadView({ view: unmaterializedDraft }));

    const result = await compareService.compareThreadViews({
      threadId: thread.threadId,
      activeThreadViewId: views.active.threadViewId,
      draftThreadViewId: unmaterializedDraft.threadViewId,
    });

    assert.equal(result.ok, true);
    assert.equal(result.issues?.some((issue) => issue.code === "THREAD_VIEW_MATERIALIZATION_REQUIRED"), true);
    assert.deepEqual(
      expectOk(result).emittedMessageDifferences.map((difference) => ({
        messageOrder: difference.messageOrder,
        active: difference.active?.content,
        draft: difference.draft?.content,
      })),
      [
        { messageOrder: 1, active: "Active full fidelity message", draft: undefined },
        { messageOrder: 2, active: "Active smooth message", draft: undefined },
      ],
    );
  });
});

test("comparison ignores archived views unless explicitly requested", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { thread, compareService, threadViewStore, views } = await seedComparisonHarness(storeRootDir);
    const archivedView = makeThreadView({
      threadId: thread.threadId,
      state: "archived",
      name: "Archived Candidate",
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: ["turn-009"],
      }),
      emittedMessages: [
        makeThreadViewMessage({
          threadViewId: "archived-temp",
          bandType: "full_fidelity",
          messageOrder: 1,
          sourceReference: "turn-009/message-001",
          content: "Archived message",
        }),
      ],
    });
    expectOk(await threadViewStore.createThreadView({ view: archivedView }));

    const rejected = await compareService.compareThreadViews({
      threadId: thread.threadId,
      activeThreadViewId: views.active.threadViewId,
      draftThreadViewId: archivedView.threadViewId,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.issues[0]?.code, "THREAD_VIEW_STATE_CONFLICT");

    const allowed = expectOk(
      await compareService.compareThreadViews({
        threadId: thread.threadId,
        activeThreadViewId: views.active.threadViewId,
        draftThreadViewId: archivedView.threadViewId,
        allowArchived: true,
      }),
    );
    assert.equal(allowed.bandDifferences[0]?.bandType, "full_fidelity");
  });
});
