import {
  StewardResultError,
  createStewardIssue,
  type StewardIssue,
} from "../../thread/domain/errors.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  BAND_ORDER,
  type BandRecord,
  type BandRenderedStatus,
  type BandType,
} from "../../thread-view/domain/thread-view-records.js";
import type { ThreadViewStore } from "../../thread-view/store/thread-view-store.js";
import {
  resolveChunkPlaceholderTokenAccounting,
  resolveRawTurnTokenAccounting,
  resolveSmoothTurnTokenAccounting,
  type SelectedTokenAccounting,
} from "../../thread-view/services/thread-view-builder.js";
import { materializeChunkSmoothTextFromTurns } from "../../thread/async-thread/services/chunk-service.js";
import { countChunkSmoothMaterialized } from "../../token-accounting/index.js";
import { WorkbenchQueryService } from "./workbench-query-service.js";

export interface CompactionAuditBandReport {
  bandType: BandType;
  targetTokenBudget?: number;
  selectedCount: number;
  selectedIds: string[];
  renderedStatus: BandRenderedStatus;
  actualTokenCount: number;
  countPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
  countPolicyReason?: string;
}

export interface CompactionAuditSelectedTurn {
  turnId: string;
  bandType: "full_fidelity" | "smooth";
  rawTokenCount: number;
  smoothTokenCount?: number;
  smoothQuality?: "ready" | "degraded" | "missing";
  rawCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
  smoothCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
}

export interface CompactionAuditSelectedChunk {
  chunkId: string;
  bandType: "detailed" | "brief";
  smoothTokenCount?: number;
  detailedTokenCount?: number;
  briefTokenCount?: number;
  smoothCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
  detailedCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
  briefCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
}

export interface CompactionAuditReport {
  threadId: string;
  threadViewId: string;
  compactStatus?: string;
  resultingTokenCount: number;
  generatedSessionTokenCount?: number;
  generatedSessionCountSource?: string;
  generatedSessionCountTrustClass?: string;
  generatedSessionCountPolicyStatus?: SelectedTokenAccounting["decision"]["status"];
  generatedSessionCountPolicyReason?: string;
  generatedFilePath?: string;
  archivePath?: string;
  bands: Record<BandType, CompactionAuditBandReport>;
  selectedTurns: CompactionAuditSelectedTurn[];
  degradedSmoothingCount: number;
  selectedChunks: CompactionAuditSelectedChunk[];
  blockers: StewardIssue[];
  reloadResult?: string;
}

export interface BuildCompactionAuditReportInput {
  threadId: string;
  threadViewId: string;
}

export interface BuildCompactionAuditReportDependencies {
  threadStore: ThreadStore;
  threadViewStore: ThreadViewStore;
}

function bandRecordForType(
  bands: {
    fullFidelityBand: BandRecord;
    smoothBand: BandRecord;
    detailedBand: BandRecord;
    briefBand: BandRecord;
  },
  bandType: BandType,
): BandRecord {
  switch (bandType) {
    case "full_fidelity":
      return bands.fullFidelityBand;
    case "smooth":
      return bands.smoothBand;
    case "detailed":
      return bands.detailedBand;
    case "brief":
      return bands.briefBand;
  }
}

function throwReportIssue(input: { code: StewardIssue["code"]; message: string; threadId: string }): never {
  throw new StewardResultError([
    createStewardIssue({
      code: input.code,
      message: input.message,
      threadId: input.threadId,
    }),
  ]);
}

