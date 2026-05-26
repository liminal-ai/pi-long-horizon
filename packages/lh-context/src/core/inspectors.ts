import { loadThread } from "./io.js";
import { estimateTokens, generatedSessionTokenCount, increment, latestAssistantUsageTotal, rollupTokenMetadata, threadViewMetadata, visibleTextOf } from "./util.js";
import type {
  BandDetail,
  BandName,
  BandsResult,
  InspectInput,
  MaintenanceReadinessEntry,
  ReadinessEntry,
  ReadinessResult,
  StatusSummary,
  SummaryResult,
  TokensResult,
} from "../types/public.js";

const BAND_NAMES: BandName[] = ["full_fidelity", "smooth", "detailed", "brief"];

export async function inspectSummary(input: InspectInput = {}): Promise<SummaryResult> {
  const loaded = await loadThread(input, { preferGeneratedThreadView: !input.threadId && !input.threadDir && !input.threadViewPath });
  const byKind: Record<string, number> = {};
  const byActorType: Record<string, number> = {};
  for (const m of loaded.messages) {
    increment(byKind, m?.messageKind);
    increment(byActorType, m?.actorType);
  }
  const status = summarizeStatuses(loaded.thread?.status);
  return {
    kind: "summary",
    backing: loaded.backing,
    rootDir: loaded.rootDir,
    contextStewardDir: loaded.contextStewardDir,
    threadDir: loaded.threadDir,
    threadId: loaded.threadId,
    sourceRevision: loaded.thread?.sourceRevision,
    messageHighWatermark: loaded.thread?.messageHighWatermark,
    updatedAt: loaded.thread?.updatedAt,
    messages: { total: loaded.messages.length, byKind, byActorType },
    turns: countLifecycle(loaded.turns),
    chunks: countLifecycle(loaded.chunks),
    currentGeneratedFilePath: loaded.generatedFilePath,
    currentGeneratedTokenCount: generatedSessionTokenCount(loaded.thread, loaded.generatedRecords)?.count,
    status,
    warnings: loaded.warnings,
  };
}

export async function inspectTokens(input: InspectInput = {}): Promise<TokensResult> {
  const loaded = await loadThread(input, { preferGeneratedThreadView: !input.threadId && !input.threadDir && !input.threadViewPath });
  const canonicalText = loaded.messages.map((m) => (m?.parts ?? []).map((p: any) => visibleTextOf(p.content)).join("\n")).join("\n");
  const toolText = loaded.messages.filter((m) => m?.messageKind === "tool_result" || m?.actorType === "tool").map((m) => visibleTextOf(m.parts)).join("\n");
  const rawTurn = loaded.turns.flatMap((t) => t?.rawTokenCountMetadata ? [t.rawTokenCountMetadata] : []);
  const smoothTurn = loaded.turns.flatMap((t) => t?.smooth?.tokenCountMetadata ? [t.smooth.tokenCountMetadata] : []);
  const lowerBand = loaded.turns.flatMap((t) => t?.smooth?.lowerBandProjection?.tokenCountMetadata ? [t.smooth.lowerBandProjection.tokenCountMetadata] : []);
  const chunkSmooth = loaded.chunks.flatMap((c) => c?.smoothTokenCountMetadata ? [c.smoothTokenCountMetadata] : []);
  const detailed = loaded.chunks.flatMap((c) => chunkLowerBandTokenMetadata(c, "detailed") ? [chunkLowerBandTokenMetadata(c, "detailed")] : []);
  const brief = loaded.chunks.flatMap((c) => chunkLowerBandTokenMetadata(c, "brief") ? [chunkLowerBandTokenMetadata(c, "brief")] : []);
  const generated = generatedSessionTokenCount(loaded.thread, loaded.generatedRecords);
  return {
    kind: "tokens",
    backing: loaded.backing,
    threadId: loaded.threadId,
    estimates: {
      canonicalVisibleTextRaw: { count: estimateTokens(canonicalText), label: "estimate", method: "visible_text_chars_div_4" },
      toolResultRaw: { count: estimateTokens(toolText), label: "estimate", method: "visible_text_chars_div_4" },
    },
    rollups: {
      rawTurnTokenMetadata: rollupTokenMetadata(rawTurn),
      smoothTurnTokenMetadata: rollupTokenMetadata(smoothTurn),
      lowerBandProjectionTokenMetadata: rollupTokenMetadata(lowerBand),
      chunkSmoothTokenMetadata: rollupTokenMetadata(chunkSmooth),
      detailedChunkTokenMetadata: rollupTokenMetadata(detailed),
      briefChunkTokenMetadata: rollupTokenMetadata(brief),
    },
    generatedThreadViewTokenCount: generated,
    warnings: loaded.warnings,
  };
}

