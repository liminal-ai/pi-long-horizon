import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import {
  createManagedThreadSnapshot,
  restoreManagedThreadSnapshot,
} from "../../src/context-steward/services/snapshot-export-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread, updateGeneratedThreadViewOutputMetadata } from "../../src/context-steward/services/thread-service.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore, withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { assertTokenCountRecord } from "../../src/token-accounting/token-count-metadata.js";
import { runCli } from "../../packages/lh-context/src/commands/run.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function capturePiMessage(
  store: SqliteThreadStore,
  threadId: string,
  target: ReturnType<typeof makeThreadTarget>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(
    mapPiMessageEnd({
      message,
      ctx: makePiExtensionContext(target),
    }),
  );

  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
    }),
  );
}

async function prepareManagedThread(
  input: {
    projectDir: string;
    storeRootDir: string;
    resolveProjectPath: (...segments: string[]) => string;
  },
  options: { withGeneratedRollout: boolean },
) {
  const store = new SqliteThreadStore(input.storeRootDir);
  const target = makeThreadTarget({
    sessionId: "session-snapshot-export-001",
    sessionFilePath: input.resolveProjectPath("pi", "session-snapshot-export-001.jsonl"),
    cwd: input.projectDir,
  });
  const thread = expectOk(await openOrCreateManagedThread({ target }, store));

  await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Snapshot prompt" }));
  await capturePiMessage(
    store,
    thread.threadId,
    target,
    makePiAssistantMessage({
      responseId: "response-snapshot-export-001",
      content: [{ type: "text", text: "Snapshot response" }],
    }),
  );

  const snapshot = expectOk(await store.openThread(thread.threadId));
  const currentTurn = snapshot.turns[0];
  assert.ok(currentTurn);

  const generatedFilePath = input.resolveProjectPath("generated-rollouts", "snapshot-export-001.jsonl");
  if (options.withGeneratedRollout) {
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      [
        JSON.stringify({
          type: "custom",
          customType: "pi-long-horizon.thread-view.output",
          data: {
            entries: [
              {
                metadata: {
                  bandType: "full_fidelity",
                  sourceReference: `turn:${currentTurn.turnId}`,
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            usage: { totalTokens: 777 },
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
  }

  expectOk(
    await updateGeneratedThreadViewOutputMetadata({
      store,
      threadId: thread.threadId,
      generatedFilePath,
      generatedOutput: {
        threadId: thread.threadId,
        generatedSource: "thread_view",
        generatedFilePath,
        generatedAt: "2026-02-01T00:00:00.000Z",
        placeholderExplicit: false,
        status: "available",
        generatedSessionTokenCountMetadata: assertTokenCountRecord({
          count: 321,
          scope: "generated_session",
          source: "provider_input_count",
          trustClass: "exact",
          provider: "openai",
          model: "gpt-5.4-mini",
          representationHash: "sha256:snapshot-export-001",
          sourceRevision: snapshot.thread.sourceRevision,
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
      },
    }),
  );

  return { store, threadId: thread.threadId, generatedFilePath };
}

test("SQLite snapshot bundles thread.sqlite and restores into a portable inspectable artifact", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const prepared = await prepareManagedThread({ projectDir, storeRootDir, resolveProjectPath }, { withGeneratedRollout: true });
    const snapshotDir = resolveProjectPath("thread-snapshots", "snapshot-export-001");

    const created = expectOk(
      await createManagedThreadSnapshot({
        store: prepared.store,
        storeRootDir,
        threadId: prepared.threadId,
        outputDir: snapshotDir,
      }),
    );

    assert.equal(created.manifest.exportKind, "sqlite_thread_snapshot");
    assert.equal(created.manifest.threadId, prepared.threadId);
    assert.equal(created.manifest.counts.messages, 2);
    assert.equal(created.manifest.counts.turns, 1);
    assert.equal(created.manifest.generatedArtifacts[0]?.status, "included");
    await rm(prepared.generatedFilePath, { force: true });

    await withTempThreadStore(async ({ projectDir: restoredProjectDir, storeRootDir: restoredStoreRootDir }) => {
      const restored = expectOk(
        await restoreManagedThreadSnapshot({
          snapshotDir,
          targetStoreRootDir: restoredStoreRootDir,
        }),
      );

      const reopenedStore = new SqliteThreadStore(restoredStoreRootDir);
      const reopenedSnapshot = expectOk(await reopenedStore.openThread(restored.threadId));
      assert.equal(reopenedSnapshot.messages.length, 2);
      assert.equal(reopenedSnapshot.turns.length, 1);

      const bands = await runCli([
        "inspect",
        "bands",
        "--root",
        restoredProjectDir,
        "--thread",
        restored.threadId,
        "--json",
      ]);
      assert.equal(bands.exitCode, 0, bands.stderr);
      const parsedBands = JSON.parse(bands.stdout) as {
        recordCount: number;
        warnings: string[];
        generatedFilePath?: string;
      };
      assert.equal(parsedBands.recordCount, 2);
      assert.match(parsedBands.generatedFilePath ?? "", /generated\/snapshot-export-001\.jsonl$/);
      assert.ok(parsedBands.warnings.some((warning) => warning.includes("Using bundled generated thread-view file")));
    });
  });
});

test("SQLite snapshot reports missing generated rollout files as recoverable warnings", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const prepared = await prepareManagedThread({ projectDir, storeRootDir, resolveProjectPath }, { withGeneratedRollout: false });
    const snapshotDir = resolveProjectPath("thread-snapshots", "snapshot-export-missing-rollout");

    const created = expectOk(
      await createManagedThreadSnapshot({
        store: prepared.store,
        storeRootDir,
        threadId: prepared.threadId,
        outputDir: snapshotDir,
      }),
    );

    assert.equal(created.manifest.generatedArtifacts[0]?.status, "missing");
    assert.ok(created.manifest.warnings.some((warning) => warning.includes("Generated rollout is missing from disk")));
  });
});
