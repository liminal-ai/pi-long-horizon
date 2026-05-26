import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { ThreadRecord } from "../../src/thread/domain/records.js";
import type { CompactThreadSnapshot } from "../../src/thread/store/thread-store.js";
import { SqliteThreadStore } from "../../src/thread/store/sqlite-thread-store.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import {
  createPathResolver,
  expectOk,
  fakeOpenAICounter,
  importDeterministicRebuildThreadToSqlite,
  rewriteSmoothTurnComponentText,
} from "./helpers/smart-compact-sqlite-helpers.js";

const SQLITE_READY_LOWER_BOUND = 2_000;
const SQLITE_SMOOTH_ONLY_BANDS = { fullFidelity: 0, smooth: 100, detailed: 0, brief: 0 } as const;

class InterleavingSqliteStore extends SqliteThreadStore {
  snapshotReadRevision: number | undefined;
  private appendedAfterSnapshot = false;

  override async readCompactSnapshot(threadId: string): Promise<StewardResult<CompactThreadSnapshot>> {
    const snapshot = await super.readCompactSnapshot(threadId);
    if (!snapshot.ok || this.appendedAfterSnapshot) {
      return snapshot;
    }

    this.snapshotReadRevision = snapshot.value.readRevision;
    this.appendedAfterSnapshot = true;
    const actor = snapshot.value.actors[0];
    assert.ok(actor);

    expectOk(
      await super.appendMessage({
        threadId,
        actor,
        message: {
          threadId,
          messageId: "message-smart-compact-snapshot-interleave",
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "runtime_event",
          parts: [
            {
              partId: "part-smart-compact-snapshot-interleave",
              partOrder: 1,
              partType: "text",
              content: "interleaved after compact snapshot",
            },
          ],
        },
        targetEventKey: "event-smart-compact-snapshot-interleave",
      }),
    );

    return snapshot;
  }
}

class MutatingSnapshotSqliteStore extends SqliteThreadStore {
  snapshotReadRevision: number | undefined;
  private mutatedAfterSnapshot = false;

  constructor(
    rootDir: string,
    private readonly turnId: string,
    private readonly nextText: string,
  ) {
    super(rootDir);
  }

  override async readCompactSnapshot(threadId: string): Promise<StewardResult<CompactThreadSnapshot>> {
    const snapshot = await super.readCompactSnapshot(threadId);
    if (!snapshot.ok || this.mutatedAfterSnapshot) {
      return snapshot;
    }

    this.snapshotReadRevision = snapshot.value.readRevision;
    this.mutatedAfterSnapshot = true;
    await rewriteSmoothTurnComponentText({
      store: this,
      threadId,
      turnId: this.turnId,
      nextText: this.nextText,
    });
    return snapshot;
  }
}

class PreSnapshotRevisionChangeSqliteStore extends SqliteThreadStore {
  sourceRevisionBeforeCompactSnapshot: number | undefined;
  private mutatedBeforeCompactSnapshot = false;

  constructor(
    rootDir: string,
    private readonly turnId: string,
    private readonly nextText: string,
  ) {
    super(rootDir);
  }

  override async assertCanMutate(threadId: string): Promise<StewardResult<ThreadRecord>> {
    if (!this.mutatedBeforeCompactSnapshot) {
      this.mutatedBeforeCompactSnapshot = true;
      await rewriteSmoothTurnComponentText({
        store: this,
        threadId,
        turnId: this.turnId,
        nextText: this.nextText,
      });
    }

    const result = await super.assertCanMutate(threadId);
    if (result.ok) {
      this.sourceRevisionBeforeCompactSnapshot = result.value.sourceRevision;
    }

    return result;
  }
}

async function rewriteLegacySmoothTurnComponentText(input: {
  turnsFilePath: string;
  turnId: string;
  nextText: string;
}): Promise<void> {
  const turns = JSON.parse(await readFile(input.turnsFilePath, "utf8")) as Array<{
    turnId: string;
    smooth?: { components?: Array<{ text?: string }> };
  }>;

  const nextTurns = turns.map((turn) => {
    if (turn.turnId !== input.turnId || !turn.smooth?.components?.length) {
      return turn;
    }

    return {
      ...turn,
      smooth: {
        ...turn.smooth,
        components: turn.smooth.components.map((component, index) => ({
          ...component,
          text: index === 0 ? input.nextText : component.text,
        })),
      },
    };
  });

  await writeFile(input.turnsFilePath, `${JSON.stringify(nextTurns, null, 2)}\n`, "utf8");
}

