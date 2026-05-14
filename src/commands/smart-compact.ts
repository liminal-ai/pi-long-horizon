import { createThreadViewOutputRevisionId } from "../thread/domain/ids.js";
import { updateGeneratedThreadViewOutputMetadata } from "../thread/services/thread-service.js";
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
  PiThreadViewFile,
  SmartCompactCommandInput,
  SmartCompactCommandResult,
} from "../thread-view/domain/pi-thread-view-file.js";
import { validateSmartCompactCommandInput } from "../thread-view/domain/pi-thread-view-file.js";
import type { GeneratedOutputMetadata } from "../thread/domain/output-metadata.js";
import {
  evaluateTokenCountRecordForScope,
  OpenAIInputTokenCounter,
  type GeneratedSessionTokenCountRecord,
  type TokenCountSourceDecision,
} from "../token-accounting/index.js";

export interface SmartCompactCommandDependencies {
  threadStore: ThreadStore;
  threadViewStore: ThreadViewStore;
  mutationCoordinator?: ThreadMutationCoordinator;
  piCliHarnessAdapter?: PiCliHarnessAdapter;
  piSessionSwitch?: PiCliHarnessAdapterDependencies;
  piThreadViewWriterOptions?: PiThreadViewWriterOptions;
  openAIInputTokenCounter?: AsyncThreadRunDependencies["openAIInputTokenCounter"] &
    Pick<OpenAIInputTokenCounter, "countGeneratedSession">;
  asyncThreadDependencies?: Omit<AsyncThreadRunDependencies, "store">;
  now?: () => Date;
}

function buildThreadViewOutputRevisionStatus(
  compactStatus: SmartCompactCommandResult["compactStatus"],
): "available" | "failed" {
  return compactStatus === "success" || compactStatus === "degraded" ? "available" : "failed";
}

function buildBlockedSmartCompactResult(
  input: SmartCompactCommandInput,
  issues: Parameters<typeof createStewardIssue>[0][],
): SmartCompactCommandResult {
  return {
    threadId: input.threadId,
    requestedLowerBound: input.requestedLowerBound,
    requestedBandPercentages: input.requestedBandPercentages,
    compactStatus: "blocked",
    blockers: issues.map((issue) => createStewardIssue(issue)),
  };
}

function compactStatusFromBuildStatus(
  status: "ready" | "blocked" | "degraded",
): SmartCompactCommandResult["compactStatus"] {
  if (status === "ready") {
    return "success";
  }

  return status;
}

export function isOpenAIInputTokenCountProvider(provider: string | undefined): boolean {
  return provider === "openai" || provider === "openai-codex";
}

function buildGeneratedOutputMetadata(input: {
  threadId: string;
  projectionRevisionId?: string;
  threadViewId?: string;
  generatedSessionId?: string;
  generatedFilePath?: string;
  archivePath?: string;
  generatedAt: string;
  status: GeneratedOutputMetadata["status"];
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: string;
  placeholderExplicit: boolean;
  requestedLowerBound?: number;
  generatedSessionTokenCountMetadata?: GeneratedSessionTokenCountRecord;
  generatedSessionCountPolicy?: TokenCountSourceDecision;
  issues?: GeneratedOutputMetadata["issues"];
}): GeneratedOutputMetadata {
  return {
    threadId: input.threadId,
    projectionRevisionId: input.projectionRevisionId,
    threadViewId: input.threadViewId,
    generatedSessionId: input.generatedSessionId,
    generatedFilePath: input.generatedFilePath,
    archivePath: input.archivePath,
    generatedAt: input.generatedAt,
    status: input.status,
    generatedSource: "thread_view",
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    placeholderExplicit: input.placeholderExplicit,
    requestedLowerBound: input.requestedLowerBound,
    generatedSessionTokenCount: input.generatedSessionTokenCountMetadata?.count,
    generatedSessionTokenCountMetadata: input.generatedSessionTokenCountMetadata,
    generatedSessionCountPolicy: input.generatedSessionCountPolicy,
    issues: input.issues?.map((issue) => createStewardIssue(issue)),
  };
}

type FinalGeneratedSessionCountResult =
  | {
      ok: true;
      piFile: PiThreadViewFile;
      generatedSessionTokenCountMetadata: GeneratedSessionTokenCountRecord;
      generatedSessionCountPolicy: TokenCountSourceDecision;
      reductions: string[];
    }
  | {
      ok: false;
      piFile: PiThreadViewFile;
      generatedSessionTokenCountMetadata?: GeneratedSessionTokenCountRecord;
      generatedSessionCountPolicy?: TokenCountSourceDecision;
      reductions: string[];
      issues: Parameters<typeof createStewardIssue>[0][];
      outputStatus: "blocked" | "degraded";
    };

