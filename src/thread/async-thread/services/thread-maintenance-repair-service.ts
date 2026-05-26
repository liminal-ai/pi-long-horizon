import { ok, fail, StewardResultError, type StewardIssue, type StewardResult } from "../../domain/errors.js";
import type { MessageRecord, TurnRecord } from "../../domain/records.js";
import type { ThreadStore } from "../../store/thread-store.js";
import {
  getReadyChunkLowerBandArtifact,
  isCanonicalChunkState,
  type ChunkState,
} from "../domain/chunk-state.js";
import type { ChunkSemanticArtifactBand } from "../domain/lower-band-artifact-state.js";
import { updateChunkState } from "./chunk-service.js";
import {
  persistTokenCountingMaintenanceStatus,
  persistThreadMaintenanceRunStatus,
  repairOpenAITokenCounts,
  type AsyncThreadRunDependencies,
} from "./async-thread-run-service.js";
import { ensureLowerBandTurnProjection } from "./lower-band-turn-projection-service.js";
import {
  LowerBandCompressionService,
  type LowerBandCompressionLogger,
  type LowerBandCompressionProvider,
} from "./lower-band-compression-service.js";
import { ensureSmoothTurn } from "./smooth-turn-service.js";

export interface ThreadMaintenanceRepairInput {
  threadId: string;
}

export interface ThreadMaintenanceRepairDependencies {
  store: ThreadStore;
  lowerBandCompressionProvider?: LowerBandCompressionProvider;
  lowerBandCompressionLogger?: LowerBandCompressionLogger;
  openAIInputTokenCounter?: AsyncThreadRunDependencies["openAIInputTokenCounter"];
  tokenCountModel?: string;
  now?: () => Date;
}

export interface ThreadMaintenancePhaseReport {
  alreadyReady: number;
  repaired: number;
  skipped: number;
  failed: number;
  blockers: StewardIssue[];
}

export interface ThreadMaintenanceRepairResult {
  threadId: string;
  phases: {
    smoothTurns: ThreadMaintenancePhaseReport;
    lowerBandTurnProjections: ThreadMaintenancePhaseReport;
    chunks: ThreadMaintenancePhaseReport;
    lowerBandChunks: ThreadMaintenancePhaseReport;
    tokenCounts: ThreadMaintenancePhaseReport;
  };
  summary: {
    alreadyReady: number;
    repaired: number;
    skipped: number;
    failed: number;
  };
  warnings: string[];
}

const EMPTY_PHASE = (): ThreadMaintenancePhaseReport => ({
  alreadyReady: 0,
  repaired: 0,
  skipped: 0,
  failed: 0,
  blockers: [],
});

export async function repairThreadMaintenance(
  input: ThreadMaintenanceRepairInput,
  dependencies?: ThreadMaintenanceRepairDependencies,
): Promise<StewardResult<ThreadMaintenanceRepairResult>> {
  if (!dependencies?.store) {
    return fail({
      code: "STORE_UNAVAILABLE",
      message: "repairThreadMaintenance requires a thread store dependency.",
      threadId: input.threadId,
    });
  }

  const phases = {
    smoothTurns: EMPTY_PHASE(),
    lowerBandTurnProjections: EMPTY_PHASE(),
    chunks: EMPTY_PHASE(),
    lowerBandChunks: EMPTY_PHASE(),
    tokenCounts: EMPTY_PHASE(),
  };
  const warnings: string[] = [];

  const smoothIssues = await repairSmoothTurns(input.threadId, dependencies, phases.smoothTurns);
  if (smoothIssues.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, smoothIssues),
      dependencies,
    );
  }

  const projectionIssues = await repairLowerBandTurnProjections(input.threadId, dependencies, phases.lowerBandTurnProjections);
  if (projectionIssues.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, projectionIssues),
      dependencies,
    );
  }

  const chunkIssues = await repairChunkState(input.threadId, dependencies, phases.chunks);
  if (chunkIssues.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, chunkIssues),
      dependencies,
    );
  }

  const tokenDependencies: AsyncThreadRunDependencies = {
    store: dependencies.store,
    openAIInputTokenCounter: dependencies.openAIInputTokenCounter,
    tokenCountModel: dependencies.tokenCountModel,
    now: dependencies.now,
  };
  await runExactTokenRepair(input.threadId, tokenDependencies, phases.tokenCounts);

  const tokenIssues = [...phases.chunks.blockers, ...phases.tokenCounts.blockers];
  if (tokenIssues.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, tokenIssues),
      dependencies,
    );
  }

  const lowerBandIssues = await repairLowerBandChunks(input.threadId, dependencies, phases.lowerBandChunks);
  if (lowerBandIssues.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, lowerBandIssues),
      dependencies,
    );
  }

  await runExactTokenRepair(input.threadId, tokenDependencies, phases.tokenCounts);
  if (phases.tokenCounts.blockers.length > 0) {
    return finalizeRepairResult(
      failWithReport(input.threadId, phases, warnings, phases.tokenCounts.blockers),
      dependencies,
    );
  }

  return finalizeRepairResult(ok(buildReport(input.threadId, phases, warnings)), dependencies);
}

