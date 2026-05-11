import { createGeneratedId, createStableId } from "../../context-steward/domain/ids.js";

export const THREAD_VIEW_STATES = ["active", "draft", "archived"] as const;
export const THREAD_VIEW_STATUSES = ["ready", "incomplete", "blocked", "unknown"] as const;
export const BAND_TYPES = ["full_fidelity", "smooth", "detailed", "brief"] as const;
export const BAND_RENDERED_STATUSES = ["ready", "missing_artifacts", "blocked", "unknown"] as const;
export const SOURCE_UNIT_TYPES = ["turn", "chunk"] as const;
export const EMITTED_SOURCE_KINDS = [
  "raw_turn_message",
  "smooth_turn",
  "detailed_chunk_summary",
  "brief_chunk_summary",
] as const;
export const SEARCH_RESULT_TYPES = ["message", "turn", "thread_view", "chunk"] as const;
export const WORKBENCH_SEARCH_SCOPES = ["message", "turn", "thread_view"] as const;
export const WORKBENCH_CHUNK_LIFECYCLE_STATUSES = ["open", "closed"] as const;
export const LOWER_BAND_READINESS_STATUSES = [
  "eligible",
  "missing_artifacts",
  "blocked",
  "ineligible_open_chunk",
] as const;
export const BAND_ORDER = [...BAND_TYPES] as readonly BandType[];

export type ThreadViewState = (typeof THREAD_VIEW_STATES)[number];
export type ThreadViewStatus = (typeof THREAD_VIEW_STATUSES)[number];
export type BandType = (typeof BAND_TYPES)[number];
export type BandRenderedStatus = (typeof BAND_RENDERED_STATUSES)[number];
export type SourceUnitType = (typeof SOURCE_UNIT_TYPES)[number];
export type EmittedSourceKind = (typeof EMITTED_SOURCE_KINDS)[number];
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];
export type WorkbenchSearchScope = (typeof WORKBENCH_SEARCH_SCOPES)[number];
export type WorkbenchChunkLifecycleStatus = (typeof WORKBENCH_CHUNK_LIFECYCLE_STATUSES)[number];
export type LowerBandReadinessStatus = (typeof LOWER_BAND_READINESS_STATUSES)[number];

export interface ThreadViewRecord {
  threadViewId: string;
  threadId: string;
  state: ThreadViewState;
  name?: string;
  purpose?: string;
  createdAt: string;
  updatedAt: string;
  sourceStateReference?: string;
  fullFidelityBand: BandRecord;
  smoothBand: BandRecord;
  detailedBand: BandRecord;
  briefBand: BandRecord;
  emittedMessages: ThreadViewMessageRecord[];
  status: ThreadViewStatus;
}

export interface BandRecord {
  bandType: BandType;
  targetTokenBudget?: number;
  sourceUnitType: SourceUnitType;
  selectedIds: string[];
  exclusions?: string[];
  renderedStatus: BandRenderedStatus;
}

export interface ThreadViewMessageRecord {
  threadViewMessageId: string;
  threadViewId: string;
  bandType: BandType;
  sourceKind: EmittedSourceKind;
  sourceReference: string;
  messageOrder: number;
  content: string | Record<string, unknown>;
}

export interface SearchResultSummary {
  resultType: SearchResultType;
  resultId: string;
  title: string;
  summaryText: string;
  status?: string;
  relationshipHints?: string[];
}

export interface WorkbenchChunkRead {
  chunkId: string;
  lifecycleStatus: WorkbenchChunkLifecycleStatus;
  sourceTurnIds: string[];
  smoothText?: string;
  smoothTokenCount?: number;
  detailedSummary?: string;
  detailedSummaryTokenCount?: number;
  detailedSummaryStrategy?: string;
  briefSummary?: string;
  briefSummaryTokenCount?: number;
  briefSummaryStrategy?: string;
  placeholderExplicit?: boolean;
  summaryQuality?: "deterministic_placeholder_not_semantic";
  issues?: Array<{
    code: string;
    message: string;
    threadId?: string;
    cause?: string;
  }>;
}

