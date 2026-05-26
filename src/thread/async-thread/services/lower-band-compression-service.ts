import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  CHUNK_SEMANTIC_ARTIFACT_BANDS,
  type ChunkSemanticArtifactBand,
  type ChunkSemanticArtifactRecord,
} from "../domain/lower-band-artifact-state.js";
import {
  cloneChunkState,
  getReadyChunkConversationTranscriptText,
  isCanonicalChunkState,
  type CanonicalChunkState,
  type ChunkState,
} from "../domain/chunk-state.js";
import type { ThreadStore } from "../../store/thread-store.js";
import { fail, ok, StewardResultError, type StewardIssue, type StewardResult } from "../../domain/errors.js";
import { withSerializedThreadOperation } from "../../services/thread-service.js";
import { externalIntegrationDetails, formatExternalIntegrationFailure } from "../../../integration-error.js";
import {
  countBriefChunkMaterialized,
  countDetailedChunkMaterialized,
  type OpenAIInputTokenCounter,
  type TokenCountRecord,
} from "../../../token-accounting/index.js";

export const LOWER_BAND_DETAIL_PROMPT_VERSION = "lower_band_detailed_v1" as const;
export const LOWER_BAND_BRIEF_PROMPT_VERSION = "lower_band_brief_v1" as const;
export const LOWER_BAND_ROUTING_DIVISOR = 3.5;
export const LOWER_BAND_MAX_ESTIMATED_INPUT_TOKENS = 8_500;
export const LOWER_BAND_MAX_ATTEMPTS = 3;
export const LOWER_BAND_ESCALATED_MODEL_ID = "gpt-5.5" as const;
export const LOWER_BAND_ESCALATED_REASONING_EFFORT = "medium" as const;

export type LowerBandCompressionPromptVersion =
  | typeof LOWER_BAND_DETAIL_PROMPT_VERSION
  | typeof LOWER_BAND_BRIEF_PROMPT_VERSION;

export interface LowerBandCompressionProviderInput {
  threadId: string;
  chunkId: string;
  band: ChunkSemanticArtifactBand;
  transcriptText: string;
  promptVersion: LowerBandCompressionPromptVersion;
  modelId: "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.5";
  reasoningEffort: "none" | "low" | "medium" | "high";
  retryContext?: {
    previousAttempt: number;
    attempt: number;
    maxAttempts: number;
    previousErrorMessage?: string;
    previousOutputText?: string;
    previousEstimatedTokens?: number;
    acceptedRange?: { min: number; max: number };
    rangeDisposition?: "below_range" | "above_range";
  };
}

export interface LowerBandCompressionProviderOutput {
  text: string;
  providerId: "openai-codex";
  modelId: "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.5";
  reasoningEffort: "none" | "low" | "medium" | "high";
  promptVersion: LowerBandCompressionPromptVersion;
  usage?: Record<string, unknown>;
  elapsedMs: number;
  generatedAt: string;
}

export interface LowerBandCompressionProvider {
  compress(input: LowerBandCompressionProviderInput): Promise<LowerBandCompressionProviderOutput>;
}

export interface LowerBandCompressionLogger {
  error(message: string, details?: Record<string, unknown>): void;
  debug?(message: string, details?: Record<string, unknown>): void;
}

export interface LowerBandCompressionLane {
  modelId: "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.5";
  reasoningEffort: "low" | "medium" | "high";
}

export interface LowerBandCompressionServiceOptions {
  store: ThreadStore;
  provider: LowerBandCompressionProvider;
  openAIInputTokenCounter?: Pick<
    OpenAIInputTokenCounter,
    "countDetailedChunkMaterialized" | "countBriefChunkMaterialized"
  >;
  tokenCountModel?: string;
  now?: () => Date;
  logger?: LowerBandCompressionLogger;
  maxAttempts?: number;
}

export interface EnsureLowerBandChunkArtifactsInput {
  threadId: string;
  chunkId: string;
  requiredBands?: Array<ChunkSemanticArtifactBand>;
  mode: "async_close" | "prepare_catch_up";
}

export interface EnsureLowerBandChunkArtifactsResult {
  chunkId: string;
  transcriptReady: boolean;
  detailedReady: boolean;
  briefReady: boolean;
  blockers: StewardIssue[];
}

const inFlight = new Set<string>();

