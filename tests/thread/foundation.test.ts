import assert from "node:assert/strict";
import test from "node:test";

import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import {
  FileThreadMutationCoordinator,
  StaleThreadMutationError,
} from "../../src/thread/store/mutation-coordinator.js";
import {
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
} from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";

test("deterministic token-count helpers are stable across reruns", () => {
  const text = "  Alpha\n\n beta\tgamma  ";
  const firstNormalized = normalizeDeterministicText(text);
  const secondNormalized = normalizeDeterministicText(text);
  const firstCount = estimateDeterministicTokenCount(text);
  const secondCount = estimateDeterministicTokenCount(` ${text} `);

  assert.equal(firstNormalized, secondNormalized);
  assert.equal(firstNormalized, "Alpha beta gamma");
  assert.equal(firstCount, secondCount);
  assert.equal(firstCount, 3);
});

test("thread-scoped mutation coordinator rejects stale revision writes cleanly", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const created = await store.createThread({
      thread: makeThreadRecord({
        threadId: "thread-stale",
        target: makeThreadTarget({ sessionId: "session-stale" }),
      }),
      targetRef: {
        runtime: "pi",
        sessionId: "session-stale",
      },
    });
    assert.equal(created.ok, true);

    const coordinator = new FileThreadMutationCoordinator(store);

    await assert.rejects(
      coordinator.acquireThreadLease({
        threadId: "thread-stale",
        expectedSourceRevision: 1,
      }),
      (error: unknown) => {
        assert.equal(error instanceof StaleThreadMutationError, true);
        assert.equal((error as StaleThreadMutationError).issue.code, "STALE_SOURCE_REVISION");
        return true;
      },
    );

    const lease = await coordinator.acquireThreadLease({
      threadId: "thread-stale",
      expectedSourceRevision: 0,
    });
    assert.equal(lease.threadId, "thread-stale");
    await lease.release();
  });
});
