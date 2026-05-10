import { dirname } from "node:path";

import { createImportId, createSourceRange, createThreadId } from "../domain/ids.js";
import { fail, mergeIssues, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import {
  createThreadRecord,
  type ImportRecord,
  type MessageRecord,
  type SourceRange,
  type ThreadRecord,
  type TurnRecord,
} from "../domain/records.js";
import { mapPiMessageEnd } from "../pi/pi-message-mapper.js";
import {
  readPiActivePath,
  type PiActivePathReadResult,
  type PiImportSessionManager,
} from "../pi/pi-session-importer.js";
import type { ThreadStore, ThreadTargetRef } from "../store/thread-store.js";
import { captureFinalizedActivityInCurrentThreadOperation } from "./capture-service.js";
import { withSerializedThreadOperation } from "./thread-service.js";
import { checkTurnHealth, type TurnHealthReport } from "./turn-service.js";

export interface AttachPiSessionInput {
  store: ThreadStore;
  target: ThreadTargetRef & {
    cwd?: string;
    currentGeneratedFilePath?: string;
  };
  sessionFilePath: string;
  activeLeafId?: string;
  sessionManager?: PiImportSessionManager;
  now?: () => Date;
}

export interface AttachPiSessionResult {
  thread: ThreadRecord;
  importedMessages: number;
  importedSourceRange?: SourceRange;
  importRecord: ImportRecord;
  health: TurnHealthReport;
}

export interface PreviewPiSessionImportResult {
  sessionId?: string;
  sessionFilePath: string;
  activePathReference?: string;
  importableMessages: number;
  issues: StewardIssue[];
}

function cloneIssues(issues: readonly StewardIssue[] | undefined): StewardIssue[] {
  return (issues ?? []).map((issue) => ({
    ...issue,
    sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
  }));
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function sortIssues(issues: readonly StewardIssue[]): StewardIssue[] {
  return cloneIssues(issues).sort((left, right) => {
    const leftStart = left.sourceRange?.fromSourceOrder ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.sourceRange?.fromSourceOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    const leftEnd = left.sourceRange?.toSourceOrder ?? Number.MAX_SAFE_INTEGER;
    const rightEnd = right.sourceRange?.toSourceOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftEnd !== rightEnd) {
      return leftEnd - rightEnd;
    }

    if (left.code !== right.code) {
      return left.code.localeCompare(right.code);
    }

    return left.message.localeCompare(right.message);
  });
}

function decorateImportIssues(input: {
  issues: readonly StewardIssue[];
  sourceRange?: SourceRange;
  threadId?: string;
  sessionId?: string;
}): StewardIssue[] {
  return cloneIssues(input.issues).map((issue) => ({
    ...issue,
    threadId: issue.threadId ?? input.threadId,
    targetRuntime: issue.targetRuntime ?? "pi",
    targetSessionId: issue.targetSessionId ?? input.sessionId,
    sourceRange: issue.sourceRange ?? input.sourceRange,
  }));
}

function importConflictIssue(target: ThreadTargetRef, threadId: string): StewardIssue {
  const targetLabel = target.sessionId ?? target.sessionFilePath ?? "unknown-target";

  return {
    code: "TARGET_ASSOCIATION_CONFLICT",
    message: `PI target ${targetLabel} is already managed by thread ${threadId}.`,
    threadId,
    targetRuntime: target.runtime,
    targetSessionId: target.sessionId,
  };
}

function normalizeTargetValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function importTargetFromInput(input: AttachPiSessionInput): ThreadRecord["target"] {
  const contextSessionFilePath = normalizeTargetValue(input.target.sessionFilePath);
  const importSessionFilePath = normalizeTargetValue(input.sessionFilePath);
  const reusesContextTarget =
    contextSessionFilePath !== undefined &&
    importSessionFilePath !== undefined &&
    contextSessionFilePath === importSessionFilePath;

  if (reusesContextTarget) {
    return {
      runtime: "pi",
      sessionId: input.target.sessionId,
      sessionFilePath: input.target.sessionFilePath ?? input.sessionFilePath,
      cwd: input.target.cwd,
      currentGeneratedFilePath: input.target.currentGeneratedFilePath,
    };
  }

  return {
    runtime: "pi",
    sessionFilePath: input.sessionFilePath,
  };
}

function importRuntimeContext(input: AttachPiSessionInput, sessionId: string | undefined) {
  return {
    cwd: input.target.cwd ?? process.cwd(),
    sessionManager: {
      getCwd: () => input.target.cwd ?? process.cwd(),
      getSessionDir: () => dirname(input.sessionFilePath),
      getSessionId: () => sessionId ?? "",
      getSessionFile: () => input.sessionFilePath,
      getLeafId: () => null,
      getLeafEntry: () => undefined,
      getEntry: () => undefined,
      getLabel: () => undefined,
      getBranch: () => [],
      getHeader: () => null,
      getEntries: () => [],
      getTree: () => [],
      getSessionName: () => undefined,
    },
  } as Parameters<typeof mapPiMessageEnd>[0]["ctx"];
}

function importedRange(messages: readonly MessageRecord[]): SourceRange | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  return createSourceRange(messages[0]!.sourceOrder, messages[messages.length - 1]!.sourceOrder);
}

