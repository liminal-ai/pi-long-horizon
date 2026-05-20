import type { GeneratedTokenCount, TokenRollupBucket } from "../types/public.js";

export function increment(map: Record<string, number>, key: string | undefined): void {
  map[key || "unknown"] = (map[key || "unknown"] ?? 0) + 1;
}

export function visibleTextOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(visibleTextOf).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const o = value as any;
    if (typeof o.text === "string") return o.text;
    if (typeof o.output === "string") return o.output;
    if (typeof o.thinking === "string") return o.thinking;
    if (typeof o.arguments === "object") return JSON.stringify(o.arguments);
    return Object.entries(o)
      .filter(([k]) => !/signature|encrypted/i.test(k))
      .map(([, v]) => visibleTextOf(v))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function metadataLabel(source?: string, trustClass?: string): TokenRollupBucket["label"] {
  if (/provider|openai|anthropic/i.test(source ?? "") || /exact|provider_input_count/i.test(trustClass ?? "")) return "provider_exact";
  if (/heuristic|estimate/i.test(source ?? "") || /heuristic|estimate/i.test(trustClass ?? "")) return "estimate";
  return "unknown";
}

export function rollupTokenMetadata(items: unknown[]): TokenRollupBucket[] {
  const buckets = new Map<string, TokenRollupBucket>();
  for (const item of items) {
    const m = item as any;
    if (typeof m?.count !== "number") continue;
    const source = String(m.source ?? "unknown");
    const trustClass = String(m.trustClass ?? "unknown");
    const key = `${source}\u0000${trustClass}`;
    const bucket = buckets.get(key) ?? { source, trustClass, count: 0, records: 0, label: metadataLabel(source, trustClass) };
    bucket.count += m.count;
    bucket.records += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.source.localeCompare(b.source) || a.trustClass.localeCompare(b.trustClass));
}

export function walkTokenMetadata(value: unknown, predicate: (path: string[], metadata: any) => boolean, path: string[] = []): any[] {
  const out: any[] = [];
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...walkTokenMetadata(v, predicate, [...path, String(i)])));
    return out;
  }
  for (const [key, val] of Object.entries(value as any)) {
    const next = [...path, key];
    if (key.toLowerCase().includes("tokencountmetadata") && val && typeof val === "object" && predicate(next, val)) out.push(val);
    out.push(...walkTokenMetadata(val, predicate, next));
  }
  return out;
}

export function latestAssistantUsageTotal(records: any[], options: { ignoreZero?: boolean } = {}): number | undefined {
  let latest: number | undefined;
  for (const r of records) {
    const msg = r?.message;
    if (r?.type === "message" && msg?.role === "assistant" && typeof msg?.usage?.totalTokens === "number") {
      if (options.ignoreZero && msg.usage.totalTokens === 0) continue;
      latest = msg.usage.totalTokens;
    }
  }
  return latest;
}

export function generatedSessionTokenCount(thread: any, generatedRecords: any[]): GeneratedTokenCount | undefined {
  const generatedOutput = thread?.threadViewOutputSummary?.generatedOutput;
  const metadata = generatedOutput?.generatedSessionTokenCountMetadata;
  if (metadata && typeof metadata.count === "number") {
    return {
      count: metadata.count,
      label: metadataLabel(metadata.source, metadata.trustClass),
      source: "thread_view_output_summary.generatedSessionTokenCountMetadata",
      metadata,
    };
  }
  if (typeof generatedOutput?.generatedSessionTokenCount === "number") {
    return {
      count: generatedOutput.generatedSessionTokenCount,
      label: "unknown",
      source: "thread_view_output_summary.generatedSessionTokenCount",
    };
  }
  const latestUsage = latestAssistantUsageTotal(generatedRecords, { ignoreZero: true });
  return latestUsage === undefined ? undefined : { count: latestUsage, label: "provider_exact", source: "latest_assistant_usage" };
}

export function threadViewMetadata(records: any[]): any | undefined {
  return records.find((r) => r?.type === "custom" && r?.customType === "pi-long-horizon.thread-view.output")?.data;
}
