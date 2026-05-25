import { basename } from "node:path";

import type { BandDetail, BandsResult, PostCompactReportResult, SummaryResult, TokensResult } from "../types/public.js";

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatSummaryHuman(r: SummaryResult): string {
  return [
    `PI Long Horizon context summary`,
    `Thread: ${r.threadId}`,
    `Updated: ${r.updatedAt ?? "unknown"}  sourceRevision=${r.sourceRevision ?? "?"}  highWatermark=${r.messageHighWatermark ?? "?"}`,
    `Messages: ${r.messages.total} (${kv(r.messages.byKind)}; actors: ${kv(r.messages.byActorType)})`,
    `Turns: ${r.turns.total} closed=${r.turns.closed} open=${r.turns.open}`,
    `Chunks: ${r.chunks.total} closed=${r.chunks.closed} open=${r.chunks.open}`,
    `Generated thread-view: ${r.currentGeneratedFilePath ?? "none"}`,
    `Generated tokens: ${r.currentGeneratedTokenCount ?? "unknown"}`,
    `Status: degraded=${r.status.degraded.length} repairNeeded=${r.status.repairNeeded.length}`,
    ...warnings(r.warnings),
  ].join("\n") + "\n";
}

export function formatTokensHuman(r: TokensResult): string {
  const lines = [
    `PI Long Horizon token inspection`,
    `Thread: ${r.threadId}`,
    `Canonical visible text raw estimate: ${r.estimates.canonicalVisibleTextRaw.count} (${r.estimates.canonicalVisibleTextRaw.method})`,
    `Tool-result raw estimate: ${r.estimates.toolResultRaw.count} (${r.estimates.toolResultRaw.method})`,
    `Generated thread-view tokens: ${r.generatedThreadViewTokenCount?.count ?? "unknown"} (${r.generatedThreadViewTokenCount?.label ?? "n/a"}${r.generatedThreadViewTokenCount ? `, ${r.generatedThreadViewTokenCount.source}` : ""})`,
    `Rollups:`,
  ];
  for (const [name, buckets] of Object.entries(r.rollups)) lines.push(`  ${name}: ${buckets.map((b) => `${b.count} ${b.source}/${b.trustClass} ${b.label}`).join(", ") || "none"}`);
  return [...lines, ...warnings(r.warnings)].join("\n") + "\n";
}

export function formatPostCompactReportHuman(r: PostCompactReportResult): string {
  const generatedFile = r.generatedThreadView.fileName ?? (r.generatedThreadView.filePath ? basename(r.generatedThreadView.filePath) : "none");
  const lines = [
    `Post-compact context report:`,
    ``,
    `Thread: ${r.threadId}`,
    `Messages: ${formatNumber(r.canonical.messages.total)}`,
    ...Object.entries(r.canonical.messages.byKind).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `  ${kind}: ${formatNumber(count)}`),
    `Turns: ${r.canonical.turns.closed} closed / ${r.canonical.turns.open} open`,
    `Chunks: ${r.canonical.chunks.closed} closed / ${r.canonical.chunks.open} open`,
    ``,
    `Generated thread-view:`,
    `  Generated file: ${generatedFile}`,
    `  Generated tokens: ${formatMaybeNumber(r.generatedThreadView.generatedSessionTokenCount?.count)}${r.generatedThreadView.generatedSessionTokenCount ? ` ${tokenCountLabel(r.generatedThreadView.generatedSessionTokenCount.label)}` : ""}`,
    `  Records: ${formatNumber(r.generatedThreadView.recordCount)}`,
    `  Messages: ${formatNumber(r.generatedThreadView.messageCount)}`,
    `  Status: degraded=${r.generatedThreadView.statusSummary.degradedCount} repairNeeded=${r.generatedThreadView.statusSummary.repairNeededCount}`,
    ``,
    `Bands:`,
    ...(["full_fidelity", "smooth", "detailed", "brief"] as const).map((band) => formatReportBandLine(band, r.bands[band])),
    ``,
    `Token scale:`,
    `  Canonical raw estimate: ${formatNumber(r.tokenScale.canonicalRawEstimate.count)}`,
    `  Tool-result raw estimate: ${formatNumber(r.tokenScale.toolResultRawEstimate.count)}`,
    `  Raw turn exact total: ${formatNumber(r.tokenScale.rawTurn.providerExactTotal)}`,
    `  Smooth turn exact total: ${formatNumber(r.tokenScale.smoothTurn.providerExactTotal)}`,
    `  Generated exact total: ${formatNumber(r.tokenScale.generated.providerExactTotal)}`,
  ];
  return [...lines, ...warnings(r.warnings)].join("\n") + "\n";
}

export function formatBandsHuman(r: BandsResult): string {
  const lines = [
    `PI Long Horizon band inspection`,
    `Thread: ${r.threadId}`,
    `Generated thread-view: ${r.generatedFilePath ?? "none"}`,
    `Records: ${r.recordCount}  messages=${r.messageCount}  generatedSessionTokens=${r.generatedSessionTokenCount?.count ?? "unknown"}${r.generatedSessionTokenCount ? ` (${r.generatedSessionTokenCount.label}, ${r.generatedSessionTokenCount.source})` : ""}  latestAssistantUsage=${r.latestAssistantUsageTotalTokens ?? "unknown"}`,
  ];
  for (const band of ["full_fidelity", "smooth", "detailed", "brief"] as const) {
    const b = r.bands[band];
    lines.push(`${band}: entries=${b.entries} turns=${b.turns.count}${formatTurnRange(b.turns.range)} chunks=${b.chunks.count}${b.tokenSum === undefined ? "" : ` tokenSum=${b.tokenSum}`}`);
  }
  lines.push(`Live tail detection: unsupported (${r.livePostCompactTailDetection.note})`);
  return [...lines, ...warnings(r.warnings)].join("\n") + "\n";
}

function formatReportBandLine(band: string, detail: BandDetail): string {
  const parts = [`  ${band}:`];
  if (detail.turns.count > 0) parts.push(`${detail.turns.count} turns${formatTurnRange(detail.turns.range)}`);
  if (detail.chunks.count > 0) parts.push(`${detail.chunks.count} chunks${detail.chunks.ids.length ? ` ${detail.chunks.ids.join(",")}` : ""}`);
  if (detail.turns.count === 0 && detail.chunks.count === 0) parts.push(band === "detailed" || band === "brief" ? "0 chunks" : "0 turns");
  if (detail.tokenSum !== undefined) parts.push(`tokenSum ${formatNumber(detail.tokenSum)}`);
  return parts.join("   ");
}

function tokenCountLabel(label: string): string {
  if (label === "provider_exact") return "exact";
  return label;
}

function formatMaybeNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function kv(record: Record<string, number>): string {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
}

function warnings(items: string[]): string[] {
  return items.length ? [`Warnings:`, ...items.map((w) => `  - ${w}`)] : [];
}

function formatTurnRange(range: BandsResult["bands"]["full_fidelity"]["turns"]["range"]): string {
  if (!range) return "";
  if (typeof range.firstIndex === "number" && typeof range.lastIndex === "number") {
    return range.firstIndex === range.lastIndex ? ` (turn ${range.firstIndex})` : ` (turns ${range.firstIndex}-${range.lastIndex})`;
  }
  return ` (${range.firstId}..${range.lastId})`;
}