function rangeOverlaps(left: SourceRange, right: SourceRange): boolean {
  return left.fromSourceOrder <= right.toSourceOrder && right.fromSourceOrder <= left.toSourceOrder;
}

function repairNeededTurns(
  turns: readonly TurnRecord[],
  sourceRanges: readonly SourceRange[],
  sourceRevision: number,
  repairedAt: string,
): TurnRecord[] {
  return turns.map((turn) => {
    if (!sourceRanges.some((sourceRange) => rangeOverlaps(turn.sourceRange, sourceRange))) {
      return structuredClone(turn);
    }

    return {
      ...structuredClone(turn),
      repairStatus: "repair_needed",
      repairMetadata: {
        ...structuredClone(turn.repairMetadata),
        repairedAt,
        sourceRevisionChecked: sourceRevision,
        sourceRange: { ...turn.sourceRange },
        failureCode: "IMPORT_PARTIAL",
        failureReason: "Imported session history included entries that were only partially mapped.",
      },
    };
  });
}

function sourceRangesFromIssues(issues: readonly StewardIssue[], fallback?: SourceRange): SourceRange[] {
  const ranges = issues.flatMap((issue) => (issue.sourceRange ? [issue.sourceRange] : []));
  if (ranges.length > 0) {
    return ranges.map((range) => ({ ...range }));
  }

  return fallback ? [{ ...fallback }] : [];
}

async function finalizeThreadTurnState(input: {
  store: ThreadStore;
  thread: ThreadRecord;
  status: ThreadRecord["status"]["turnState"];
  turns?: TurnRecord[];
}): Promise<StewardResult<ThreadRecord>> {
  if (input.turns) {
    const writtenTurns = await input.store.writeTurns({
      threadId: input.thread.threadId,
      expectedSourceRevision: input.thread.sourceRevision,
      expectedMessageHighWatermark: input.thread.messageHighWatermark,
      turns: input.turns,
      turnState: input.status,
    });
    if (!writtenTurns.ok) {
      return writtenTurns;
    }
  }

  return input.store.updateThreadMetadata({
    threadId: input.thread.threadId,
    expectedSourceRevision: input.thread.sourceRevision,
    patch: {
      status: {
        turnState: input.status,
      },
    },
  });
}

function buildImportRecord(input: {
  importPlan: PiActivePathReadResult;
  importedAt: string;
  importedMessages: readonly MessageRecord[];
  status: ImportRecord["status"];
  issues: readonly StewardIssue[];
}): ImportRecord {
  return {
    importId: createImportId(),
    sourceRuntime: "pi",
    sourceSessionId: input.importPlan.sessionId,
    sourcePath: input.importPlan.sessionFilePath,
    activePathReference: input.importPlan.activePathReference,
    importedAt: input.importedAt,
    importedMessageCount: input.importedMessages.length,
    importedSourceRange: importedRange(input.importedMessages),
    status: input.status,
    issues: input.issues.length > 0 ? sortIssues(input.issues) : undefined,
  };
}

async function recordFailedImport(input: {
  store: ThreadStore;
  thread: ThreadRecord;
  importRecord: ImportRecord;
  expectedSourceRevision?: number;
}): Promise<void> {
  await input.store.updateThreadMetadata({
    threadId: input.thread.threadId,
    expectedSourceRevision: input.expectedSourceRevision ?? input.thread.sourceRevision,
    patch: {
      status: {
        turnState: "repair_needed",
      },
    },
  });
  await input.store.recordImport(input.thread.threadId, input.importRecord);
}