export async function inspectBands(input: InspectInput = {}): Promise<BandsResult> {
  const loaded = await loadThread(input, { preferGeneratedThreadView: !input.threadId && !input.threadDir && !input.threadViewPath });
  const meta = threadViewMetadata(loaded.generatedRecords);
  const warnings = [...loaded.warnings];
  if (!meta) warnings.push("Generated thread-view metadata record is missing; band details are partial.");
  const bands = Object.fromEntries(BAND_NAMES.map((b) => [b, emptyBand(b)])) as Record<BandName, BandDetail>;
  const entries = Array.isArray(meta?.entries) ? meta.entries : [];
  const turnMeta = new Map<string, { index: number; raw?: number; smooth?: number }>();
  loaded.turns.forEach((t, i) => {
    if (!t?.turnId) return;
    turnMeta.set(t.turnId, {
      index: typeof t.turnOrder === "number" ? t.turnOrder : i + 1,
      raw: numeric(t.rawTokenCountMetadata?.count),
      smooth: numeric(t.smooth?.tokenCountMetadata?.count),
    });
  });
  const tokenByChunkBand = new Map<string, number>();
  for (const c of loaded.chunks) {
    for (const [band, n] of [["smooth", c?.smoothTokenCountMetadata?.count], ["detailed", chunkLowerBandTokenMetadata(c, "detailed")?.count], ["brief", chunkLowerBandTokenMetadata(c, "brief")?.count]] as const) {
      if (c?.chunkId && typeof n === "number") tokenByChunkBand.set(`${band}:${c.chunkId}`, n);
    }
  }
  const selectedBandEntryCounts: Record<string, number> = {};
  const turnSets = new Map<BandName, Set<string>>(BAND_NAMES.map((b) => [b, new Set<string>()]));
  const chunkSets = new Map<BandName, Set<string>>(BAND_NAMES.map((b) => [b, new Set<string>()]));
  for (const e of entries) {
    const band = normalizeBand(e?.metadata?.bandType);
    if (!band) continue;
    selectedBandEntryCounts[band] = (selectedBandEntryCounts[band] ?? 0) + 1;
    bands[band].entries += 1;
    const ref = String(e?.metadata?.sourceReference ?? "");
    const turnId = ref.match(/(turn[-_][A-Za-z0-9-]+)/)?.[1];
    const chunkId = ref.match(/(chunk-[A-Za-z0-9-]+|chunk_[A-Za-z0-9-]+)/)?.[1];
    if (turnId) turnSets.get(band)!.add(turnId);
    if (chunkId) chunkSets.get(band)!.add(chunkId);
  }
  for (const b of BAND_NAMES) {
    const turns = [...turnSets.get(b)!].sort((a, z) => (turnMeta.get(a)?.index ?? Number.MAX_SAFE_INTEGER) - (turnMeta.get(z)?.index ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(z));
    const turnIndices = turns.map((t) => turnMeta.get(t)?.index).filter((v): v is number => typeof v === "number");
    const chunks = [...chunkSets.get(b)!].sort();
    bands[b].turns = {
      count: turns.length,
      ids: turns,
      indices: turnIndices,
      range: turns.length ? { firstId: turns[0]!, lastId: turns.at(-1)!, firstIndex: turnIndices[0], lastIndex: turnIndices.at(-1) } : undefined,
    };
    bands[b].chunks = { count: chunks.length, ids: chunks };
    bands[b].tokenSum = bandTokenSum(b, turns, chunks, turnMeta, tokenByChunkBand);
  }
  return {
    kind: "bands",
    backing: loaded.backing,
    threadId: loaded.threadId,
    generatedFilePath: loaded.generatedFilePath,
    recordCount: loaded.generatedRecords.length,
    messageCount: loaded.generatedRecords.filter((r) => r?.type === "message").length,
    generatedSessionTokenCount: generatedSessionTokenCount(loaded.thread, loaded.generatedRecords),
    latestAssistantUsageTotalTokens: latestAssistantUsageTotal(loaded.generatedRecords),
    selectedBandEntryCounts: Object.keys(selectedBandEntryCounts).length ? selectedBandEntryCounts : undefined,
    bands,
    livePostCompactTailDetection: { supported: false, note: "TODO: distinguish appended live PI turns from generated compact projection without guessing." },
    warnings,
  };
}

export async function inspectReadiness(input: InspectInput = {}): Promise<ReadinessResult> {
  const loaded = await loadThread(input, { preferGeneratedThreadView: !input.threadId && !input.threadDir && !input.threadViewPath });
  const projection = projectionReadiness(loaded.thread, loaded.generatedFilePath, loaded.generatedRecords.length, loaded.warnings);
  const tokenCounting = readinessEntry(loaded.thread?.status?.tokenCounting);
  const overallStatus = determineOverallReadiness(loaded.thread?.status?.turnState, tokenCounting, projection);

  return {
    kind: "readiness",
    backing: loaded.backing,
    threadId: loaded.threadId,
    overallStatus,
    compactModeRecommendation: overallStatus === "ready" ? "strict" : "prepare",
    turnState: loaded.thread?.status?.turnState ?? "unknown",
    tokenCounting,
    projection,
    maintenance: {
      background: maintenanceEntry(loaded.thread?.status?.maintenance?.background),
      manualRepair: maintenanceEntry(loaded.thread?.status?.maintenance?.manualRepair),
      prepare: maintenanceEntry(loaded.thread?.status?.maintenance?.prepare),
    },
    warnings: loaded.warnings,
  };
}

function countLifecycle(items: any[]): { total: number; closed: number; open: number } {
  return { total: items.length, closed: items.filter((i) => i?.lifecycleStatus === "closed").length, open: items.filter((i) => i?.lifecycleStatus === "open").length };
}

function summarizeStatuses(status: any): SummaryResult["status"] {
  const degraded: StatusSummary[] = [];
  const repairNeeded: StatusSummary[] = [];
  function walk(v: any, p: string[]) {
    if (!v || typeof v !== "object") return;
    if (typeof v.status === "string" || typeof v.state === "string") {
      const s = v.status ?? v.state;
      const item = { path: p.join("."), status: s, issueCount: v.issueCount, issues: v.issues };
      if (s === "degraded") degraded.push(item);
      if (s === "repair_needed") repairNeeded.push(item);
    }
    for (const [k, child] of Object.entries(v)) walk(child, [...p, k]);
  }
  walk(status, ["status"]);
  return { degraded, repairNeeded };
}

function readinessEntry(record: any): ReadinessEntry | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  return {
    status: typeof record.status === "string" ? record.status : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    sourceRevision: typeof record.sourceRevision === "number" ? record.sourceRevision : undefined,
    issueCount: typeof record.issueCount === "number" ? record.issueCount : Array.isArray(record.issues) ? record.issues.length : 0,
    issues: normalizeIssues(record.issues),
  };
}

