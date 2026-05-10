import { checkMaintenanceReadiness } from "../../context-steward/services/turn-service.js";
import type { StewardIssue } from "../../context-steward/domain/errors.js";
import type { FixtureRecord, ThreadRecord } from "../../context-steward/domain/records.js";
import type { ThreadStore } from "../../context-steward/store/thread-store.js";
import {
  cloneThreadViewRecord,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  failWorkbenchResult,
  mergeWorkbenchIssues,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type { ThreadViewStore } from "../store/thread-view-store.js";

export interface OpenWorkbenchThreadInput {
  threadId: string;
}

export interface OpenFixtureThreadInput {
  fixtureId: string;
}

export interface OpenWorkbenchThreadResult {
  thread: ThreadRecord;
  threadViews: ThreadViewRecord[];
  activeThreadView?: ThreadViewRecord;
  usableStatus: "ready" | "blocked" | "degraded";
  blockers: StewardIssue[];
}

export interface OpenFixtureThreadResult extends OpenWorkbenchThreadResult {
  fixture: FixtureRecord;
}

function cloneThread(thread: ThreadRecord): ThreadRecord {
  return structuredClone(thread);
}

function resolveActiveThreadView(
  thread: ThreadRecord,
  threadViews: readonly ThreadViewRecord[],
): ThreadViewRecord | undefined {
  const pointedView = thread.activeThreadViewId
    ? threadViews.find((view) => view.threadViewId === thread.activeThreadViewId)
    : undefined;

  if (pointedView?.state === "active") {
    return cloneThreadViewRecord(pointedView);
  }

  const activeView = threadViews.find((view) => view.state === "active");
  return activeView ? cloneThreadViewRecord(activeView) : undefined;
}

function buildInspectionResult(
  thread: ThreadRecord,
  threadViews: readonly ThreadViewRecord[],
  blockers: readonly StewardIssue[] = [],
): OpenWorkbenchThreadResult {
  const activeThreadView = resolveActiveThreadView(thread, threadViews);
  const nextThreadViews = threadViews.map(cloneThreadViewRecord);
  const nextBlockers = mergeWorkbenchIssues(blockers);
  const usableStatus =
    nextBlockers.length > 0
      ? nextBlockers.every((issue) => issue.code === "THREAD_VIEW_STATE_CONFLICT")
        ? "degraded"
        : "blocked"
      : "ready";

  return {
    thread: cloneThread(thread),
    threadViews: nextThreadViews,
    activeThreadView,
    usableStatus,
    blockers: nextBlockers,
  };
}

export class WorkbenchQueryService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly threadViewStore: ThreadViewStore,
  ) {}

  async openThread(input: OpenWorkbenchThreadInput): Promise<WorkbenchResult<OpenWorkbenchThreadResult>> {
    const threadSnapshot = await this.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return failWorkbenchResult(...threadSnapshot.issues);
    }

    const listedViews = await this.threadViewStore.listThreadViews(input.threadId);
    if (!listedViews.ok) {
      return failWorkbenchResult(...listedViews.issues);
    }

    const refreshedThreadSnapshot =
      listedViews.issues && listedViews.issues.length > 0
        ? await this.threadStore.openThread(input.threadId)
        : threadSnapshot;
    if (!refreshedThreadSnapshot.ok) {
      return failWorkbenchResult(...refreshedThreadSnapshot.issues);
    }

    const readiness = checkMaintenanceReadiness(refreshedThreadSnapshot.value);

    return okWorkbenchResult(
      buildInspectionResult(
        refreshedThreadSnapshot.value.thread,
        listedViews.value,
        mergeWorkbenchIssues(listedViews.issues, readiness.blockers),
      ),
    );
  }

  async openFixtureThread(input: OpenFixtureThreadInput): Promise<WorkbenchResult<OpenFixtureThreadResult>> {
    const fixtureSnapshot = await this.threadStore.openFixture(input.fixtureId);
    if (!fixtureSnapshot.ok) {
      return failWorkbenchResult(...fixtureSnapshot.issues);
    }

    const readiness = checkMaintenanceReadiness(fixtureSnapshot.value.snapshot);
    const inspection = buildInspectionResult(
      fixtureSnapshot.value.snapshot.thread,
      [],
      readiness.blockers,
    );

    return okWorkbenchResult({
      ...inspection,
      fixture: structuredClone(fixtureSnapshot.value.fixture),
    });
  }
}
