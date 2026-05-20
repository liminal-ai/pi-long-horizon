export interface InspectInput {
  rootDir?: string;
  threadId?: string;
  threadDir?: string;
  threadViewPath?: string;
}

export type TrustClass = string;
export type TokenSource = string;

export interface TokenRollupBucket {
  source: TokenSource;
  trustClass: TrustClass;
  count: number;
  records: number;
  label: "provider_exact" | "estimate" | "unknown";
}

export interface StatusSummary {
  path: string;
  status?: string;
  issueCount?: number;
  issues?: Array<{ code?: string; message?: string }>;
}

export interface GeneratedTokenCount {
  count: number;
  label: "provider_exact" | "estimate" | "unknown";
  source: "thread_view_output_summary.generatedSessionTokenCountMetadata" | "thread_view_output_summary.generatedSessionTokenCount" | "latest_assistant_usage";
  metadata?: unknown;
}

export interface SummaryResult {
  kind: "summary";
  rootDir: string;
  contextStewardDir: string;
  threadDir: string;
  threadId: string;
  sourceRevision?: number;
  messageHighWatermark?: number;
  updatedAt?: string;
  messages: {
    total: number;
    byKind: Record<string, number>;
    byActorType: Record<string, number>;
  };
  turns: { total: number; closed: number; open: number };
  chunks: { total: number; closed: number; open: number };
  currentGeneratedFilePath?: string;
  currentGeneratedTokenCount?: number;
  status: {
    degraded: StatusSummary[];
    repairNeeded: StatusSummary[];
  };
  warnings: string[];
}

export interface TokensResult {
  kind: "tokens";
  threadId: string;
  estimates: {
    canonicalVisibleTextRaw: { count: number; label: "estimate"; method: string };
    toolResultRaw: { count: number; label: "estimate"; method: string };
  };
  rollups: {
    rawTurnTokenMetadata: TokenRollupBucket[];
    smoothTurnTokenMetadata: TokenRollupBucket[];
    lowerBandProjectionTokenMetadata: TokenRollupBucket[];
    chunkSmoothTokenMetadata: TokenRollupBucket[];
    detailedChunkTokenMetadata: TokenRollupBucket[];
    briefChunkTokenMetadata: TokenRollupBucket[];
  };
  generatedThreadViewTokenCount?: GeneratedTokenCount;
  warnings: string[];
}

export type BandName = "full_fidelity" | "smooth" | "detailed" | "brief";

export interface BandDetail {
  band: BandName;
  entries: number;
  turns: {
    count: number;
    ids: string[];
    indices: number[];
    range?: { firstId: string; lastId: string; firstIndex?: number; lastIndex?: number };
  };
  chunks: { count: number; ids: string[] };
  tokenSum?: number;
}

export interface BandsResult {
  kind: "bands";
  threadId: string;
  generatedFilePath?: string;
  recordCount: number;
  messageCount: number;
  generatedSessionTokenCount?: GeneratedTokenCount;
  latestAssistantUsageTotalTokens?: number;
  selectedBandEntryCounts?: Record<string, number>;
  bands: Record<BandName, BandDetail>;
  livePostCompactTailDetection: { supported: false; note: string };
  warnings: string[];
}
