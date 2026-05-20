import type { TokenCountRecord } from "../../../token-accounting/token-count-metadata.js";

export const CHUNK_CONVERSATION_TRANSCRIPT_STATUSES = [
  "ready",
  "pending",
  "failed",
  "invalid",
] as const;
export const CHUNK_SEMANTIC_ARTIFACT_BANDS = ["detailed", "brief"] as const;
export const CHUNK_SEMANTIC_ARTIFACT_STATUSES = ["ready", "pending", "failed"] as const;

export type ChunkConversationTranscriptStatus =
  (typeof CHUNK_CONVERSATION_TRANSCRIPT_STATUSES)[number];
export type ChunkSemanticArtifactBand = (typeof CHUNK_SEMANTIC_ARTIFACT_BANDS)[number];
export type ChunkSemanticArtifactStatus = (typeof CHUNK_SEMANTIC_ARTIFACT_STATUSES)[number];

export interface ChunkSemanticArtifactProviderMetadata {
  providerId: "openai-codex";
  modelId: "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.5";
  reasoningEffort: "none" | "low" | "medium" | "high";
  promptVersion: string;
  usage?: Record<string, unknown>;
  elapsedMs: number;
}

export interface ChunkConversationTranscriptRecord {
  status: ChunkConversationTranscriptStatus;
  text?: string;
  sourceFingerprint?: string;
  sourceRevision?: number;
  updatedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ChunkSemanticArtifactRecord {
  band: ChunkSemanticArtifactBand;
  status: ChunkSemanticArtifactStatus;
  text?: string;
  // Ready semantic artifacts must carry inference provenance. Do not satisfy
  // this contract with deterministic fallback text; provider failure should
  // persist pending/failed state instead.
  providerMetadata?: ChunkSemanticArtifactProviderMetadata;
  tokenCountMetadata?: TokenCountRecord;
  updatedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ChunkLowerBandState {
  detailed?: ChunkSemanticArtifactRecord;
  brief?: ChunkSemanticArtifactRecord;
}

export function cloneChunkConversationTranscriptRecord(
  record: ChunkConversationTranscriptRecord,
): ChunkConversationTranscriptRecord {
  return { ...record };
}

export function cloneChunkSemanticArtifactRecord(
  record: ChunkSemanticArtifactRecord,
): ChunkSemanticArtifactRecord {
  return {
    ...record,
    providerMetadata: record.providerMetadata
      ? {
          ...record.providerMetadata,
          usage: record.providerMetadata.usage ? { ...record.providerMetadata.usage } : undefined,
        }
      : undefined,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
  };
}

export function cloneChunkLowerBandState(record: ChunkLowerBandState): ChunkLowerBandState {
  return {
    detailed: record.detailed ? cloneChunkSemanticArtifactRecord(record.detailed) : undefined,
    brief: record.brief ? cloneChunkSemanticArtifactRecord(record.brief) : undefined,
  };
}
