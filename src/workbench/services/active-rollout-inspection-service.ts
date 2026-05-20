import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { StewardResultError } from "../../thread/domain/errors.js";
import type { ProjectionRevisionRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  getReadyChunkLowerBandArtifact,
  type ChunkState,
} from "../../thread/async-thread/domain/chunk-state.js";
import type { BandType } from "../../thread-view/domain/thread-view-records.js";
import { BAND_ORDER } from "../../thread-view/domain/thread-view-records.js";

export interface ActiveRolloutBandInspection {
  entryCount: number;
  messageCount: number;
  sourceCounts: Record<string, number>;
}

export interface ActiveRolloutLiveTailInspection {
  entryCount: number;
  messageCount: number;
  roleCounts: Record<string, number>;
}

export interface ActiveRolloutToolResultInspection {
  totalCount: number;
  truncatedCount: number;
  nonTruncatedCount: number;
  largestNonTruncated: Array<{
    entryId?: string;
    toolCallId?: string;
    toolName?: string;
    estimatedTokens: number;
    charCount: number;
  }>;
}

export interface ActiveRolloutInspectionReport {
  threadId: string;
  activeProjectionId?: string;
  activeThreadViewId?: string;
  generatedFilePath?: string;
  bands: Record<BandType, ActiveRolloutBandInspection>;
  liveTail: ActiveRolloutLiveTailInspection;
  toolResults: ActiveRolloutToolResultInspection;
  estimatedVisibleTokens: number;
  catchUpEvents: ActiveRolloutCatchUpEvent[];
  warnings: string[];
}

export interface InspectActiveRolloutInput {
  threadId: string;
}

export interface InspectActiveRolloutDependencies {
  threadStore: ThreadStore;
}

export interface ActiveRolloutCatchUpEvent {
  at?: string;
  chunkId: string;
  band: "detailed" | "brief";
  event:
    | "completed"
    | "retry"
    | "failed"
    | "escalated"
    | "truncated"
    | "other";
  message: string;
}

interface PiSessionEntry {
  type?: string;
  id?: string;
  customType?: string;
  data?: {
    entries?: Array<{
      index?: number;
      generatedSource?: string;
      role?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  message?: {
    role?: string;
    customType?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    metadata?: Record<string, unknown>;
    originalOutput?: unknown;
  };
}

const SOURCE_TO_BAND: Record<string, BandType> = {
  raw_turn_message: "full_fidelity",
  smooth_turn: "smooth",
  detailed_chunk_summary: "detailed",
  brief_chunk_summary: "brief",
};

function emptyBands(): Record<BandType, ActiveRolloutBandInspection> {
  return Object.fromEntries(
    BAND_ORDER.map((bandType) => [
      bandType,
      {
        entryCount: 0,
        messageCount: 0,
        sourceCounts: {},
      },
    ]),
  ) as Record<BandType, ActiveRolloutBandInspection>;
}

function latestAvailableProjection(projections: readonly ProjectionRevisionRecord[]): ProjectionRevisionRecord | undefined {
  return [...projections]
    .filter((projection) => projection.status === "available" && projection.generatedFilePath)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
}

function estimateTokens(value: unknown): number {
  const text = stringifyVisible(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized ? normalized.split(" ").length : 0;
}

function stringifyVisible(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stringifyVisible).join("\n");
  }
  if (value && typeof value === "object") {
    const maybeText = (value as { text?: unknown }).text;
    if (typeof maybeText === "string") {
      return maybeText;
    }
    return JSON.stringify(value);
  }
  return value === undefined ? "" : String(value);
}

function isTruncatedToolResult(message: PiSessionEntry["message"]): boolean {
  const text = stringifyVisible(message?.content).trimEnd();
  const metadata = message?.metadata;
  const explicitTruncated =
    metadata?.truncated === true ||
    metadata?.isTruncated === true ||
    typeof message?.originalOutput !== "undefined" ||
    typeof metadata?.originalOutput !== "undefined";
  return explicitTruncated || /\[omitted:|\btruncated\b/i.test(text) || text.endsWith("...");
}

function parseJsonl(content: string): PiSessionEntry[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PiSessionEntry);
}

function sourceCountsForBand(band: ActiveRolloutBandInspection, source: string): void {
  band.sourceCounts[source] = (band.sourceCounts[source] ?? 0) + 1;
}

function collectSelectedLowerBandWarnings(input: {
  projection: ProjectionRevisionRecord | undefined;
  chunks: readonly ChunkState[];
}): string[] {
  const snapshot = input.projection?.compactSnapshot;
  if (!snapshot) {
    return [];
  }

  const chunkById = new Map(input.chunks.map((chunk) => [chunk.chunkId, chunk] as const));
  const warnings: string[] = [];

  for (const bandType of ["detailed", "brief"] as const) {
    for (const chunkId of snapshot.bands[bandType].selectedIds) {
      const chunk = chunkById.get(chunkId);
      if (!chunk) {
        warnings.push(`Active projection ${bandType} chunk ${chunkId} is missing from current chunk state.`);
        continue;
      }

      if (!getReadyChunkLowerBandArtifact(chunk, bandType)) {
        warnings.push(
          `Active projection ${bandType} chunk ${chunkId} is missing ready semantic lower-band output in current chunk state.`,
        );
      }
    }
  }

  return warnings;
}

function debugLogPath(threadStore: ThreadStore): string | undefined {
  const rootDir = (threadStore as { rootDir?: unknown }).rootDir;
  return typeof rootDir === "string" ? join(rootDir, "debug", "lower-band-compression.log") : undefined;
}

function classifyCatchUpEvent(message: string): ActiveRolloutCatchUpEvent["event"] {
  if (message.includes("completed")) {
    return "completed";
  }
  if (message.includes("will retry")) {
    return "retry";
  }
  if (message.includes("exhausted")) {
    return "failed";
  }
  if (message.includes("escalating")) {
    return "escalated";
  }
  if (message.includes("truncated")) {
    return "truncated";
  }
  return "other";
}

async function readCatchUpEvents(input: {
  threadId: string;
  threadStore: ThreadStore;
}): Promise<ActiveRolloutCatchUpEvent[]> {
  const logPath = debugLogPath(input.threadStore);
  if (!logPath) {
    return [];
  }

  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch {
    return [];
  }

  const parsed = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter(
      (entry) =>
        entry.threadId === input.threadId &&
        entry.mode === "prepare_catch_up" &&
        (entry.band === "detailed" || entry.band === "brief") &&
        typeof entry.chunkId === "string" &&
        typeof entry.message === "string",
    )
    .map((entry) => ({
      at: typeof entry.at === "string" ? entry.at : undefined,
      chunkId: entry.chunkId as string,
      band: entry.band as "detailed" | "brief",
      event: classifyCatchUpEvent(entry.message as string),
      message: entry.message as string,
    }))
    .sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""))
    .slice(-10);

  return parsed;
}