async function runExactTokenRepair(
  threadId: string,
  dependencies: AsyncThreadRunDependencies,
  phase: ThreadMaintenancePhaseReport,
): Promise<void> {
  const tokenCountBefore = countExactTokenRecords(await safeOpenThread(threadId, dependencies.store));
  const tokenCountIssues = await repairOpenAITokenCounts(threadId, dependencies, {
    includeOpenRawTurns: false,
    missingCounterMessage:
      "OpenAI materialized token counter is not configured; standalone thread maintenance left exact materialized token counts repair-needed.",
    failureMessage:
      "OpenAI materialized token counting failed during standalone thread maintenance.",
  });
  const persistedStatusIssues = await persistTokenCountingMaintenanceStatus({
    threadId,
    dependencies,
    status: tokenCountIssues.length === 0 ? "ready" : "repair_needed",
    issues: tokenCountIssues,
  });
  if (tokenCountIssues.length > 0 || persistedStatusIssues.length > 0) {
    phase.failed += tokenCountIssues.length + persistedStatusIssues.length;
    phase.blockers.push(...tokenCountIssues, ...persistedStatusIssues);
  }

  const tokenCountAfter = countExactTokenRecords(await safeOpenThread(threadId, dependencies.store));
  const repaired = Math.max(0, tokenCountAfter - tokenCountBefore);
  phase.repaired += repaired;
  if (repaired === 0 && phase.blockers.length === 0) {
    phase.alreadyReady += tokenCountAfter;
  }
}

async function repairSmoothTurns(
  threadId: string,
  dependencies: ThreadMaintenanceRepairDependencies,
  phase: ThreadMaintenancePhaseReport,
): Promise<StewardIssue[]> {
  const snapshot = await dependencies.store.openThread(threadId);
  if (!snapshot.ok) return snapshot.issues;
  const messagesById = new Map(snapshot.value.messages.map((message) => [message.messageId, message]));
  for (const turn of snapshot.value.turns) {
    if (turn.lifecycleStatus !== "closed") {
      phase.skipped += 1;
      continue;
    }
    if (isSmoothReady(turn, messagesById)) {
      phase.alreadyReady += 1;
      continue;
    }
    const result = await ensureSmoothTurn({ threadId, turnId: turn.turnId }, dependencies);
    result.smoothStatus === "ready" ? phase.repaired += 1 : phase.failed += 1;
  }
  return [];
}

