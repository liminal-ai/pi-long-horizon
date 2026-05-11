import type { StewardIssue } from "../../domain/errors.js";

export const PLACEHOLDER_ARTIFACT_KINDS = ["detailed", "brief"] as const;
export const PLACEHOLDER_ARTIFACT_STATUSES = ["ready", "missing", "invalid"] as const;
export const PLACEHOLDER_ARTIFACT_STRATEGIES = [
  "deterministic_truncate_30",
  "deterministic_truncate_5",
] as const;
export const PLACEHOLDER_ARTIFACT_MARKERS = {
  detailed: "[deterministic-placeholder:detailed] [not-semantic-summary]",
  brief: "[deterministic-placeholder:brief] [not-semantic-summary]",
} as const;

export type PlaceholderArtifactKind = (typeof PLACEHOLDER_ARTIFACT_KINDS)[number];
export type PlaceholderArtifactStatus = (typeof PLACEHOLDER_ARTIFACT_STATUSES)[number];
export type PlaceholderArtifactStrategy = (typeof PLACEHOLDER_ARTIFACT_STRATEGIES)[number];

export interface PlaceholderArtifactRecord {
  kind: PlaceholderArtifactKind;
  status: PlaceholderArtifactStatus;
  text?: string;
  tokenCount?: number;
  strategy:
    | "deterministic_truncate_30"
    | "deterministic_truncate_5";
  generatedAt?: string;
}

export interface PlaceholderArtifactState {
  chunkId: string;
  threadId: string;
  detailed?: PlaceholderArtifactRecord;
  brief?: PlaceholderArtifactRecord;
}

export interface EnsurePlaceholderArtifactsInput {
  threadId: string;
  chunkId: string;
}

export interface EnsurePlaceholderArtifactsResult {
  chunkId: string;
  detailedReady: boolean;
  briefReady: boolean;
  blockers: StewardIssue[];
}

export function getPlaceholderArtifactMarker(kind: PlaceholderArtifactKind): string {
  return PLACEHOLDER_ARTIFACT_MARKERS[kind];
}

export function clonePlaceholderArtifactRecord(
  record: PlaceholderArtifactRecord,
): PlaceholderArtifactRecord {
  return {
    ...record,
  };
}

export function clonePlaceholderArtifactState(
  record: PlaceholderArtifactState,
): PlaceholderArtifactState {
  return {
    ...record,
    detailed: record.detailed ? clonePlaceholderArtifactRecord(record.detailed) : undefined,
    brief: record.brief ? clonePlaceholderArtifactRecord(record.brief) : undefined,
  };
}
