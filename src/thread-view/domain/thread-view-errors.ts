import {
  createStewardIssue,
  fail,
  mergeIssues,
  ok,
  type CreateStewardIssueInput,
  type StewardIssue,
  type StewardResult,
} from "../../thread/domain/errors.js";

export const THREAD_VIEW_ERROR_CODES = [
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

export type ThreadViewErrorCode = (typeof THREAD_VIEW_ERROR_CODES)[number];
export type ThreadViewResult<T> = StewardResult<T>;

export interface CreateThreadViewIssueInput extends Omit<CreateStewardIssueInput, "code"> {
  code: ThreadViewErrorCode;
}

export function isThreadViewErrorCode(value: string): value is ThreadViewErrorCode {
  return (THREAD_VIEW_ERROR_CODES as readonly string[]).includes(value);
}

export function createThreadViewIssue(input: CreateThreadViewIssueInput): StewardIssue {
  return createStewardIssue(input);
}

export function okThreadViewResult<T>(value: T, issues?: readonly StewardIssue[]): ThreadViewResult<T> {
  return ok(value, issues);
}

export function failThreadViewResult<T = never>(...issues: readonly StewardIssue[]): ThreadViewResult<T> {
  return fail<T>(...issues);
}

export function mergeThreadViewIssues(
  ...issueSets: ReadonlyArray<readonly StewardIssue[] | undefined>
): StewardIssue[] {
  return mergeIssues(...issueSets);
}

// Compatibility aliases for existing workbench callers.
export const WORKBENCH_ERROR_CODES = THREAD_VIEW_ERROR_CODES;
export type WorkbenchErrorCode = ThreadViewErrorCode;
export type WorkbenchResult<T> = ThreadViewResult<T>;
export interface CreateWorkbenchIssueInput extends CreateThreadViewIssueInput {}
export const isWorkbenchErrorCode = isThreadViewErrorCode;
export const createWorkbenchIssue = createThreadViewIssue;
export const okWorkbenchResult = okThreadViewResult;
export const failWorkbenchResult = failThreadViewResult;
export const mergeWorkbenchIssues = mergeThreadViewIssues;