export async function inspectActiveThreadView(
  input: InspectActiveRolloutInput,
  dependencies: InspectActiveRolloutDependencies,
): Promise<ActiveRolloutInspectionReport> {
  const snapshotResult = await dependencies.threadStore.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new StewardResultError(snapshotResult.issues);
  }

  const snapshot = snapshotResult.value;
  const chunksResult = await dependencies.threadStore.readChunks(input.threadId);
  if (!chunksResult.ok) {
    throw new StewardResultError(chunksResult.issues);
  }
  const projection =
    (snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId
      ? snapshot.projections.find(
          (candidate) => candidate.revisionId === snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId,
        )
      : undefined) ?? latestAvailableProjection(snapshot.projections);
  const generatedFilePath =
    projection?.generatedFilePath ??
    snapshot.thread.threadViewOutputSummary.generatedOutput?.generatedFilePath ??
    snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath ??
    snapshot.thread.target.currentGeneratedFilePath;

  const warnings: string[] = [];
  const catchUpEvents = await readCatchUpEvents({
    threadId: input.threadId,
    threadStore: dependencies.threadStore,
  });
  warnings.push(
    ...catchUpEvents.map(
      (event) =>
        `Recent lower-band catch-up ${event.event} for chunk ${event.chunkId} (${event.band}) at ${event.at ?? "unknown time"}.`,
    ),
  );
  if (snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId && projection?.status !== "available") {
    warnings.push(
      `Current projection ${snapshot.thread.threadViewOutputSummary.currentProjectionRevisionId} is ${projection?.status ?? "unavailable"}.`,
    );
  }
  if (snapshot.thread.threadViewOutputSummary.lastRevisionStatus && snapshot.thread.threadViewOutputSummary.lastRevisionStatus !== "available") {
    warnings.push(`Latest projection revision status is ${snapshot.thread.threadViewOutputSummary.lastRevisionStatus}.`);
  }
  if (
    snapshot.thread.threadViewOutputSummary.generatedOutput?.status &&
    snapshot.thread.threadViewOutputSummary.generatedOutput.status !== "available"
  ) {
    warnings.push(`Generated output status is ${snapshot.thread.threadViewOutputSummary.generatedOutput.status}.`);
  }
  warnings.push(
    ...collectSelectedLowerBandWarnings({
      projection,
      chunks: chunksResult.value,
    }),
  );
  if (!generatedFilePath) {
    warnings.push("No active generated rollout file is recorded for this thread.");
    return {
      threadId: input.threadId,
      activeProjectionId: projection?.revisionId,
      activeThreadViewId: projection?.threadViewId ?? snapshot.thread.threadViewOutputSummary.currentThreadViewId,
      generatedFilePath,
      bands: emptyBands(),
      liveTail: { entryCount: 0, messageCount: 0, roleCounts: {} },
      toolResults: { totalCount: 0, truncatedCount: 0, nonTruncatedCount: 0, largestNonTruncated: [] },
      estimatedVisibleTokens: 0,
      catchUpEvents,
      warnings,
    };
  }

  let entries: PiSessionEntry[];
  try {
    entries = parseJsonl(await readFile(generatedFilePath, "utf8"));
  } catch (error) {
    warnings.push(
      `Active generated rollout file is unreadable: ${generatedFilePath}${error instanceof Error ? ` (${error.message})` : ""}.`,
    );
    return {
      threadId: input.threadId,
      activeProjectionId: projection?.revisionId ?? snapshot.thread.threadViewOutputSummary.generatedOutput?.projectionRevisionId,
      activeThreadViewId: projection?.threadViewId ?? snapshot.thread.threadViewOutputSummary.currentThreadViewId,
      generatedFilePath,
      bands: emptyBands(),
      liveTail: { entryCount: 0, messageCount: 0, roleCounts: {} },
      toolResults: { totalCount: 0, truncatedCount: 0, nonTruncatedCount: 0, largestNonTruncated: [] },
      estimatedVisibleTokens: 0,
      catchUpEvents,
      warnings,
    };
  }
  const metadata = entries.find(
    (entry) => entry.type === "custom" && entry.customType === "pi-long-horizon.thread-view.output",
  );
  const generatedEntries = metadata?.data?.entries ?? [];
  const messageEntries = entries.filter((entry) => entry.type === "message");
  const bands = emptyBands();
  let estimatedVisibleTokens = 0;

  for (const generatedEntry of generatedEntries) {
    const source = generatedEntry.generatedSource ?? "unknown";
    const bandType = SOURCE_TO_BAND[source];
    if (!bandType) {
      warnings.push(`Generated entry ${generatedEntry.index ?? "unknown"} has unknown source ${source}.`);
      continue;
    }
    const band = bands[bandType];
    band.entryCount += 1;
    band.messageCount += 1;
    sourceCountsForBand(band, source);
  }

  const generatedMessageCount = generatedEntries.length;
  const liveTailEntries = messageEntries.slice(generatedMessageCount);
  const liveTail: ActiveRolloutLiveTailInspection = {
    entryCount: liveTailEntries.length,
    messageCount: liveTailEntries.length,
    roleCounts: {},
  };
  const largestNonTruncated: ActiveRolloutToolResultInspection["largestNonTruncated"] = [];
  let truncatedCount = 0;
  let nonTruncatedCount = 0;
  for (const entry of messageEntries) {
    estimatedVisibleTokens += estimateTokens(entry.message?.content);
    if (entry.message?.role === "toolResult") {
      const text = stringifyVisible(entry.message.content);
      if (isTruncatedToolResult(entry.message)) {
        truncatedCount += 1;
      } else {
        nonTruncatedCount += 1;
        largestNonTruncated.push({
          entryId: entry.id,
          toolCallId: entry.message.toolCallId,
          toolName: entry.message.toolName,
          estimatedTokens: estimateTokens(text),
          charCount: text.length,
        });
      }
    }
  }
  for (const entry of liveTailEntries) {
    const role = entry.message?.role ?? "unknown";
    liveTail.roleCounts[role] = (liveTail.roleCounts[role] ?? 0) + 1;
  }
  largestNonTruncated.sort((left, right) => right.charCount - left.charCount);

  return {
    threadId: input.threadId,
    activeProjectionId: projection?.revisionId ?? snapshot.thread.threadViewOutputSummary.generatedOutput?.projectionRevisionId,
    activeThreadViewId: projection?.threadViewId ?? snapshot.thread.threadViewOutputSummary.currentThreadViewId,
    generatedFilePath,
    bands,
    liveTail,
    toolResults: {
      totalCount: truncatedCount + nonTruncatedCount,
      truncatedCount,
      nonTruncatedCount,
      largestNonTruncated: largestNonTruncated.slice(0, 5),
    },
    estimatedVisibleTokens,
    catchUpEvents,
    warnings,
  };
}

export function formatActiveRolloutInspectionJson(report: ActiveRolloutInspectionReport): string {
  return JSON.stringify(report, null, 2);
}
