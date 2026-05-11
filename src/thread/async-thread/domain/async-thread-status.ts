import { createStewardIssue, type StewardIssue } from "../../domain/errors.js";

export const ASYNC_THREAD_STATUSES = ["ready", "blocked", "degraded"] as const;
export const ASYNC_THREAD_BLOCKER_CODES = [
  "SMOOTH_MISSING",
  "SMOOTH_INVALID",
  "CHUNK_STATE_INVALID",
  "CHUNK_PLACEHOLDER_MISSING",
  "LOWER_THRESHOLD_UNREACHED",
  "GENERATED_WRITE_FAILED",
  "PI_RELOAD_FAILED",
] as const;

export type AsyncThreadStatusLevel = (typeof ASYNC_THREAD_STATUSES)[number];
export type AsyncThreadBlockerCode = (typeof ASYNC_THREAD_BLOCKER_CODES)[number];

export interface AsyncThreadStatus {
  threadId: string;
  status: AsyncThreadStatusLevel;
  smoothReady: boolean;
  chunksReady: boolean;
  placeholdersReady: boolean;
  blockers: StewardIssue[];
}

export interface PrepareAsyncThreadInput {
  threadId: string;
  mode: "strict" | "prepare";
}

export interface PrepareAsyncThreadResult {
  threadId: string;
  smoothReady: boolean;
  chunksReady: boolean;
  placeholdersReady: boolean;
  blockers: StewardIssue[];
}

export function isAsyncThreadBlockerCode(value: string): value is AsyncThreadBlockerCode {
  return (ASYNC_THREAD_BLOCKER_CODES as readonly string[]).includes(value);
}

export function createAsyncThreadBlocker(input: {
  code: AsyncThreadBlockerCode;
  message: string;
  threadId?: string;
  cause?: string;
}): StewardIssue {
  return createStewardIssue(input);
}

export function cloneAsyncThreadStatus(record: AsyncThreadStatus): AsyncThreadStatus {
  return {
    ...record,
    blockers: record.blockers.map((issue) => createStewardIssue(issue)),
  };
}
