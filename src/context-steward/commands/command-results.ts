import type { StewardIssue } from "../domain/errors.js";

export interface CommandResult {
  ok: boolean;
  title: string;
  summary: string;
  issues: StewardIssue[];
  threadId?: string;
  fixtureId?: string;
}

function uniqueIssueCodes(issues: readonly StewardIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code))];
}

export function cloneCommandResult(result: CommandResult): CommandResult {
  return {
    ...result,
    issues: result.issues.map((issue) => ({
      ...issue,
      sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
    })),
  };
}

export function formatCommandResult(result: CommandResult): string {
  const cloned = cloneCommandResult(result);
  const title = cloned.ok || cloned.title.toLowerCase().includes("failed")
    ? cloned.title
    : `${cloned.title} failed`;
  const codes = uniqueIssueCodes(cloned.issues);
  const suffix = codes.length > 0 ? ` [${codes.join(", ")}]` : "";

  return `${title}: ${cloned.summary}${suffix}`;
}
