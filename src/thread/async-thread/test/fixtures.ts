import {
  DEFAULT_TEST_TIMESTAMP,
  makeThreadSnapshot,
  type ThreadSnapshotFixture,
} from "../../../context-steward/test/fixtures.js";
import {
  cloneChunkState,
  type ChunkState,
} from "../domain/chunk-state.js";
import {
  clonePlaceholderArtifactState,
  type PlaceholderArtifactState,
} from "../domain/placeholder-artifact-state.js";
import {
  cloneSmoothTurnState,
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
  type SmoothTurnState,
} from "../domain/smooth-turn-state.js";

export { DEFAULT_TEST_TIMESTAMP, makeThreadSnapshot };
export type { ThreadSnapshotFixture };

export function makeSmoothTurnState(overrides: Partial<SmoothTurnState> = {}): SmoothTurnState {
  const text = overrides.text ?? "Deterministic smooth turn text";
  const normalizedText = normalizeDeterministicText(text);

  return cloneSmoothTurnState({
    turnId: overrides.turnId ?? "turn-001",
    threadId: overrides.threadId ?? "thread-001",
    status: overrides.status ?? "ready",
    text: overrides.status === "missing" ? undefined : normalizedText,
    tokenCount:
      overrides.tokenCount ??
      (overrides.status === "missing" ? undefined : estimateDeterministicTokenCount(normalizedText)),
    strategy: overrides.strategy ?? "deterministic_marker_sections_v1",
    generatedAt: overrides.generatedAt ?? DEFAULT_TEST_TIMESTAMP,
    sourceRevision: overrides.sourceRevision ?? 1,
  });
}

export function makePlaceholderArtifactState(
  overrides: Partial<PlaceholderArtifactState> = {},
): PlaceholderArtifactState {
  const threadId = overrides.threadId ?? "thread-001";
  const chunkId = overrides.chunkId ?? "chunk-001";

  return clonePlaceholderArtifactState({
    chunkId,
    threadId,
    detailed:
      overrides.detailed === undefined
        ? {
            kind: "detailed",
            status: "ready",
            text: "[placeholder:detailed] Deterministic lower-band text",
            tokenCount: 5,
            strategy: "deterministic_truncate_30",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          }
        : overrides.detailed,
    brief:
      overrides.brief === undefined
        ? {
            kind: "brief",
            status: "ready",
            text: "[placeholder:brief] Deterministic lower-band text",
            tokenCount: 4,
            strategy: "deterministic_truncate_5",
            generatedAt: DEFAULT_TEST_TIMESTAMP,
          }
        : overrides.brief,
  });
}

export function makeChunkState(overrides: Partial<ChunkState> = {}): ChunkState {
  const lifecycleStatus = overrides.lifecycleStatus ?? "closed";
  const placeholders =
    overrides.placeholders === undefined
      ? lifecycleStatus === "closed"
        ? makePlaceholderArtifactState({
            threadId: overrides.threadId ?? "thread-001",
            chunkId: overrides.chunkId ?? "chunk-001",
          })
        : undefined
      : overrides.placeholders;

  return cloneChunkState({
    chunkId: overrides.chunkId ?? "chunk-001",
    threadId: overrides.threadId ?? "thread-001",
    lifecycleStatus,
    sourceTurnIds: overrides.sourceTurnIds ? [...overrides.sourceTurnIds] : ["turn-001", "turn-002"],
    smoothText: overrides.smoothText ?? "Combined smooth chunk text",
    smoothTokenCount: overrides.smoothTokenCount ?? 4,
    openedAt: overrides.openedAt ?? DEFAULT_TEST_TIMESTAMP,
    closedAt: overrides.closedAt ?? (lifecycleStatus === "closed" ? DEFAULT_TEST_TIMESTAMP : undefined),
    closeReason: overrides.closeReason ?? (lifecycleStatus === "closed" ? "soft_threshold" : undefined),
    sourceRevision: overrides.sourceRevision ?? 1,
    placeholders,
  });
}
