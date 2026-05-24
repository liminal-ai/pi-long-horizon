import {
  DEFAULT_TEST_TIMESTAMP,
  makeThreadSnapshot,
  type ThreadSnapshotFixture,
} from "../../../context-steward/test/fixtures.js";
import {
  CHUNK_SCHEMA_VERSION,
  cloneChunkState,
  type CanonicalChunkState,
  type ChunkState,
  type LegacyPlaceholderChunkState,
} from "../domain/chunk-state.js";
import {
  cloneChunkConversationTranscriptRecord,
  cloneChunkLowerBandState,
  type ChunkConversationTranscriptRecord,
  type ChunkLowerBandState,
  type ChunkSemanticArtifactRecord,
} from "../domain/lower-band-artifact-state.js";
import {
  clonePlaceholderArtifactState,
  type PlaceholderArtifactState,
} from "../domain/placeholder-artifact-state.js";
import {
  cloneSmoothTurnState,
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
  type SmoothTurnState,
  type TurnLowerBandProjectionState,
} from "../domain/smooth-turn-state.js";
import { createSmoothChunkSourceFingerprint } from "../services/placeholder-artifact-service.js";
import { assertTokenCountRecord, type TokenCountScope } from "../../../token-accounting/index.js";

export { DEFAULT_TEST_TIMESTAMP, makeThreadSnapshot };
export type { ThreadSnapshotFixture };

export function makeSmoothTurnState(overrides: Partial<SmoothTurnState> = {}): SmoothTurnState {
  const text = overrides.text ?? "Deterministic smooth turn text";
  const normalizedText = normalizeDeterministicText(text);
  const count = overrides.tokenCountMetadata?.count ?? (overrides.status === "missing" ? undefined : estimateDeterministicTokenCount(normalizedText));
  const components = overrides.components ?? (
    overrides.status === "missing"
      ? undefined
      : [
          {
            componentId: `${overrides.turnId ?? "turn-001"}:user_prompt:message-001:part-001`,
            kind: "user_prompt" as const,
            status: "ready" as const,
            text: normalizedText,
            quality: "deterministic_preserved" as const,
            sourceMessageIds: ["message-001"],
            sourcePartIds: ["part-001"],
            sourceRevision: overrides.sourceRevision ?? 1,
            generatedAt: overrides.generatedAt ?? DEFAULT_TEST_TIMESTAMP,
            strategy: "deterministic_user_prompt_preserved_v1" as const,
          },
        ]
  );

  return cloneSmoothTurnState({
    turnId: overrides.turnId ?? "turn-001",
    threadId: overrides.threadId ?? "thread-001",
    schemaVersion: overrides.schemaVersion ?? (components ? "component_smooth_turn_v1" : undefined),
    status: overrides.status ?? "ready",
    tokenCountMetadata: count === undefined ? undefined : makeTokenCountRecord(count, "smooth_turn_materialized"),
    strategy: overrides.strategy ?? (components ? "component_smooth_turn_v1" : undefined),
    generatedAt: overrides.generatedAt ?? DEFAULT_TEST_TIMESTAMP,
    sourceRevision: overrides.sourceRevision ?? 1,
    components,
    lowerBandProjection: overrides.lowerBandProjection,
  });
}

function makeTokenCountRecord(count: number, scope: TokenCountScope) {
  return assertTokenCountRecord({
    count,
    scope,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    representationHash: `sha256:test-${scope}-${count}`,
    sourceRevision: 1,
    createdAt: DEFAULT_TEST_TIMESTAMP,
  });
}

function makeExactTokenCountRecord(count: number, scope: TokenCountScope) {
  return assertTokenCountRecord({
    count,
    scope,
    source: "provider_input_count",
    trustClass: "exact",
    provider: "openai",
    model: "gpt-5.4-mini",
    representationHash: `sha256:test-${scope}-${count}`,
    sourceRevision: 1,
    createdAt: DEFAULT_TEST_TIMESTAMP,
  });
}

