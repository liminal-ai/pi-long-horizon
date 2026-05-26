import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { exportLegacyThreadDebugBundle } from "../../src/context-steward/services/snapshot-export-service.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { openOrCreateManagedThread, updateGeneratedThreadViewOutputMetadata } from "../../src/context-steward/services/thread-service.js";
import { SqliteThreadStore } from "../../src/context-steward/store/sqlite-thread-store.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore } from "../../src/context-steward/test/temp-store.js";
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

test("legacy debug export writes labeled JSON compatibility files without making them authoritative", async () => {
  await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const store = new SqliteThreadStore(storeRootDir);
    const target = makeThreadTarget({
      sessionId: "session-legacy-export-001",
      sessionFilePath: resolveProjectPath("pi", "session-legacy-export-001.jsonl"),
      cwd: projectDir,
    });
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));

    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Legacy export prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-legacy-export-001",
        content: [{ type: "text", text: "Legacy export response" }],
      }),
    );

    const generatedFilePath = resolveProjectPath("generated-rollouts", "legacy-export-001.jsonl");
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      `${JSON.stringify({
        type: "custom",
        customType: "pi-long-horizon.thread-view.output",
        data: { entries: [] },
      })}\n`,
      "utf8",
    );
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
            count: 123,
            scope: "generated_session",
            source: "provider_input_count",
            trustClass: "exact",
            provider: "openai",
            model: "gpt-5.4-mini",
            representationHash: "sha256:legacy-export-001",
            sourceRevision: 2,
            createdAt: "2026-02-01T00:00:00.000Z",
          }),
        },
      }),
    );

    const exportDir = resolveProjectPath("exports", "legacy-debug-001");
    const exported = expectOk(
      await exportLegacyThreadDebugBundle({
        store,
        storeRootDir,
        threadId: thread.threadId,
        outputDir: exportDir,
      }),
    );

    assert.equal(exported.manifest.exportKind, "legacy_debug_export");
    assert.equal(exported.manifest.canonicalSource.ownership, "authoritative_managed_source");
    assert.ok(exported.manifest.legacyDebugArtifacts.every((artifact) => artifact.ownership === "non_authoritative_legacy_export"));
    assert.deepEqual(
      exported.manifest.legacyDebugArtifacts.map((artifact) => artifact.relativePath),
      [
        "legacy-debug/thread.json",
        "legacy-debug/actors.json",
        "legacy-debug/messages.jsonl",
        "legacy-debug/turns.json",
        "legacy-debug/chunks.json",
        "legacy-debug/imports.json",
        "legacy-debug/projections.json",
      ],
    );

    const legacySummary = await runCli([
      "inspect",
      "summary",
      "--thread-dir",
      resolveProjectPath("exports", "legacy-debug-001", "legacy-debug"),
      "--json",
    ]);
    assert.equal(legacySummary.exitCode, 0, legacySummary.stderr);
    const parsedSummary = JSON.parse(legacySummary.stdout) as { threadId: string; messages: { total: number } };
    assert.equal(parsedSummary.threadId, thread.threadId);
    assert.equal(parsedSummary.messages.total, 2);

    const manifestFromDisk = JSON.parse(
      await readFile(resolveProjectPath("exports", "legacy-debug-001", "manifest.json"), "utf8"),
    ) as { legacyDebugArtifacts: Array<{ ownership: string }> };
    assert.ok(manifestFromDisk.legacyDebugArtifacts.every((artifact) => artifact.ownership === "non_authoritative_legacy_export"));
  });
});