export async function buildCompactionAuditReport(
  input: BuildCompactionAuditReportInput,
  dependencies: BuildCompactionAuditReportDependencies,
): Promise<CompactionAuditReport> {
  const query = new WorkbenchQueryService(dependencies.threadStore, dependencies.threadViewStore);
  const threadResult = await query.openThread({ threadId: input.threadId });
  if (!threadResult.ok) {
    throw new StewardResultError(threadResult.issues);
  }

  const viewResult = await query.openThreadViewDetail(input);
  if (!viewResult.ok) {
    throw new StewardResultError(viewResult.issues);
  }

  const view = viewResult.value.view;
  const generatedOutput = threadResult.value.thread.threadViewOutputSummary.generatedOutput;
  const scopedGeneratedOutput =
    generatedOutput?.threadViewId === input.threadViewId ? generatedOutput : undefined;
  const chunkState = await dependencies.threadStore.readChunks(input.threadId);
  if (!chunkState.ok) {
    throw new StewardResultError(chunkState.issues);
  }
  const chunksById = new Map(chunkState.value.map((chunk) => [chunk.chunkId, chunk]));
  const threadSnapshot = await dependencies.threadStore.openThread(input.threadId);
  if (!threadSnapshot.ok) {
    throw new StewardResultError(threadSnapshot.issues);
  }
  const turnsById = new Map(threadSnapshot.value.turns.map((turn) => [turn.turnId, turn]));
  const messagesById = new Map(threadSnapshot.value.messages.map((message) => [message.messageId, message]));
  const accountingByBand = new Map<BandType, SelectedTokenAccounting[]>(
    BAND_ORDER.map((bandType) => [bandType, []]),
  );

  const selectedTurns: CompactionAuditSelectedTurn[] = [];
  for (const bandType of ["full_fidelity", "smooth"] as const) {
    const band = bandRecordForType(view, bandType);
    for (const turnId of band.selectedIds) {
      const turnResult = await query.openTurnDetail({ threadId: input.threadId, turnId });
      if (!turnResult.ok) {
        throw new StewardResultError(turnResult.issues);
      }
      const rawAccounting = resolveRawTurnTokenAccounting({
        turn: turnResult.value.turn,
        messages: turnResult.value.messages,
      });
      const smoothAccounting = resolveSmoothTurnTokenAccounting({
        turn: turnResult.value.turn,
        messages: turnResult.value.messages,
      });
      if (bandType === "full_fidelity") {
        accountingByBand.get("full_fidelity")?.push(rawAccounting);
      }
      if (bandType === "smooth" && smoothAccounting) {
        accountingByBand.get("smooth")?.push(smoothAccounting);
      }

      selectedTurns.push({
        turnId,
        bandType,
        rawTokenCount: rawAccounting.count,
        smoothTokenCount: smoothAccounting?.count,
        smoothQuality: turnResult.value.turn.smooth?.components?.some((component) => component.status === "degraded")
          ? "degraded"
          : smoothAccounting
            ? "ready"
            : "missing",
        rawCountPolicyStatus: rawAccounting.decision.status,
        smoothCountPolicyStatus: smoothAccounting?.decision.status,
      });
    }
  }

  const selectedChunks: CompactionAuditSelectedChunk[] = [];
  for (const bandType of ["detailed", "brief"] as const) {
    const band = bandRecordForType(view, bandType);
    for (const chunkId of band.selectedIds) {
      const chunk = chunksById.get(chunkId);
      if (!chunk) {
        throwReportIssue({
          code: "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
          message: `Chunk ${chunkId} was not found for thread ${input.threadId}.`,
          threadId: input.threadId,
        });
      }
      const currentSmoothSource = materializeChunkSmoothTextFromTurns({ chunk, turnsById, messagesById });
      const currentSmoothTokenCount = currentSmoothSource
        ? countChunkSmoothMaterialized({
            ...chunk,
            smoothText: currentSmoothSource.text,
            sourceRevision: currentSmoothSource.sourceRevision,
          }).count
        : undefined;
      const detailedAccounting = resolveChunkPlaceholderTokenAccounting({
        chunk,
        bandType: "detailed",
        currentSmoothSource: currentSmoothSource
          ? {
              text: currentSmoothSource.text,
              sourceRevision: currentSmoothSource.sourceRevision,
              tokenCount: currentSmoothTokenCount!,
            }
          : undefined,
      });
      const briefAccounting = resolveChunkPlaceholderTokenAccounting({
        chunk,
        bandType: "brief",
        currentSmoothSource: currentSmoothSource
          ? {
              text: currentSmoothSource.text,
              sourceRevision: currentSmoothSource.sourceRevision,
              tokenCount: currentSmoothTokenCount!,
            }
          : undefined,
      });
      const selectedBandAccounting = bandType === "detailed" ? detailedAccounting : briefAccounting;
      if (selectedBandAccounting) {
        accountingByBand.get(bandType)?.push(selectedBandAccounting);
      }

      selectedChunks.push({
        chunkId,
        bandType,
        smoothTokenCount: chunk.smoothTokenCountMetadata?.count,
        detailedTokenCount: detailedAccounting?.count,
        briefTokenCount: briefAccounting?.count,
        detailedCountPolicyStatus: detailedAccounting?.decision.status,
        briefCountPolicyStatus: briefAccounting?.decision.status,
      });
    }
  }

  const bands = Object.fromEntries(
    BAND_ORDER.map((bandType) => {
      const band = bandRecordForType(view, bandType);
      const accounting = accountingByBand.get(bandType) ?? [];
      const degradedAccounting = accounting.find((entry) => entry.decision.status !== "usable");

      return [
        bandType,
        {
          bandType,
          targetTokenBudget: band.targetTokenBudget,
          selectedCount: band.selectedIds.length,
          selectedIds: [...band.selectedIds],
          renderedStatus: band.renderedStatus,
          actualTokenCount: accounting.reduce((total, entry) => total + entry.count, 0),
          countPolicyStatus: degradedAccounting?.decision.status ?? accounting[0]?.decision.status,
          countPolicyReason: degradedAccounting?.decision.reason ?? accounting[0]?.decision.reason,
        } satisfies CompactionAuditBandReport,
      ];
    }),
  ) as Record<BandType, CompactionAuditBandReport>;

  if (view.threadId !== input.threadId) {
    throwReportIssue({
      code: "THREAD_VIEW_NOT_FOUND",
      message: `Thread view ${input.threadViewId} does not belong to thread ${input.threadId}.`,
      threadId: input.threadId,
    });
  }

  return {
    threadId: input.threadId,
    threadViewId: input.threadViewId,
    compactStatus: scopedGeneratedOutput?.status,
    resultingTokenCount: Object.values(bands).reduce((total, band) => total + band.actualTokenCount, 0),
    generatedSessionTokenCount: scopedGeneratedOutput?.generatedSessionTokenCount,
    generatedSessionCountSource: scopedGeneratedOutput?.generatedSessionTokenCountMetadata?.source,
    generatedSessionCountTrustClass: scopedGeneratedOutput?.generatedSessionTokenCountMetadata?.trustClass,
    generatedSessionCountPolicyStatus: scopedGeneratedOutput?.generatedSessionCountPolicy?.status,
    generatedSessionCountPolicyReason: scopedGeneratedOutput?.generatedSessionCountPolicy?.reason,
    generatedFilePath: scopedGeneratedOutput?.generatedFilePath,
    archivePath: scopedGeneratedOutput?.archivePath,
    bands,
    selectedTurns,
    degradedSmoothingCount: selectedTurns.filter(
      (turn) => turn.bandType === "smooth" && turn.smoothQuality === "degraded",
    ).length,
    selectedChunks,
    blockers: scopedGeneratedOutput?.issues?.map((issue) => createStewardIssue(issue)) ?? [],
    reloadResult: scopedGeneratedOutput?.generatedFilePath ? scopedGeneratedOutput.status : undefined,
  };
}