function createChunkStateIssue(input: {
  threadId: string;
  chunkId: string;
  cause: string;
  message: string;
}): StewardIssue {
  return {
    code: "CHUNK_STATE_INVALID",
    threadId: input.threadId,
    cause: input.cause,
    message: input.message,
  };
}

function inFlightKey(input: Pick<EnsureLowerBandChunkArtifactsInput, "threadId" | "chunkId">): string {
  return `${input.threadId}:${input.chunkId}`;
}

function bandPromptVersion(band: ChunkSemanticArtifactBand): LowerBandCompressionPromptVersion {
  return band === "detailed" ? LOWER_BAND_DETAIL_PROMPT_VERSION : LOWER_BAND_BRIEF_PROMPT_VERSION;
}

function orderedBands(requiredBands?: readonly ChunkSemanticArtifactBand[]): ChunkSemanticArtifactBand[] {
  const requested = new Set(requiredBands ?? CHUNK_SEMANTIC_ARTIFACT_BANDS);
  return CHUNK_SEMANTIC_ARTIFACT_BANDS.filter((band) => requested.has(band));
}

function maxTranscriptChars(): number {
  return Math.floor(LOWER_BAND_MAX_ESTIMATED_INPUT_TOKENS * LOWER_BAND_ROUTING_DIVISOR);
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "LOWER_BAND_PROVIDER_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameArtifactState(
  left: ChunkSemanticArtifactRecord | undefined,
  right: ChunkSemanticArtifactRecord,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function isArtifactStateFresher(
  current: ChunkSemanticArtifactRecord | undefined,
  incoming: ChunkSemanticArtifactRecord,
): boolean {
  if (current?.status === "ready" && incoming.status !== "ready") {
    return true;
  }

  if (current?.status === "failed" && incoming.status === "pending") {
    return true;
  }

  if (current?.status !== incoming.status) {
    return false;
  }

  return (
    typeof current?.updatedAt === "string" &&
    typeof incoming.updatedAt === "string" &&
    current.updatedAt > incoming.updatedAt
  );
}

function bandReady(record: ChunkSemanticArtifactRecord | undefined): boolean {
  return record?.status === "ready" && typeof record.text === "string" && record.text.trim().length > 0;
}

function isRetryablePersistIssue(result: StewardResult<void>): boolean {
  return (
    !result.ok &&
    result.issues.some((issue) => issue.code === "STALE_SOURCE_REVISION" || issue.code === "STORE_UNAVAILABLE")
  );
}

function estimateLowerBandTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / LOWER_BAND_ROUTING_DIVISOR));
}

function targetRangeForBand(input: {
  band: ChunkSemanticArtifactBand;
  transcriptEstimatedTokens: number;
}): { min: number; max: number } {
  const ratios = input.band === "detailed"
    ? { min: 0.15, max: 0.5 }
    : { min: 0.01, max: 0.2 };
  const min = Math.max(1, Math.ceil(input.transcriptEstimatedTokens * ratios.min));
  const max = Math.max(min, Math.floor(input.transcriptEstimatedTokens * ratios.max));
  return { min, max };
}

function assessLowerBandOutputSize(input: {
  band: ChunkSemanticArtifactBand;
  transcriptEstimatedTokens: number;
  outputText: string;
}): {
  acceptedRange: { min: number; max: number };
  outputEstimatedTokens: number;
  inRange: boolean;
  rangeDisposition: "below_range" | "above_range" | "within_range";
} {
  const acceptedRange = targetRangeForBand({
    band: input.band,
    transcriptEstimatedTokens: input.transcriptEstimatedTokens,
  });
  const outputEstimatedTokens = estimateLowerBandTokens(input.outputText);
  if (outputEstimatedTokens < acceptedRange.min) {
    return {
      acceptedRange,
      outputEstimatedTokens,
      inRange: false,
      rangeDisposition: "below_range",
    };
  }

  if (outputEstimatedTokens > acceptedRange.max) {
    return {
      acceptedRange,
      outputEstimatedTokens,
      inRange: false,
      rangeDisposition: "above_range",
    };
  }

  return {
    acceptedRange,
    outputEstimatedTokens,
    inRange: true,
    rangeDisposition: "within_range",
  };
}