const REDUCIBLE_GENERATED_SOURCE_ORDER: PiThreadViewFile["entries"][number]["generatedSource"][] = [
  "brief_chunk_summary",
  "detailed_chunk_summary",
  "smooth_turn",
];

function removeReducibleEntry(piFile: PiThreadViewFile): { piFile: PiThreadViewFile; reduction: string } | undefined {
  for (const generatedSource of REDUCIBLE_GENERATED_SOURCE_ORDER) {
    const entryIndex = piFile.entries.findIndex((entry) => entry.generatedSource === generatedSource);

    if (entryIndex === -1) {
      continue;
    }

    const removedEntry = piFile.entries[entryIndex]!;
    const nextEntries = piFile.entries.filter((_, index) => index !== entryIndex);
    const reduction =
      `${removedEntry.generatedSource}:${removedEntry.metadata?.sourceReference ?? removedEntry.metadata?.threadViewMessageId ?? entryIndex}`;

    return {
      piFile: {
        ...piFile,
        entries: nextEntries,
        entryCount: nextEntries.length,
        placeholderExplicit: nextEntries.some(
          (entry) =>
            entry.generatedSource === "detailed_chunk_summary" ||
            entry.generatedSource === "brief_chunk_summary",
        ),
      },
      reduction,
    };
  }

  return undefined;
}

