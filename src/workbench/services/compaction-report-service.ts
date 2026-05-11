import {
  StewardResultError,
  createStewardIssue,
  type StewardIssue,
} from "../../thread/domain/errors.js";
import type { MessageRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  BAND_ORDER,
  type BandRecord,
  type BandRenderedStatus,
  type BandType,
  type ThreadViewMessageRecord,
} from "../../thread-view/domain/thread-view-records.js";
import type { ThreadViewStore } from "../../thread-view/store/thread-view-store.js";
import {
  estimateMaterializedMessageTokenCount,
  estimateRawMessageTokenCount,
} from "../../thread-view/services/thread-view-builder.js";
import { WorkbenchQueryService } from "./workbench-query-service.js";

export interface CompactionAuditBandReport {
  bandType: BandType;
  targetTokenBudget?: number;
  selectedCount: number;
  selectedIds: string[];
  renderedStatus: BandRenderedStatus;
  actualTokenCount: number;
}

export interface CompactionAuditSelectedTurn {
  turnId: string;
  bandType: "full_fidelity" | "smooth";
  rawTokenCount: number;
  smoothTokenCount?: number;
}

export interface CompactionAuditSelectedChunk {
  chunkId: string;
  bandType: "detailed" | "brief";
  smoothTokenCount?: number;
  detailedTokenCount?: number;
  briefTokenCount?: number;
}

export interface CompactionAuditReport {
  threadId: string;
  threadViewId: string;
  compactStatus?: string;
  resultingTokenCount: number;
  generatedFilePath?: string;
  archivePath?: string;
  bands: Record<BandType, CompactionAuditBandReport>;
  selectedTurns: CompactionAuditSelectedTurn[];
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

function emittedMessageTokenCount(message: ThreadViewMessageRecord): number {
  return estimateMaterializedMessageTokenCount(message.content);
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

function rawTurnTokenCount(messages: readonly MessageRecord[]): number {
  return messages.reduce((total, message) => total + estimateRawMessageTokenCount(message), 0);
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
  const emittedMessages = view.emittedMessages;
  const bands = Object.fromEntries(
    BAND_ORDER.map((bandType) => {
      const band = bandRecordForType(view, bandType);
      const actualTokenCount = emittedMessages
        .filter((message) => message.bandType === bandType)
        .reduce((total, message) => total + emittedMessageTokenCount(message), 0);

      return [
        bandType,
        {
          bandType,
          targetTokenBudget: band.targetTokenBudget,
          selectedCount: band.selectedIds.length,
          selectedIds: [...band.selectedIds],
          renderedStatus: band.renderedStatus,
          actualTokenCount,
        } satisfies CompactionAuditBandReport,
      ];
    }),
  ) as Record<BandType, CompactionAuditBandReport>;

  const selectedTurns: CompactionAuditSelectedTurn[] = [];
  for (const bandType of ["full_fidelity", "smooth"] as const) {
    const band = bandRecordForType(view, bandType);
    for (const turnId of band.selectedIds) {
      const turnResult = await query.openTurnDetail({ threadId: input.threadId, turnId });
      if (!turnResult.ok) {
        throw new StewardResultError(turnResult.issues);
      }

      selectedTurns.push({
        turnId,
        bandType,
        rawTokenCount: rawTurnTokenCount(turnResult.value.messages),
        smoothTokenCount: turnResult.value.turn.smooth?.tokenCount,
      });
    }
  }

  const selectedChunks: CompactionAuditSelectedChunk[] = [];
  for (const bandType of ["detailed", "brief"] as const) {
    const band = bandRecordForType(view, bandType);
    for (const chunkId of band.selectedIds) {
      const chunkResult = await query.openChunkDetail({ threadId: input.threadId, chunkId });
      if (!chunkResult.ok) {
        throw new StewardResultError(chunkResult.issues);
      }

      selectedChunks.push({
        chunkId,
        bandType,
        smoothTokenCount: chunkResult.value.chunk.smoothTokenCount,
        detailedTokenCount: chunkResult.value.chunk.detailedSummaryTokenCount,
        briefTokenCount: chunkResult.value.chunk.briefSummaryTokenCount,
      });
    }
  }

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
    resultingTokenCount: emittedMessages.reduce((total, message) => total + emittedMessageTokenCount(message), 0),
    generatedFilePath: scopedGeneratedOutput?.generatedFilePath,
    archivePath: scopedGeneratedOutput?.archivePath,
    bands,
    selectedTurns,
    selectedChunks,
    blockers: scopedGeneratedOutput?.issues?.map((issue) => createStewardIssue(issue)) ?? [],
    reloadResult: scopedGeneratedOutput?.status,
  };
}