function maintenanceEntry(record: any): MaintenanceReadinessEntry | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }

  return {
    status: typeof record.status === "string" ? record.status : "unknown",
    scope: typeof record.scope === "string" ? record.scope : "unknown",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "unknown",
    sourceRevision: typeof record.sourceRevision === "number" ? record.sourceRevision : undefined,
    fixedCount: typeof record.fixedCount === "number" ? record.fixedCount : 0,
    skippedCount: typeof record.skippedCount === "number" ? record.skippedCount : 0,
    failedCount: typeof record.failedCount === "number" ? record.failedCount : 0,
    remainingDebtCount: typeof record.remainingDebtCount === "number" ? record.remainingDebtCount : 0,
    blockerCount: Array.isArray(record.blockers) ? record.blockers.length : 0,
    blockers: normalizeIssues(record.blockers),
  };
}

function projectionReadiness(
  thread: any,
  generatedFilePath: string | undefined,
  generatedRecordCount: number,
  warnings: string[],
): ReadinessResult["projection"] {
  const generatedOutput = thread?.threadViewOutputSummary?.generatedOutput;
  const issues = normalizeIssues(generatedOutput?.issues);
  const recordedPath = generatedOutput?.generatedFilePath ?? thread?.threadViewOutputSummary?.currentGeneratedFilePath ?? thread?.target?.currentGeneratedFilePath;
  const hasMissingGeneratedWarning = warnings.some((warning) => warning.includes("Generated thread-view file not found"));

  let status: ReadinessResult["projection"]["status"] = "unknown";
  if (hasMissingGeneratedWarning || generatedOutput?.status === "blocked" || generatedOutput?.status === "write_failed") {
    status = "blocked";
  } else if (issues.length > 0 || generatedOutput?.status === "degraded" || generatedOutput?.status === "reload_failed") {
    status = "degraded";
  } else if (generatedFilePath && generatedRecordCount > 0) {
    status = "ready";
  }

  return {
    status,
    currentGeneratedFilePath: generatedFilePath ?? recordedPath,
    currentProjectionRevisionId: thread?.threadViewOutputSummary?.currentProjectionRevisionId,
    generatedOutputStatus: typeof generatedOutput?.status === "string" ? generatedOutput.status : undefined,
    issueCount: issues.length,
    issues,
  };
}

