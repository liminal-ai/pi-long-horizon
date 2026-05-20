import type { GeneratedOutputMetadata } from "../domain/output-metadata.js";
import { cloneGeneratedOutputMetadata } from "../domain/output-metadata.js";
import type { StewardErrorCode, StewardIssue } from "./errors.js";
import type { TokenCountRecord } from "../../token-accounting/token-count-metadata.js";

export const THREAD_SCHEMA_VERSION = "context-steward.thread.v1" as const;

export const TARGET_RUNTIMES = ["pi"] as const;
export const ACTOR_TYPES = ["human", "agent", "system", "tool", "runtime", "steward"] as const;
export const MESSAGE_KINDS = ["prompt", "response", "tool_result", "runtime_event", "unknown"] as const;
export const PART_TYPES = [
  "text",
  "reasoning",
  "tool_call",
  "tool_result",
  "runtime_note",
  "image_ref",
  "file_ref",
  "unknown",
] as const;
export const TURN_LIFECYCLE_STATUSES = ["open", "closed"] as const;
export const TURN_REPAIR_STATUSES = ["ready", "repair_needed", "repair_failed", "unknown"] as const;
export const TURN_LOWER_BAND_PROJECTION_STATUSES = ["ready", "pending", "failed", "invalid"] as const;
export const TOKEN_COUNTING_MAINTENANCE_STATUSES = ["ready", "repair_needed", "unknown"] as const;
export const IMPORT_STATUSES = ["complete", "partial", "failed"] as const;
export const PROJECTION_STATUSES = ["available", "stale", "failed", "unknown"] as const;
export const FIXTURE_SOURCE_TYPES = ["managed_thread", "pi_session"] as const;
export const FIXTURE_THREAD_SHAPES = ["thread_shaped_data"] as const;
export const FIXTURE_STATUSES = ["available", "failed"] as const;

export type TargetRuntime = (typeof TARGET_RUNTIMES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type PartType = (typeof PART_TYPES)[number];
export type TurnLifecycleStatus = (typeof TURN_LIFECYCLE_STATUSES)[number];
export type TurnRepairStatus = (typeof TURN_REPAIR_STATUSES)[number];
export type TurnLowerBandProjectionStatus = (typeof TURN_LOWER_BAND_PROJECTION_STATUSES)[number];
export type TokenCountingMaintenanceStatus = (typeof TOKEN_COUNTING_MAINTENANCE_STATUSES)[number];
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];
export type FixtureSourceType = (typeof FIXTURE_SOURCE_TYPES)[number];
export type FixtureThreadShape = (typeof FIXTURE_THREAD_SHAPES)[number];
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export interface SourceRange {
  fromSourceOrder: number;
  toSourceOrder: number;
}

export interface StewardRootIndex {
  schemaVersion: typeof THREAD_SCHEMA_VERSION;
  threadByTargetKey: Record<string, string>;
}

export interface ThreadRecord {
  threadId: string;
  schemaVersion: typeof THREAD_SCHEMA_VERSION;
  createdSchemaVersion: typeof THREAD_SCHEMA_VERSION;
  lastMigratedSchemaVersion: typeof THREAD_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  sourceRevision: number;
  messageHighWatermark: number;
  turnsRevision: number;
  activeThreadViewId?: string;
  target: ThreadTargetMetadata;
  importSummary: {
    count: number;
    lastImportedAt?: string;
    lastImportStatus?: ImportStatus;
  };
  threadViewOutputSummary: {
    count: number;
    currentProjectionRevisionId?: string;
    currentThreadViewId?: string;
    currentGeneratedSessionId?: string;
    currentGeneratedFilePath?: string;
    lastRevisionStatus?: ProjectionStatus;
    generatedOutput?: GeneratedOutputMetadata;
  };
  status: {
    turnState: TurnRepairStatus;
    tokenCounting?: TokenCountingMaintenanceRecord;
  };
  indexes: {
    targetEventKeys: Record<string, string>;
  };
}

export interface TokenCountingMaintenanceRecord {
  status: TokenCountingMaintenanceStatus;
  updatedAt: string;
  sourceRevision?: number;
  issueCount?: number;
  issues?: StewardIssue[];
}

export interface ThreadTargetMetadata {
  runtime: TargetRuntime;
  sessionId?: string;
  sessionFilePath?: string;
  cwd?: string;
  currentGeneratedFilePath?: string;
}

export interface ActorRecord {
  actorId: string;
  actorType: ActorType;
  displayName?: string;
  targetMetadata?: Record<string, unknown>;
}

export interface MessageRecord {
  messageId: string;
  threadId: string;
  sourceOrder: number;
  sourceRevision: number;
  actorId: string;
  actorType: ActorType;
  messageKind: MessageKind;
  createdAt?: string;
  capturedAt: string;
  parts: PartRecord[];
  targetMetadata?: PiTargetMetadata;
  tokenTelemetry?: MessageTokenTelemetryMetadata;
}

export interface PartRecord {
  partId: string;
  partOrder: number;
  partType: PartType;
  content: string | Record<string, unknown>;
  targetMetadata?: Record<string, unknown>;
}