async function repairLowerBandTurnProjections(
  threadId: string,
  dependencies: ThreadMaintenanceRepairDependencies,
  phase: ThreadMaintenancePhaseReport,
): Promise<StewardIssue[]> {
  const snapshot = await dependencies.store.openThread(threadId);
  if (!snapshot.ok) return snapshot.issues;
  for (const turn of snapshot.value.turns) {
    if (turn.lifecycleStatus !== "closed" || !turn.smooth) {
      phase.skipped += 1;
      continue;
    }
    if (turn.smooth.lowerBandProjection?.status === "ready" && turn.smooth.lowerBandProjection.tokenCountMetadata?.source === "provider_input_count") {
      phase.alreadyReady += 1;
      continue;
    }
    if (!dependencies.openAIInputTokenCounter?.countTurnLowerBandProjectionMaterialized) {
      phase.skipped += 1;
      continue;
    }
    const result = await ensureLowerBandTurnProjection(
      { threadId, turnId: turn.turnId },
      {
        store: dependencies.store,
        openAIInputTokenCounter: {
          countTurnLowerBandProjectionMaterialized: dependencies.openAIInputTokenCounter.countTurnLowerBandProjectionMaterialized.bind(dependencies.openAIInputTokenCounter),
        },
        tokenCountModel: dependencies.tokenCountModel,
        now: dependencies.now,
      },
    );
    result.projectionStatus === "ready" ? phase.repaired += 1 : phase.failed += 1;
  }
  return [];
}

async function repairChunkState(
  threadId: string,
  dependencies: ThreadMaintenanceRepairDependencies,
  phase: ThreadMaintenancePhaseReport,
): Promise<StewardIssue[]> {
  const before = await dependencies.store.readChunks(threadId);
  if (!before.ok) return before.issues;
  if (before.value.every((chunk) => chunk.lifecycleStatus !== "closed" || (isCanonicalChunkState(chunk) && chunk.conversationTranscript?.status === "ready"))) {
    phase.alreadyReady += before.value.length;
    return [];
  }

  const result = await updateChunkState({ threadId }, { store: dependencies.store, now: dependencies.now });
  if (result.blockers.length > 0) {
    phase.failed += result.blockers.length;
    phase.blockers.push(...result.blockers);
    return result.blockers;
  }
  phase.repaired += result.updatedChunkIds.length;
  phase.alreadyReady += Math.max(0, before.value.length - result.updatedChunkIds.length);
  return [];
}

async function repairLowerBandChunks(
  threadId: string,
  dependencies: ThreadMaintenanceRepairDependencies,
  phase: ThreadMaintenancePhaseReport,
): Promise<StewardIssue[]> {
  const chunksResult = await dependencies.store.readChunks(threadId);
  if (!chunksResult.ok) return chunksResult.issues;
  if (!dependencies.lowerBandCompressionProvider) {
    phase.skipped += chunksResult.value.filter((chunk) => chunk.lifecycleStatus === "closed").length;
    return [];
  }

  const service = new LowerBandCompressionService({
    store: dependencies.store,
    provider: dependencies.lowerBandCompressionProvider,
    openAIInputTokenCounter: dependencies.openAIInputTokenCounter,
    tokenCountModel: dependencies.tokenCountModel,
    now: dependencies.now,
    logger: dependencies.lowerBandCompressionLogger,
  });

  for (const chunk of chunksResult.value) {
    if (chunk.lifecycleStatus !== "closed") {
      phase.skipped += 1;
      continue;
    }
    if (!isCanonicalChunkState(chunk)) {
      phase.skipped += 1;
      continue;
    }
    const missingBands = (["detailed", "brief"] as const).filter((band) => !getReadyChunkLowerBandArtifact(chunk, band));
    if (missingBands.length === 0) {
      phase.alreadyReady += 2;
      continue;
    }
    const result = await service.run({
      threadId,
      chunkId: chunk.chunkId,
      requiredBands: missingBands,
      mode: "prepare_catch_up",
    });
    if (result.blockers.length > 0) {
      phase.failed += result.blockers.length;
      phase.blockers.push(...result.blockers);
      return result.blockers;
    }
    phase.repaired += repairedBandCount(result, missingBands);
  }

  return [];
}

function repairedBandCount(
  result: { detailedReady: boolean; briefReady: boolean },
  requiredBands: readonly ChunkSemanticArtifactBand[],
): number {
  let count = 0;
  if (requiredBands.includes("detailed") && result.detailedReady) count += 1;
  if (requiredBands.includes("brief") && result.briefReady) count += 1;
  return count;
}

