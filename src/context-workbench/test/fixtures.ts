import type { ThreadSnapshotFixture } from "../../context-steward/test/fixtures.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeThreadSnapshot,
} from "../../context-steward/test/fixtures.js";
import {
  bandTypeToSourceUnitType,
  cloneBandRecord,
  cloneThreadViewMessageRecord,
  cloneThreadViewRecord,
  createSourceStateReference,
  createThreadViewId,
  createThreadViewMessageId,
  type BandRecord,
  type BandType,
  type ThreadViewMessageRecord,
  type ThreadViewRecord,
  type ThreadViewState,
  type ThreadViewStatus,
  type WorkbenchChunkRead,
  type WorkbenchSearchInput,
} from "../domain/thread-view-records.js";

export { DEFAULT_TEST_TIMESTAMP, makeThreadSnapshot };
export type { ThreadSnapshotFixture };

export function makeBandRecord(
  overrides: Partial<BandRecord> & Pick<BandRecord, "bandType">,
): BandRecord {
  const sourceUnitType = overrides.sourceUnitType ?? bandTypeToSourceUnitType(overrides.bandType);

  return cloneBandRecord({
    bandType: overrides.bandType,
    targetTokenBudget: overrides.targetTokenBudget,
    sourceUnitType,
    selectedIds: overrides.selectedIds ? [...overrides.selectedIds] : [],
    exclusions: overrides.exclusions ? [...overrides.exclusions] : undefined,
    renderedStatus: overrides.renderedStatus ?? "unknown",
  });
}

export function makeThreadViewMessage(
  overrides: Partial<ThreadViewMessageRecord> & Pick<ThreadViewMessageRecord, "threadViewId" | "bandType">,
): ThreadViewMessageRecord {
  const messageOrder = overrides.messageOrder ?? 1;
  const sourceReference = overrides.sourceReference ?? `${overrides.bandType}-source-${String(messageOrder).padStart(3, "0")}`;

  return cloneThreadViewMessageRecord({
    threadViewMessageId:
      overrides.threadViewMessageId ??
      createThreadViewMessageId({
        threadViewId: overrides.threadViewId,
        bandType: overrides.bandType,
        sourceReference,
        messageOrder,
      }),
    threadViewId: overrides.threadViewId,
    bandType: overrides.bandType,
    sourceKind:
      overrides.sourceKind ??
      (overrides.bandType === "full_fidelity"
        ? "raw_turn_message"
        : overrides.bandType === "smooth"
          ? "smooth_turn"
          : overrides.bandType === "detailed"
            ? "detailed_chunk_summary"
            : "brief_chunk_summary"),
    sourceReference,
    messageOrder,
    content: overrides.content ?? `${overrides.bandType} emitted content ${messageOrder}`,
  });
}

export interface MakeThreadViewOptions extends Partial<ThreadViewRecord> {
  threadId?: string;
  state?: ThreadViewState;
  status?: ThreadViewStatus;
}

function resolveBand(
  threadViewId: string,
  bandType: BandType,
  band: BandRecord | undefined,
  emittedMessages: readonly ThreadViewMessageRecord[],
): BandRecord {
  if (band) {
    return cloneBandRecord(band);
  }

  return makeBandRecord({
    bandType,
    selectedIds: [],
    renderedStatus: emittedMessages.some((message) => message.threadViewId === threadViewId && message.bandType === bandType)
      ? "ready"
      : "unknown",
  });
}

export function makeThreadView(options: MakeThreadViewOptions = {}): ThreadViewRecord {
  const threadId = options.threadId ?? "thread-001";
  const createdAt = options.createdAt ?? DEFAULT_TEST_TIMESTAMP;
  const threadViewId =
    options.threadViewId ??
    createThreadViewId({
      threadId,
      state: options.state ?? "draft",
      name: options.name,
      purpose: options.purpose,
      createdAt,
    });
  const emittedMessages = options.emittedMessages
    ? options.emittedMessages.map((message) => ({
        ...cloneThreadViewMessageRecord(message),
        threadViewId,
      }))
    : [];
  const state = options.state ?? "draft";
  const sourceStateReference =
    options.sourceStateReference ??
    createSourceStateReference({
      sourceRevision: 1,
      messageHighWatermark: 1,
    });

  return cloneThreadViewRecord({
    threadViewId,
    threadId,
    state,
    name: options.name,
    purpose: options.purpose,
    createdAt,
    updatedAt: options.updatedAt ?? createdAt,
    sourceStateReference,
    fullFidelityBand: resolveBand(threadViewId, "full_fidelity", options.fullFidelityBand, emittedMessages),
    smoothBand: resolveBand(threadViewId, "smooth", options.smoothBand, emittedMessages),
    detailedBand: resolveBand(threadViewId, "detailed", options.detailedBand, emittedMessages),
    briefBand: resolveBand(threadViewId, "brief", options.briefBand, emittedMessages),
    emittedMessages,
    status: options.status ?? "unknown",
  });
}

export function makeWorkbenchSearchInput(
  overrides: Partial<WorkbenchSearchInput> = {},
): WorkbenchSearchInput {
  return {
    threadId: overrides.threadId ?? "thread-001",
    scope: overrides.scope ?? "message",
    query: overrides.query,
    filters: overrides.filters ? { ...overrides.filters } : undefined,
  };
}

export function makeWorkbenchChunkRead(
  overrides: Partial<WorkbenchChunkRead> = {},
): WorkbenchChunkRead {
  return {
    chunkId: overrides.chunkId ?? "chunk-001",
    lifecycleStatus: overrides.lifecycleStatus ?? "closed",
    sourceTurnIds: overrides.sourceTurnIds ? [...overrides.sourceTurnIds] : ["turn-001"],
    smoothText: overrides.smoothText,
    smoothTokenCount: overrides.smoothTokenCount,
    detailedSummary: overrides.detailedSummary,
    detailedSummaryTokenCount: overrides.detailedSummaryTokenCount,
    briefSummary: overrides.briefSummary,
    briefSummaryTokenCount: overrides.briefSummaryTokenCount,
  };
}