function routeLowerBandCompressionLane(estimatedTokens: number): LowerBandCompressionLane {
  if (estimatedTokens <= 1_000) {
    return { modelId: "gpt-5.4-mini", reasoningEffort: "low" };
  }

  if (estimatedTokens <= 1_500) {
    return { modelId: "gpt-5.4-mini", reasoningEffort: "medium" };
  }

  if (estimatedTokens <= 2_000) {
    return { modelId: "gpt-5.4-mini", reasoningEffort: "high" };
  }

  if (estimatedTokens <= 3_000) {
    return { modelId: "gpt-5.4", reasoningEffort: "medium" };
  }

  return { modelId: "gpt-5.4", reasoningEffort: "high" };
}

function laneForAttempt(routedLane: LowerBandCompressionLane, attempt: number): LowerBandCompressionLane {
  if (attempt < 3) {
    return routedLane;
  }

  return {
    modelId: LOWER_BAND_ESCALATED_MODEL_ID,
    reasoningEffort: LOWER_BAND_ESCALATED_REASONING_EFFORT,
  };
}

function truncateCompressionInput(input: {
  transcriptText: string;
  estimatedTokens: number;
}): { transcriptText: string; estimatedTokens: number; truncated: boolean } {
  if (input.estimatedTokens <= LOWER_BAND_MAX_ESTIMATED_INPUT_TOKENS) {
    return {
      transcriptText: input.transcriptText,
      estimatedTokens: input.estimatedTokens,
      truncated: false,
    };
  }

  const truncatedText = input.transcriptText.slice(0, maxTranscriptChars());
  return {
    transcriptText: truncatedText,
    estimatedTokens: estimateLowerBandTokens(truncatedText),
    truncated: true,
  };
}

function defaultLogger(): LowerBandCompressionLogger {
  const debugDir = join(process.cwd(), ".context-steward", "debug");
  const logPath = join(debugDir, "lower-band-compression.log");

  async function write(level: "debug" | "error", message: string, details?: Record<string, unknown>) {
    await mkdir(debugDir, { recursive: true });
    await appendFile(
      logPath,
      `${JSON.stringify({ at: new Date().toISOString(), level, message, ...details })}\n`,
      "utf8",
    );
  }

  return {
    error(message, details) {
      const rendered = details ? `${message} ${JSON.stringify(details)}` : message;
      console.error(rendered);
      void write("error", message, details).catch(() => undefined);
    },
    debug(message, details) {
      void write("debug", message, details).catch(() => undefined);
    },
  };
}

function writeOversizeWarning(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Best-effort warning only.
  }
}

async function buildSemanticArtifactTokenCountMetadata(input: {
  chunk: CanonicalChunkState;
  band: ChunkSemanticArtifactBand;
  counter?: Pick<OpenAIInputTokenCounter, "countDetailedChunkMaterialized" | "countBriefChunkMaterialized">;
  model?: string;
  now?: () => Date;
  logger?: LowerBandCompressionLogger;
}): Promise<TokenCountRecord> {
  try {
    if (input.counter) {
      const record = input.band === "detailed"
        ? await input.counter.countDetailedChunkMaterialized(input.chunk, { model: input.model, now: input.now })
        : await input.counter.countBriefChunkMaterialized(input.chunk, { model: input.model, now: input.now });
      return {
        ...record,
        sourceRevision: input.chunk.sourceRevision,
      };
    }
  } catch (error) {
    input.logger?.error("Lower-band artifact exact token counting failed; persisting heuristic metadata instead.", {
      chunkId: input.chunk.chunkId,
      band: input.band,
      error: errorMessage(error),
    });
  }

  const record = input.band === "detailed"
    ? countDetailedChunkMaterialized(input.chunk, { now: input.now })
    : countBriefChunkMaterialized(input.chunk, { now: input.now });

  return {
    ...record,
    sourceRevision: input.chunk.sourceRevision,
  };
}

async function persistLowerBandArtifactState(
  input: {
    threadId: string;
    chunkId: string;
    band: ChunkSemanticArtifactBand;
    record: ChunkSemanticArtifactRecord;
  },
  store: ThreadStore,
): Promise<StewardResult<void>> {
  let lastResult: StewardResult<void> | undefined;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await persistLowerBandArtifactStateOnce(input, store);
    if (result.ok) {
      return result;
    }

    lastResult = result;
    if (!isRetryablePersistIssue(result)) {
      return result;
    }

    await sleep(attempt * 10);
  }

  return lastResult ?? fail(
    createChunkStateIssue({
      threadId: input.threadId,
      chunkId: input.chunkId,
      cause: "lower_band_artifact_write_failed",
      message: `Chunk ${input.chunkId} lower-band artifact state could not be persisted.`,
    }),
  );
}

