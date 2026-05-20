import {
  clonePlaceholderArtifactState,
  getPlaceholderArtifactMarker,
  type EnsurePlaceholderArtifactsInput,
  type EnsurePlaceholderArtifactsResult,
  type PlaceholderArtifactKind,
  type PlaceholderArtifactRecord,
  type PlaceholderArtifactState,
} from "../domain/placeholder-artifact-state.js";
import { createHash } from "node:crypto";
import {
  DEFAULT_PLACEHOLDER_BUILD_SETTINGS,
  clonePlaceholderBuildSettings,
  type PlaceholderBuildSettings,
  validatePlaceholderBuildSettings,
} from "../domain/settings.js";
import { cloneChunkState, type ChunkState } from "../domain/chunk-state.js";
import {
  estimateDeterministicTokenCount,
  normalizeDeterministicText,
} from "../domain/smooth-turn-state.js";
import { fail, ok, StewardResultError, type StewardIssue } from "../../domain/errors.js";
import type { ThreadStore } from "../../store/thread-store.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import {
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  validateTokenCountRecord,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export interface PlaceholderArtifactServiceOptions {
  store: ThreadStore;
  settings?: PlaceholderBuildSettings;
  now?: () => Date;
}

function buildPlaceholderIssue(message: string, threadId: string, cause: string): StewardIssue {
  return {
    code: "CHUNK_STATE_INVALID",
    message,
    threadId,
    cause,
  };
}

function cloneChunks(chunks: readonly ChunkState[]): ChunkState[] {
  return chunks.map((chunk) => cloneChunkState(chunk));
}

function isCurrentTokenCountMetadata(record: TokenCountRecord | undefined, expected: TokenCountRecord): boolean {
  if (!record) {
    return false;
  }

  const isExactProviderCount = record.source === "provider_input_count" && record.trustClass === "exact";

  return (
    validateTokenCountRecord(record).ok &&
    record.scope === expected.scope &&
    (isExactProviderCount || record.count === expected.count) &&
    record.sourceRevision === expected.sourceRevision &&
    record.representationHash === expected.representationHash
  );
}

function backfillChunkSmoothTokenCountMetadata(chunk: ChunkState): boolean {
  if (!chunk.smoothText) {
    return false;
  }

  const expectedTokenCountMetadata = countChunkSmoothMaterialized(chunk);
  if (isCurrentTokenCountMetadata(chunk.smoothTokenCountMetadata, expectedTokenCountMetadata)) {
    return false;
  }

  chunk.smoothTokenCountMetadata = expectedTokenCountMetadata;
  return true;
}

