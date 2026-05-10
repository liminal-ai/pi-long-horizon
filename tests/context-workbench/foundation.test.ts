import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  BAND_ORDER,
  cloneThreadViewRecord,
  concatenateBandMessages,
  createThreadViewId,
  createThreadViewMessageId,
  orderThreadViewMessages,
} from "../../src/context-workbench/domain/thread-view-records.js";
import { isWorkbenchErrorCode } from "../../src/context-workbench/domain/workbench-errors.js";
import {
  makeBandRecord,
  makeThreadSnapshot,
  makeThreadView,
  makeThreadViewMessage,
  makeWorkbenchSearchInput,
} from "../../src/context-workbench/test/fixtures.js";
import { withTempWorkbenchStore } from "../../src/context-workbench/test/temp-workbench-store.js";

test("Thread View id and emitted-message ordering helpers are deterministic", () => {
  const seed = {
    threadId: "thread-123",
    state: "draft",
    name: "Draft A",
    purpose: "Compare upper bands",
    createdAt: "2026-05-10T19:25:00.000Z",
  };
  const firstThreadViewId = createThreadViewId(seed);
  const secondThreadViewId = createThreadViewId({ ...seed });
  const firstMessageId = createThreadViewMessageId({
    threadViewId: firstThreadViewId,
    bandType: "smooth",
    sourceReference: "turn-100",
    messageOrder: 2,
  });
  const secondMessageId = createThreadViewMessageId({
    threadViewId: secondThreadViewId,
    bandType: "smooth",
    sourceReference: "turn-100",
    messageOrder: 2,
  });
  const ordered = orderThreadViewMessages([
    makeThreadViewMessage({
      threadViewId: firstThreadViewId,
      bandType: "smooth",
      threadViewMessageId: "message-b",
      sourceReference: "turn-002",
      messageOrder: 2,
    }),
    makeThreadViewMessage({
      threadViewId: firstThreadViewId,
      bandType: "full_fidelity",
      threadViewMessageId: "message-a",
      sourceReference: "turn-001",
      messageOrder: 3,
    }),
    makeThreadViewMessage({
      threadViewId: firstThreadViewId,
      bandType: "full_fidelity",
      threadViewMessageId: "message-c",
      sourceReference: "turn-001",
      messageOrder: 1,
    }),
  ]);

  assert.equal(firstThreadViewId, secondThreadViewId);
  assert.equal(firstMessageId, secondMessageId);
  assert.deepEqual(
    ordered.map((message) => ({
      bandType: message.bandType,
      messageOrder: message.messageOrder,
      threadViewMessageId: message.threadViewMessageId,
    })),
    [
      { bandType: "full_fidelity", messageOrder: 1, threadViewMessageId: "message-c" },
      { bandType: "full_fidelity", messageOrder: 3, threadViewMessageId: "message-a" },
      { bandType: "smooth", messageOrder: 2, threadViewMessageId: "message-b" },
    ],
  );
});

test("band-order concatenation helpers preserve full_fidelity smooth detailed brief", () => {
  const threadView = makeThreadView({ state: "active", status: "ready" });
  const concatenated = concatenateBandMessages({
    brief: [
      makeThreadViewMessage({
        threadViewId: threadView.threadViewId,
        bandType: "brief",
        messageOrder: 1,
        sourceReference: "chunk-010",
      }),
    ],
    full_fidelity: [
      makeThreadViewMessage({
        threadViewId: threadView.threadViewId,
        bandType: "full_fidelity",
        messageOrder: 2,
        sourceReference: "turn-002",
      }),
      makeThreadViewMessage({
        threadViewId: threadView.threadViewId,
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: "turn-001",
      }),
    ],
    smooth: [
      makeThreadViewMessage({
        threadViewId: threadView.threadViewId,
        bandType: "smooth",
        messageOrder: 1,
        sourceReference: "turn-003",
      }),
    ],
    detailed: [
      makeThreadViewMessage({
        threadViewId: threadView.threadViewId,
        bandType: "detailed",
        messageOrder: 1,
        sourceReference: "chunk-001",
      }),
    ],
  });

  assert.deepEqual(BAND_ORDER, ["full_fidelity", "smooth", "detailed", "brief"]);
  assert.deepEqual(
    concatenated.map((message) => ({
      bandType: message.bandType,
      messageOrder: message.messageOrder,
      sourceReference: message.sourceReference,
    })),
    [
      { bandType: "full_fidelity", messageOrder: 1, sourceReference: "turn-001" },
      { bandType: "full_fidelity", messageOrder: 2, sourceReference: "turn-002" },
      { bandType: "smooth", messageOrder: 3, sourceReference: "turn-003" },
      { bandType: "detailed", messageOrder: 4, sourceReference: "chunk-001" },
      { bandType: "brief", messageOrder: 5, sourceReference: "chunk-010" },
    ],
  );
});

test("fixture builders and temp workbench store helper produce complete workbench scaffolding", async () => {
  const fullFidelityBand = makeBandRecord({
    bandType: "full_fidelity",
    selectedIds: ["turn-001", "turn-002"],
    renderedStatus: "ready",
  });
  const smoothBand = makeBandRecord({
    bandType: "smooth",
    selectedIds: ["turn-003"],
    renderedStatus: "ready",
  });
  const threadView = makeThreadView({
    threadId: "thread-901",
    state: "draft",
    name: "Operator draft",
    purpose: "Stage comparison",
    status: "incomplete",
    fullFidelityBand,
    smoothBand,
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId: "thread-view-temp",
        bandType: "full_fidelity",
        messageOrder: 1,
        sourceReference: "turn-001/message-001",
        content: { text: "Full fidelity content" },
      }),
    ],
  });
  const snapshot = makeThreadSnapshot();
  const searchInput = makeWorkbenchSearchInput({
    threadId: threadView.threadId,
    scope: "thread_view",
    query: "draft",
    filters: { state: "draft" },
  });

  assert.equal(threadView.threadId, "thread-901");
  assert.equal(threadView.state, "draft");
  assert.equal(threadView.fullFidelityBand.sourceUnitType, "turn");
  assert.equal(threadView.smoothBand.sourceUnitType, "turn");
  assert.equal(threadView.detailedBand.sourceUnitType, "chunk");
  assert.equal(threadView.briefBand.sourceUnitType, "chunk");
  assert.equal(threadView.emittedMessages[0]?.threadViewId, threadView.threadViewId);
  assert.deepEqual(cloneThreadViewRecord(threadView), threadView);
  assert.equal(snapshot.thread.threadId, "thread-001");
  assert.deepEqual(searchInput, {
    threadId: "thread-901",
    scope: "thread_view",
    query: "draft",
    filters: { state: "draft" },
  });
  assert.equal(isWorkbenchErrorCode("THREAD_VIEW_NOT_FOUND"), true);
  assert.equal(isWorkbenchErrorCode("STALE_SOURCE_REVISION"), false);

  let projectDir = "";
  let storeRootDir = "";

  await withTempWorkbenchStore(async (context) => {
    projectDir = context.projectDir;
    storeRootDir = context.storeRootDir;

    assert.match(context.resolveThreadPath("thread-001", "thread.json"), /thread-001\/thread\.json$/);
    assert.match(
      context.resolveThreadViewsPath("thread-001", "draft-001", "thread-view.json"),
      /thread-001\/thread-views\/draft-001\/thread-view\.json$/,
    );

    await access(context.storeRootDir);
  });

  await assert.rejects(access(projectDir));
  await assert.rejects(access(storeRootDir));
});
