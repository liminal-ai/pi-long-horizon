import { BAND_ORDER } from "../../thread-view/domain/thread-view-records.js";
import type {
  CompactionAuditReport,
  CompactionAuditSelectedChunk,
  CompactionAuditSelectedTurn,
} from "./compaction-report-service.js";

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "n/a" : String(value);
}

function formatSelectedIds(selectedIds: readonly string[]): string {
  return selectedIds.length === 0 ? "(none)" : selectedIds.join(", ");
}

function formatTurn(turn: CompactionAuditSelectedTurn): string {
  return `- ${turn.turnId} [${turn.bandType}]: raw ${turn.rawTokenCount}, smooth ${formatOptionalNumber(turn.smoothTokenCount)}, quality ${turn.smoothQuality ?? "n/a"}`;
}

function formatChunk(chunk: CompactionAuditSelectedChunk): string {
  return `- ${chunk.chunkId} [${chunk.bandType}]: smooth ${formatOptionalNumber(chunk.smoothTokenCount)}, detailed ${formatOptionalNumber(chunk.detailedTokenCount)}, brief ${formatOptionalNumber(chunk.briefTokenCount)}`;
}

export function formatCompactionAuditReport(report: CompactionAuditReport): string {
  const lines = [
    "Compaction audit report",
    `Thread: ${report.threadId}`,
    `Thread view: ${report.threadViewId}`,
    `Compact status: ${report.compactStatus ?? "unknown"}`,
    `Reload result: ${report.reloadResult ?? "unknown"}`,
    `Resulting token count: ${report.resultingTokenCount}`,
    `Generated session token count: ${formatOptionalNumber(report.generatedSessionTokenCount)}`,
    `Generated session count source: ${report.generatedSessionCountSource ?? "n/a"}`,
    `Generated session count trust: ${report.generatedSessionCountTrustClass ?? "n/a"}`,
    `Generated session count policy: ${report.generatedSessionCountPolicyStatus ?? "n/a"}`,
    `Degraded smoothing count: ${report.degradedSmoothingCount}`,
    `Generated file: ${report.generatedFilePath ?? "n/a"}`,
    `Archive: ${report.archivePath ?? "n/a"}`,
    "",
    "Bands",
  ];

  for (const bandType of BAND_ORDER) {
    const band = report.bands[bandType];
    lines.push(
      `${bandType}`,
      `- Budget vs actual: ${formatOptionalNumber(band.targetTokenBudget)} target, ${band.actualTokenCount} actual`,
      `- Rendered status: ${band.renderedStatus}`,
      `- Selected (${band.selectedCount}): ${formatSelectedIds(band.selectedIds)}`,
    );
  }

  lines.push("", "Selected turns");
  if (report.selectedTurns.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(...report.selectedTurns.map(formatTurn));
  }

  lines.push("", "Selected chunks");
  if (report.selectedChunks.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(...report.selectedChunks.map(formatChunk));
  }

  lines.push("", "Blockers");
  if (report.blockers.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(...report.blockers.map((issue) => `- ${issue.code}: ${issue.message}`));
  }

  return lines.join("\n");
}

export function formatCompactionAuditReportJson(report: CompactionAuditReport): string {
  return JSON.stringify(report, null, 2);
}