async function persistLowerBandArtifactStateOnce(
  input: {
    threadId: string;
    chunkId: string;
    band: ChunkSemanticArtifactBand;
    record: ChunkSemanticArtifactRecord;
  },
  store: ThreadStore,
): Promise<StewardResult<void>> {
  return withSerializedThreadOperation(input.threadId, async () => {
    const threadResult = await store.openThread(input.threadId);
    if (!threadResult.ok) {
      return threadResult;
    }

    const chunksResult = await store.readChunks(input.threadId);
    if (!chunksResult.ok) {
      return chunksResult;
    }

    const nextChunks = chunksResult.value.map((chunk) => cloneChunkState(chunk));
    const chunkIndex = nextChunks.findIndex((chunk) => chunk.chunkId === input.chunkId);
    if (chunkIndex === -1) {
      return fail(
        createChunkStateIssue({
          threadId: input.threadId,
          chunkId: input.chunkId,
          cause: "chunk_missing",
          message: `Chunk ${input.chunkId} was not found in thread ${input.threadId}.`,
        }),
      );
    }

    const chunk = nextChunks[chunkIndex]!;
    if (!isCanonicalChunkState(chunk)) {
      return fail(
        createChunkStateIssue({
          threadId: input.threadId,
          chunkId: input.chunkId,
          cause: "legacy_chunk_state",
          message: `Chunk ${input.chunkId} is still using legacy placeholder state and cannot persist semantic lower-band artifacts.`,
        }),
      );
    }

    const current = chunk.lowerBand?.[input.band];
    if (isArtifactStateFresher(current, input.record) || sameArtifactState(current, input.record)) {
      return ok(undefined);
    }

    chunk.lowerBand = {
      ...(chunk.lowerBand ?? {}),
      [input.band]: { ...input.record },
    };

    const writeResult = store.writeChunkRows
      ? await store.writeChunkRows({
          threadId: input.threadId,
          expectedSourceRevision: threadResult.value.thread.sourceRevision,
          expectedMessageHighWatermark: threadResult.value.thread.messageHighWatermark,
          chunks: [chunk],
          updatedAt: input.record.updatedAt,
        })
      : await store.writeChunks({
          threadId: input.threadId,
          expectedSourceRevision: threadResult.value.thread.sourceRevision,
          expectedMessageHighWatermark: threadResult.value.thread.messageHighWatermark,
          expectedTurnsRevision: threadResult.value.thread.turnsRevision,
          chunks: nextChunks,
        });
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(undefined);
  });
}

export class LowerBandCompressionService {
  private readonly logger: LowerBandCompressionLogger;
  private readonly maxAttempts: number;

  constructor(private readonly options: LowerBandCompressionServiceOptions) {
    this.logger = options.logger ?? defaultLogger();
    this.maxAttempts = Math.max(1, options.maxAttempts ?? LOWER_BAND_MAX_ATTEMPTS);
  }

  schedule(input: Omit<EnsureLowerBandChunkArtifactsInput, "mode"> & { mode?: EnsureLowerBandChunkArtifactsInput["mode"] }): boolean {
    const key = inFlightKey(input);
    if (inFlight.has(key)) {
      return false;
    }

    inFlight.add(key);
    const timer = setTimeout(() => {
      void this.run({
        ...input,
        mode: input.mode ?? "async_close",
      })
        .catch((error) => {
          this.logger.error("Async lower-band compression run failed.", {
            threadId: input.threadId,
            chunkId: input.chunkId,
            mode: input.mode ?? "async_close",
            error: errorMessage(error),
          });
        })
        .finally(() => {
          inFlight.delete(key);
        });
    }, 0);
    timer.unref?.();
    return true;
  }