export function makeTurnLowerBandProjection(
  overrides: Partial<TurnLowerBandProjectionState> = {},
): TurnLowerBandProjectionState {
  const text = overrides.text ?? "> Steward request\n● Assistant response";
  const count = overrides.tokenCountMetadata?.count ?? estimateDeterministicTokenCount(text);

  return {
    status: overrides.status ?? "ready",
    text: overrides.status === "pending" || overrides.status === "failed" || overrides.status === "invalid"
      ? overrides.text
      : text,
    tokenCountMetadata:
      overrides.tokenCountMetadata ??
      (overrides.status === "pending" || overrides.status === "failed" || overrides.status === "invalid"
        ? undefined
        : makeExactTokenCountRecord(count, "turn_lower_band_projection_materialized")),
    sourceFingerprint: overrides.sourceFingerprint ?? "sha256:test-lower-band-projection",
    sourceRevision: overrides.sourceRevision ?? 1,
    generatedAt: overrides.generatedAt ?? DEFAULT_TEST_TIMESTAMP,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
  };
}

export function makePlaceholderArtifactState(
  overrides: Partial<PlaceholderArtifactState> = {},
): PlaceholderArtifactState {
  const threadId = overrides.threadId ?? "thread-001";
  const chunkId = overrides.chunkId ?? "chunk-001";
  const defaultDetailedText =
    "Deterministic detailed text\n\n[deterministic-placeholder:detailed] [not-semantic-summary]";
  const defaultBriefText =
    "Deterministic brief text\n\n[deterministic-placeholder:brief] [not-semantic-summary]";
  const defaultSmoothText = "Combined smooth chunk text";
  const defaultSmoothTokenCount = estimateDeterministicTokenCount(defaultSmoothText);

  return clonePlaceholderArtifactState({
    chunkId,
    threadId,
    detailed:
      overrides.detailed === undefined
        ? {
            kind: "detailed",
            status: "ready",
            text: defaultDetailedText,
            tokenCountMetadata: makeTokenCountRecord(
              estimateDeterministicTokenCount(defaultDetailedText),
              "detailed_chunk_materialized",
            ),
            strategy: "deterministic_truncate_30",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            smoothSourceFingerprint: createSmoothChunkSourceFingerprint(defaultSmoothText),
            smoothSourceRevision: 1,
            smoothSourceTokenCount: defaultSmoothTokenCount,
            generatedFromComponentSmooth: true,
          }
        : overrides.detailed,
    brief:
      overrides.brief === undefined
        ? {
            kind: "brief",
            status: "ready",
            text: defaultBriefText,
            tokenCountMetadata: makeTokenCountRecord(
              estimateDeterministicTokenCount(defaultBriefText),
              "brief_chunk_materialized",
            ),
            strategy: "deterministic_truncate_5",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
            smoothSourceFingerprint: createSmoothChunkSourceFingerprint(defaultSmoothText),
            smoothSourceRevision: 1,
            smoothSourceTokenCount: defaultSmoothTokenCount,
            generatedFromComponentSmooth: true,
          }
        : overrides.brief,
  });
}

export function makeChunkLowerBandArtifacts(
  overrides: Partial<ChunkLowerBandState> = {},
): ChunkLowerBandState {
  const detailedText = "Detailed semantic lower-band artifact";
  const briefText = "Brief semantic lower-band artifact";

  return cloneChunkLowerBandState({
    detailed:
      overrides.detailed === undefined
        ? {
            band: "detailed",
            status: "ready",
            text: detailedText,
            providerMetadata: {
              providerId: "openai-codex",
              modelId: "gpt-5.4-mini",
              reasoningEffort: "medium",
              promptVersion: "test-lower-band-detail-v1",
              elapsedMs: 1,
            },
            tokenCountMetadata: makeExactTokenCountRecord(
              estimateDeterministicTokenCount(detailedText),
              "detailed_chunk_materialized",
            ),
            updatedAt: DEFAULT_TEST_TIMESTAMP,
          }
        : overrides.detailed,
    brief:
      overrides.brief === undefined
        ? {
            band: "brief",
            status: "ready",
            text: briefText,
            providerMetadata: {
              providerId: "openai-codex",
              modelId: "gpt-5.4-mini",
              reasoningEffort: "medium",
              promptVersion: "test-lower-band-brief-v1",
              elapsedMs: 1,
            },
            tokenCountMetadata: makeExactTokenCountRecord(
              estimateDeterministicTokenCount(briefText),
              "brief_chunk_materialized",
            ),
            updatedAt: DEFAULT_TEST_TIMESTAMP,
          }
        : overrides.brief,
  });
}