function determineOverallReadiness(
  turnState: unknown,
  tokenCounting: ReadinessEntry | undefined,
  projection: ReadinessResult["projection"],
): ReadinessResult["overallStatus"] {
  if (turnState === "repair_failed" || projection.status === "blocked") {
    return "blocked";
  }

  if (turnState !== "ready" || tokenCounting?.status === "repair_needed" || projection.status === "degraded") {
    return "prepare_recommended";
  }

  return "ready";
}

function normalizeIssues(issues: unknown): Array<{ code?: string; message?: string }> {
  return Array.isArray(issues)
    ? issues.flatMap((issue) => issue && typeof issue === "object"
      ? [{
          code: typeof (issue as { code?: unknown }).code === "string" ? (issue as { code: string }).code : undefined,
          message: typeof (issue as { message?: unknown }).message === "string" ? (issue as { message: string }).message : undefined,
        }]
      : [])
    : [];
}

function emptyBand(band: BandName): BandDetail {
  return { band, entries: 0, turns: { count: 0, ids: [], indices: [] }, chunks: { count: 0, ids: [] } };
}

function chunkLowerBandTokenMetadata(chunk: any, band: "detailed" | "brief"): any | undefined {
  return chunk?.lowerBand?.[band]?.tokenCountMetadata ?? chunk?.placeholders?.[band]?.tokenCountMetadata;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function bandTokenSum(
  band: BandName,
  turns: string[],
  chunks: string[],
  turnMeta: Map<string, { index: number; raw?: number; smooth?: number }>,
  tokenByChunkBand: Map<string, number>,
): number | undefined {
  let total = 0;
  let found = false;
  for (const turnId of turns) {
    const token = band === "full_fidelity" ? turnMeta.get(turnId)?.raw : band === "smooth" ? turnMeta.get(turnId)?.smooth : undefined;
    if (typeof token === "number") { total += token; found = true; }
  }
  for (const chunkId of chunks) {
    const token = tokenByChunkBand.get(`${band}:${chunkId}`);
    if (typeof token === "number") { total += token; found = true; }
  }
  return found ? total : undefined;
}

function normalizeBand(value: unknown): BandName | undefined {
  return BAND_NAMES.includes(value as BandName) ? value as BandName : undefined;
}