export interface WorkbenchSearchInput {
  threadId: string;
  scope: WorkbenchSearchScope;
  query?: string;
  filters?: Record<string, string | number | boolean>;
}

export interface LowerBandReadinessEntry {
  chunkId: string;
  status: LowerBandReadinessStatus;
}

export function isUpperBandType(bandType: BandType): boolean {
  return bandType === "full_fidelity" || bandType === "smooth";
}

export function isLowerBandType(bandType: BandType): boolean {
  return !isUpperBandType(bandType);
}

export function bandTypeToSourceUnitType(bandType: BandType): SourceUnitType {
  return isUpperBandType(bandType) ? "turn" : "chunk";
}

export function createThreadViewId(seed?: unknown): string {
  return seed === undefined ? createGeneratedId("thread_view") : createStableId("thread_view", seed);
}

export function createThreadViewMessageId(seed?: unknown): string {
  return seed === undefined ? createGeneratedId("thread_view_message") : createStableId("thread_view_message", seed);
}

export function createSourceStateReference(input: {
  sourceRevision: number;
  messageHighWatermark: number;
}): string {
  return `${input.sourceRevision}:${input.messageHighWatermark}`;
}

export function cloneBandRecord(record: BandRecord): BandRecord {
  return {
    ...record,
    selectedIds: [...record.selectedIds],
    exclusions: record.exclusions ? [...record.exclusions] : undefined,
  };
}

export function cloneThreadViewMessageRecord(record: ThreadViewMessageRecord): ThreadViewMessageRecord {
  return {
    ...record,
    content: typeof record.content === "string" ? record.content : structuredClone(record.content),
  };
}

export function cloneSearchResultSummary(record: SearchResultSummary): SearchResultSummary {
  return {
    ...record,
    relationshipHints: record.relationshipHints ? [...record.relationshipHints] : undefined,
  };
}

export function cloneWorkbenchChunkRead(record: WorkbenchChunkRead): WorkbenchChunkRead {
  return {
    ...record,
    sourceTurnIds: [...record.sourceTurnIds],
    issues: record.issues ? record.issues.map((issue) => ({ ...issue })) : undefined,
  };
}

export function cloneThreadViewRecord(record: ThreadViewRecord): ThreadViewRecord {
  return {
    ...record,
    fullFidelityBand: cloneBandRecord(record.fullFidelityBand),
    smoothBand: cloneBandRecord(record.smoothBand),
    detailedBand: cloneBandRecord(record.detailedBand),
    briefBand: cloneBandRecord(record.briefBand),
    emittedMessages: record.emittedMessages.map(cloneThreadViewMessageRecord),
  };
}

export function compareBandTypeOrder(left: BandType, right: BandType): number {
  return BAND_ORDER.indexOf(left) - BAND_ORDER.indexOf(right);
}

export function orderThreadViewMessages(
  messages: readonly ThreadViewMessageRecord[],
): ThreadViewMessageRecord[] {
  return messages
    .map(cloneThreadViewMessageRecord)
    .sort((left, right) => {
      const bandComparison = compareBandTypeOrder(left.bandType, right.bandType);
      if (bandComparison !== 0) {
        return bandComparison;
      }

      if (left.messageOrder !== right.messageOrder) {
        return left.messageOrder - right.messageOrder;
      }

      if (left.sourceReference !== right.sourceReference) {
        return left.sourceReference.localeCompare(right.sourceReference);
      }

      return left.threadViewMessageId.localeCompare(right.threadViewMessageId);
    });
}

export function concatenateBandMessages(
  bandMessages: Partial<Record<BandType, readonly ThreadViewMessageRecord[]>>,
): ThreadViewMessageRecord[] {
  let nextMessageOrder = 1;

  return BAND_ORDER.flatMap((bandType) =>
    orderThreadViewMessages(bandMessages[bandType] ?? []).map((message) => ({
      ...message,
      messageOrder: nextMessageOrder++,
    })),
  );
}
