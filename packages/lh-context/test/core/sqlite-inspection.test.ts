import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectBands, inspectPostCompactReport, inspectReadiness, inspectSummary, inspectTokens } from "../../src/index.js";
import { LhxError } from "../../src/errors/errors.js";
import { setBetterSqlite3LoaderForTest } from "../../src/core/io.js";
import { FileThreadStore } from "../../../../src/context-steward/store/file-thread-store.js";
import { seedSqliteThreadSnapshot } from "../../../../src/context-steward/store/sqlite-thread-store.js";
import {
  makeActorRecord,
  makeMessageRecord,
  makeSourceRange,
  makeThreadRecord,
  makeThreadTarget,
  makeTurnRecord,
} from "../../../../src/context-steward/test/fixtures.js";
import { withTempSqliteThreadStore, withTempThreadStore } from "../../../../src/context-steward/test/temp-store.js";
import { assertTokenCountRecord } from "../../../../src/token-accounting/token-count-metadata.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeChunkState,
  makeSmoothTurnState,
  makeTurnLowerBandProjection,
} from "../../../../src/thread/async-thread/test/fixtures.js";
import { openOrCreateManagedThread } from "../../../../src/context-steward/services/thread-service.js";

afterEach(() => {
  setBetterSqlite3LoaderForTest(undefined);
});

function makeTokenCount(
  count: number,
  scope:
    | "raw_turn_materialized"
    | "smooth_turn_materialized"
    | "turn_lower_band_projection_materialized"
    | "chunk_smooth_materialized"
    | "detailed_chunk_materialized"
    | "brief_chunk_materialized"
    | "generated_session",
  source: "provider_input_count" | "pi_heuristic" = "provider_input_count",
) {
  return assertTokenCountRecord({
    count,
    scope,
    source,
    trustClass: source === "provider_input_count" ? "exact" : "heuristic_estimate",
    provider: source === "provider_input_count" ? "openai" : undefined,
    model: source === "provider_input_count" ? "gpt-5.4-mini" : undefined,
    representationHash: `sha256:${scope}:${count}:${source}`,
    sourceRevision: 7,
    createdAt: DEFAULT_TEST_TIMESTAMP,
  });
}