export interface TurnRecord {
  turnId: string;
  threadId: string;
  turnOrder: number;
  lifecycleStatus: TurnLifecycleStatus;
  repairStatus: TurnRepairStatus;
  initiatingMessageId: string;
  messageIds: string[];
  sourceRange: SourceRange;
  openedAt?: string;
  closedAt?: string;
  sourceRevision: number;
  rawTokenCountMetadata?: TokenCountRecord;
  smooth?: TurnSmoothRecord;
  repairMetadata?: RepairMetadata;
}

export interface TurnSmoothRecord {
  schemaVersion?: "component_smooth_turn_v1";
  status?: "ready" | "missing" | "pending" | "degraded" | "stale" | "invalid";
  text?: string;
  tokenCountMetadata?: TokenCountRecord;
  strategy?: "deterministic_marker_sections_v1" | "component_smooth_turn_v1";
  generatedAt?: string;
  sourceRevision?: number;
  components?: TurnSmoothComponentRecord[];
  materialized?: TurnSmoothMaterializedRecord;
  lowerBandProjection?: TurnLowerBandProjectionRecord;
}

export interface TurnLowerBandProjectionRecord {
  status: TurnLowerBandProjectionStatus;
  text?: string;
  tokenCountMetadata?: TokenCountRecord;
  sourceFingerprint?: string;
  sourceRevision?: number;
  generatedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TurnSmoothComponentRecord {
  componentId: string;
  kind: "user_prompt" | "assistant_message" | "tool_exchange" | "thinking";
  status: "pending" | "ready" | "degraded" | "omitted" | "stale" | "invalid";
  text?: string;
  quality?: "model_smoothed" | "deterministic_preserved" | "deterministic_rendered" | "omitted_no_plaintext";
  sourceMessageIds: string[];
  sourcePartIds?: string[];
  sourceRevision: number;
  generatedAt?: string;
  strategy:
    | "gpt_5_4_mini_user_prompt_v1"
    | "deterministic_user_prompt_preserved_v1"
    | "deterministic_assistant_v1"
    | "deterministic_tool_exchange_v1"
    | "thinking_plaintext_or_omitted_v1";
  actorLabel?: string;
  providerMetadata?: {
    providerId?: string;
    modelId?: string;
    reasoningEffort?: string;
    promptVersion?: string;
    usage?: Record<string, unknown>;
    elapsedMs?: number;
  };
}

export interface TurnSmoothMaterializedRecord {
  sourceFingerprint?: string;
  tokenCountMetadata?: TokenCountRecord;
}

export interface RepairMetadata {
  repairedAt?: string;
  sourceRevisionChecked?: number;
  sourceRange?: SourceRange;
  failureCode?: StewardErrorCode;
  failureReason?: string;
}

export interface ImportRecord {
  importId: string;
  sourceRuntime: TargetRuntime;
  sourceSessionId?: string;
  sourcePath?: string;
  activePathReference?: string;
  importedAt: string;
  importedMessageCount: number;
  importedSourceRange?: SourceRange;
  status: ImportStatus;
  issues?: StewardIssue[];
}

export interface ProjectionRevisionRecord {
  revisionId: string;
  threadId: string;
  /**
   * Legacy rollout/view identity. This no longer points at active ThreadViewStore
   * state; it is retained as the generated rollout id embedded in PI files.
   */
  threadViewId?: string;
  targetRuntime: TargetRuntime;
  generatedSessionId?: string;
  generatedFilePath: string;
  archivePath?: string;
  createdAt: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: string;
  sourceStateReference?: string;
  compactSnapshot?: ProjectionCompactSnapshot;
  status: ProjectionStatus;
}

export type ProjectionBandType = "full_fidelity" | "smooth" | "detailed" | "brief";
export type ProjectionSourceUnitType = "turn" | "chunk";
export type ProjectionBandRenderedStatus = "ready" | "missing_artifacts" | "blocked" | "unknown";
export type ProjectionGeneratedSource =
  | "raw_turn_message"
  | "smooth_turn"
  | "detailed_chunk_summary"
  | "brief_chunk_summary";

export interface ProjectionBandSnapshot {
  bandType: ProjectionBandType;
  targetTokenBudget?: number;
  sourceUnitType: ProjectionSourceUnitType;
  selectedIds: string[];
  exclusions?: string[];
  renderedStatus: ProjectionBandRenderedStatus;
}

export interface ProjectionGeneratedEntrySnapshot {
  index: number;
  generatedSource: ProjectionGeneratedSource;
  role: "user" | "assistant" | "toolResult" | "custom";
  sourceReference?: string;
  threadViewMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProjectionCompactSnapshot {
  schemaVersion: "projection.compact-snapshot.v1";
  sourceStateReference?: string;
  requestedLowerBound?: number;
  requestedBandPercentages?: {
    fullFidelity: number;
    smooth: number;
    detailed: number;
    brief: number;
  };
  resultingTokenCount?: number;
  bands: Record<ProjectionBandType, ProjectionBandSnapshot>;
  generatedEntries: ProjectionGeneratedEntrySnapshot[];
}

export interface FixtureRecord {
  fixtureId: string;
  fixtureName?: string;
  sourceType: FixtureSourceType;
  sourceThreadId?: string;
  sourceSessionId?: string;
  sourcePath?: string;
  sourceRange?: SourceRange;
  createdAt: string;
  threadShape: FixtureThreadShape;
  importStatus?: ImportStatus;
  repairStatus: TurnRepairStatus;
  status: FixtureStatus;
  issues?: StewardIssue[];
}

export interface PiTargetMetadata {
  runtime: "pi";
  sessionId?: string;
  sessionFilePath?: string;
  sessionEntryId?: string;
  targetEventKey?: string;
  piRole?: "user" | "assistant" | "toolResult" | string;
  turnIndex?: number;
  toolCallId?: string;
  toolName?: string;
  provider?: string;
  api?: string;
  model?: string;
  responseId?: string;
  stopReason?: string;
  imported?: boolean;
  rawType?: string;
}

export interface MessageTokenTelemetryMetadata {
  providerUsage?: ProviderUsageTelemetryMetadata;
}

export interface ProviderUsageTelemetryMetadata {
  source: "pi_assistant_message_usage";
  provider: string;
  model: string;
  api?: string;
  responseId?: string;
  responseModel?: string;
  stopReason?: string;
  usage: Record<string, unknown>;
  tokenCountRecord?: TokenCountRecord;
  capturedAt: string;
}

export interface CreateThreadRecordInput {
  threadId: string;
  target: ThreadTargetMetadata;
  createdAt: string;
  updatedAt?: string;
  sourceRevision?: number;
  messageHighWatermark?: number;
  turnsRevision?: number;
  importSummary?: Partial<ThreadRecord["importSummary"]>;
  threadViewOutputSummary?: Partial<ThreadRecord["threadViewOutputSummary"]>;
  status?: Partial<ThreadRecord["status"]>;
  indexes?: Partial<ThreadRecord["indexes"]>;
}

export function createStewardRootIndex(
  threadByTargetKey: Record<string, string> = {},
): StewardRootIndex {
  return {
    schemaVersion: THREAD_SCHEMA_VERSION,
    threadByTargetKey: { ...threadByTargetKey },
  };
}

export function createThreadRecord(input: CreateThreadRecordInput): ThreadRecord {
  const updatedAt = input.updatedAt ?? input.createdAt;
  const importSummary: ThreadRecord["importSummary"] = {
    count: input.importSummary?.count ?? 0,
  };
  const threadViewOutputSummary: ThreadRecord["threadViewOutputSummary"] = {
    count: input.threadViewOutputSummary?.count ?? 0,
  };

  if (input.importSummary?.lastImportedAt) {
    importSummary.lastImportedAt = input.importSummary.lastImportedAt;
  }

  if (input.importSummary?.lastImportStatus) {
    importSummary.lastImportStatus = input.importSummary.lastImportStatus;
  }

  const currentGeneratedFilePath =
    input.threadViewOutputSummary?.currentGeneratedFilePath ?? input.target.currentGeneratedFilePath;
  if (input.threadViewOutputSummary?.currentProjectionRevisionId) {
    threadViewOutputSummary.currentProjectionRevisionId = input.threadViewOutputSummary.currentProjectionRevisionId;
  }

  if (input.threadViewOutputSummary?.currentThreadViewId) {
    threadViewOutputSummary.currentThreadViewId = input.threadViewOutputSummary.currentThreadViewId;
  }

  if (input.threadViewOutputSummary?.currentGeneratedSessionId) {
    threadViewOutputSummary.currentGeneratedSessionId = input.threadViewOutputSummary.currentGeneratedSessionId;
  }

  if (currentGeneratedFilePath) {
    threadViewOutputSummary.currentGeneratedFilePath = currentGeneratedFilePath;
  }

  if (input.threadViewOutputSummary?.lastRevisionStatus) {
    threadViewOutputSummary.lastRevisionStatus = input.threadViewOutputSummary.lastRevisionStatus;
  }

  if (input.threadViewOutputSummary?.generatedOutput) {
    threadViewOutputSummary.generatedOutput = cloneGeneratedOutputMetadata(input.threadViewOutputSummary.generatedOutput);
  }

  return {
    threadId: input.threadId,
    schemaVersion: THREAD_SCHEMA_VERSION,
    createdSchemaVersion: THREAD_SCHEMA_VERSION,
    lastMigratedSchemaVersion: THREAD_SCHEMA_VERSION,
    createdAt: input.createdAt,
    updatedAt,
    sourceRevision: input.sourceRevision ?? 0,
    messageHighWatermark: input.messageHighWatermark ?? 0,
    turnsRevision: input.turnsRevision ?? 0,
    target: { ...input.target },
    importSummary,
    threadViewOutputSummary,
    status: {
      turnState: input.status?.turnState ?? "unknown",
    },
    indexes: {
      targetEventKeys: { ...(input.indexes?.targetEventKeys ?? {}) },
    },
  };
}