function isSmoothReady(turn: TurnRecord, messagesById: ReadonlyMap<string, MessageRecord>): boolean {
  if (!turn.smooth?.text || !turn.smooth.tokenCountMetadata || !turn.smooth.materialized?.tokenCountMetadata) {
    return false;
  }
  return turn.messageIds.every((messageId) => messagesById.has(messageId));
}

async function safeOpenThread(threadId: string, store: ThreadStore) {
  const snapshot = await store.openThread(threadId);
  if (!snapshot.ok) throw new StewardResultError(snapshot.issues);
  const chunks = await store.readChunks(threadId);
  if (!chunks.ok) throw new StewardResultError(chunks.issues);
  return { turns: snapshot.value.turns, chunks: chunks.value };
}

function countExactTokenRecords(input: { turns: readonly TurnRecord[]; chunks: readonly ChunkState[] }): number {
  let count = 0;
  for (const turn of input.turns) {
    if (turn.rawTokenCountMetadata?.source === "provider_input_count" && turn.rawTokenCountMetadata.trustClass === "exact") count += 1;
    if (turn.smooth?.tokenCountMetadata?.source === "provider_input_count" && turn.smooth.tokenCountMetadata.trustClass === "exact") count += 1;
    if (turn.smooth?.lowerBandProjection?.tokenCountMetadata?.source === "provider_input_count" && turn.smooth.lowerBandProjection.tokenCountMetadata.trustClass === "exact") count += 1;
  }
  for (const chunk of input.chunks) {
    if (chunk.smoothTokenCountMetadata?.source === "provider_input_count" && chunk.smoothTokenCountMetadata.trustClass === "exact") count += 1;
    if (chunk.lowerBand?.detailed?.tokenCountMetadata?.source === "provider_input_count" && chunk.lowerBand.detailed.tokenCountMetadata.trustClass === "exact") count += 1;
    if (chunk.lowerBand?.brief?.tokenCountMetadata?.source === "provider_input_count" && chunk.lowerBand.brief.tokenCountMetadata.trustClass === "exact") count += 1;
  }
  return count;
}

async function finalizeRepairResult(
  result: StewardResult<ThreadMaintenanceRepairResult>,
  dependencies: ThreadMaintenanceRepairDependencies,
): Promise<StewardResult<ThreadMaintenanceRepairResult>> {
  if (!dependencies.store) {
    return result;
  }

  const report = (result as StewardResult<ThreadMaintenanceRepairResult> & { value: ThreadMaintenanceRepairResult }).value;
  await persistThreadMaintenanceRunStatus({
    threadId: report.threadId,
    runMode: "manual_repair",
    scope: "full",
    fixedCount: report.summary.repaired,
    skippedCount: report.summary.skipped,
    failedCount: report.summary.failed,
    blockers: result.ok ? [] : result.issues,
    dependencies: {
      store: dependencies.store,
      openAIInputTokenCounter: dependencies.openAIInputTokenCounter,
      tokenCountModel: dependencies.tokenCountModel,
      now: dependencies.now,
    },
  });

  return result;
}

function buildReport(
  threadId: string,
  phases: ThreadMaintenanceRepairResult["phases"],
  warnings: string[],
): ThreadMaintenanceRepairResult {
  return {
    threadId,
    phases,
    summary: {
      alreadyReady: Object.values(phases).reduce((total, phase) => total + phase.alreadyReady, 0),
      repaired: Object.values(phases).reduce((total, phase) => total + phase.repaired, 0),
      skipped: Object.values(phases).reduce((total, phase) => total + phase.skipped, 0),
      failed: Object.values(phases).reduce((total, phase) => total + phase.failed, 0),
    },
    warnings,
  };
}

function failWithReport(
  threadId: string,
  phases: ThreadMaintenanceRepairResult["phases"],
  warnings: string[],
  issues: readonly StewardIssue[],
): StewardResult<ThreadMaintenanceRepairResult> {
  return {
    ok: false,
    issues: issues.map((issue) => ({ ...issue })),
    value: buildReport(threadId, phases, warnings),
  } as StewardResult<ThreadMaintenanceRepairResult>;
}
