import type { GeneratedOutputMetadata } from "../../thread/domain/output-metadata.js";
import { cloneGeneratedOutputMetadata } from "../../thread/domain/output-metadata.js";
import type { StewardErrorCode, StewardIssue } from "./errors.js";

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
  projectionSummary: {
    count: number;
    currentGeneratedFilePath?: string;
    lastRevisionStatus?: ProjectionStatus;
    generatedOutput?: GeneratedOutputMetadata;
  };
  status: {
    turnState: TurnRepairStatus;
  };
  indexes: {
    targetEventKeys: Record<string, string>;
  };
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
  smooth?: TurnSmoothRecord;
  repairMetadata?: RepairMetadata;
}

export interface TurnSmoothRecord {
  status?: "ready" | "missing" | "stale" | "invalid";
  text?: string;
  tokenCount?: number;
  strategy?: "deterministic_marker_sections_v1";
  generatedAt?: string;
  sourceRevision?: number;
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
  threadViewId?: string;
  targetRuntime: TargetRuntime;
  generatedFilePath: string;
  createdAt: string;
  sourceStateReference?: string;
  status: ProjectionStatus;
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

export interface CreateThreadRecordInput {
  threadId: string;
  target: ThreadTargetMetadata;
  createdAt: string;
  updatedAt?: string;
  sourceRevision?: number;
  messageHighWatermark?: number;
  turnsRevision?: number;
  importSummary?: Partial<ThreadRecord["importSummary"]>;
  projectionSummary?: Partial<ThreadRecord["projectionSummary"]>;
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
  const projectionSummary: ThreadRecord["projectionSummary"] = {
    count: input.projectionSummary?.count ?? 0,
  };

  if (input.importSummary?.lastImportedAt) {
    importSummary.lastImportedAt = input.importSummary.lastImportedAt;
  }

  if (input.importSummary?.lastImportStatus) {
    importSummary.lastImportStatus = input.importSummary.lastImportStatus;
  }

  const currentGeneratedFilePath =
    input.projectionSummary?.currentGeneratedFilePath ?? input.target.currentGeneratedFilePath;
  if (currentGeneratedFilePath) {
    projectionSummary.currentGeneratedFilePath = currentGeneratedFilePath;
  }

  if (input.projectionSummary?.lastRevisionStatus) {
    projectionSummary.lastRevisionStatus = input.projectionSummary.lastRevisionStatus;
  }

  if (input.projectionSummary?.generatedOutput) {
    projectionSummary.generatedOutput = cloneGeneratedOutputMetadata(input.projectionSummary.generatedOutput);
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
    projectionSummary,
    status: {
      turnState: input.status?.turnState ?? "unknown",
    },
    indexes: {
      targetEventKeys: { ...(input.indexes?.targetEventKeys ?? {}) },
    },
  };
}