function makeChunkConversationTranscript(
  overrides: Partial<ChunkConversationTranscriptRecord> = {},
): ChunkConversationTranscriptRecord {
  return cloneChunkConversationTranscriptRecord({
    status: overrides.status ?? "ready",
    text: overrides.text ?? "> Steward request\n● Assistant response",
    sourceFingerprint: overrides.sourceFingerprint ?? "sha256:test-chunk-transcript",
    sourceRevision: overrides.sourceRevision ?? 1,
    updatedAt: overrides.updatedAt ?? DEFAULT_TEST_TIMESTAMP,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
  });
}

export function makeChunkState(overrides: Partial<CanonicalChunkState> = {}): CanonicalChunkState {
  const lifecycleStatus = overrides.lifecycleStatus ?? "closed";
  const threadId = overrides.threadId ?? "thread-001";
  const chunkId = overrides.chunkId ?? "chunk-001";
  const closedDefaults = lifecycleStatus === "closed";

  return cloneChunkState({
    chunkId,
    threadId,
    lifecycleStatus,
    sourceTurnIds: overrides.sourceTurnIds ? [...overrides.sourceTurnIds] : ["turn-001", "turn-002"],
    smoothText: overrides.smoothText ?? "Combined smooth chunk text",
    smoothTokenCountMetadata:
      overrides.smoothTokenCountMetadata ??
      makeTokenCountRecord(4, "chunk_smooth_materialized"),
    openedAt: overrides.openedAt ?? DEFAULT_TEST_TIMESTAMP,
    closedAt: overrides.closedAt ?? (closedDefaults ? DEFAULT_TEST_TIMESTAMP : undefined),
    closeReason: overrides.closeReason ?? (closedDefaults ? "soft_threshold" : undefined),
    sourceRevision: overrides.sourceRevision ?? 1,
    schemaVersion: overrides.schemaVersion ?? (closedDefaults ? CHUNK_SCHEMA_VERSION : undefined),
    conversationTranscript:
      overrides.conversationTranscript === undefined
        ? closedDefaults
          ? makeChunkConversationTranscript({
              sourceRevision: overrides.sourceRevision ?? 1,
            })
          : undefined
        : overrides.conversationTranscript,
    lowerBand:
      overrides.lowerBand === undefined
        ? closedDefaults
          ? makeChunkLowerBandArtifacts()
          : undefined
        : overrides.lowerBand,
  }) as CanonicalChunkState;
}

export function makeLegacyPlaceholderChunkState(
  overrides: Partial<LegacyPlaceholderChunkState> = {},
): LegacyPlaceholderChunkState {
  return cloneChunkState({
    chunkId: overrides.chunkId ?? "chunk-001",
    threadId: overrides.threadId ?? "thread-001",
    lifecycleStatus: overrides.lifecycleStatus ?? "closed",
    sourceTurnIds: overrides.sourceTurnIds ? [...overrides.sourceTurnIds] : ["turn-001", "turn-002"],
    smoothText: overrides.smoothText ?? "Combined smooth chunk text",
    smoothTokenCountMetadata:
      overrides.smoothTokenCountMetadata ??
      makeTokenCountRecord(4, "chunk_smooth_materialized"),
    openedAt: overrides.openedAt ?? DEFAULT_TEST_TIMESTAMP,
    closedAt: overrides.closedAt ?? (overrides.lifecycleStatus === "open" ? undefined : DEFAULT_TEST_TIMESTAMP),
    closeReason: overrides.closeReason ?? (overrides.lifecycleStatus === "open" ? undefined : "soft_threshold"),
    sourceRevision: overrides.sourceRevision ?? 1,
    placeholders:
      overrides.placeholders ??
      makePlaceholderArtifactState({
        threadId: overrides.threadId ?? "thread-001",
        chunkId: overrides.chunkId ?? "chunk-001",
      }),
  }) as LegacyPlaceholderChunkState;
}
