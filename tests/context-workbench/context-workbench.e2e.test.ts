import assert from "node:assert/strict";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import type { MessageRecord, ThreadRecord } from "../../src/context-steward/domain/records.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
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
import type { WorkbenchChunkRead } from "../../src/context-workbench/domain/thread-view-records.js";
import { ThreadViewActivationService } from "../../src/context-workbench/services/thread-view-activation-service.js";
import { ThreadViewCompareService } from "../../src/context-workbench/services/thread-view-compare-service.js";
import { ThreadViewEditService } from "../../src/context-workbench/services/thread-view-edit-service.js";
import {
  formatSmoothTurnFromMessages,
} from "../../src/context-workbench/services/thread-view-materializer.js";
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

function normalizeSourceSnapshot(snapshot: ThreadSnapshot) {
  const { activeThreadViewId: _activeThreadViewId, updatedAt: _updatedAt, ...thread } = snapshot.thread;
  return {
    thread,
    messages: snapshot.messages,
    turns: snapshot.turns,
    imports: snapshot.imports,
    projections: snapshot.projections,
  };
}

async function appendThreadMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actorId: string;
  actorType: "human" | "agent" | "tool";
  displayName: string;
  messageId: string;
  messageKind: MessageRecord["messageKind"];
  parts: ReturnType<typeof makePartRecord>[];
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
        parts: input.parts,
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

async function createWorkbenchHarness(
  storeRootDir: string,
  options: { chunkReader?: InMemoryChunkReader } = {},
) {
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);

  return {
    threadStore,
    threadViewStore,
    queryService: new WorkbenchQueryService(threadStore, threadViewStore, options.chunkReader),
    editService: new ThreadViewEditService(threadStore, threadViewStore),
    compareService: new ThreadViewCompareService(threadViewStore),
    activationService: new ThreadViewActivationService(threadViewStore),
  };
}

async function seedWorkbenchFlow(storeRootDir: string) {
  const harness = await createWorkbenchHarness(storeRootDir);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: makeThreadTarget({
          sessionId: "session-context-workbench-e2e",
          sessionFilePath: undefined,
        }),
      },
      harness.threadStore,
    ),
  );

  const alphaPrompt = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-e2e",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-e2e-001",
    messageKind: "prompt",
    parts: [makePartRecord({ content: "Bring in the alpha active context." })],
  });
  const alphaResponse = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-e2e",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-e2e-002",
    messageKind: "response",
    parts: [
      makePartRecord({ partType: "reasoning", content: { text: "Tracing the active lane." } }),
      makePartRecord({ content: "Alpha active context is ready for operators." }),
    ],
  });
  const alphaTool = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-tool-e2e",
    actorType: "tool",
    displayName: "Search Tool",
    messageId: "message-e2e-003",
    messageKind: "tool_result",
    parts: [
      makePartRecord({
        partType: "tool_result",
        content: { summary: "alpha lookup", files: ["src/context-workbench/services/thread-view-edit-service.ts"] },
      }),
    ],
  });
  const betaPrompt = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-human-e2e",
    actorType: "human",
    displayName: "Steward",
    messageId: "message-e2e-004",
    messageKind: "prompt",
    parts: [makePartRecord({ content: "Compare the beta draft path before activation." })],
  });
  const betaResponse = await appendThreadMessage({
    store: harness.threadStore,
    threadId: thread.threadId,
    actorId: "actor-agent-e2e",
    actorType: "agent",
    displayName: "Pair Agent",
    messageId: "message-e2e-005",
    messageKind: "response",
    parts: [makePartRecord({ content: "Beta draft keeps the active lane safe until review clears it." })],
  });

  const turns = await writeTurns(harness.threadStore, thread.threadId, [
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-e2e-alpha",
      turnOrder: 1,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: alphaPrompt.messageId,
      messageIds: [alphaPrompt.messageId, alphaResponse.messageId, alphaTool.messageId],
      sourceRange: {
        fromSourceOrder: alphaPrompt.sourceOrder,
        toSourceOrder: alphaTool.sourceOrder,
      },
      sourceRevision: betaResponse.sourceRevision,
      openedAt: alphaPrompt.capturedAt,
      closedAt: alphaTool.capturedAt,
      smooth: {
        text: formatSmoothTurnFromMessages([alphaPrompt, alphaResponse, alphaTool]),
        tokenCount: 20,
      },
    }),
    makeTurnRecord({
      threadId: thread.threadId,
      turnId: "turn-e2e-beta",
      turnOrder: 2,
      lifecycleStatus: "closed",
      repairStatus: "ready",
      initiatingMessageId: betaPrompt.messageId,
      messageIds: [betaPrompt.messageId, betaResponse.messageId],
      sourceRange: {
        fromSourceOrder: betaPrompt.sourceOrder,
        toSourceOrder: betaResponse.sourceOrder,
      },
      sourceRevision: betaResponse.sourceRevision,
      openedAt: betaPrompt.capturedAt,
      closedAt: betaResponse.capturedAt,
      smooth: {
        text: formatSmoothTurnFromMessages([betaPrompt, betaResponse]),
        tokenCount: 12,
      },
    }),
  ]);

  const activeView = makeThreadView({
    threadId: thread.threadId,
    state: "active",
    name: "Active Alpha View",
    purpose: "Carry the approved alpha operator context.",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [turns[0].turnId],
      renderedStatus: "ready",
    }),
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "active-alpha-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: `${turns[0].turnId}/${alphaPrompt.messageId}`,
        content: "human",
      }),
      makeThreadViewMessage({
        threadViewId: "active-alpha-temp",
        bandType: "full_fidelity",
        messageOrder: 2,
        sourceReference: `${turns[0].turnId}/${alphaResponse.messageId}`,
        content: "agent",
      }),
      makeThreadViewMessage({
        threadViewId: "active-alpha-temp",
        bandType: "full_fidelity",
        messageOrder: 3,
        sourceReference: `${turns[0].turnId}/${alphaTool.messageId}`,
        content: "tool",
      }),
    ],
    status: "ready",
  });

  expectOk(await harness.threadViewStore.createThreadView({ view: activeView }));

  return {
    ...harness,
    thread,
    turns: {
      alpha: turns[0],
      beta: turns[1],
    },
    views: {
      active: activeView,
    },
  };
}

