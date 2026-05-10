import {
  BAND_ORDER,
  cloneThreadViewMessageRecord,
  type BandType,
  type ThreadViewMessageRecord,
  type ThreadViewRecord,
} from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  mergeWorkbenchIssues,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type { ThreadViewStore } from "../store/thread-view-store.js";

export interface CompareThreadViewsInput {
  threadId: string;
  activeThreadViewId: string;
  draftThreadViewId: string;
  allowArchived?: boolean;
}

export interface CompareThreadViewsResult {
  bandDifferences: Array<{
    bandType: BandType;
    addedIds: string[];
    removedIds: string[];
  }>;
  emittedMessageDifferences: Array<{
    messageOrder: number;
    active?: ThreadViewMessageRecord;
    draft?: ThreadViewMessageRecord;
  }>;
}

function getBand(view: ThreadViewRecord, bandType: BandType) {
  switch (bandType) {
    case "full_fidelity":
      return view.fullFidelityBand;
    case "smooth":
      return view.smoothBand;
    case "detailed":
      return view.detailedBand;
    case "brief":
      return view.briefBand;
  }
}

function uniqueOrderedIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ordered.push(id);
  }

  return ordered;
}

function collectBandDifferences(activeView: ThreadViewRecord, draftView: ThreadViewRecord) {
  return BAND_ORDER.flatMap((bandType) => {
    const activeIds = uniqueOrderedIds(getBand(activeView, bandType).selectedIds);
    const draftIds = uniqueOrderedIds(getBand(draftView, bandType).selectedIds);
    const activeSet = new Set(activeIds);
    const draftSet = new Set(draftIds);
    const addedIds = draftIds.filter((id) => !activeSet.has(id));
    const removedIds = activeIds.filter((id) => !draftSet.has(id));

    if (addedIds.length === 0 && removedIds.length === 0) {
      return [];
    }

    return [{ bandType, addedIds, removedIds }];
  });
}

function areMessagesEquivalent(
  left: ThreadViewMessageRecord | undefined,
  right: ThreadViewMessageRecord | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify({
    bandType: left.bandType,
    sourceKind: left.sourceKind,
    sourceReference: left.sourceReference,
    content: left.content,
  }) === JSON.stringify({
    bandType: right.bandType,
    sourceKind: right.sourceKind,
    sourceReference: right.sourceReference,
    content: right.content,
  });
}

function collectEmittedMessageDifferences(activeView: ThreadViewRecord, draftView: ThreadViewRecord) {
  const activeMessages = activeView.emittedMessages;
  const draftMessages = draftView.emittedMessages;
  const maxLength = Math.max(activeMessages.length, draftMessages.length);
  const differences: CompareThreadViewsResult["emittedMessageDifferences"] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const active = activeMessages[index];
    const draft = draftMessages[index];
    if (areMessagesEquivalent(active, draft)) {
      continue;
    }

    differences.push({
      messageOrder: index + 1,
      active: active ? cloneThreadViewMessageRecord(active) : undefined,
      draft: draft ? cloneThreadViewMessageRecord(draft) : undefined,
    });
  }

  return differences;
}

export class ThreadViewCompareService {
  constructor(private readonly threadViewStore: ThreadViewStore) {}

  async compareThreadViews(
    input: CompareThreadViewsInput,
  ): Promise<WorkbenchResult<CompareThreadViewsResult>> {
    const openedActiveView = await this.threadViewStore.openThreadView(
      input.threadId,
      input.activeThreadViewId,
    );
    if (!openedActiveView.ok) {
      return failWorkbenchResult(...openedActiveView.issues);
    }

    const openedDraftView = await this.threadViewStore.openThreadView(
      input.threadId,
      input.draftThreadViewId,
    );
    if (!openedDraftView.ok) {
      return failWorkbenchResult(...openedDraftView.issues);
    }

    const activeView = openedActiveView.value.view;
    const draftView = openedDraftView.value.view;
    const allowArchived = input.allowArchived ?? false;

    if (!allowArchived && activeView.state === "archived") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${activeView.threadViewId} is archived and cannot be compared as the active view without explicit archived access.`,
          threadId: input.threadId,
        }),
      );
    }

    if (!allowArchived && draftView.state === "archived") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${draftView.threadViewId} is archived and cannot be compared as the draft view without explicit archived access.`,
          threadId: input.threadId,
        }),
      );
    }

    const issues = mergeWorkbenchIssues(openedActiveView.issues, openedDraftView.issues);
    if (activeView.state !== "active" && activeView.state !== "archived") {
      issues.push(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${activeView.threadViewId} is ${activeView.state}, not active.`,
          threadId: input.threadId,
        }),
      );
    }

    if (draftView.state !== "draft" && draftView.state !== "archived") {
      issues.push(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${draftView.threadViewId} is ${draftView.state}, not draft.`,
          threadId: input.threadId,
        }),
      );
    }

    if (draftView.emittedMessages.length === 0) {
      issues.push(
        createWorkbenchIssue({
          code: "THREAD_VIEW_MATERIALIZATION_REQUIRED",
          message: `Thread View ${draftView.threadViewId} does not have materialized emitted output yet.`,
          threadId: input.threadId,
        }),
      );
    }

    return okWorkbenchResult(
      {
        bandDifferences: collectBandDifferences(activeView, draftView),
        emittedMessageDifferences: collectEmittedMessageDifferences(activeView, draftView),
      },
      issues,
    );
  }
}
