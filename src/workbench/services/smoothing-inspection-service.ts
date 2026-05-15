import { StewardResultError } from "../../thread/domain/errors.js";
import type { MessageRecord, PartRecord, TurnRecord, TurnSmoothComponentRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import { materializeSmoothTurnFromState } from "../../thread/async-thread/services/smooth-turn-service.js";

export interface SmoothingInspectionReference {
  turnId: string;
  messageIds: string[];
  componentId?: string;
  kind?: TurnSmoothComponentRecord["kind"];
  status?: TurnSmoothComponentRecord["status"] | "missing";
  quality?: TurnSmoothComponentRecord["quality"];
  sourceRevision?: number;
  materializedSourceFingerprint?: string;
}

export interface SmoothingStageCounts {
  ready: number;
  pending: number;
  degraded: number;
  failed: number;
  missing: number;
}

export interface CompleteSmoothReadinessInspection extends SmoothingStageCounts {
  completeReadyCount: number;
  completeDegradedCount: number;
  completeUnavailableCount: number;
}

export interface SmoothingInspectionReport {
  threadId: string;
  turnCounts: {
    total: number;
    open: number;
    closed: number;
  };
  componentCounts: Record<string, number>;
  messageEndUserSmoothing: SmoothingStageCounts;
  closedTurnDeterministicComponents: SmoothingStageCounts;
  openTurnPendingCount: number;
  completeSmoothReadiness: CompleteSmoothReadinessInspection;
  degraded: SmoothingInspectionReference[];
  failed: SmoothingInspectionReference[];
  pending: SmoothingInspectionReference[];
}

export interface InspectSmoothingStatusInput {
  threadId: string;
}

export interface InspectSmoothingStatusDependencies {
  threadStore: ThreadStore;
}

function emptyStageCounts(): SmoothingStageCounts {
  return {
    ready: 0,
    pending: 0,
    degraded: 0,
    failed: 0,
    missing: 0,
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function bumpStage(counts: SmoothingStageCounts, status: TurnSmoothComponentRecord["status"] | "missing"): void {
  if (status === "ready" || status === "omitted") {
    counts.ready += 1;
    return;
  }
  if (status === "pending") {
    counts.pending += 1;
    return;
  }
  if (status === "degraded") {
    counts.degraded += 1;
    return;
  }
  if (status === "invalid" || status === "stale") {
    counts.failed += 1;
    return;
  }
  counts.missing += 1;
}

function reference(turn: TurnRecord, component?: TurnSmoothComponentRecord): SmoothingInspectionReference {
  return {
    turnId: turn.turnId,
    messageIds: [...turn.messageIds],
    componentId: component?.componentId,
    kind: component?.kind,
    status: component?.status ?? "missing",
    quality: component?.quality,
    sourceRevision: component?.sourceRevision,
    materializedSourceFingerprint: turn.smooth?.materialized?.sourceFingerprint,
  };
}

function contentObject(part: PartRecord): Record<string, unknown> {
  return typeof part.content === "object" && part.content !== null ? part.content : {};
}

function normalizePartText(part: PartRecord): string {
  if (typeof part.content === "string") {
    return part.content.replace(/\s+/g, " ").trim();
  }
  const content = contentObject(part);
  const text = typeof content.text === "string"
    ? content.text
    : typeof content.thinking === "string"
      ? content.thinking
      : "";
  return text.replace(/\s+/g, " ").trim();
}

function hasStructuredContent(part: PartRecord): boolean {
  return typeof part.content === "object" && part.content !== null && Object.keys(part.content).length > 0;
}

function classifyComponentKind(message: MessageRecord, part: PartRecord): TurnSmoothComponentRecord["kind"] {
  if (part.partType === "reasoning") {
    return "thinking";
  }
  if (
    part.partType === "tool_call" ||
    part.partType === "tool_result" ||
    message.messageKind === "tool_result" ||
    message.actorType === "tool"
  ) {
    return "tool_exchange";
  }
  if (message.actorType === "human" || message.messageKind === "prompt") {
    return "user_prompt";
  }
  return "assistant_message";
}

function expectedDeterministicKinds(
  turn: TurnRecord,
  messagesById: ReadonlyMap<string, MessageRecord>,
): Array<TurnSmoothComponentRecord["kind"]> {
  const kinds = new Set<TurnSmoothComponentRecord["kind"]>();
  for (const messageId of turn.messageIds) {
    const message = messagesById.get(messageId);
    if (!message || message.actorType === "human" || message.messageKind === "prompt") {
      continue;
    }
    for (const part of message.parts) {
      const kind = classifyComponentKind(message, part);
      if (kind === "user_prompt") {
        continue;
      }
      if (
        kind === "thinking" ||
        kind === "tool_exchange" ||
        normalizePartText(part).length > 0 ||
        (kind === "assistant_message" && hasStructuredContent(part))
      ) {
        kinds.add(kind);
      }
    }
  }
  return [...kinds].sort();
}

export async function inspectSmoothingStatus(
  input: InspectSmoothingStatusInput,
  dependencies: InspectSmoothingStatusDependencies,
): Promise<SmoothingInspectionReport> {
  const snapshotResult = await dependencies.threadStore.openThread(input.threadId);
  if (!snapshotResult.ok) {
    throw new StewardResultError(snapshotResult.issues);
  }

  const snapshot = snapshotResult.value;
  const componentCounts: Record<string, number> = {};
  const messageEndUserSmoothing = emptyStageCounts();
  const closedTurnDeterministicComponents = emptyStageCounts();
  const completeSmoothReadiness: CompleteSmoothReadinessInspection = {
    ...emptyStageCounts(),
    completeReadyCount: 0,
    completeDegradedCount: 0,
    completeUnavailableCount: 0,
  };
  const degraded: SmoothingInspectionReference[] = [];
  const failed: SmoothingInspectionReference[] = [];
  const pending: SmoothingInspectionReference[] = [];
  const messagesById = new Map(snapshot.messages.map((message) => [message.messageId, message]));
  let openTurnPendingCount = 0;

  for (const turn of snapshot.turns) {
    if (turn.lifecycleStatus === "open") {
      openTurnPendingCount += 1;
    }

    const components = turn.smooth?.components ?? [];
    for (const component of components) {
      increment(componentCounts, component.kind);
      increment(componentCounts, `${component.kind}:${component.status}`);
      if (component.quality) {
        increment(componentCounts, `quality:${component.quality}`);
      }

      if (component.status === "degraded") {
        degraded.push(reference(turn, component));
      } else if (component.status === "pending") {
        pending.push(reference(turn, component));
      } else if (component.status === "stale" || component.status === "invalid") {
        failed.push(reference(turn, component));
      }
    }

    const userPrompt = components.find((component) => component.kind === "user_prompt");
    bumpStage(messageEndUserSmoothing, userPrompt?.status ?? "missing");
    if (!userPrompt) {
      pending.push(reference(turn));
    }

    if (turn.lifecycleStatus === "closed") {
      for (const kind of expectedDeterministicKinds(turn, messagesById)) {
        const component = components.find((candidate) => candidate.kind === kind);
        bumpStage(closedTurnDeterministicComponents, component?.status ?? "missing");
        if (!component) {
          pending.push({ ...reference(turn), kind, status: "missing" });
        }
      }
    }

    const materialized = materializeSmoothTurnFromState({
      turn,
      messages: turn.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message) => message !== undefined),
    });
    if (materialized.status === "ready") {
      completeSmoothReadiness.ready += 1;
      completeSmoothReadiness.completeReadyCount += 1;
    } else if (materialized.status === "degraded") {
      completeSmoothReadiness.degraded += 1;
      completeSmoothReadiness.completeDegradedCount += 1;
    } else if (materialized.status === "pending") {
      completeSmoothReadiness.pending += 1;
      pending.push(reference(turn));
    } else if (materialized.status === "invalid" || materialized.status === "stale") {
      completeSmoothReadiness.failed += 1;
      completeSmoothReadiness.completeUnavailableCount += 1;
      failed.push(reference(turn));
    } else {
      completeSmoothReadiness.missing += 1;
      completeSmoothReadiness.completeUnavailableCount += 1;
    }
  }

  return {
    threadId: input.threadId,
    turnCounts: {
      total: snapshot.turns.length,
      open: snapshot.turns.filter((turn) => turn.lifecycleStatus === "open").length,
      closed: snapshot.turns.filter((turn) => turn.lifecycleStatus === "closed").length,
    },
    componentCounts,
    messageEndUserSmoothing,
    closedTurnDeterministicComponents,
    openTurnPendingCount,
    completeSmoothReadiness,
    degraded,
    failed,
    pending,
  };
}

export function formatSmoothingInspectionJson(report: SmoothingInspectionReport): string {
  return JSON.stringify(report, null, 2);
}
