import {
  createStewardIssue,
  fail,
  mergeIssues,
  ok,
  type CreateStewardIssueInput,
  type StewardIssue,
  type StewardResult,
} from "../../context-steward/domain/errors.js";

export const WORKBENCH_ERROR_CODES = [
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
] as const;

export type WorkbenchErrorCode = (typeof WORKBENCH_ERROR_CODES)[number];
export type WorkbenchResult<T> = StewardResult<T>;

export interface CreateWorkbenchIssueInput extends Omit<CreateStewardIssueInput, "code"> {
  code: WorkbenchErrorCode;
}

export function isWorkbenchErrorCode(value: string): value is WorkbenchErrorCode {
  return (WORKBENCH_ERROR_CODES as readonly string[]).includes(value);
}

export function createWorkbenchIssue(input: CreateWorkbenchIssueInput): StewardIssue {
  return createStewardIssue(input);
}

export function okWorkbenchResult<T>(value: T, issues?: readonly StewardIssue[]): WorkbenchResult<T> {
  return ok(value, issues);
}

export function failWorkbenchResult<T = never>(...issues: readonly StewardIssue[]): WorkbenchResult<T> {
  return fail<T>(...issues);
}

export function mergeWorkbenchIssues(
  ...issueSets: ReadonlyArray<readonly StewardIssue[] | undefined>
): StewardIssue[] {
  return mergeIssues(...issueSets);
}
