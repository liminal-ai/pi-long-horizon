import type { ThreadViewMessageRecord } from "./thread-view-records.js";
import type { StewardIssue } from "../../thread/domain/errors.js";

export interface ThreadViewBandPercentages {
  fullFidelity: number;
  smooth: number;
  detailed: number;
  brief: number;
}

export interface ThreadViewBuildInputs {
  threadId: string;
  requestedLowerBound: number;
  requestedBandPercentages: ThreadViewBandPercentages;
  mode: "strict" | "prepare";
}

export interface ThreadViewBuildResult {
  draftThreadViewId: string;
  status: "ready" | "blocked" | "degraded";
  resultingTokenCount?: number;
  blockers: StewardIssue[];
}

export interface PiThreadViewEntry {
  entryType: "message";
  role: "user" | "assistant" | "toolResult" | "custom";
  content: string | Record<string, unknown>;
  generatedSource:
    | "raw_turn_message"
    | "smooth_turn"
    | "detailed_chunk_summary"
    | "brief_chunk_summary";
  metadata?: Record<string, unknown>;
}

export interface PiThreadViewFile {
  threadId: string;
  threadViewId: string;
  sessionId: string;
  cwd: string;
  parentSessionId?: string;
  generatedAt: string;
  placeholderExplicit: boolean;
  fileName: string;
  entries: PiThreadViewEntry[];
  entryCount: number;
}

export interface BuildPiThreadViewFileInput {
  threadId: string;
  threadViewId: string;
  emittedMessages: ThreadViewMessageRecord[];
  sessionId?: string;
  cwd?: string;
  parentSessionId?: string;
  generatedAt?: string;
  fileName?: string;
}

export interface WritePiThreadViewFileInput {
  threadId: string;
  threadViewId: string;
  file: PiThreadViewFile;
}

export interface WritePiThreadViewFileResult {
  generatedFilePath: string;
  archivePath?: string;
}

export interface PiCliHarnessAdapter {
  loadThreadViewFile(input: {
    threadId: string;
    threadViewId: string;
    filePath: string;
  }): Promise<
    | {
        ok: true;
      }
    | {
        ok: false;
        issues: StewardIssue[];
      }
  >;
}

export interface SmartCompactCommandInput {
  threadId: string;
  requestedLowerBound: number;
  requestedBandPercentages: ThreadViewBandPercentages;
  mode: "strict" | "prepare";
}

export interface SmartCompactCommandResult {
  threadId: string;
  requestedLowerBound: number;
  requestedBandPercentages: ThreadViewBandPercentages;
  threadViewId?: string;
  generatedFilePath?: string;
  archivePath?: string;
  compactStatus: "success" | "blocked" | "degraded" | "write_failed" | "reload_failed";
  blockers: StewardIssue[];
  resultingTokenCount?: number;
}

const BAND_PERCENTAGE_KEYS = ["fullFidelity", "smooth", "detailed", "brief"] as const;
const BAND_PERCENTAGE_PRECISION = 4;

export function normalizeBandPercentages(
  percentages: ThreadViewBandPercentages,
  precision = BAND_PERCENTAGE_PRECISION,
): ThreadViewBandPercentages {
  const factor = 10 ** precision;

  return {
    fullFidelity: Math.round(percentages.fullFidelity * factor) / factor,
    smooth: Math.round(percentages.smooth * factor) / factor,
    detailed: Math.round(percentages.detailed * factor) / factor,
    brief: Math.round(percentages.brief * factor) / factor,
  };
}

export function validateThreadViewBuildInputs(input: ThreadViewBuildInputs): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(input.requestedLowerBound) || input.requestedLowerBound <= 0) {
    errors.push("requestedLowerBound must be greater than 0.");
  }

  const percentages = normalizeBandPercentages(input.requestedBandPercentages);
  const sum = BAND_PERCENTAGE_KEYS.reduce((total, key) => total + percentages[key], 0);
  const roundedSum = Math.round(sum * 10 ** BAND_PERCENTAGE_PRECISION) / 10 ** BAND_PERCENTAGE_PRECISION;

  for (const key of BAND_PERCENTAGE_KEYS) {
    const value = percentages[key];
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`requestedBandPercentages.${key} must be a finite number greater than or equal to 0.`);
    }
  }

  if (percentages.fullFidelity + percentages.smooth === 0) {
    errors.push("requestedBandPercentages.fullFidelity and .smooth cannot both be 0.");
  }

  if (roundedSum !== 100) {
    errors.push("requestedBandPercentages must sum to 100.");
  }

  if (input.mode !== "strict" && input.mode !== "prepare") {
    errors.push('mode must be either "strict" or "prepare".');
  }

  return errors;
}

export function validateSmartCompactCommandInput(input: SmartCompactCommandInput): string[] {
  return validateThreadViewBuildInputs(input);
}
