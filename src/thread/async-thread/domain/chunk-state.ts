import {
  clonePlaceholderArtifactState,
  type PlaceholderArtifactState,
} from "./placeholder-artifact-state.js";
import type { StewardIssue } from "../../domain/errors.js";

export const CHUNK_LIFECYCLE_STATUSES = ["open", "closed"] as const;
export const CHUNK_CLOSE_REASONS = ["soft_threshold", "hard_max", "manual", "repair"] as const;

export type ChunkLifecycleStatus = (typeof CHUNK_LIFECYCLE_STATUSES)[number];
export type ChunkCloseReason = (typeof CHUNK_CLOSE_REASONS)[number];

export interface ChunkState {
  chunkId: string;
  threadId: string;
  lifecycleStatus: ChunkLifecycleStatus;
  sourceTurnIds: string[];
  smoothText?: string;
  smoothTokenCount: number;
  openedAt?: string;
  closedAt?: string;
  closeReason?: ChunkCloseReason;
  sourceRevision?: number;
  placeholders?: PlaceholderArtifactState;
}

export interface UpdateChunkStateInput {
  threadId: string;
}

export interface UpdateChunkStateResult {
  threadId: string;
  updatedChunkIds: string[];
  blockers: StewardIssue[];
}

export function cloneChunkState(record: ChunkState): ChunkState {
  return {
    ...record,
    sourceTurnIds: [...record.sourceTurnIds],
    placeholders: record.placeholders ? clonePlaceholderArtifactState(record.placeholders) : undefined,
  };
}