async function createMaterializedDraft(input: {
  editService: ThreadViewEditService;
  threadId: string;
  fullFidelityTurnId: string;
  smoothTurnId: string;
}) {
  const draft = expectOk(
    await input.editService.createDraftThreadView({
      threadId: input.threadId,
      name: "Draft Beta View",
      purpose: "Stage the beta comparison before activation.",
      now: () => new Date("2026-05-10T23:30:00.000Z"),
    }),
  );

  return expectOk(
    await input.editService.updateThreadViewBands({
      threadId: input.threadId,
      threadViewId: draft.threadViewId,
      fullFidelityBand: makeBandRecord({
        bandType: "full_fidelity",
        selectedIds: [input.fullFidelityTurnId],
      }),
      smoothBand: makeBandRecord({
        bandType: "smooth",
        selectedIds: [input.smoothTurnId],
      }),
      now: () => new Date("2026-05-10T23:31:00.000Z"),
    }),
  );
}

test("opens Thread with active Thread View", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { queryService, thread, views } = await seedWorkbenchFlow(storeRootDir);

    const opened = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(opened.thread.threadId, thread.threadId);
    assert.equal(opened.activeThreadView?.threadViewId, views.active.threadViewId);
    assert.deepEqual(opened.threadViews.map((view) => view.state), ["active"]);
  });
});

test("creates empty draft", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, thread } = await seedWorkbenchFlow(storeRootDir);

    const draft = expectOk(
      await editService.createDraftThreadView({
        threadId: thread.threadId,
        name: "Draft Empty View",
        purpose: "Start empty before curation.",
        now: () => new Date("2026-05-10T23:20:00.000Z"),
      }),
    );
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: draft.threadViewId,
      }),
    );

    assert.equal(detail.view.state, "draft");
    assert.deepEqual(detail.view.fullFidelityBand.selectedIds, []);
    assert.deepEqual(detail.view.smoothBand.selectedIds, []);
    assert.equal(detail.view.emittedMessages.length, 0);
  });
});

test("fills upper bands and materializes emitted output", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { editService, queryService, thread, turns } = await seedWorkbenchFlow(storeRootDir);

    const updatedDraft = await createMaterializedDraft({
      editService,
      threadId: thread.threadId,
      fullFidelityTurnId: turns.beta.turnId,
      smoothTurnId: turns.alpha.turnId,
    });
    const detail = expectOk(
      await queryService.openThreadViewDetail({
        threadId: thread.threadId,
        threadViewId: updatedDraft.threadViewId,
      }),
    );

    assert.equal(updatedDraft.status, "ready");
    assert.deepEqual(
      detail.view.emittedMessages.map((message) => message.bandType),
      ["full_fidelity", "full_fidelity", "smooth"],
    );
    assert.deepEqual(detail.view.fullFidelityBand.selectedIds, [turns.beta.turnId]);
    assert.deepEqual(detail.view.smoothBand.selectedIds, [turns.alpha.turnId]);
  });
});

test("compares draft and active views", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { compareService, editService, thread, turns, views } = await seedWorkbenchFlow(storeRootDir);
    const draft = await createMaterializedDraft({
      editService,
      threadId: thread.threadId,
      fullFidelityTurnId: turns.beta.turnId,
      smoothTurnId: turns.alpha.turnId,
    });

    const comparison = expectOk(
      await compareService.compareThreadViews({
        threadId: thread.threadId,
        activeThreadViewId: views.active.threadViewId,
        draftThreadViewId: draft.threadViewId,
      }),
    );

    assert.deepEqual(comparison.bandDifferences, [
      {
        bandType: "full_fidelity",
        addedIds: [turns.beta.turnId],
        removedIds: [turns.alpha.turnId],
      },
      {
        bandType: "smooth",
        addedIds: [turns.alpha.turnId],
        removedIds: [],
      },
    ]);
    assert.ok(comparison.emittedMessageDifferences.length > 0);
  });
});

