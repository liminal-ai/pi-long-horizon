import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import { STEWARD_ERROR_CODES } from "../../src/thread/domain/errors.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import {
  FileThreadMutationCoordinator,
  StaleThreadMutationError,
} from "../../src/thread/store/mutation-coordinator.js";
import {
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
} from "../../src/thread/async-thread/domain/smooth-turn-state.js";
import {
  createAsyncThreadBlocker,
  isAsyncThreadBlockerCode,
} from "../../src/thread/async-thread/domain/async-thread-status.js";
import {
  buildDraftThreadView,
} from "../../src/thread-view/services/thread-view-builder.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeChunkState,
  makePiThreadViewFile,
  makePlaceholderArtifactState,
  makeSmoothTurnState,
  makeThreadView,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import { makeThreadRecord, makeThreadTarget } from "../../src/context-steward/test/fixtures.js";

test("Feature 3 foundation exports the new blocker vocabulary and reusable stubs", async () => {
  for (const code of [
    "SMOOTH_MISSING",
    "SMOOTH_INVALID",
    "CHUNK_STATE_INVALID",
    "CHUNK_PLACEHOLDER_MISSING",
    "LOWER_THRESHOLD_UNREACHED",
    "GENERATED_WRITE_FAILED",
    "PI_RELOAD_FAILED",
  ] as const) {
    assert.equal(STEWARD_ERROR_CODES.includes(code), true);
    assert.equal(isAsyncThreadBlockerCode(code), true);
  }

  const blocker = createAsyncThreadBlocker({
    code: "SMOOTH_MISSING",
    message: "Smooth output is missing.",
    threadId: "thread-001",
  });

  assert.equal(blocker.code, "SMOOTH_MISSING");
  await assert.rejects(buildDraftThreadView({
    threadId: "thread-001",
    requestedLowerBound: 100,
    requestedBandPercentages: { fullFidelity: 40, smooth: 30, detailed: 20, brief: 10 },
    mode: "strict",
  }), /threadStore and threadViewStore dependencies/);
});

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

test("Feature 3 fixture builders and temp stores create usable scaffolding", async () => {
  const smooth = makeSmoothTurnState({ text: "  Smooth\nturn text " });
  const placeholders = makePlaceholderArtifactState();
  const openChunk = makeChunkState({ lifecycleStatus: "open" });
  const closedChunk = makeChunkState({ placeholders });
  const threadView = makeThreadView({ threadId: "thread-900", state: "draft" });
  const piFile = makePiThreadViewFile({
    threadId: threadView.threadId,
    threadViewId: threadView.threadViewId,
  });

  assert.equal(smooth.text, "Smooth turn text");
  assert.equal(openChunk.lifecycleStatus, "open");
  assert.equal(openChunk.closedAt, undefined);
  assert.equal(openChunk.closeReason, undefined);
  assert.equal(openChunk.placeholders, undefined);
  assert.equal(closedChunk.lifecycleStatus, "closed");
  assert.equal(closedChunk.closedAt, DEFAULT_TEST_TIMESTAMP);
  assert.equal(closedChunk.closeReason, "soft_threshold");
  assert.equal(closedChunk.placeholders?.detailed?.strategy, "deterministic_truncate_30");
  assert.equal(closedChunk.placeholders?.brief?.strategy, "deterministic_truncate_5");
  assert.equal(piFile.entryCount, piFile.entries.length);

  let projectDir = "";
  let storeRootDir = "";

  await withTempFeature3Store(async (context) => {
    projectDir = context.projectDir;
    storeRootDir = context.storeRootDir;

    assert.match(context.resolveThreadPath("thread-900", "thread.json"), /thread-900\/thread\.json$/);
    assert.match(
      context.resolveThreadViewsPath("thread-900", threadView.threadViewId, "thread-view.json"),
      /thread-900\/thread-views\/.+\/thread-view\.json$/,
    );
    assert.match(
      context.resolveGeneratedArchivePath("thread-900", "view-001.jsonl"),
      /thread-900\/archives\/pi-thread-views\/view-001\.jsonl$/,
    );

    await access(context.storeRootDir);
  });

  await assert.rejects(access(projectDir));
  await assert.rejects(access(storeRootDir));
});
