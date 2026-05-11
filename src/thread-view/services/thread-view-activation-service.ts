import type { ThreadViewRecord } from "../domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/thread-view-errors.js";
import type { ActivateThreadViewInput, ThreadViewStore } from "../store/thread-view-store.js";

export interface ActivateDraftThreadViewInput {
  threadId: string;
  draftThreadViewId: string;
  requireMaterializedOutput?: boolean;
  now?: () => Date;
}

export interface ActivateDraftThreadViewResult {
  active: ThreadViewRecord;
  archived: ThreadViewRecord;
}

export class ThreadViewActivationService {
  constructor(private readonly threadViewStore: ThreadViewStore) {}

  async activateDraftThreadView(
    input: ActivateDraftThreadViewInput,
  ): Promise<WorkbenchResult<ActivateDraftThreadViewResult>> {
    const openedDraftView = await this.threadViewStore.openThreadView(
      input.threadId,
      input.draftThreadViewId,
    );
    if (!openedDraftView.ok) {
      return failWorkbenchResult(...openedDraftView.issues);
    }

    const draftView = openedDraftView.value.view;
    if (draftView.state !== "draft") {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_STATE_CONFLICT",
          message: `Thread View ${input.draftThreadViewId} must be draft to activate, but is ${draftView.state}.`,
          threadId: input.threadId,
        }),
      );
    }

    const requireMaterializedOutput = input.requireMaterializedOutput ?? true;
    if (requireMaterializedOutput && draftView.emittedMessages.length === 0) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "THREAD_VIEW_MATERIALIZATION_REQUIRED",
          message: `Thread View ${input.draftThreadViewId} must be materialized before activation.`,
          threadId: input.threadId,
        }),
      );
    }

    const activationInput: ActivateThreadViewInput = {
      threadId: input.threadId,
      draftThreadViewId: input.draftThreadViewId,
      activatedAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    const activated = await this.threadViewStore.activateThreadView(activationInput);
    if (!activated.ok) {
      return failWorkbenchResult(...activated.issues);
    }

    return okWorkbenchResult(
      {
        active: activated.value.active,
        archived: activated.value.archived,
      },
      activated.issues,
    );
  }
}
