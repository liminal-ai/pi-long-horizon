import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fail, mergeIssues, ok, type StewardIssue, type StewardResult } from "../domain/errors.js";
import { createFixtureId, createSourceRange } from "../domain/ids.js";
import type { FixtureRecord, ImportRecord, TurnRepairStatus } from "../domain/records.js";
import { attachExistingPiSession, type AttachPiSessionInput } from "./import-service.js";
import { checkMaintenanceReadiness } from "./turn-service.js";
import { FileThreadStore } from "../store/file-thread-store.js";
import type { ThreadSnapshot, ThreadStore } from "../store/thread-store.js";

export interface CreateRealSessionFixtureInput {
  store: ThreadStore;
  source:
    | { type: "managed_thread"; threadId: string }
    | Pick<AttachPiSessionInput, "activeLeafId" | "sessionManager"> & {
        type: "pi_session";
        sessionFilePath: string;
        sessionId?: string;
      };
  fixtureName?: string;
  now?: () => Date;
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function cloneIssues(issues: readonly StewardIssue[] | undefined): StewardIssue[] {
  return (issues ?? []).map((issue) => ({
    ...issue,
    sourceRange: issue.sourceRange ? { ...issue.sourceRange } : undefined,
  }));
}

function latestImportRecord(snapshot: ThreadSnapshot): ImportRecord | undefined {
  return [...snapshot.imports]
    .sort((left, right) => left.importedAt.localeCompare(right.importedAt))
    .at(-1);
}

function snapshotSourceRange(snapshot: ThreadSnapshot) {
  const firstMessage = snapshot.messages[0];
  const lastMessage = snapshot.messages.at(-1);
  if (!firstMessage || !lastMessage) {
    return undefined;
  }

  return createSourceRange(firstMessage.sourceOrder, lastMessage.sourceOrder);
}

function fixtureRepairStatus(snapshot: ThreadSnapshot): TurnRepairStatus {
  const readiness = checkMaintenanceReadiness(snapshot);
  if (readiness.status === "ready") {
    return "ready";
  }

  if (
    snapshot.thread.status.turnState === "repair_failed" ||
    readiness.blockers.some((issue) => issue.code === "TURN_REPAIR_WRITE_FAILED")
  ) {
    return "repair_failed";
  }

  return "repair_needed";
}

function fixtureIssues(
  sourceType: FixtureRecord["sourceType"],
  snapshot: ThreadSnapshot,
): StewardIssue[] | undefined {
  const readiness = checkMaintenanceReadiness(snapshot);
  const issues =
    sourceType === "pi_session"
      ? mergeIssues(readiness.blockers, latestImportRecord(snapshot)?.issues)
      : mergeIssues(readiness.blockers);

  return issues.length > 0 ? cloneIssues(issues) : undefined;
}

function buildFixtureRecord(
  input: CreateRealSessionFixtureInput,
  snapshot: ThreadSnapshot,
  createdAt: string,
): FixtureRecord {
  const sourceRange = snapshotSourceRange(snapshot);
  const importRecord = latestImportRecord(snapshot);
  const issues = fixtureIssues(input.source.type, snapshot);

  return {
    fixtureId: createFixtureId(),
    fixtureName: input.fixtureName,
    sourceType: input.source.type,
    sourceThreadId: input.source.type === "managed_thread" ? input.source.threadId : undefined,
    sourceSessionId:
      input.source.type === "pi_session"
        ? input.source.sessionId ?? snapshot.thread.target.sessionId ?? importRecord?.sourceSessionId
        : undefined,
    sourcePath:
      input.source.type === "pi_session"
        ? input.source.sessionFilePath
        : undefined,
    sourceRange,
    createdAt,
    threadShape: "thread_shaped_data",
    importStatus: input.source.type === "pi_session" ? importRecord?.status : undefined,
    repairStatus: fixtureRepairStatus(snapshot),
    status: "available",
    issues,
  };
}

function stringifyIssues(issues: readonly StewardIssue[]): string {
  return issues
    .map((issue) => `${issue.code}: ${issue.message}${issue.cause ? ` (${issue.cause})` : ""}`)
    .join("; ");
}

function wrapFixtureFailure(
  input: CreateRealSessionFixtureInput,
  issues: readonly StewardIssue[],
): StewardResult<FixtureRecord> {
  const sourceLabel =
    input.source.type === "managed_thread"
      ? `managed thread ${input.source.threadId}`
      : `PI session ${input.source.sessionFilePath}`;

  return fail(
    {
      code: "FIXTURE_CREATE_FAILED",
      message: `Failed to create fixture from ${sourceLabel}.`,
      threadId: input.source.type === "managed_thread" ? input.source.threadId : undefined,
      targetRuntime: input.source.type === "pi_session" ? "pi" : undefined,
      targetSessionId: input.source.type === "pi_session" ? input.source.sessionId : undefined,
      cause: stringifyIssues(issues),
    },
    ...cloneIssues(issues),
  );
}

async function loadManagedThreadSnapshot(
  input: CreateRealSessionFixtureInput & {
    source: Extract<CreateRealSessionFixtureInput["source"], { type: "managed_thread" }>;
  },
): Promise<StewardResult<ThreadSnapshot>> {
  return input.store.openThread(input.source.threadId);
}

async function loadPiSessionSnapshot(
  input: CreateRealSessionFixtureInput & {
    source: Extract<CreateRealSessionFixtureInput["source"], { type: "pi_session" }>;
  },
): Promise<StewardResult<ThreadSnapshot>> {
  const tempProjectDir = await mkdtemp(join(tmpdir(), "context-steward-fixture-"));

  try {
    const tempStore = new FileThreadStore(join(tempProjectDir, ".context-steward"));
    const attached = await attachExistingPiSession({
      store: tempStore,
      target: {
        runtime: "pi",
        sessionId: input.source.sessionId,
        sessionFilePath: input.source.sessionFilePath,
      },
      sessionFilePath: input.source.sessionFilePath,
      activeLeafId: input.source.activeLeafId,
      sessionManager: input.source.sessionManager,
      now: input.now,
    });
    if (!attached.ok) {
      return attached;
    }

    const snapshot = await tempStore.openThread(attached.value.thread.threadId);
    return snapshot;
  } finally {
    await rm(tempProjectDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function loadFixtureSnapshot(input: CreateRealSessionFixtureInput): Promise<StewardResult<ThreadSnapshot>> {
  if (input.source.type === "managed_thread") {
    return loadManagedThreadSnapshot({
      ...input,
      source: input.source,
    });
  }

  return loadPiSessionSnapshot({
    ...input,
    source: input.source,
  });
}

export async function createRealSessionFixture(
  input: CreateRealSessionFixtureInput,
): Promise<StewardResult<FixtureRecord>> {
  const snapshot = await loadFixtureSnapshot(input);
  if (!snapshot.ok) {
    return wrapFixtureFailure(input, snapshot.issues);
  }

  const fixture = buildFixtureRecord(input, snapshot.value, nowIso(input.now));
  const created = await input.store.createFixture({
    fixture,
    snapshot: snapshot.value,
  });
  if (!created.ok) {
    return wrapFixtureFailure(input, created.issues);
  }

  return ok(created.value, created.issues);
}
