import type { TurnSmoothRecord } from "../../domain/records.js";
import type { TokenCountRecord } from "../../../token-accounting/token-count-metadata.js";

export const SMOOTH_TURN_STATUSES = ["ready", "missing", "stale", "invalid"] as const;
export const SMOOTH_TURN_STRATEGIES = ["deterministic_marker_sections_v1"] as const;

export type SmoothTurnStatus = (typeof SMOOTH_TURN_STATUSES)[number];
export type SmoothTurnStrategy = (typeof SMOOTH_TURN_STRATEGIES)[number];

export interface SmoothTurnState {
  turnId: string;
  threadId: string;
  status: SmoothTurnStatus;
  text?: string;
  tokenCountMetadata?: TokenCountRecord;
  strategy?: SmoothTurnStrategy;
  generatedAt?: string;
  sourceRevision?: number;
}

export interface EnsureSmoothTurnInput {
  threadId: string;
  turnId: string;
}

export interface ReadSmoothTurnStateInput {
  threadId: string;
  turnId: string;
}

export interface EnsureSmoothTurnResult {
  turnId: string;
  smoothStatus: SmoothTurnStatus;
  smoothTokenCount?: number;
}

export interface ReadSmoothTurnStateResult extends EnsureSmoothTurnResult {
  smoothText?: string;
  smoothStrategy?: SmoothTurnStrategy;
  generatedAt?: string;
  sourceRevision?: number;
}

export function normalizeDeterministicText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function estimateDeterministicTokenCount(text: string): number {
  const normalized = normalizeDeterministicText(text);
  return normalized.length === 0 ? 0 : normalized.split(" ").length;
}

export function cloneSmoothTurnState(record: SmoothTurnState): SmoothTurnState {
  return {
    ...record,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
  };
}

export function toTurnSmoothRecord(record: SmoothTurnState): TurnSmoothRecord {
  return {
    status: record.status,
    text: record.text,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
    strategy: record.strategy,
    generatedAt: record.generatedAt,
    sourceRevision: record.sourceRevision,
  };
}