  async run(input: EnsureLowerBandChunkArtifactsInput): Promise<EnsureLowerBandChunkArtifactsResult> {
    const blockers: StewardIssue[] = [];
    let transcriptReady = false;
    let detailedReady = false;
    let briefReady = false;

    const threadResult = await this.options.store.openThread(input.threadId);
    if (!threadResult.ok) {
      throw new StewardResultError(threadResult.issues);
    }

    const chunksResult = await this.options.store.readChunks(input.threadId);
    if (!chunksResult.ok) {
      throw new StewardResultError(chunksResult.issues);
    }

    const chunk = chunksResult.value.find((candidate) => candidate.chunkId === input.chunkId);
    if (!chunk) {
      return {
        chunkId: input.chunkId,
        transcriptReady: false,
        detailedReady: false,
        briefReady: false,
        blockers: [
          createChunkStateIssue({
            threadId: input.threadId,
            chunkId: input.chunkId,
            cause: "chunk_missing",
            message: `Chunk ${input.chunkId} was not found in thread ${input.threadId}.`,
          }),
        ],
      };
    }

    if (!isCanonicalChunkState(chunk)) {
      return {
        chunkId: input.chunkId,
        transcriptReady: false,
        detailedReady: false,
        briefReady: false,
        blockers: [
          createChunkStateIssue({
            threadId: input.threadId,
            chunkId: input.chunkId,
            cause: "legacy_chunk_state",
            message: `Chunk ${input.chunkId} is still using legacy placeholder state and cannot generate semantic lower-band artifacts.`,
          }),
        ],
      };
    }

    if (chunk.lifecycleStatus !== "closed") {
      return {
        chunkId: input.chunkId,
        transcriptReady: false,
        detailedReady: false,
        briefReady: false,
        blockers: [
          createChunkStateIssue({
            threadId: input.threadId,
            chunkId: input.chunkId,
            cause: "chunk_not_closed",
            message: `Chunk ${input.chunkId} must be closed before semantic lower-band artifacts can be generated.`,
          }),
        ],
      };
    }

    const transcriptText = getReadyChunkConversationTranscriptText(chunk);
    if (!transcriptText) {
      return {
        chunkId: input.chunkId,
        transcriptReady: false,
        detailedReady: false,
        briefReady: false,
        blockers: [
          createChunkStateIssue({
            threadId: input.threadId,
            chunkId: input.chunkId,
            cause: "conversation_transcript_not_ready",
            message: `Chunk ${input.chunkId} is missing a ready conversation-only transcript required for semantic lower-band generation.`,
          }),
        ],
      };
    }

    transcriptReady = true;

    for (const band of orderedBands(input.requiredBands)) {
      const existingBand = chunk.lowerBand?.[band];
      if (bandReady(existingBand)) {
        if (band === "detailed") {
          detailedReady = true;
        } else {
          briefReady = true;
        }
        continue;
      }

      const bandResult = await this.generateBand({
        input,
        chunk,
        transcriptText,
        band,
      });
      blockers.push(...bandResult.blockers);

      if (band === "detailed") {
        detailedReady = bandResult.ready;
      } else {
        briefReady = bandResult.ready;
      }
    }

    for (const band of CHUNK_SEMANTIC_ARTIFACT_BANDS) {
      if (!(input.requiredBands ?? CHUNK_SEMANTIC_ARTIFACT_BANDS).includes(band)) {
        const existingBand = chunk.lowerBand?.[band];
        if (band === "detailed" && bandReady(existingBand)) {
          detailedReady = true;
        }
        if (band === "brief" && bandReady(existingBand)) {
          briefReady = true;
        }
      }
    }

    return {
      chunkId: input.chunkId,
      transcriptReady,
      detailedReady,
      briefReady,
      blockers,
    };
  }