export function createSmoothChunkSourceFingerprint(smoothText: string | undefined): string | undefined {
  const normalized = normalizeDeterministicText(smoothText ?? "");
  if (!normalized) {
    return undefined;
  }

  const digest = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${digest}`;
}

export function isPlaceholderFreshForChunk(
  chunk: ChunkState,
  record: PlaceholderArtifactRecord | undefined,
  smoothText: string | undefined = chunk.smoothText,
  smoothSourceRevision: number | undefined = chunk.sourceRevision,
  smoothSourceTokenCount: number | undefined = chunk.smoothTokenCountMetadata?.count,
): boolean {
  const smoothSourceFingerprint = createSmoothChunkSourceFingerprint(smoothText);
  if (!record || !smoothSourceFingerprint) {
    return false;
  }

  return (
    record.smoothSourceFingerprint === smoothSourceFingerprint &&
    record.smoothSourceRevision === smoothSourceRevision &&
    record.smoothSourceTokenCount === smoothSourceTokenCount &&
    record.generatedFromComponentSmooth === true
  );
}

function validateChunkForPlaceholderBuild(chunk: ChunkState): StewardIssue[] {
  const issues: StewardIssue[] = [];

  if (chunk.lifecycleStatus !== "closed") {
    issues.push(
      buildPlaceholderIssue(
        `Chunk ${chunk.chunkId} must be closed before placeholder artifacts can be generated.`,
        chunk.threadId,
        "chunk_not_closed",
      ),
    );
  }

  const smoothText = normalizeDeterministicText(chunk.smoothText ?? "");
  if (smoothText.length === 0) {
    issues.push(
      buildPlaceholderIssue(
        `Chunk ${chunk.chunkId} is missing smooth text required for placeholder generation.`,
        chunk.threadId,
        "smooth_text_missing",
      ),
    );
  }

  const expectedSmoothTokenCountMetadata = countChunkSmoothMaterialized(chunk);
  if (!isCurrentTokenCountMetadata(chunk.smoothTokenCountMetadata, expectedSmoothTokenCountMetadata)) {
    issues.push(
      buildPlaceholderIssue(
        `Chunk ${chunk.chunkId} smooth token metadata does not match its persisted smooth text.`,
        chunk.threadId,
        "smooth_token_count_metadata_invalid",
      ),
    );
  }

  return issues;
}

function buildPlaceholderRecord(input: {
  chunk: ChunkState;
  kind: PlaceholderArtifactKind;
  smoothText: string;
  settings: PlaceholderBuildSettings;
  generatedAt: string;
}): PlaceholderArtifactRecord {
  const normalizedText = normalizeDeterministicText(input.smoothText);
  const smoothTokens = normalizedText.length === 0 ? [] : normalizedText.split(" ");
  const marker = getPlaceholderArtifactMarker(input.kind);
  const markerTokenCount = estimateDeterministicTokenCount(marker);
  const ratio = input.kind === "detailed" ? input.settings.detailedRatio : input.settings.briefRatio;
  const strategy = input.kind === "detailed" ? input.settings.detailedStrategy : input.settings.briefStrategy;
  const targetArtifactTokenCount = Math.max(1, Math.round(smoothTokens.length * ratio));
  const preservedTokenCount =
    smoothTokens.length === 0
      ? 0
      : Math.min(smoothTokens.length, Math.max(1, targetArtifactTokenCount - markerTokenCount));
  const preservedText = smoothTokens.slice(0, preservedTokenCount).join(" ");
  const text = preservedText.length > 0 ? `${preservedText}\n\n${marker}` : marker;

  return {
    kind: input.kind,
    status: "ready",
    text,
    strategy,
    generatedAt: input.generatedAt,
    smoothSourceFingerprint: createSmoothChunkSourceFingerprint(input.smoothText),
    smoothSourceRevision: input.chunk.sourceRevision,
    smoothSourceTokenCount: input.chunk.smoothTokenCountMetadata?.count,
    generatedFromComponentSmooth: true,
  };
}

function withPlaceholderTokenCountMetadata(input: {
  chunk: ChunkState;
  record: PlaceholderArtifactRecord;
}): PlaceholderArtifactRecord {
  const placeholders: PlaceholderArtifactState = {
    chunkId: input.chunk.chunkId,
    threadId: input.chunk.threadId,
    detailed: input.record.kind === "detailed" ? input.record : input.chunk.placeholders?.detailed,
    brief: input.record.kind === "brief" ? input.record : input.chunk.placeholders?.brief,
  };
  const chunkWithPlaceholder: ChunkState = {
    chunkId: input.chunk.chunkId,
    threadId: input.chunk.threadId,
    lifecycleStatus: input.chunk.lifecycleStatus,
    sourceTurnIds: [...input.chunk.sourceTurnIds],
    smoothText: input.chunk.smoothText,
    smoothTokenCountMetadata: input.chunk.smoothTokenCountMetadata,
    openedAt: input.chunk.openedAt,
    closedAt: input.chunk.closedAt,
    closeReason: input.chunk.closeReason,
    sourceRevision: input.chunk.sourceRevision,
    placeholders,
  };
  const tokenCountMetadata =
    input.record.kind === "detailed"
      ? countDetailedChunkMaterialized(chunkWithPlaceholder, { createdAt: input.record.generatedAt })
      : countBriefChunkMaterialized(chunkWithPlaceholder, { createdAt: input.record.generatedAt });

  return {
    ...input.record,
    tokenCountMetadata,
  };
}

function isCurrentPlaceholderRecord(
  record: PlaceholderArtifactRecord | undefined,
  expected: PlaceholderArtifactRecord,
): boolean {
  if (!record) {
    return false;
  }

  return (
    record.kind === expected.kind &&
    record.status === "ready" &&
    record.text === expected.text &&
    record.smoothSourceFingerprint === expected.smoothSourceFingerprint &&
    record.smoothSourceRevision === expected.smoothSourceRevision &&
    record.smoothSourceTokenCount === expected.smoothSourceTokenCount &&
    record.generatedFromComponentSmooth === true &&
    isCurrentTokenCountMetadata(record.tokenCountMetadata, expected.tokenCountMetadata!) &&
    record.strategy === expected.strategy &&
    typeof record.generatedAt === "string" &&
    record.generatedAt.length > 0
  );
}

export async function ensurePlaceholderArtifacts(
  input: EnsurePlaceholderArtifactsInput,
  options: PlaceholderArtifactServiceOptions,
): Promise<EnsurePlaceholderArtifactsResult> {
  return withSerializedThreadOperation<EnsurePlaceholderArtifactsResult>(input.threadId, async () => {
    const settings = clonePlaceholderBuildSettings(options.settings ?? DEFAULT_PLACEHOLDER_BUILD_SETTINGS);
    const settingIssues = validatePlaceholderBuildSettings(settings);
    if (settingIssues.length > 0) {
      return ok({
        chunkId: input.chunkId,
        detailedReady: false,
        briefReady: false,
        blockers: settingIssues.map((message) =>
          buildPlaceholderIssue(message, input.threadId, "placeholder_settings_invalid"),
        ),
      } satisfies EnsurePlaceholderArtifactsResult);
    }

    const snapshotResult = await options.store.openThread(input.threadId);
    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const chunksResult = await options.store.readChunks(input.threadId);
    if (!chunksResult.ok) {
      return chunksResult;
    }

    const originalChunks = cloneChunks(chunksResult.value);
    const nextChunks = cloneChunks(chunksResult.value);
    const chunk = nextChunks.find((candidate) => candidate.chunkId === input.chunkId);
    if (!chunk) {
      return ok({
        chunkId: input.chunkId,
        detailedReady: false,
        briefReady: false,
        blockers: [
          buildPlaceholderIssue(
            `Chunk ${input.chunkId} was not found in thread ${input.threadId}.`,
            input.threadId,
            "chunk_missing",
          ),
        ],
      } satisfies EnsurePlaceholderArtifactsResult);
    }

    backfillChunkSmoothTokenCountMetadata(chunk);

    const blockers = validateChunkForPlaceholderBuild(chunk);
    if (blockers.length > 0) {
      return ok({
        chunkId: input.chunkId,
        detailedReady: false,
        briefReady: false,
        blockers,
      } satisfies EnsurePlaceholderArtifactsResult);
    }

    const generatedAt = (options.now ?? (() => new Date()))().toISOString();
    const detailed = withPlaceholderTokenCountMetadata({
      chunk,
      record: buildPlaceholderRecord({
        chunk,
        kind: "detailed",
        smoothText: chunk.smoothText ?? "",
        settings,
        generatedAt,
      }),
    });
    const brief = withPlaceholderTokenCountMetadata({
      chunk,
      record: buildPlaceholderRecord({
        chunk,
        kind: "brief",
        smoothText: chunk.smoothText ?? "",
        settings,
        generatedAt,
      }),
    });
    const previousPlaceholders = chunk.placeholders
      ? clonePlaceholderArtifactState(chunk.placeholders)
      : undefined;
    const nextPlaceholders: PlaceholderArtifactState = {
      chunkId: chunk.chunkId,
      threadId: chunk.threadId,
      detailed: isCurrentPlaceholderRecord(previousPlaceholders?.detailed, detailed)
        ? previousPlaceholders?.detailed
        : detailed,
      brief: isCurrentPlaceholderRecord(previousPlaceholders?.brief, brief)
        ? previousPlaceholders?.brief
        : brief,
    };

    const chunkIndex = nextChunks.findIndex((candidate) => candidate.chunkId === input.chunkId);
    nextChunks[chunkIndex] = {
      chunkId: chunk.chunkId,
      threadId: chunk.threadId,
      lifecycleStatus: chunk.lifecycleStatus,
      sourceTurnIds: [...chunk.sourceTurnIds],
      smoothText: chunk.smoothText,
      smoothTokenCountMetadata: chunk.smoothTokenCountMetadata,
      openedAt: chunk.openedAt,
      closedAt: chunk.closedAt,
      closeReason: chunk.closeReason,
      sourceRevision: chunk.sourceRevision,
      placeholders: nextPlaceholders,
    };

    if (JSON.stringify(originalChunks) !== JSON.stringify(nextChunks)) {
      const writeResult = await options.store.writeChunks({
        threadId: input.threadId,
        expectedSourceRevision: snapshotResult.value.thread.sourceRevision,
        expectedMessageHighWatermark: snapshotResult.value.thread.messageHighWatermark,
        expectedTurnsRevision: snapshotResult.value.thread.turnsRevision,
        chunks: nextChunks,
      });
      if (!writeResult.ok) {
        return writeResult;
      }
    }

    return ok({
      chunkId: input.chunkId,
      detailedReady: true,
      briefReady: true,
      blockers: [],
    } satisfies EnsurePlaceholderArtifactsResult);
  }).then((result) => {
    if (!result.ok) {
      throw new StewardResultError(result.issues);
    }

    return result.value;
  });
}
