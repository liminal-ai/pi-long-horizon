import { createHash } from "node:crypto";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "@earendil-works/pi-coding-agent";

import type { ChunkState } from "../thread/async-thread/domain/chunk-state.js";
import type { MessageRecord, TurnRecord } from "../thread/domain/records.js";
import { materializeRawThreadViewMessageContent } from "../thread-view/services/thread-view-materializer.js";
import type { ThreadViewMessageRecord } from "../thread-view/domain/thread-view-records.js";
import { orderThreadViewMessages } from "../thread-view/domain/thread-view-records.js";
import type { WritePiThreadViewFileInput } from "../thread-view/domain/pi-thread-view-file.js";
import { serializePiThreadViewFileContent } from "../thread-view/targets/pi/pi-thread-view-writer.js";
import {
  assertTokenCountRecord,
  type BandMaterializedTokenCountRecord,
  type BriefChunkMaterializedTokenCountRecord,
  type ChunkSmoothMaterializedTokenCountRecord,
  type DetailedChunkMaterializedTokenCountRecord,
  type GeneratedSessionTokenCountRecord,
  type RawMessageMaterializedTokenCountRecord,
  type RawTurnMaterializedTokenCountRecord,
  type SmoothTurnMaterializedTokenCountRecord,
  type TokenCountRecord,
} from "./token-count-metadata.js";

export const MATERIALIZED_REPRESENTATION_HASH_ALGORITHM = "sha256" as const;
export const MATERIALIZED_REPRESENTATION_COUNTER_SOURCE = "pi_heuristic" as const;
export const MATERIALIZED_REPRESENTATION_COUNTER_TRUST_CLASS = "heuristic_estimate" as const;
export const MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE =
  "pi-long-horizon.materialized-representation-counter.v1" as const;

export interface MaterializedTokenCountOptions {
  createdAt?: string;
  now?: () => Date;
}

export interface CountRawTurnMaterializedInput extends MaterializedTokenCountOptions {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
}

export interface CountBandMaterializedInput extends MaterializedTokenCountOptions {
  messages: readonly ThreadViewMessageRecord[];
  sourceRevision?: number;
}

export interface CountGeneratedSessionInput extends MaterializedTokenCountOptions {
  input: WritePiThreadViewFileInput;
  timestamp: string;
  sourceRevision?: number;
}

function normalizeForStableRepresentation(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `__number__:${String(value)}`;
  }

  if (typeof value === "bigint") {
    return `__bigint__:${value.toString()}`;
  }

  if (value instanceof Date) {
    return `__date__:${value.toISOString()}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableRepresentation(item));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey,
        normalizeForStableRepresentation(entryValue),
      ]),
    );
  }

  return `__${typeof value}__:${String(value)}`;
}

export function serializeMaterializedRepresentation(representation: unknown): string {
  if (typeof representation === "string") {
    return representation;
  }

  return `${JSON.stringify(normalizeForStableRepresentation(representation))}\n`;
}

export function createMaterializedRepresentationHash(representation: unknown): string {
  const serialized = serializeMaterializedRepresentation(representation);
  const digest = createHash(MATERIALIZED_REPRESENTATION_HASH_ALGORITHM).update(serialized).digest("hex");

  return `${MATERIALIZED_REPRESENTATION_HASH_ALGORITHM}:${digest}`;
}

function createdAt(options: MaterializedTokenCountOptions): string {
  return options.createdAt ?? (options.now ?? (() => new Date()))().toISOString();
}

function estimateSerializedRepresentationTokenCount(representation: unknown): number {
  const serialized = serializeMaterializedRepresentation(representation);

  return estimateTokens({
    role: "custom",
    customType: "pi-long-horizon.materialized-representation-count",
    content: [{ type: "text", text: serialized }],
    display: false,
    timestamp: 0,
  } as AgentMessage);
}

function createMaterializedRecord<TRecord extends TokenCountRecord>(input: {
  count: number;
  scope: TRecord["scope"];
  representation: unknown;
  sourceRevision?: number;
  createdAt: string;
  provenance: string;
  note?: string;
}): TRecord {
  return assertTokenCountRecord({
    count: input.count,
    scope: input.scope,
    source: MATERIALIZED_REPRESENTATION_COUNTER_SOURCE,
    trustClass: MATERIALIZED_REPRESENTATION_COUNTER_TRUST_CLASS,
    representationHash: createMaterializedRepresentationHash(input.representation),
    sourceRevision: input.sourceRevision,
    createdAt: input.createdAt,
    provenance: input.provenance,
    note: input.note,
  }) as TRecord;
}

export function countRawMessageMaterialized(
  message: MessageRecord,
  options: MaterializedTokenCountOptions = {},
): RawMessageMaterializedTokenCountRecord {
  const representation = materializeRawThreadViewMessageContent(message);

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "raw_message_materialized",
    representation,
    sourceRevision: message.sourceRevision,
    createdAt: createdAt(options),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.raw-message-content`,
    note: "Temporary PI heuristic estimate over the raw message materialized Thread View content.",
  });
}