test("activates draft and archives prior active", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, editService, queryService, thread, turns, views } = await seedWorkbenchFlow(storeRootDir);
    const draft = await createMaterializedDraft({
      editService,
      threadId: thread.threadId,
      fullFidelityTurnId: turns.beta.turnId,
      smoothTurnId: turns.alpha.turnId,
    });

    const activated = expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: draft.threadViewId,
        now: () => new Date("2026-05-10T23:40:00.000Z"),
      }),
    );
    const opened = expectOk(await queryService.openThread({ threadId: thread.threadId }));

    assert.equal(activated.active.threadViewId, draft.threadViewId);
    assert.equal(activated.archived.threadViewId, views.active.threadViewId);
    assert.equal(opened.activeThreadView?.threadViewId, draft.threadViewId);
    assert.equal(
      opened.threadViews.find((view) => view.threadViewId === views.active.threadViewId)?.state,
      "archived",
    );
  });
});

test("rejects activation when emitted output is required but missing", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, editService, thread } = await seedWorkbenchFlow(storeRootDir);
    const draft = expectOk(
      await editService.createDraftThreadView({
        threadId: thread.threadId,
        name: "Unmaterialized Draft",
      }),
    );

    const rejected = await activationService.activateDraftThreadView({
      threadId: thread.threadId,
      draftThreadViewId: draft.threadViewId,
    });

    assert.equal(rejected.ok, false);
    assert.equal(rejected.issues[0]?.code, "THREAD_VIEW_MATERIALIZATION_REQUIRED");
  });
});

test("opens fixture Thread through workbench flow", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { threadStore, queryService, thread } = await seedWorkbenchFlow(storeRootDir);
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

test("reports lower-band blocker for open or incomplete chunk", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const flow = await seedWorkbenchFlow(storeRootDir);
    const chunkReader = new InMemoryChunkReader({
      [flow.thread.threadId]: [
        {
          chunkId: "chunk-open",
          lifecycleStatus: "open",
          sourceTurnIds: [flow.turns.alpha.turnId],
          detailedSummary: "Open chunk should still stay ineligible.",
        },
        {
          chunkId: "chunk-missing",
          lifecycleStatus: "closed",
          sourceTurnIds: [flow.turns.beta.turnId],
          smoothText: "Chunk exists but lower-band artifacts are incomplete.",
        },
      ],
    });
    const harness = await createWorkbenchHarness(storeRootDir, { chunkReader });
    const lowerBandDraft = expectOk(
      await harness.editService.createDraftThreadView({
        threadId: flow.thread.threadId,
        name: "Lower Band Draft",
      }),
    );
    expectOk(
      await harness.threadViewStore.updateThreadView({
        threadId: flow.thread.threadId,
        threadViewId: lowerBandDraft.threadViewId,
        expectedUpdatedAt: lowerBandDraft.updatedAt,
        patch: {
          detailedBand: makeBandRecord({
            bandType: "detailed",
            selectedIds: ["chunk-open", "chunk-missing"],
          }),
          briefBand: makeBandRecord({
            bandType: "brief",
            selectedIds: ["chunk-open", "chunk-missing"],
          }),
        },
      }),
    );

    const readiness = expectOk(
      await harness.queryService.inspectLowerBandReadiness({
        threadId: flow.thread.threadId,
        threadViewId: lowerBandDraft.threadViewId,
      }),
    );

    assert.equal(
      readiness.detailedBand.find((entry) => entry.chunkId === "chunk-open")?.status,
      "ineligible_open_chunk",
    );
    assert.equal(
      readiness.detailedBand.find((entry) => entry.chunkId === "chunk-missing")?.status,
      "missing_artifacts",
    );
    assert.equal(
      readiness.briefBand.find((entry) => entry.chunkId === "chunk-missing")?.status,
      "missing_artifacts",
    );
  });
});

test("source Thread unchanged after view edits and activation", async () => {
  await withTempWorkbenchStore(async ({ storeRootDir }) => {
    const { activationService, editService, threadStore, thread, turns } = await seedWorkbenchFlow(storeRootDir);
    const before = expectOk(await threadStore.openThread(thread.threadId));
    const draft = await createMaterializedDraft({
      editService,
      threadId: thread.threadId,
      fullFidelityTurnId: turns.beta.turnId,
      smoothTurnId: turns.alpha.turnId,
    });

    expectOk(
      await activationService.activateDraftThreadView({
        threadId: thread.threadId,
        draftThreadViewId: draft.threadViewId,
      }),
    );
    const after = expectOk(await threadStore.openThread(thread.threadId));

    assert.deepEqual(normalizeSourceSnapshot(after), normalizeSourceSnapshot(before));
  });
});