async function countFinalGeneratedSessionUntilUnderTarget(input: {
  threadId: string;
  requestedLowerBound: number;
  initialPiFile: PiThreadViewFile;
  openAIInputTokenCounter?: AsyncThreadRunDependencies["openAIInputTokenCounter"] &
    Pick<OpenAIInputTokenCounter, "countGeneratedSession">;
  threadViewId: string;
  sourceRevision: number;
  writeTimestamp: string;
}): Promise<FinalGeneratedSessionCountResult> {
  if (!input.openAIInputTokenCounter) {
    return {
      ok: false,
      piFile: input.initialPiFile,
      reductions: [],
      outputStatus: "blocked",
      issues: [
        {
          code: "TOKEN_COUNT_BLOCKED",
          message:
            "OpenAI provider_input_count is not configured; smart compact cannot write or reload without an exact generated-session count.",
          threadId: input.threadId,
        },
      ],
    };
  }

  let piFile = input.initialPiFile;
  const reductions: string[] = [];

  while (true) {
    let generatedSessionTokenCountMetadata: GeneratedSessionTokenCountRecord;
    try {
      generatedSessionTokenCountMetadata = await input.openAIInputTokenCounter.countGeneratedSession({
        input: {
          threadId: input.threadId,
          threadViewId: input.threadViewId,
          file: piFile,
        },
        model: isOpenAIInputTokenCountProvider(piFile.modelProvider) ? piFile.modelId : undefined,
        createdAt: input.writeTimestamp,
        sourceRevision: input.sourceRevision,
        now: () => new Date(input.writeTimestamp),
      });
    } catch (error) {
      const reductionSummary =
        reductions.length > 0
          ? ` after ${reductions.length} reduction attempts (${reductions.join(" -> ")})`
          : "";
      return {
        ok: false,
        piFile,
        reductions,
        outputStatus: "blocked",
        issues: [
          {
            code: "TOKEN_COUNT_BLOCKED",
            message:
              `OpenAI provider_input_count failed for the final generated-session representation${reductionSummary}; smart compact did not write or reload.`,
            threadId: input.threadId,
            cause: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    const generatedSessionCountPolicy = evaluateTokenCountRecordForScope({
      record: generatedSessionTokenCountMetadata,
      requestedScope: "generated_session",
      mode: "strict",
    });

    if (!generatedSessionCountPolicy.usableForSmartCompact) {
      return {
        ok: false,
        piFile,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
        reductions,
        outputStatus: "blocked",
        issues: [
          {
            code: "TOKEN_COUNT_BLOCKED",
            message: `Final generated-session token accounting was blocked by source policy: ${generatedSessionCountPolicy.reason}`,
            threadId: input.threadId,
          },
        ],
      };
    }

    if (generatedSessionTokenCountMetadata.count <= input.requestedLowerBound) {
      return {
        ok: true,
        piFile,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
        reductions,
      };
    }

    const reduction = removeReducibleEntry(piFile);
    if (!reduction) {
      return {
        ok: false,
        piFile,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
        reductions,
        outputStatus: "degraded",
        issues: [
          {
            code: "GENERATED_SESSION_OVER_LOWER_BOUND",
            message:
              `Final OpenAI provider_input_count ${generatedSessionTokenCountMetadata.count} exceeds requested lower bound ${input.requestedLowerBound}; ` +
              "all reducible older/lower-fidelity content has already been removed, so smart compact did not write or reload.",
            threadId: input.threadId,
          },
        ],
      };
    }

    reductions.push(reduction.reduction);
    piFile = reduction.piFile;
  }
}

export async function runSmartCompact(
  input: SmartCompactCommandInput,
  dependencies?: SmartCompactCommandDependencies,
): Promise<SmartCompactCommandResult> {
  const inputErrors = validateSmartCompactCommandInput(input);
  if (inputErrors.length > 0) {
    return buildBlockedSmartCompactResult(input, [
      {
        code: "INVALID_COMMAND_ARGS",
        message: `Invalid smart compact input: ${inputErrors.join(" ")}`,
        threadId: input.threadId,
      },
    ]);
  }

  if (!dependencies?.threadStore || !dependencies.threadViewStore) {
    return buildBlockedSmartCompactResult(input, [
      {
        code: "INVALID_COMMAND_ARGS",
        message: "runSmartCompact requires threadStore and threadViewStore dependencies.",
        threadId: input.threadId,
      },
    ]);
  }

  const threadSnapshotResult = await dependencies.threadStore.openThread(input.threadId);
  if (!threadSnapshotResult.ok) {
    return {
      threadId: input.threadId,
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: input.requestedBandPercentages,
      compactStatus: "blocked",
      blockers: threadSnapshotResult.issues,
    };
  }

  const mutationCoordinator =
    dependencies.mutationCoordinator ?? new FileThreadMutationCoordinator(dependencies.threadStore);
  const lease = await mutationCoordinator.acquireThreadLease({
    threadId: input.threadId,
    expectedSourceRevision: threadSnapshotResult.value.thread.sourceRevision,
  });
  const openAIInputTokenCounterForReadiness =
    dependencies.openAIInputTokenCounter ??
    dependencies.asyncThreadDependencies?.openAIInputTokenCounter ??
    (isOpenAIInputTokenCountProvider(input.modelProvider) && input.modelId
      ? new OpenAIInputTokenCounter(undefined, input.modelId)
      : undefined);
  const openAIInputTokenCounterForFinalCount =
    dependencies.openAIInputTokenCounter ??
    (isOpenAIInputTokenCountProvider(input.modelProvider) && input.modelId
      ? new OpenAIInputTokenCounter(undefined, input.modelId)
      : undefined);
  const tokenCountModel =
    dependencies.asyncThreadDependencies?.tokenCountModel ??
    (isOpenAIInputTokenCountProvider(input.modelProvider) ? input.modelId : undefined);

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
        openAIInputTokenCounter: openAIInputTokenCounterForReadiness,
        tokenCountModel,
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

    const projectionRevisionId = createThreadViewOutputRevisionId();
    const buildResult = await buildDraftThreadView(input, {
      threadStore: dependencies.threadStore,
      threadViewStore: dependencies.threadViewStore,
      now: dependencies.now,
      reuseExistingDraft: false,
    });
    const compactStatus = compactStatusFromBuildStatus(buildResult.status);
    const hasThresholdIssue = buildResult.blockers.some((issue) => issue.code === "LOWER_THRESHOLD_UNREACHED");
    if (compactStatus === "blocked" || hasThresholdIssue) {
      if (compactStatus === "degraded") {
        await updateGeneratedThreadViewOutputMetadata({
          store: dependencies.threadStore,
          threadId: input.threadId,
          generatedOutput: buildGeneratedOutputMetadata({
            threadId: input.threadId,
            projectionRevisionId,
            threadViewId: buildResult.draftThreadViewId,
            generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
            status: "degraded",
            placeholderExplicit:
              input.requestedBandPercentages.detailed > 0 || input.requestedBandPercentages.brief > 0,
            requestedLowerBound: input.requestedLowerBound,
            issues: buildResult.blockers,
          }),
          now: dependencies.now,
        });
      }

      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        projectionRevisionId,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus,
        blockers: buildResult.blockers,
        resultingTokenCount: buildResult.resultingTokenCount,
      };
    }
    const buildIssues = compactStatus === "degraded" ? buildResult.blockers : [];

    const threadViewSnapshot = await dependencies.threadViewStore.openThreadView(
      input.threadId,
      buildResult.draftThreadViewId,
    );
    if (!threadViewSnapshot.ok) {
      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus: "blocked",
        blockers: threadViewSnapshot.issues,
        resultingTokenCount: buildResult.resultingTokenCount,
      };
    }

    const threadSnapshot = await dependencies.threadStore.openThread(input.threadId);
    if (!threadSnapshot.ok) {
      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus: "blocked",
        blockers: threadSnapshot.issues,
        resultingTokenCount: buildResult.resultingTokenCount,
      };
    }

    const piFile = await buildPiThreadViewFile({
      threadId: input.threadId,
      threadViewId: buildResult.draftThreadViewId,
      emittedMessages: threadViewSnapshot.value.view.emittedMessages,
      sessionId: `sc-${input.threadId.replace("thread_", "").slice(0, 8)}-${projectionRevisionId.replace("projection_", "").slice(0, 8)}-${Date.now().toString(36)}`,
      cwd: threadSnapshot.value.thread.target.cwd ?? process.cwd(),
      parentSessionId: threadSnapshot.value.thread.target.sessionId,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      fileName: `${projectionRevisionId}-${buildResult.draftThreadViewId}.jsonl`,
    });
    const writeTimestamp = (
      dependencies.piThreadViewWriterOptions?.now ??
      dependencies.now ??
      (() => new Date())
    )().toISOString();
    const finalCountResult = await countFinalGeneratedSessionUntilUnderTarget({
      threadId: input.threadId,
      requestedLowerBound: input.requestedLowerBound,
      initialPiFile: piFile,
      openAIInputTokenCounter: openAIInputTokenCounterForFinalCount,
      threadViewId: buildResult.draftThreadViewId,
      sourceRevision: threadSnapshot.value.thread.sourceRevision,
      writeTimestamp,
    });

    if (!finalCountResult.ok) {
      const finalIssues = [...buildIssues, ...finalCountResult.issues.map((issue) => createStewardIssue(issue))];
      await updateGeneratedThreadViewOutputMetadata({
        store: dependencies.threadStore,
        threadId: input.threadId,
        generatedOutput: buildGeneratedOutputMetadata({
          threadId: input.threadId,
          projectionRevisionId,
          threadViewId: buildResult.draftThreadViewId,
          generatedAt: writeTimestamp,
          status: finalCountResult.outputStatus,
          placeholderExplicit: finalCountResult.piFile.placeholderExplicit,
          requestedLowerBound: input.requestedLowerBound,
          generatedSessionTokenCountMetadata: finalCountResult.generatedSessionTokenCountMetadata,
          generatedSessionCountPolicy: finalCountResult.generatedSessionCountPolicy,
          issues: finalIssues,
        }),
        now: dependencies.now,
      });

      return {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        projectionRevisionId,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus: finalCountResult.outputStatus,
        blockers: finalIssues,
        resultingTokenCount: buildResult.resultingTokenCount,
        generatedSessionTokenCount: finalCountResult.generatedSessionTokenCountMetadata?.count,
        generatedSessionTokenCountMetadata: finalCountResult.generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy: finalCountResult.generatedSessionCountPolicy,
      };
    }

    const countedPiFile = finalCountResult.piFile;
    const generatedSessionTokenCountMetadata = finalCountResult.generatedSessionTokenCountMetadata;
    const generatedSessionCountPolicy = finalCountResult.generatedSessionCountPolicy;

    let writeResult;
    try {
      writeResult = await writePiThreadViewFile(
        {
          threadId: input.threadId,
          threadViewId: buildResult.draftThreadViewId,
          file: countedPiFile,
        },
        {
          ...dependencies.piThreadViewWriterOptions,
          now: () => new Date(writeTimestamp),
        },
      );
    } catch (error) {
      const writeFailedResult: SmartCompactCommandResult = {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        projectionRevisionId,
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
        generatedSessionTokenCount: generatedSessionTokenCountMetadata.count,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
      };
      await updateGeneratedThreadViewOutputMetadata({
        store: dependencies.threadStore,
        threadId: input.threadId,
        generatedOutput: buildGeneratedOutputMetadata({
          threadId: input.threadId,
          projectionRevisionId,
          threadViewId: buildResult.draftThreadViewId,
          generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
          status: "write_failed",
          placeholderExplicit: countedPiFile.placeholderExplicit,
          requestedLowerBound: input.requestedLowerBound,
          generatedSessionTokenCountMetadata,
          generatedSessionCountPolicy,
          issues: writeFailedResult.blockers,
        }),
        now: dependencies.now,
      });

      return writeFailedResult;
    }

    const mappedGeneratedPiIdentities = await dependencies.threadStore.recordThreadIdMap({
      threadId: input.threadId,
      projectionRevisionId,
      target: {
        runtime: "pi",
        sessionId: countedPiFile.sessionId,
        sessionFilePath: writeResult.generatedFilePath,
      },
    });
    if (!mappedGeneratedPiIdentities.ok) {
      const blockedResult: SmartCompactCommandResult = {
        threadId: input.threadId,
        requestedLowerBound: input.requestedLowerBound,
        requestedBandPercentages: input.requestedBandPercentages,
        projectionRevisionId,
        threadViewId: buildResult.draftThreadViewId,
        compactStatus: "blocked",
        blockers: mappedGeneratedPiIdentities.issues,
        resultingTokenCount: buildResult.resultingTokenCount,
        generatedSessionTokenCount: generatedSessionTokenCountMetadata.count,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
      };
      await updateGeneratedThreadViewOutputMetadata({
        store: dependencies.threadStore,
        threadId: input.threadId,
        generatedOutput: buildGeneratedOutputMetadata({
          threadId: input.threadId,
          projectionRevisionId,
          threadViewId: buildResult.draftThreadViewId,
          generatedSessionId: countedPiFile.sessionId,
          generatedFilePath: writeResult.generatedFilePath,
          archivePath: writeResult.archivePath,
          generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
          status: "blocked",
          modelProvider: countedPiFile.modelProvider,
          modelId: countedPiFile.modelId,
          thinkingLevel: countedPiFile.thinkingLevel,
          placeholderExplicit: countedPiFile.placeholderExplicit,
          requestedLowerBound: input.requestedLowerBound,
          generatedSessionTokenCountMetadata,
          generatedSessionCountPolicy,
          issues: blockedResult.blockers,
        }),
        now: dependencies.now,
      });

      return blockedResult;
    }

    const piCliHarnessAdapter =
      dependencies.piCliHarnessAdapter ?? createPiCliHarnessAdapter(dependencies.piSessionSwitch);
    const loadResult = await piCliHarnessAdapter.loadThreadViewFile({
      threadId: input.threadId,
      threadViewId: buildResult.draftThreadViewId,
      filePath: writeResult.generatedFilePath,
    });
    const finalCompactStatus: SmartCompactCommandResult["compactStatus"] = loadResult.ok
      ? compactStatus
      : "reload_failed";
    const finalIssues = loadResult.ok ? buildIssues : [...loadResult.issues, ...buildIssues];

    await updateGeneratedThreadViewOutputMetadata({
      store: dependencies.threadStore,
      threadId: input.threadId,
      generatedFilePath: writeResult.generatedFilePath,
      generatedOutput: buildGeneratedOutputMetadata({
        threadId: input.threadId,
        projectionRevisionId,
        threadViewId: buildResult.draftThreadViewId,
        generatedSessionId: countedPiFile.sessionId,
        generatedFilePath: writeResult.generatedFilePath,
        archivePath: writeResult.archivePath,
        generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        status: finalCompactStatus === "success"
          ? "available"
          : finalCompactStatus === "degraded"
            ? "degraded"
            : "reload_failed",
        modelProvider: countedPiFile.modelProvider,
        modelId: countedPiFile.modelId,
        thinkingLevel: countedPiFile.thinkingLevel,
        placeholderExplicit: countedPiFile.placeholderExplicit,
        requestedLowerBound: input.requestedLowerBound,
        generatedSessionTokenCountMetadata,
        generatedSessionCountPolicy,
        issues: finalIssues,
      }),
      revision: {
        revisionId: projectionRevisionId,
        threadId: input.threadId,
        threadViewId: buildResult.draftThreadViewId,
        targetRuntime: "pi",
        generatedSessionId: countedPiFile.sessionId,
        generatedFilePath: writeResult.generatedFilePath,
        archivePath: writeResult.archivePath,
        createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        modelProvider: countedPiFile.modelProvider,
        modelId: countedPiFile.modelId,
        thinkingLevel: countedPiFile.thinkingLevel,
        sourceStateReference: threadViewSnapshot.value.view.sourceStateReference,
        status: buildThreadViewOutputRevisionStatus(finalCompactStatus),
      },
      now: dependencies.now,
    });

    return {
      threadId: input.threadId,
      requestedLowerBound: input.requestedLowerBound,
      requestedBandPercentages: input.requestedBandPercentages,
      projectionRevisionId,
      threadViewId: buildResult.draftThreadViewId,
      generatedFilePath: writeResult.generatedFilePath,
      archivePath: writeResult.archivePath,
      compactStatus: finalCompactStatus,
      blockers: finalIssues,
      resultingTokenCount: buildResult.resultingTokenCount,
      generatedSessionTokenCount: generatedSessionTokenCountMetadata.count,
      generatedSessionTokenCountMetadata,
      generatedSessionCountPolicy,
    };
  } finally {
    await lease.release();
  }
}