test("strict smart compact pins generated-session source revision to the SQLite compact snapshot", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);
    const store = new InterleavingSqliteStore(context.storeRootDir);

    const result = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_SMOOTH_ONLY_BANDS,
        mode: "strict",
      },
      {
        threadStore: store,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.equal(result.generatedSessionTokenCountMetadata?.sourceRevision, store.snapshotReadRevision);

    const reopened = expectOk(await store.openThread(imported.threadId));
    assert.equal(reopened.thread.sourceRevision, (store.snapshotReadRevision ?? 0) + 1);
    assert.equal(reopened.messages.at(-1)?.messageId, "message-smart-compact-snapshot-interleave");
  });
});

test("strict smart compact does not throw stale source revision when SQLite source changes before compact snapshot acquisition", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);
    const liveUpdatedText = "LIVE_SQLITE_TEXT_BEFORE_COMPACT_SNAPSHOT";
    const store = new PreSnapshotRevisionChangeSqliteStore(
      context.storeRootDir,
      imported.turns.newest.turnId,
      liveUpdatedText,
    );

    const result = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_SMOOTH_ONLY_BANDS,
        mode: "strict",
      },
      {
        threadStore: store,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.equal(result.blockers.some((issue) => issue.code === "STALE_SOURCE_REVISION"), false);
    assert.ok(result.generatedFilePath);

    const generatedContent = await readFile(result.generatedFilePath!, "utf8");
    assert.equal(generatedContent.includes(liveUpdatedText), true);

    const reopened = expectOk(await store.openThread(imported.threadId));
    assert.equal(result.generatedSessionTokenCountMetadata?.sourceRevision, reopened.thread.sourceRevision);
    assert.equal(result.generatedSessionTokenCountMetadata?.sourceRevision, store.sourceRevisionBeforeCompactSnapshot);
  });
});

test("strict smart compact renders selected SQLite smooth content from the compact snapshot instead of post-snapshot mutations", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);
    const preSnapshotText = "PRE_SNAPSHOT_SELECTED_TEXT";
    const postSnapshotText = "POST_SNAPSHOT_SELECTED_TEXT";

    await rewriteSmoothTurnComponentText({
      store: imported.sqliteStore,
      threadId: imported.threadId,
      turnId: imported.turns.newest.turnId,
      nextText: preSnapshotText,
    });

    const store = new MutatingSnapshotSqliteStore(
      context.storeRootDir,
      imported.turns.newest.turnId,
      postSnapshotText,
    );

    const result = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_SMOOTH_ONLY_BANDS,
        mode: "strict",
      },
      {
        threadStore: store,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(result.compactStatus, "success");
    assert.ok(result.generatedFilePath);

    const regeneratedContent = await readFile(result.generatedFilePath!, "utf8");
    assert.equal(regeneratedContent.includes(preSnapshotText), true);
    assert.equal(regeneratedContent.includes(postSnapshotText), false);

    const reopened = expectOk(await store.openThread(imported.threadId));
    const mutatedTurn = reopened.turns.find((turn) => turn.turnId === imported.turns.newest.turnId);
    assert.equal(mutatedTurn?.smooth?.components?.[0]?.text, postSnapshotText);
  });
});

test("strict smart compact rebuilds from current SQLite managed state instead of legacy JSON or a prior generated rollout", async () => {
  await withTempFeature3Store(async (context) => {
    const imported = await importDeterministicRebuildThreadToSqlite(context);

    const first = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_SMOOTH_ONLY_BANDS,
        mode: "strict",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(first.compactStatus, "success");
    assert.ok(first.generatedFilePath);
    await writeFile(first.generatedFilePath!, "GENERATED_POISON\n", "utf8");

    await rewriteSmoothTurnComponentText({
      store: imported.sqliteStore,
      threadId: imported.threadId,
      turnId: imported.turns.newest.turnId,
      nextText: "SQLITE_MANAGED_TEXT",
    });
    await rewriteLegacySmoothTurnComponentText({
      turnsFilePath: context.resolveThreadPath(imported.threadId, "turns.json"),
      turnId: imported.turns.newest.turnId,
      nextText: "LEGACY_POISON",
    });

    const second = await runSmartCompact(
      {
        threadId: imported.threadId,
        requestedLowerBound: SQLITE_READY_LOWER_BOUND,
        requestedBandPercentages: SQLITE_SMOOTH_ONLY_BANDS,
        mode: "strict",
      },
      {
        threadStore: imported.sqliteStore,
        openAIInputTokenCounter: fakeOpenAICounter,
        piThreadViewWriterOptions: {
          pathResolver: createPathResolver(context),
        },
        piSessionSwitch: {
          switchSession: async () => ({ cancelled: false }),
        },
      },
    );

    assert.equal(second.compactStatus, "success");
    assert.ok(second.generatedFilePath);

    const regeneratedContent = await readFile(second.generatedFilePath!, "utf8");
    assert.match(regeneratedContent, /SQLITE_MANAGED_TEXT/);
    assert.doesNotMatch(regeneratedContent, /GENERATED_POISON/);
    assert.doesNotMatch(regeneratedContent, /LEGACY_POISON/);
  });
});