  private async generateBand(input: {
    input: EnsureLowerBandChunkArtifactsInput;
    chunk: CanonicalChunkState;
    transcriptText: string;
    band: ChunkSemanticArtifactBand;
  }): Promise<{ ready: boolean; blockers: StewardIssue[] }> {
    const updatedAt = nowIso(this.options.now);
    const pendingRecord: ChunkSemanticArtifactRecord = {
      band: input.band,
      status: "pending",
      updatedAt,
    };
    const pendingPersistResult = await persistLowerBandArtifactState(
      {
        threadId: input.input.threadId,
        chunkId: input.input.chunkId,
        band: input.band,
        record: pendingRecord,
      },
      this.options.store,
    );
    if (!pendingPersistResult.ok) {
      throw new StewardResultError(pendingPersistResult.issues);
    }

    const initialEstimate = estimateLowerBandTokens(input.transcriptText);
    const routedLane = routeLowerBandCompressionLane(initialEstimate);
    const preparedTranscript = truncateCompressionInput({
      transcriptText: input.transcriptText,
      estimatedTokens: initialEstimate,
    });
    let retryContext: LowerBandCompressionProviderInput["retryContext"] | undefined;

    if (preparedTranscript.truncated) {
      const warning =
        `[lower-band-compression] Chunk ${input.input.chunkId} ${input.band} transcript exceeded ` +
        `${LOWER_BAND_MAX_ESTIMATED_INPUT_TOKENS} estimated tokens; truncating input for this generation attempt.`;
      writeOversizeWarning(warning);
      this.logger.debug?.("Lower-band compression transcript truncated before provider call.", {
        threadId: input.input.threadId,
        chunkId: input.input.chunkId,
        band: input.band,
        mode: input.input.mode,
        originalEstimatedTokens: initialEstimate,
        truncatedEstimatedTokens: preparedTranscript.estimatedTokens,
      });
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const lane = laneForAttempt(routedLane, attempt);
      if (attempt >= 3) {
        this.logger.debug?.("Lower-band compression escalating to GPT-5.5 medium.", {
          threadId: input.input.threadId,
          chunkId: input.input.chunkId,
          band: input.band,
          mode: input.input.mode,
          attempt,
          maxAttempts: this.maxAttempts,
          routedModelId: routedLane.modelId,
          routedReasoningEffort: routedLane.reasoningEffort,
        });
      }

      try {
        const output = await this.options.provider.compress({
          threadId: input.input.threadId,
          chunkId: input.input.chunkId,
          band: input.band,
          transcriptText: preparedTranscript.transcriptText,
          promptVersion: bandPromptVersion(input.band),
          modelId: lane.modelId,
          reasoningEffort: lane.reasoningEffort,
          retryContext,
        });
        const text = output.text.trim();
        if (!text) {
          throw new Error("Lower-band compression provider returned empty text.");
        }

        const sizeAssessment = assessLowerBandOutputSize({
          band: input.band,
          transcriptEstimatedTokens: initialEstimate,
          outputText: text,
        });
        const shouldAccept = sizeAssessment.inRange || attempt === this.maxAttempts;
        if (!shouldAccept) {
          this.logger.debug?.("Lower-band compression output missed size guidance and will retry.", {
            threadId: input.input.threadId,
            chunkId: input.input.chunkId,
            band: input.band,
            mode: input.input.mode,
            attempt,
            maxAttempts: this.maxAttempts,
            modelId: output.modelId,
            reasoningEffort: output.reasoningEffort,
            transcriptEstimatedTokens: initialEstimate,
            outputEstimatedTokens: sizeAssessment.outputEstimatedTokens,
            acceptedRangeMin: sizeAssessment.acceptedRange.min,
            acceptedRangeMax: sizeAssessment.acceptedRange.max,
            rangeDisposition: sizeAssessment.rangeDisposition,
          });
          retryContext = {
            previousAttempt: attempt,
            attempt: attempt + 1,
            maxAttempts: this.maxAttempts,
            previousOutputText: text,
            previousEstimatedTokens: sizeAssessment.outputEstimatedTokens,
            acceptedRange: sizeAssessment.acceptedRange,
            rangeDisposition:
              sizeAssessment.rangeDisposition === "within_range"
                ? undefined
                : sizeAssessment.rangeDisposition,
          };
          continue;
        }

        const readyRecord: ChunkSemanticArtifactRecord = {
          band: input.band,
          status: "ready",
          text,
          providerMetadata: {
            providerId: output.providerId,
            modelId: output.modelId,
            reasoningEffort: output.reasoningEffort,
            promptVersion: output.promptVersion,
            usage: output.usage,
            elapsedMs: output.elapsedMs,
          },
          tokenCountMetadata: await buildSemanticArtifactTokenCountMetadata({
            chunk: {
              ...input.chunk,
              lowerBand: {
                ...(input.chunk.lowerBand ?? {}),
                [input.band]: {
                  band: input.band,
                  status: "ready",
                  text,
                  updatedAt: output.generatedAt,
                },
              },
            },
            band: input.band,
            counter: this.options.openAIInputTokenCounter,
            model: this.options.tokenCountModel,
            now: this.options.now,
            logger: this.logger,
          }),
          updatedAt: output.generatedAt,
        };
        const readyPersistResult = await persistLowerBandArtifactState(
          {
            threadId: input.input.threadId,
            chunkId: input.input.chunkId,
            band: input.band,
            record: readyRecord,
          },
          this.options.store,
        );
        if (!readyPersistResult.ok) {
          throw new StewardResultError(readyPersistResult.issues);
        }

        this.logger.debug?.("Lower-band compression completed.", {
          threadId: input.input.threadId,
          chunkId: input.input.chunkId,
          band: input.band,
          mode: input.input.mode,
          attempt,
          modelId: output.modelId,
          reasoningEffort: output.reasoningEffort,
          promptVersion: output.promptVersion,
          transcriptEstimatedTokens: initialEstimate,
          outputEstimatedTokens: sizeAssessment.outputEstimatedTokens,
          acceptedRangeMin: sizeAssessment.acceptedRange.min,
          acceptedRangeMax: sizeAssessment.acceptedRange.max,
          acceptedOutOfRange: !sizeAssessment.inRange,
        });

        return { ready: true, blockers: [] };
      } catch (error) {
        const formatted = formatExternalIntegrationFailure(
          {
            integration: "lower_band_compression",
            operation: "compress_chunk",
            provider: "openai-codex",
            model: lane.modelId,
            attempt,
            maxAttempts: this.maxAttempts,
          },
          error,
        );

        if (attempt < this.maxAttempts) {
          retryContext = {
            previousAttempt: attempt,
            attempt: attempt + 1,
            maxAttempts: this.maxAttempts,
            previousErrorMessage: errorMessage(error),
          };
          this.logger.debug?.("Lower-band compression attempt failed and will retry.", {
            threadId: input.input.threadId,
            chunkId: input.input.chunkId,
            band: input.band,
            mode: input.input.mode,
            attempt,
            maxAttempts: this.maxAttempts,
            estimatedTokens: preparedTranscript.estimatedTokens,
            ...externalIntegrationDetails(
              {
                integration: "lower_band_compression",
                operation: "compress_chunk",
                provider: "openai-codex",
                model: lane.modelId,
                attempt,
                maxAttempts: this.maxAttempts,
              },
              error,
            ),
          });
          continue;
        }

        const failedRecord: ChunkSemanticArtifactRecord = {
          band: input.band,
          status: "failed",
          updatedAt: nowIso(this.options.now),
          errorCode: errorCode(error),
          errorMessage: errorMessage(error),
        };
        const failedPersistResult = await persistLowerBandArtifactState(
          {
            threadId: input.input.threadId,
            chunkId: input.input.chunkId,
            band: input.band,
            record: failedRecord,
          },
          this.options.store,
        );
        if (!failedPersistResult.ok) {
          throw new StewardResultError(failedPersistResult.issues);
        }

        this.logger.error("Lower-band compression exhausted provider retries.", {
          threadId: input.input.threadId,
          chunkId: input.input.chunkId,
          band: input.band,
          mode: input.input.mode,
          attempt,
          maxAttempts: this.maxAttempts,
          estimatedTokens: preparedTranscript.estimatedTokens,
          transcriptEstimatedTokens: initialEstimate,
          failure: formatted,
        });

        return {
          ready: false,
          blockers: [
            createChunkStateIssue({
              threadId: input.input.threadId,
              chunkId: input.input.chunkId,
              cause: errorCode(error),
              message:
                `Chunk ${input.input.chunkId} failed ${input.band} lower-band compression after ` +
                `${this.maxAttempts} attempts: ${errorMessage(error)}`,
            }),
          ],
        };
      }
    }

    return {
      ready: false,
      blockers: [
        createChunkStateIssue({
          threadId: input.input.threadId,
          chunkId: input.input.chunkId,
          cause: "compression_attempts_exhausted",
          message: `Chunk ${input.input.chunkId} failed ${input.band} lower-band compression after ${this.maxAttempts} attempts.`,
        }),
      ],
    };
  }
}

export function estimateLowerBandRoutingTokens(text: string): number {
  return estimateLowerBandTokens(text);
}

export function routeLowerBandCompression(input: { transcriptText: string }): LowerBandCompressionLane {
  return routeLowerBandCompressionLane(estimateLowerBandTokens(input.transcriptText));
}