describe("sqlite-backed inspection", () => {
  it("reads summary, tokens, bands, report, and readiness from SQLite-backed managed state", async () => {
    await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
      const threadId = "thread-sqlite-inspect-001";
      const generatedFilePath = resolveProjectPath("generated", "thread-sqlite-inspect-001.jsonl");
      await mkdir(dirname(generatedFilePath), { recursive: true });
      await writeFile(
        generatedFilePath,
        [
          JSON.stringify({
            type: "custom",
            customType: "pi-long-horizon.thread-view.output",
            data: {
              entries: [
                { metadata: { bandType: "full_fidelity", sourceReference: "turn:turn-sqlite-001" } },
                { metadata: { bandType: "smooth", sourceReference: "turn:turn-sqlite-001" } },
                { metadata: { bandType: "detailed", sourceReference: "chunk:chunk-sqlite-001" } },
                { metadata: { bandType: "brief", sourceReference: "chunk:chunk-sqlite-001" } },
              ],
            },
          }),
          JSON.stringify({
            type: "message",
            message: {
              role: "assistant",
              usage: {
                totalTokens: 9999,
              },
            },
          }),
        ].join("\n") + "\n",
        "utf8",
      );

      const chunk = makeChunkState({
        threadId,
        chunkId: "chunk-sqlite-001",
        sourceTurnIds: ["turn-sqlite-001"],
        sourceRevision: 7,
        smoothTokenCountMetadata: makeTokenCount(4, "chunk_smooth_materialized", "pi_heuristic"),
      });
      if (chunk.lowerBand) {
        chunk.lowerBand.detailed.tokenCountMetadata = makeTokenCount(50, "detailed_chunk_materialized");
        chunk.lowerBand.brief.tokenCountMetadata = makeTokenCount(20, "brief_chunk_materialized", "pi_heuristic");
      }

      await seedSqliteThreadSnapshot({
        rootDir: storeRootDir,
        thread: makeThreadRecord({
          threadId,
          sourceRevision: 7,
          messageHighWatermark: 3,
          updatedAt: "2026-02-01T00:00:00.000Z",
          target: makeThreadTarget({
            sessionId: "session-sqlite-inspect-001",
            sessionFilePath: `${projectDir}/pi/session-sqlite-inspect-001.jsonl`,
            cwd: projectDir,
            currentGeneratedFilePath: generatedFilePath,
          }),
          threadViewOutputSummary: {
            count: 1,
            currentGeneratedFilePath: generatedFilePath,
            generatedOutput: {
              threadId,
              generatedSource: "thread_view",
              generatedFilePath,
              generatedAt: DEFAULT_TEST_TIMESTAMP,
              placeholderExplicit: false,
              status: "available",
              generatedSessionTokenCountMetadata: makeTokenCount(444, "generated_session"),
            },
          },
          status: {
            turnState: "repair_needed",
            tokenCounting: {
              status: "repair_needed",
              updatedAt: DEFAULT_TEST_TIMESTAMP,
              sourceRevision: 7,
              issueCount: 1,
              issues: [{ code: "TOKEN_COUNT_DEGRADED", message: "Exact counts still pending." }],
            },
            maintenance: {
              background: {
                mode: "background",
                scope: "bounded",
                status: "repair_needed",
                updatedAt: DEFAULT_TEST_TIMESTAMP,
                sourceRevision: 7,
                fixedCount: 1,
                skippedCount: 0,
                failedCount: 0,
                remainingDebtCount: 1,
                remainingDebt: [{ category: "token_count", entityType: "turn", entityId: "turn-sqlite-002" }],
              },
            },
          },
        }),
        actors: [
          makeActorRecord({ actorId: "actor-user-001", actorType: "human", displayName: "User" }),
          makeActorRecord({ actorId: "actor-assistant-001", actorType: "agent", displayName: "Assistant" }),
          makeActorRecord({ actorId: "actor-tool-001", actorType: "tool", displayName: "Tool" }),
        ],
        messages: [
          makeMessageRecord({
            messageId: "message-sqlite-001",
            threadId,
            sourceOrder: 1,
            sourceRevision: 7,
            actorId: "actor-user-001",
            actorType: "human",
            messageKind: "prompt",
            parts: [{ partId: "part-sqlite-001", partOrder: 1, partType: "text", content: "Prompt text" }],
          }),
          makeMessageRecord({
            messageId: "message-sqlite-002",
            threadId,
            sourceOrder: 2,
            sourceRevision: 7,
            actorId: "actor-assistant-001",
            actorType: "agent",
            messageKind: "response",
            parts: [{ partId: "part-sqlite-002", partOrder: 1, partType: "text", content: "Response text" }],
          }),
          makeMessageRecord({
            messageId: "message-sqlite-003",
            threadId,
            sourceOrder: 3,
            sourceRevision: 7,
            actorId: "actor-tool-001",
            actorType: "tool",
            messageKind: "tool_result",
            parts: [{ partId: "part-sqlite-003", partOrder: 1, partType: "tool_result", content: "Tool output payload" }],
          }),
        ],
        turns: [
          makeTurnRecord({
            threadId,
            turnId: "turn-sqlite-001",
            turnOrder: 1,
            lifecycleStatus: "closed",
            repairStatus: "ready",
            initiatingMessageId: "message-sqlite-001",
            messageIds: ["message-sqlite-001", "message-sqlite-002"],
            sourceRange: makeSourceRange({ fromSourceOrder: 1, toSourceOrder: 2 }),
            sourceRevision: 7,
            rawTokenCountMetadata: makeTokenCount(32, "raw_turn_materialized"),
            smooth: {
              ...makeSmoothTurnState({
                threadId,
                turnId: "turn-sqlite-001",
                sourceRevision: 7,
              }),
              tokenCountMetadata: makeTokenCount(10, "smooth_turn_materialized", "pi_heuristic"),
              lowerBandProjection: makeTurnLowerBandProjection({
                sourceRevision: 7,
                tokenCountMetadata: makeTokenCount(10, "turn_lower_band_projection_materialized", "pi_heuristic"),
              }),
            },
          }),
          makeTurnRecord({
            threadId,
            turnId: "turn-sqlite-002",
            turnOrder: 2,
            lifecycleStatus: "open",
            repairStatus: "repair_needed",
            initiatingMessageId: "message-sqlite-003",
            messageIds: ["message-sqlite-003"],
            sourceRange: makeSourceRange({ fromSourceOrder: 3, toSourceOrder: 3 }),
            sourceRevision: 7,
          }),
        ],
        chunks: [chunk],
      });

      const summary = await inspectSummary({ rootDir: projectDir });
      const tokens = await inspectTokens({ rootDir: projectDir });
      const bands = await inspectBands({ rootDir: projectDir });
      const report = await inspectPostCompactReport({ rootDir: projectDir });
      const readiness = await inspectReadiness({ rootDir: projectDir });

      expect(summary.threadId).toBe(threadId);
      expect(summary.messages.total).toBe(3);
      expect(summary.turns).toEqual({ total: 2, closed: 1, open: 1 });
      expect(summary.chunks).toEqual({ total: 1, closed: 1, open: 0 });
      expect(summary.currentGeneratedTokenCount).toBe(444);

      expect(tokens.generatedThreadViewTokenCount?.count).toBe(444);
      expect(tokens.generatedThreadViewTokenCount?.source).toBe("thread_view_output_summary.generatedSessionTokenCountMetadata");
      expect(tokens.rollups.rawTurnTokenMetadata).toContainEqual(
        expect.objectContaining({ count: 32, label: "provider_exact" }),
      );
      expect(tokens.rollups.detailedChunkTokenMetadata).toContainEqual(
        expect.objectContaining({ count: 50, label: "provider_exact" }),
      );
      expect(tokens.rollups.briefChunkTokenMetadata).toContainEqual(
        expect.objectContaining({ count: 20, label: "estimate" }),
      );

      expect(bands.selectedBandEntryCounts).toEqual({
        brief: 1,
        detailed: 1,
        full_fidelity: 1,
        smooth: 1,
      });
      expect(bands.bands.full_fidelity.turns.indices).toEqual([1]);
      expect(bands.bands.full_fidelity.tokenSum).toBe(32);
      expect(bands.bands.detailed.chunks.ids).toEqual(["chunk-sqlite-001"]);
      expect(bands.bands.detailed.tokenSum).toBe(50);

      expect(report.generatedThreadView.generatedSessionTokenCount?.count).toBe(444);
      expect(report.generatedThreadView.recordCount).toBe(2);
      expect(report.tokenScale.generated.providerExactTotal).toBe(444);

      expect(readiness.overallStatus).toBe("prepare_recommended");
      expect(readiness.compactModeRecommendation).toBe("prepare");
      expect(readiness.turnState).toBe("repair_needed");
      expect(readiness.tokenCounting?.issueCount).toBe(1);
      expect(readiness.projection.status).toBe("ready");
      expect(readiness.maintenance.background?.remainingDebtCount).toBe(1);
    });
  });

  it("returns SQLITE_DRIVER_UNAVAILABLE for SQLite-only inspection while file-backed inspection still works", async () => {
    setBetterSqlite3LoaderForTest(async () => {
      throw new Error("better-sqlite3 intentionally unavailable in test");
    });

    await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
      const fileStore = new FileThreadStore(storeRootDir);
      const fileThread = await openOrCreateManagedThread({
        target: makeThreadTarget({
          sessionId: "session-file-inspect-001",
          sessionFilePath: `${projectDir}/pi/session-file-inspect-001.jsonl`,
          cwd: projectDir,
        }),
        now: () => new Date("2026-03-01T00:00:00.000Z"),
      }, fileStore);
      expect(fileThread.ok).toBe(true);

      await seedSqliteThreadSnapshot({
        rootDir: storeRootDir,
        thread: makeThreadRecord({
          threadId: "thread-sqlite-only-001",
          updatedAt: "2026-01-01T00:00:00.000Z",
          target: makeThreadTarget({
            sessionId: "session-sqlite-only-001",
            sessionFilePath: `${projectDir}/pi/session-sqlite-only-001.jsonl`,
            cwd: projectDir,
          }),
        }),
      });

      const mixedSummary = await inspectSummary({ rootDir: projectDir });
      expect(mixedSummary.threadId).toBe(fileThread.value.threadId);

      await expect(inspectSummary({
        rootDir: projectDir,
        threadId: "thread-sqlite-only-001",
      })).rejects.toMatchObject<LhxError>({ code: "SQLITE_DRIVER_UNAVAILABLE" });
    });
  });

  it("keeps failed generated-output readiness degraded or blocked even when a stale generated file still exists", async () => {
    await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
      const generatedFilePath = resolveProjectPath("generated", "thread-sqlite-readiness-stale.jsonl");
      await mkdir(dirname(generatedFilePath), { recursive: true });
      await writeFile(
        generatedFilePath,
        `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "output_text", text: "stale rollout" }] } })}\n`,
        "utf8",
      );

      for (const [threadId, generatedStatus, expectedStatus, expectedOverallStatus] of [
        ["thread-sqlite-readiness-write-failed", "write_failed", "blocked", "blocked"],
        ["thread-sqlite-readiness-reload-failed", "reload_failed", "degraded", "prepare_recommended"],
      ] as const) {
        await seedSqliteThreadSnapshot({
          rootDir: storeRootDir,
          thread: makeThreadRecord({
            threadId,
            sourceRevision: 7,
            updatedAt: "2026-02-02T00:00:00.000Z",
            target: makeThreadTarget({
              sessionId: `session-${threadId}`,
              sessionFilePath: `${projectDir}/pi/${threadId}.jsonl`,
              cwd: projectDir,
              currentGeneratedFilePath: generatedFilePath,
            }),
            threadViewOutputSummary: {
              count: 1,
              currentGeneratedFilePath: generatedFilePath,
              generatedOutput: {
                threadId,
                generatedSource: "thread_view",
                generatedFilePath,
                generatedAt: DEFAULT_TEST_TIMESTAMP,
                placeholderExplicit: false,
                status: generatedStatus,
              },
            },
            status: {
              turnState: "ready",
              tokenCounting: {
                status: "ready",
                updatedAt: DEFAULT_TEST_TIMESTAMP,
                sourceRevision: 7,
                issueCount: 0,
                issues: [],
              },
            },
          }),
        });

        const readiness = await inspectReadiness({ rootDir: projectDir, threadId });
        expect(readiness.projection.status).toBe(expectedStatus);
        expect(readiness.projection.generatedOutputStatus).toBe(generatedStatus);
        expect(readiness.overallStatus).toBe(expectedOverallStatus);
      }
    });
  });

  it("ignores older failed generated-output attempts after a newer clean full repair with a previous projection available", async () => {
    await withTempSqliteThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
      const previousGeneratedFilePath = resolveProjectPath("generated", "thread-sqlite-readiness-previous.jsonl");
      const currentFailedGeneratedFilePath = resolveProjectPath("generated", "thread-sqlite-readiness-current-failed.jsonl");
      await mkdir(dirname(previousGeneratedFilePath), { recursive: true });
      await writeFile(
        previousGeneratedFilePath,
        `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "output_text", text: "previous rollout" }] } })}\n`,
        "utf8",
      );
      await writeFile(
        currentFailedGeneratedFilePath,
        `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "output_text", text: "current failed attempt file" }] } })}\n`,
        "utf8",
      );

      for (const [threadId, generatedFilePath, generatedAt, expectedStatus, expectedOverallStatus] of [
        [
          "thread-sqlite-readiness-stale-blocked-after-repair",
          resolveProjectPath("generated", "missing-failed-attempt.jsonl"),
          "2026-02-01T00:00:00.000Z",
          "ready",
          "ready",
        ],
        [
          "thread-sqlite-readiness-current-blocked-after-repair",
          currentFailedGeneratedFilePath,
          "2026-02-03T00:00:00.000Z",
          "blocked",
          "blocked",
        ],
      ] as const) {
        await seedSqliteThreadSnapshot({
          rootDir: storeRootDir,
          thread: makeThreadRecord({
            threadId,
            sourceRevision: 7,
            updatedAt: "2026-02-02T00:00:00.000Z",
            target: makeThreadTarget({
              sessionId: `session-${threadId}`,
              sessionFilePath: `${projectDir}/pi/${threadId}.jsonl`,
              cwd: projectDir,
              currentGeneratedFilePath: previousGeneratedFilePath,
            }),
            threadViewOutputSummary: {
              count: 1,
              currentGeneratedFilePath: previousGeneratedFilePath,
              currentProjectionRevisionId: `projection-${threadId}`,
              generatedOutput: {
                threadId,
                generatedSource: "thread_view",
                generatedFilePath,
                generatedAt,
                placeholderExplicit: false,
                status: "blocked",
                issues: [{ code: "GENERATED_WRITE_FAILED", message: "failed generated-output attempt" }],
              },
            },
            status: {
              turnState: "ready",
              tokenCounting: {
                status: "ready",
                updatedAt: "2026-02-02T00:00:00.000Z",
                sourceRevision: 7,
                issueCount: 0,
                issues: [],
              },
              maintenance: {
                manualRepair: {
                  mode: "manual_repair",
                  scope: "full",
                  status: "ready",
                  updatedAt: "2026-02-02T00:00:00.000Z",
                  sourceRevision: 7,
                  fixedCount: 12,
                  skippedCount: 0,
                  failedCount: 0,
                  remainingDebtCount: 0,
                  blockers: [],
                  remainingDebt: [],
                },
              },
            },
          }),
        });

        const readiness = await inspectReadiness({ rootDir: projectDir, threadId });
        expect(readiness.projection.status).toBe(expectedStatus);
        expect(readiness.projection.generatedOutputStatus).toBe("blocked");
        expect(readiness.overallStatus).toBe(expectedOverallStatus);
      }
    });
  });
});
