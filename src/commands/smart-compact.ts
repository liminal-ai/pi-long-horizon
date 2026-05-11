import {
  createProjectionRevisionId,
} from "../context-steward/domain/ids.js";
import { updateGeneratedSessionMetadata } from "../context-steward/services/thread-service.js";
import { createPiCliHarnessAdapter } from "../harness-adapter/pi-cli-ha/pi-cli-ha.js";
import type { PiCliHarnessAdapterDependencies } from "../harness-adapter/pi-cli-ha/pi-cli-ha.js";
import { prepareAsyncThread, type AsyncThreadRunDependencies } from "../thread/async-thread/services/async-thread-run-service.js";
import { FileThreadMutationCoordinator, type ThreadMutationCoordinator } from "../thread/store/mutation-coordinator.js";
import type { ThreadStore } from "../thread/store/thread-store.js";
import { createStewardIssue } from "../thread/domain/errors.js";
import { buildDraftThreadView } from "../thread-view/services/thread-view-builder.js";
import type { ThreadViewStore } from "../thread-view/store/thread-view-store.js";
import {
  buildPiThreadViewFile,
} from "../thread-view/targets/pi/pi-thread-view-builder.js";
import {
  writePiThreadViewFile,
  type PiThreadViewWriterOptions,
} from "../thread-view/targets/pi/pi-thread-view-writer.js";
import type {
  PiCliHarnessAdapter,
  SmartCompactCommandInput,
  SmartCompactCommandResult,
} from "../thread-view/domain/pi-thread-view-file.js";
import { validateSmartCompactCommandInput } from "../thread-view/domain/pi-thread-view-file.js";

export interface SmartCompactCommandDependencies {
  threadStore: ThreadStore;
  threadViewStore: ThreadViewStore;
  mutationCoordinator?: ThreadMutationCoordinator;
  piCliHarnessAdapter?: PiCliHarnessAdapter;
  piSessionSwitch?: PiCliHarnessAdapterDependencies;
  piThreadViewWriterOptions?: PiThreadViewWriterOptions;
  asyncThreadDependencies?: Omit<AsyncThreadRunDependencies, "store">;
  now?: () => Date;
}

function buildProjectionRevisionStatus(
  compactStatus: SmartCompactCommandResult["compactStatus"],
): "available" | "failed" {
  return compactStatus === "success" ? "available" : "failed";
}

function compactStatusFromBuildStatus(
  status: "ready" | "blocked" | "degraded",
): SmartCompactCommandResult["compactStatus"] {
  if (status === "ready") {
    return "success";
  }

  return status;
}

export async function runSmartCompact(
  input: SmartCompactCommandInput,
  dependencies?: SmartCompactCommandDependencies,
): Promise<SmartCompactCommandResult> {
  const inputErrors = validateSmartCompactCommandInput(input);
  if (inputErrors.length > 0) {
    throw new Error(`Invalid smart compact input: ${inputErrors.join(" ")}`);
  }

  if (!dependencies?.threadStore || !dependencies.threadViewStore) {
    throw new Error("runSmartCompact requires threadStore and threadViewStore dependencies.");
  }

  const threadSnapshotResult = await dependencies.threadStore.openThread(input.threadId);
  if (!threadSnapshotResult.ok) {
    throw new Error(threadSnapshotResult.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  const mutationCoordinator =
    dependencies.mutationCoordinator ?? new FileThreadMutationCoordinator(dependencies.threadStore);
  const lease = await mutationCoordinator.acquireThreadLease({
    threadId: input.threadId,
    expectedSourceRevision: threadSnapshotResult.value.thread.sourceRevision,
  });

  try {
    const readiness = await prepareAsyncThread(
      {
        threadId: input.threadId,
        mode: input.mode,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        requiredPlaceholderBands: {
          detailed: input.requestedBandPercentages.detailed > 0,
          brief: input.requestedBandPercentages.brief > 0,
        },
      },
      {
        store: dependencies.threadStore,
        now: dependencies.asyncThreadDependencies?.now ?? dependencies.now,
      },
    );

    if (readiness.blockers.length > 0) {
      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        compactStatus: "blocked",
        blockers: readiness.blockers,
      };
    }

    const buildResult = await buildDraftThreadView(input, {
      threadStore: dependencies.threadStore,
      threadViewStore: dependencies.threadViewStore,
      now: dependencies.now,
    });
    const compactStatus = compactStatusFromBuildStatus(buildResult.status);
    if (compactStatus !== "success") {
      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus,
        blockers: buildResult.blockers,
        resultingTokenCount: buildResult.resultingTokenCount,
      };
    }

    const threadViewSnapshot = await dependencies.threadViewStore.openThreadView(
      input.threadId,
      buildResult.draftThreadViewId,
    );
    if (!threadViewSnapshot.ok) {
      throw new Error(
        threadViewSnapshot.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
      );
    }

    const threadSnapshot = await dependencies.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      throw new Error(threadSnapshot.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    }

    const piFile = await buildPiThreadViewFile({
      threadId: input.threadId,
      threadViewId: buildResult.draftThreadViewId,
      emittedMessages: threadViewSnapshot.value.view.emittedMessages,
      sessionId: `${input.threadId}-${buildResult.draftThreadViewId}`,
      cwd: threadSnapshot.value.thread.target.cwd ?? process.cwd(),
      parentSessionId: threadSnapshot.value.thread.target.sessionId,
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });

    let writeResult;
    try {
      writeResult = await writePiThreadViewFile(
        {
          threadId: input.threadId,
          threadViewId: buildResult.draftThreadViewId,
          file: piFile,
        },
        dependencies.piThreadViewWriterOptions,
      );
    } catch (error) {
      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus: "write_failed",
        blockers: [
          createStewardIssue({
            code: "GENERATED_WRITE_FAILED",
            message: `Generated PI Thread View file could not be written for thread ${input.threadId}.`,
            threadId: input.threadId,
            cause: error instanceof Error ? error.message : String(error),
          }),
        ],
        resultingTokenCount: buildResult.resultingTokenCount,
      };
    }

    const piCliHarnessAdapter =
      dependencies.piCliHarnessAdapter ?? createPiCliHarnessAdapter(dependencies.piSessionSwitch);
    const loadResult = await piCliHarnessAdapter.loadThreadViewFile({
      threadId: input.threadId,
      threadViewId: buildResult.draftThreadViewId,
      filePath: writeResult.generatedFilePath,
    });
    const finalCompactStatus: SmartCompactCommandResult["compactStatus"] = loadResult.ok
      ? "success"
      : "reload_failed";

    await updateGeneratedSessionMetadata({
      store: dependencies.threadStore,
      threadId: input.threadId,
      generatedFilePath: writeResult.generatedFilePath,
      revision: {
        revisionId: createProjectionRevisionId(),
        threadId: input.threadId,
        threadViewId: buildResult.draftThreadViewId,
        targetRuntime: "pi",
        generatedFilePath: writeResult.generatedFilePath,
        createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        sourceStateReference: threadViewSnapshot.value.view.sourceStateReference,
        status: buildProjectionRevisionStatus(finalCompactStatus),
      },
      now: dependencies.now,
    });

    return {
      threadId: input.threadId,
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: input.requestedBandPercentages,
      threadViewId: buildResult.draftThreadViewId,
      generatedFilePath: writeResult.generatedFilePath,
      archivePath: writeResult.archivePath,
      compactStatus: finalCompactStatus,
      blockers: loadResult.ok ? [] : loadResult.issues,
      resultingTokenCount: buildResult.resultingTokenCount,
    };
  } finally {
    await lease.release();
  }
}