export async function previewPiSessionImport(
  input: Omit<AttachPiSessionInput, "store" | "target"> & {
    target?: AttachPiSessionInput["target"];
  },
): Promise<StewardResult<PreviewPiSessionImportResult>> {
  const activePath = await readPiActivePath({
    sessionFilePath: input.sessionFilePath,
    sessionId: input.target?.sessionId,
    activeLeafId: input.activeLeafId,
    sessionManager: input.sessionManager,
  });
  if (!activePath.ok) {
    return activePath;
  }

  return ok({
    sessionId: activePath.value.sessionId,
    sessionFilePath: activePath.value.sessionFilePath,
    activePathReference: activePath.value.activePathReference,
    importableMessages: activePath.value.entries.length,
    issues: sortIssues(activePath.value.issues),
  });
}

export async function attachExistingPiSession(
  input: AttachPiSessionInput,
): Promise<StewardResult<AttachPiSessionResult>> {
  const targetRef = importTargetFromInput(input);

  const existing = await input.store.findThreadByTarget({
    runtime: targetRef.runtime,
    sessionId: targetRef.sessionId,
    sessionFilePath: targetRef.sessionFilePath,
  });
  if (!existing.ok) {
    return existing;
  }

  if (existing.value) {
    return fail(importConflictIssue(targetRef, existing.value.threadId));
  }

  const importPlan = await readPiActivePath({
    sessionFilePath: input.sessionFilePath,
    sessionId: targetRef.sessionId,
    activeLeafId: input.activeLeafId,
    sessionManager: input.sessionManager,
  });
  if (!importPlan.ok) {
    return importPlan;
  }

  const target: ThreadRecord["target"] = {
    ...targetRef,
    sessionId: targetRef.sessionId ?? importPlan.value.sessionId,
    cwd: targetRef.cwd ?? importPlan.value.cwd,
  };
  const runtimeInput: AttachPiSessionInput = {
    ...input,
    target,
  };
  const createdAt = nowIso(input.now);
  const threadId = createThreadId();

  return withSerializedThreadOperation(threadId, async () => {
    const created = await input.store.createThread({
      thread: createThreadRecord({
        threadId,
        target,
        createdAt,
      }),
      targetRef: {
        runtime: target.runtime,
        sessionId: target.sessionId,
        sessionFilePath: target.sessionFilePath,
      },
    });
    if (!created.ok) {
      return created;
    }

    const importedMessages: MessageRecord[] = [];
    const structuralIssues = cloneIssues(importPlan.value.issues);
    const collectedIssues: StewardIssue[] = [];
    const runtimeContext = importRuntimeContext(runtimeInput, importPlan.value.sessionId);

    for (const entry of importPlan.value.entries) {
      const mapped = mapPiMessageEnd({
        message: entry.message,
        ctx: runtimeContext,
        imported: true,
        sessionEntryId: entry.sessionEntryId,
      });
      if (!mapped.ok) {
        const importRecord = buildImportRecord({
          importPlan: importPlan.value,
          importedAt: createdAt,
          importedMessages,
          status: "failed",
          issues: mergeIssues(
            decorateImportIssues({
              issues: structuralIssues,
              sourceRange: importedRange(importedMessages),
              threadId: created.value.threadId,
              sessionId: importPlan.value.sessionId,
            }),
            collectedIssues,
            mapped.issues,
          ),
        });
        await recordFailedImport({
          store: input.store,
          thread: created.value,
          importRecord,
          expectedSourceRevision: importedMessages.at(-1)?.sourceRevision,
        });
        return mapped;
      }

      const activity = {
        ...mapped.value,
        createdAt: mapped.value.createdAt ?? entry.timestamp,
      };

      const captured = await captureFinalizedActivityInCurrentThreadOperation({
        store: input.store,
        threadId: created.value.threadId,
        activity,
      });

      if (!captured.ok) {
        const importRecord = buildImportRecord({
          importPlan: importPlan.value,
          importedAt: createdAt,
          importedMessages,
          status: "failed",
          issues: mergeIssues(
            decorateImportIssues({
              issues: structuralIssues,
              sourceRange: importedRange(importedMessages),
              threadId: created.value.threadId,
              sessionId: importPlan.value.sessionId,
            }),
            collectedIssues,
            mapped.issues,
            captured.issues,
          ),
        });
        await recordFailedImport({
          store: input.store,
          thread: created.value,
          importRecord,
          expectedSourceRevision: importedMessages.at(-1)?.sourceRevision,
        });
        return captured;
      }

      importedMessages.push(structuredClone(captured.value.message));
      const messageRange = createSourceRange(captured.value.message.sourceOrder);
      collectedIssues.push(
        ...cloneIssues(mapped.issues).map((issue) => ({
          ...issue,
          threadId: created.value.threadId,
          targetRuntime: "pi" as const,
          targetSessionId: importPlan.value.sessionId,
          sourceRange: issue.sourceRange ?? messageRange,
        })),
        ...cloneIssues(captured.issues).map((issue) => ({
          ...issue,
          sourceRange: issue.sourceRange ?? messageRange,
        })),
      );
    }

    const snapshot = await input.store.openThread(created.value.threadId);
    if (!snapshot.ok) {
      const importRecord = buildImportRecord({
        importPlan: importPlan.value,
        importedAt: createdAt,
        importedMessages,
        status: "failed",
        issues: mergeIssues(
          decorateImportIssues({
            issues: structuralIssues,
            sourceRange: importedRange(importedMessages),
            threadId: created.value.threadId,
            sessionId: importPlan.value.sessionId,
          }),
          collectedIssues,
          snapshot.issues,
        ),
      });
      await recordFailedImport({
        store: input.store,
        thread: created.value,
        importRecord,
        expectedSourceRevision: importedMessages.at(-1)?.sourceRevision,
      });
      return snapshot;
    }

    const importStatus: ImportRecord["status"] =
      collectedIssues.length > 0 || structuralIssues.length > 0 ? "partial" : "complete";
    const importedSourceRange = importedRange(importedMessages);
    const importIssues = mergeIssues(
      decorateImportIssues({
        issues: structuralIssues,
        sourceRange: importedSourceRange,
        threadId: created.value.threadId,
        sessionId: importPlan.value.sessionId,
      }),
      collectedIssues,
    );

    if (importStatus === "partial") {
      if (snapshot.value.turns.length > 0) {
        const nextTurns = repairNeededTurns(
          snapshot.value.turns,
          sourceRangesFromIssues(importIssues, importedSourceRange),
          snapshot.value.thread.sourceRevision,
          createdAt,
        );
        const finalized = await finalizeThreadTurnState({
          store: input.store,
          thread: snapshot.value.thread,
          status: "repair_needed",
          turns: nextTurns,
        });
        if (!finalized.ok) {
          return finalized;
        }
      } else {
        const finalized = await finalizeThreadTurnState({
          store: input.store,
          thread: snapshot.value.thread,
          status: "repair_needed",
        });
        if (!finalized.ok) {
          return finalized;
        }
      }
    } else if (snapshot.value.thread.status.turnState !== "ready") {
      const finalized = await finalizeThreadTurnState({
        store: input.store,
        thread: snapshot.value.thread,
        status: "ready",
      });
      if (!finalized.ok) {
        return finalized;
      }
    }

    const importRecord = buildImportRecord({
      importPlan: importPlan.value,
      importedAt: createdAt,
      importedMessages,
      status: importStatus,
      issues: importIssues,
    });

    const recordedImport = await input.store.recordImport(created.value.threadId, importRecord);
    if (!recordedImport.ok) {
      return recordedImport;
    }

    const finalSnapshot = await input.store.openThread(created.value.threadId);
    if (!finalSnapshot.ok) {
      return finalSnapshot;
    }

    const baseHealth = checkTurnHealth(finalSnapshot.value);
    const health: TurnHealthReport =
      importStatus === "partial"
        ? {
            ...baseHealth,
            status: "repair_needed",
            issues: sortIssues(mergeIssues(baseHealth.issues, importRecord.issues)),
          }
        : baseHealth;

    return ok({
      thread: recordedImport.value,
      importedMessages: importedMessages.length,
      importedSourceRange,
      importRecord,
      health,
    }, importRecord.issues);
  });
}