export function countRawTurnMaterialized(
  input: CountRawTurnMaterializedInput,
): RawTurnMaterializedTokenCountRecord {
  const messages = [...input.messages].sort((left, right) => {
    if (left.sourceOrder !== right.sourceOrder) {
      return left.sourceOrder - right.sourceOrder;
    }

    return left.messageId.localeCompare(right.messageId);
  });
  const messageRecords = messages.map((message) => countRawMessageMaterialized(message, input));
  const representation = messages.map(materializeRawThreadViewMessageContent);

  return createMaterializedRecord({
    count: messageRecords.reduce((total, record) => total + record.count, 0),
    scope: "raw_turn_materialized",
    representation,
    sourceRevision: input.turn.sourceRevision,
    createdAt: createdAt(input),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.raw-turn-rollup`,
    note: "Rollup of raw message materialized counts; hash covers the ordered raw turn Thread View content array.",
  });
}

export function countSmoothTurnMaterialized(
  turn: TurnRecord,
  options: MaterializedTokenCountOptions = {},
): SmoothTurnMaterializedTokenCountRecord {
  const representation = turn.smooth?.text ?? "";

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "smooth_turn_materialized",
    representation,
    sourceRevision: turn.smooth?.sourceRevision ?? turn.sourceRevision,
    createdAt: createdAt(options),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.smooth-turn-content`,
    note: "Temporary PI heuristic estimate over the smooth turn materialized Thread View content.",
  });
}

export function countChunkSmoothMaterialized(
  chunk: ChunkState,
  options: MaterializedTokenCountOptions = {},
): ChunkSmoothMaterializedTokenCountRecord {
  const representation = chunk.smoothText ?? "";

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "chunk_smooth_materialized",
    representation,
    sourceRevision: chunk.sourceRevision,
    createdAt: createdAt(options),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.chunk-smooth-content`,
    note: "Temporary PI heuristic estimate over the chunk smooth materialized Thread View content.",
  });
}

export function countDetailedChunkMaterialized(
  chunk: ChunkState,
  options: MaterializedTokenCountOptions = {},
): DetailedChunkMaterializedTokenCountRecord {
  const representation = chunk.placeholders?.detailed?.text ?? "";

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "detailed_chunk_materialized",
    representation,
    sourceRevision: chunk.sourceRevision,
    createdAt: createdAt(options),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.detailed-chunk-content`,
    note: "Temporary PI heuristic estimate over the detailed chunk materialized Thread View content.",
  });
}

export function countBriefChunkMaterialized(
  chunk: ChunkState,
  options: MaterializedTokenCountOptions = {},
): BriefChunkMaterializedTokenCountRecord {
  const representation = chunk.placeholders?.brief?.text ?? "";

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "brief_chunk_materialized",
    representation,
    sourceRevision: chunk.sourceRevision,
    createdAt: createdAt(options),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.brief-chunk-content`,
    note: "Temporary PI heuristic estimate over the brief chunk materialized Thread View content.",
  });
}

export function countBandMaterialized(input: CountBandMaterializedInput): BandMaterializedTokenCountRecord {
  const representation = orderThreadViewMessages(input.messages);

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "band_materialized",
    representation,
    sourceRevision: input.sourceRevision,
    createdAt: createdAt(input),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:thread-view.band-message-array`,
    note: "Temporary PI heuristic estimate over the ordered materialized Thread View message array.",
  });
}

export function countGeneratedSession(input: CountGeneratedSessionInput): GeneratedSessionTokenCountRecord {
  const representation = serializePiThreadViewFileContent(input.input, input.timestamp);

  return createMaterializedRecord({
    count: estimateSerializedRepresentationTokenCount(representation),
    scope: "generated_session",
    representation,
    sourceRevision: input.sourceRevision,
    createdAt: createdAt(input),
    provenance: `${MATERIALIZED_REPRESENTATION_COUNTER_PROVENANCE}:pi.generated-session-jsonl`,
    note: "Temporary PI heuristic estimate over the generated session JSONL emitted by the PI writer.",
  });
}
