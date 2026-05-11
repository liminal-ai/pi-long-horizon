import {
  clonePlaceholderArtifactState,
  getPlaceholderArtifactMarker,
  type EnsurePlaceholderArtifactsInput,
  type EnsurePlaceholderArtifactsResult,
  type PlaceholderArtifactKind,
  type PlaceholderArtifactRecord,
  type PlaceholderArtifactState,
} from "../domain/placeholder-artifact-state.js";
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
import { fail, ok, type StewardIssue } from "../../domain/errors.js";
import type { ThreadStore } from "../../store/thread-store.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";

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

  if (chunk.smoothTokenCount !== estimateDeterministicTokenCount(smoothText)) {
    issues.push(
      buildPlaceholderIssue(
        `Chunk ${chunk.chunkId} smooth token count does not match its persisted smooth text.`,
        chunk.threadId,
        "smooth_token_count_invalid",
      ),
    );
  }

  return issues;
}

function buildPlaceholderRecord(input: {
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
    tokenCount: estimateDeterministicTokenCount(text),
    strategy,
    generatedAt: input.generatedAt,
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
    record.tokenCount === expected.tokenCount &&
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
    const detailed = buildPlaceholderRecord({
      kind: "detailed",
      smoothText: chunk.smoothText ?? "",
      settings,
      generatedAt,
    });
    const brief = buildPlaceholderRecord({
      kind: "brief",
      smoothText: chunk.smoothText ?? "",
      settings,
      generatedAt,
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

    chunk.placeholders = nextPlaceholders;

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
      throw new Error(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    return result.value;
  });
}
