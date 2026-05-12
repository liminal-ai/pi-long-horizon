import type { SourceRange, TargetRuntime } from "./records.js";

export const STEWARD_ERROR_CODES = [
  "INVALID_COMMAND_ARGS",
  "UNSUPPORTED_SCHEMA_VERSION",
  "TARGET_ASSOCIATION_CONFLICT",
  "STORE_UNAVAILABLE",
  "CAPTURE_APPEND_FAILED",
  "CAPTURE_DUPLICATE_EVENT",
  "UNMAPPED_PART_TYPE",
  "IMPORT_SOURCE_UNREADABLE",
  "IMPORT_PATH_AMBIGUOUS",
  "IMPORT_PARTIAL",
  "TURN_STATE_MISSING",
  "TURN_STATE_INCOMPLETE",
  "TURN_REPAIR_AMBIGUOUS",
  "TURN_REPAIR_WRITE_FAILED",
  "FIXTURE_CREATE_FAILED",
  "STALE_SOURCE_REVISION",
  "THREAD_VIEW_NOT_FOUND",
  "THREAD_VIEW_DUPLICATE",
  "THREAD_VIEW_STATE_CONFLICT",
  "THREAD_VIEW_ACTIVE_INVARIANT_VIOLATION",
  "THREAD_VIEW_MATERIALIZATION_REQUIRED",
  "WORKBENCH_SEARCH_UNSUPPORTED_SCOPE",
  "WORKBENCH_INVALID_FILTER",
  "WORKBENCH_SOURCE_UNIT_NOT_FOUND",
  "WORKBENCH_ARTIFACT_MISSING",
  "WORKBENCH_CHUNK_INELIGIBLE",
  "SMOOTH_MISSING",
  "SMOOTH_INVALID",
  "CHUNK_STATE_INVALID",
  "CHUNK_PLACEHOLDER_MISSING",
  "TOKEN_COUNT_BLOCKED",
  "TOKEN_COUNT_DEGRADED",
  "LOWER_THRESHOLD_UNREACHED",
  "GENERATED_SESSION_OVER_LOWER_BOUND",
  "GENERATED_WRITE_FAILED",
  "PI_RELOAD_FAILED",
] as const;

export type StewardErrorCode = (typeof STEWARD_ERROR_CODES)[number];

export interface StewardIssue {
  code: StewardErrorCode;
  message: string;
  threadId?: string;
  targetRuntime?: TargetRuntime;
  targetSessionId?: string;
  sourceRange?: SourceRange;
  cause?: string;
}

export class StewardResultError extends Error {
  readonly issues: StewardIssue[];

  constructor(issues: readonly StewardIssue[], message?: string) {
    super(message ?? issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "StewardResultError";
    this.issues = issues.map((issue) => createStewardIssue(issue));
  }
}

export type StewardResult<T> =
  | { ok: true; value: T; issues?: StewardIssue[] }
  | { ok: false; issues: StewardIssue[] };

export interface CreateStewardIssueInput extends StewardIssue {}

export function createStewardIssue(input: CreateStewardIssueInput): StewardIssue {
  return {
    ...input,
    sourceRange: input.sourceRange ? { ...input.sourceRange } : undefined,
  };
}

export function ok<T>(value: T, issues?: readonly StewardIssue[]): StewardResult<T> {
  if (!issues || issues.length === 0) {
    return { ok: true, value };
  }

  return {
    ok: true,
    value,
    issues: issues.map((issue) => createStewardIssue(issue)),
  };
}

export function fail<T = never>(...issues: readonly StewardIssue[]): StewardResult<T> {
  return {
    ok: false,
    issues: issues.map((issue) => createStewardIssue(issue)),
  };
}

export function mergeIssues(...issueSets: ReadonlyArray<readonly StewardIssue[] | undefined>): StewardIssue[] {
  return issueSets.flatMap((issueSet) => (issueSet ?? []).map((issue) => createStewardIssue(issue)));
}
