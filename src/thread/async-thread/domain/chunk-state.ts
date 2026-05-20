import {
  cloneChunkConversationTranscriptRecord,
  cloneChunkLowerBandState,
  type ChunkConversationTranscriptRecord,
  type ChunkLowerBandState,
} from "./lower-band-artifact-state.js";
import {
  clonePlaceholderArtifactState,
  type PlaceholderArtifactState,
} from "./placeholder-artifact-state.js";
import type { StewardIssue } from "../../domain/errors.js";
import type { TokenCountRecord } from "../../../token-accounting/token-count-metadata.js";

export const CHUNK_LIFECYCLE_STATUSES = ["open", "closed"] as const;
export const CHUNK_CLOSE_REASONS = ["soft_threshold", "hard_max", "manual", "repair"] as const;
export const CHUNK_SCHEMA_VERSION = "conversation_only_chunk_v1" as const;

export type ChunkLifecycleStatus = (typeof CHUNK_LIFECYCLE_STATUSES)[number];
export type ChunkCloseReason = (typeof CHUNK_CLOSE_REASONS)[number];

export interface BaseChunkState {
  chunkId: string;
  threadId: string;
  lifecycleStatus: ChunkLifecycleStatus;
  sourceTurnIds: string[];
  smoothText?: string;
  smoothTokenCountMetadata?: TokenCountRecord;
  openedAt?: string;
  closedAt?: string;
  closeReason?: ChunkCloseReason;
  sourceRevision?: number;
}

export interface CanonicalChunkState extends BaseChunkState {
  schemaVersion?: typeof CHUNK_SCHEMA_VERSION;
  conversationTranscript?: ChunkConversationTranscriptRecord;
  lowerBand?: ChunkLowerBandState;
  placeholders?: never;
}

export interface LegacyPlaceholderChunkState extends BaseChunkState {
  schemaVersion?: never;
  conversationTranscript?: never;
  lowerBand?: never;
  placeholders?: PlaceholderArtifactState;
}

export type ChunkState = CanonicalChunkState | LegacyPlaceholderChunkState;

export interface UpdateChunkStateInput {
  threadId: string;
}

export interface UpdateChunkStateResult {
  threadId: string;
  updatedChunkIds: string[];
  blockers: StewardIssue[];
}

export interface ReadyChunkLowerBandArtifact {
  band: "detailed" | "brief";
  kind: "semantic";
  text: string;
  tokenCountMetadata?: TokenCountRecord;
}

export function isLegacyPlaceholderChunkState(record: ChunkState): record is LegacyPlaceholderChunkState {
  return (
    "placeholders" in record ||
    (
      record.lifecycleStatus === "closed" &&
      record.schemaVersion !== CHUNK_SCHEMA_VERSION &&
      !("conversationTranscript" in record) &&
      !("lowerBand" in record)
    )
  );
}

export function isCanonicalChunkState(record: ChunkState): record is CanonicalChunkState {
  return !isLegacyPlaceholderChunkState(record);
}

export function getReadyChunkLowerBandArtifact(
  chunk: ChunkState,
  band: "detailed" | "brief",
): ReadyChunkLowerBandArtifact | undefined {
  const semanticArtifact = chunk.lowerBand?.[band];
  if (semanticArtifact?.status === "ready" && semanticArtifact.text) {
    return {
      band,
      kind: "semantic",
      text: semanticArtifact.text,
      tokenCountMetadata: semanticArtifact.tokenCountMetadata,
    };
  }

  return undefined;
}

export function getReadyChunkConversationTranscriptText(chunk: ChunkState): string | undefined {
  if (!isCanonicalChunkState(chunk)) {
    return undefined;
  }

  if (chunk.conversationTranscript?.status !== "ready" || !chunk.conversationTranscript.text) {
    return undefined;
  }

  return chunk.conversationTranscript.text;
}

export function hasConversationOnlyChunkCutover(chunks: readonly ChunkState[]): boolean {
  return chunks.some((chunk) => chunk.schemaVersion === CHUNK_SCHEMA_VERSION);
}

export function cloneChunkState(record: ChunkState): ChunkState {
  const base = {
    ...record,
    sourceTurnIds: [...record.sourceTurnIds],
    smoothTokenCountMetadata: record.smoothTokenCountMetadata ? { ...record.smoothTokenCountMetadata } : undefined,
  };

  if (isLegacyPlaceholderChunkState(record)) {
    return {
      ...base,
      schemaVersion: undefined,
      conversationTranscript: undefined,
      lowerBand: undefined,
      placeholders: record.placeholders ? clonePlaceholderArtifactState(record.placeholders) : undefined,
    } as LegacyPlaceholderChunkState;
  }

  return {
    ...base,
    schemaVersion: "schemaVersion" in record ? record.schemaVersion : undefined,
    conversationTranscript: "conversationTranscript" in record && record.conversationTranscript
      ? cloneChunkConversationTranscriptRecord(record.conversationTranscript)
      : undefined,
    lowerBand: "lowerBand" in record && record.lowerBand ? cloneChunkLowerBandState(record.lowerBand) : undefined,
  } as CanonicalChunkState;
}
