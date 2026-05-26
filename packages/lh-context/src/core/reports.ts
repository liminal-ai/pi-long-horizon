import { basename } from "node:path";

import { inspectBands, inspectSummary, inspectTokens } from "./inspectors.js";
import type {
  GeneratedTokenCount,
  InspectInput,
  PostCompactReportResult,
  TokenRollupBucket,
  TokenScaleEntry,
} from "../types/public.js";

export async function inspectPostCompactReport(input: InspectInput = {}): Promise<PostCompactReportResult> {
  const [summary, tokens, bands] = await Promise.all([
    inspectSummary(input),
    inspectTokens(input),
    inspectBands(input),
  ]);
  const generated = generatedTokenScale(tokens.generatedThreadViewTokenCount);
  const warnings = unique([
    ...summary.warnings,
    ...tokens.warnings,
    ...bands.warnings,
    ...statusWarnings(summary.status.degraded, "degraded"),
    ...statusWarnings(summary.status.repairNeeded, "repair_needed"),
    ...(tokens.generatedThreadViewTokenCount ? [] : ["Generated thread-view token count is unavailable."]),
  ]);

  return {
    kind: "post_compact_report",
    backing: summary.backing,
    threadId: summary.threadId,
    sourceRevision: summary.sourceRevision,
    messageHighWatermark: summary.messageHighWatermark,
    canonical: {
      messages: summary.messages,
      turns: summary.turns,
      chunks: summary.chunks,
    },
    generatedThreadView: {
      filePath: bands.generatedFilePath ?? summary.currentGeneratedFilePath,
      fileName: generatedFileName(bands.generatedFilePath ?? summary.currentGeneratedFilePath),
      generatedSessionTokenCount: tokens.generatedThreadViewTokenCount ?? bands.generatedSessionTokenCount,
      recordCount: bands.recordCount,
      messageCount: bands.messageCount,
      latestAssistantUsageTotalTokens: bands.latestAssistantUsageTotalTokens,
      statusSummary: {
        degradedCount: summary.status.degraded.length,
        repairNeededCount: summary.status.repairNeeded.length,
      },
    },
    bands: bands.bands,
    tokenScale: {
      canonicalRawEstimate: tokens.estimates.canonicalVisibleTextRaw,
      toolResultRawEstimate: tokens.estimates.toolResultRaw,
      rawTurn: tokenScaleEntry(tokens.rollups.rawTurnTokenMetadata),
      smoothTurn: tokenScaleEntry(tokens.rollups.smoothTurnTokenMetadata),
      lowerBandProjection: tokenScaleEntry(tokens.rollups.lowerBandProjectionTokenMetadata),
      chunkSmooth: tokenScaleEntry(tokens.rollups.chunkSmoothTokenMetadata),
      detailedChunk: tokenScaleEntry(tokens.rollups.detailedChunkTokenMetadata),
      briefChunk: tokenScaleEntry(tokens.rollups.briefChunkTokenMetadata),
      generated,
    },
    warnings,
  };
}

function tokenScaleEntry(buckets: TokenRollupBucket[]): TokenScaleEntry {
  return {
    buckets,
    providerExactTotal: totalForLabel(buckets, "provider_exact"),
    estimatedTotal: totalForLabel(buckets, "estimate"),
    unknownTotal: totalForLabel(buckets, "unknown"),
  };
}

function generatedTokenScale(count: GeneratedTokenCount | undefined): TokenScaleEntry {
  if (!count) return tokenScaleEntry([]);
  const metadata = count.metadata as { source?: unknown; trustClass?: unknown } | undefined;
  return tokenScaleEntry([{
    source: typeof metadata?.source === "string" ? metadata.source : count.source,
    trustClass: typeof metadata?.trustClass === "string" ? metadata.trustClass : count.label,
    label: count.label,
    count: count.count,
    records: 1,
  }]);
}

function generatedFileName(filePath: string | undefined): string | undefined {
  return filePath ? basename(filePath) : undefined;
}

function totalForLabel(buckets: TokenRollupBucket[], label: TokenRollupBucket["label"]): number {
  return buckets.filter((bucket) => bucket.label === label).reduce((sum, bucket) => sum + bucket.count, 0);
}

function statusWarnings(items: Array<{ path: string; status?: string; issues?: Array<{ code?: string; message?: string }> }>, label: string): string[] {
  return items.map((item) => {
    const codes = (item.issues ?? []).map((issue) => issue.code).filter(Boolean).join(", ");
    return `${label} status at ${item.path}${codes ? ` (${codes})` : ""}`;
  });
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}
