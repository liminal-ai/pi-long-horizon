import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  SessionManager,
  type SessionEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import { createSourceRange } from "../domain/ids.js";
import { fail, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";

export interface PiImportEntry {
  sessionEntryId: string;
  parentId: string | null;
  timestamp: string;
  message: AgentMessage;
}

export interface PiSessionImportInput {
  sessionFilePath: string;
  sessionId?: string;
  activeLeafId?: string;
  sessionManager?: PiImportSessionManager;
}

export interface PiActivePathReadResult {
  sessionId?: string;
  sessionFilePath: string;
  cwd?: string;
  activePathReference?: string;
  entries: PiImportEntry[];
  issues: StewardIssue[];
}

export interface PiImportSessionManager {
  getBranch(fromId?: string): SessionEntry[];
  getCwd?(): string;
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  getSessionFile(): string | undefined;
  getSessionId(): string;
}

function cloneIssues(issues: readonly StewardIssue[]): StewardIssue[] {
  return issues.map((issue) => ({
    ...issue,
    sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
  }));
}

function importSourceUnreadableIssue(
  sessionFilePath: string,
  sessionId: string | undefined,
  cause: string,
): StewardIssue {
  return {
    code: "IMPORT_SOURCE_UNREADABLE",
    message: `PI session ${sessionFilePath} could not be read for import.`,
    targetRuntime: "pi",
    targetSessionId: sessionId,
    cause,
  };
}

function importPathAmbiguousIssue(
  sessionFilePath: string,
  sessionId: string | undefined,
  detail: string,
): StewardIssue {
  return {
    code: "IMPORT_PATH_AMBIGUOUS",
    message: `PI session ${sessionFilePath} does not expose one active linear path: ${detail}`,
    targetRuntime: "pi",
    targetSessionId: sessionId,
  };
}

function skippedPathEntryIssue(
  entry: Exclude<SessionEntry, SessionMessageEntry>,
  sessionId: string | undefined,
  estimatedSourceOrder: number,
): StewardIssue {
  return {
    code: "IMPORT_PARTIAL",
    message: `PI path entry ${entry.id} of type ${entry.type} was not imported as a canonical message.`,
    targetRuntime: "pi",
    targetSessionId: sessionId,
    sourceRange: createSourceRange(estimatedSourceOrder),
  };
}

function isSessionMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

function activeLeafCandidates(entries: readonly SessionEntry[]): string[] {
  const parentIds = new Set<string>();

  for (const entry of entries) {
    if (entry.parentId) {
      parentIds.add(entry.parentId);
    }
  }

  return entries.filter((entry) => !parentIds.has(entry.id)).map((entry) => entry.id);
}

function readSessionManagerFromFile(sessionFilePath: string): PiImportSessionManager {
  return SessionManager.open(sessionFilePath);
}

function resolveManager(input: PiSessionImportInput): StewardResult<PiImportSessionManager> {
  if (input.sessionManager) {
    return ok(input.sessionManager);
  }

  try {
    return ok(readSessionManagerFromFile(input.sessionFilePath));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return fail(importSourceUnreadableIssue(input.sessionFilePath, input.sessionId, cause));
  }
}

function resolveActiveLeafId(
  manager: PiImportSessionManager,
  input: PiSessionImportInput,
): StewardResult<string | undefined> {
  const entries = manager.getEntries();
  if (entries.length === 0) {
    return ok(undefined);
  }

  if (input.activeLeafId) {
    const activeLeafExists = entries.some((entry) => entry.id === input.activeLeafId);
    if (!activeLeafExists) {
      return fail(
        importPathAmbiguousIssue(
          input.sessionFilePath,
          input.sessionId ?? manager.getSessionId(),
          `leaf ${input.activeLeafId} is not present in the session tree`,
        ),
      );
    }

    return ok(input.activeLeafId);
  }

  if (input.sessionManager) {
    const leafId = manager.getLeafId() ?? undefined;
    if (!leafId) {
      return fail(
        importPathAmbiguousIssue(
          input.sessionFilePath,
          input.sessionId ?? manager.getSessionId(),
          "the active leaf is missing from the current session manager",
        ),
      );
    }

    return ok(leafId);
  }

  const leafCandidates = activeLeafCandidates(entries);
  if (leafCandidates.length !== 1) {
    return fail(
      importPathAmbiguousIssue(
        input.sessionFilePath,
        input.sessionId ?? manager.getSessionId(),
        `expected exactly one leaf candidate but found ${leafCandidates.length}`,
      ),
    );
  }

  return ok(leafCandidates[0]);
}

export async function readPiActivePath(
  input: PiSessionImportInput,
): Promise<StewardResult<PiActivePathReadResult>> {
  const manager = resolveManager(input);
  if (!manager.ok) {
    return manager;
  }

  const managerSessionId = manager.value.getSessionId();
  const sessionId = input.sessionId ?? (managerSessionId || undefined);
  const leafId = resolveActiveLeafId(manager.value, input);
  if (!leafId.ok) {
    return leafId;
  }

  const activePathEntries = leafId.value ? manager.value.getBranch(leafId.value) : [];
  if (manager.value.getEntries().length > 0 && activePathEntries.length === 0) {
    return fail(
      importPathAmbiguousIssue(
        input.sessionFilePath,
        sessionId,
        "the active branch could not be reconstructed from the resolved leaf",
      ),
    );
  }

  const entries: PiImportEntry[] = [];
  const issues: StewardIssue[] = [];
  let importableMessageCount = 0;

  for (const entry of activePathEntries) {
    if (isSessionMessageEntry(entry)) {
      importableMessageCount += 1;
      entries.push({
        sessionEntryId: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        message: structuredClone(entry.message),
      });
      continue;
    }

    const estimatedSourceOrder = Math.max(1, importableMessageCount + 1);
    issues.push(skippedPathEntryIssue(entry, sessionId, estimatedSourceOrder));
  }

  const activePathReference = leafId.value ? `leaf:${leafId.value}` : undefined;

  return ok({
    sessionId,
    sessionFilePath: input.sessionFilePath,
    cwd: manager.value.getCwd?.(),
    activePathReference,
    entries,
    issues: cloneIssues(issues),
  });
}
