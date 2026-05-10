import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { ExtensionContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

import { createSourceRange } from "../domain/ids.js";
import {
  createStewardRootIndex,
  createThreadRecord,
  type ActorRecord,
  type FixtureRecord,
  type ImportRecord,
  type MessageKind,
  type MessageRecord,
  type PartRecord,
  type PiTargetMetadata,
  type ProjectionRevisionRecord,
  type SourceRange,
  type ThreadRecord,
  type ThreadTargetMetadata,
  type TurnRecord,
} from "../domain/records.js";

export const DEFAULT_TEST_TIMESTAMP = "2026-01-01T00:00:00.000Z";
export const DEFAULT_PI_MESSAGE_TIMESTAMP = Date.parse(DEFAULT_TEST_TIMESTAMP);
export const DEFAULT_PI_USAGE: Usage = {
  input: 128,
  output: 64,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 192,
  cost: {
    input: 0.00128,
    output: 0.00128,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.00256,
  },
};

export interface ThreadSnapshotFixture {
  thread: ThreadRecord;
  actors: ActorRecord[];
  messages: MessageRecord[];
  turns: TurnRecord[];
  imports: ImportRecord[];
  projections: ProjectionRevisionRecord[];
}

export interface CanonicalActivityFixture {
  actor: ActorRecord;
  messageKind: MessageKind;
  createdAt?: string;
  parts: PartRecord[];
  targetMetadata: PiTargetMetadata;
  targetEventKey?: string;
}

export type PiExtensionContextFixture = Pick<ExtensionContext, "cwd" | "sessionManager">;

export type PiTextContentBlockFixture = TextContent;
export type PiThinkingContentBlockFixture = ThinkingContent;
export type PiToolCallContentBlockFixture = ToolCall;
export type PiImageContentBlockFixture = ImageContent;
export type PiAssistantContentBlockFixture =
  | PiTextContentBlockFixture
  | PiThinkingContentBlockFixture
  | PiToolCallContentBlockFixture;
export type PiUserMessageFixture = UserMessage;
export type PiAssistantMessageFixture = AssistantMessage;
export type PiToolResultMessageFixture = ToolResultMessage;
export type PiMessageFixture = Message;
export interface PiSessionMessageEntryFixture extends Omit<SessionMessageEntry, "message"> {
  message: PiMessageFixture;
}

export interface MakePiSessionEntriesOptions {
  messages?: readonly PiMessageFixture[];
  branchFromIndex?: number;
  branchMessages?: readonly PiMessageFixture[];
  startedAt?: string;
}

export function makeThreadTarget(overrides: Partial<ThreadTargetMetadata> = {}): ThreadTargetMetadata {
  return {
    runtime: "pi",
    sessionId: "session-001",
    sessionFilePath: "/tmp/pi/session-001.jsonl",
    cwd: "/tmp/project",
    ...overrides,
  };
}

export function makePiTargetMetadata(overrides: Partial<PiTargetMetadata> = {}): PiTargetMetadata {
  return {
    runtime: "pi",
    sessionId: "session-001",
    sessionFilePath: "/tmp/pi/session-001.jsonl",
    sessionEntryId: "entry-001",
    targetEventKey: "pi:session-001:entry-001",
    piRole: "assistant",
    ...overrides,
  };
}

export function makeActorRecord(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    actorId: "actor-001",
    actorType: "agent",
    displayName: "Agent",
    ...overrides,
    targetMetadata: overrides.targetMetadata ? { ...overrides.targetMetadata } : undefined,
  };
}

export function makePartRecord(overrides: Partial<PartRecord> = {}): PartRecord {
  return {
    partId: "part-001",
    partOrder: 1,
    partType: "text",
    content: "hello world",
    ...overrides,
    targetMetadata: overrides.targetMetadata ? { ...overrides.targetMetadata } : undefined,
  };
}

export function makeMessageRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    messageId: "message-001",
    threadId: "thread-001",
    sourceOrder: 1,
    sourceRevision: 1,
    actorId: "actor-001",
    actorType: "agent",
    messageKind: "response",
    createdAt: DEFAULT_TEST_TIMESTAMP,
    capturedAt: DEFAULT_TEST_TIMESTAMP,
    parts: overrides.parts ? overrides.parts.map((part) => ({ ...part })) : [makePartRecord()],
    ...overrides,
    targetMetadata: overrides.targetMetadata ? { ...overrides.targetMetadata } : undefined,
  };
}

export function makeTurnRecord(overrides: Partial<TurnRecord> = {}): TurnRecord {
  const sourceRange = overrides.sourceRange ?? createSourceRange(1);
  const repairMetadata = overrides.repairMetadata
    ? {
        ...overrides.repairMetadata,
        sourceRange: overrides.repairMetadata.sourceRange
          ? { ...overrides.repairMetadata.sourceRange }
          : undefined,
      }
    : undefined;

  return {
    turnId: "turn-001",
    threadId: "thread-001",
    turnOrder: 1,
    lifecycleStatus: "open",
    repairStatus: "unknown",
    initiatingMessageId: "message-001",
    openedAt: DEFAULT_TEST_TIMESTAMP,
    sourceRevision: 1,
    ...overrides,
    repairMetadata,
    messageIds: overrides.messageIds ? [...overrides.messageIds] : ["message-001"],
    sourceRange: { ...sourceRange },
  };
}

export function makeImportRecord(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    importId: "import-001",
    sourceRuntime: "pi",
    sourceSessionId: "session-001",
    sourcePath: "/tmp/pi/session-001.jsonl",
    importedAt: DEFAULT_TEST_TIMESTAMP,
    importedMessageCount: 0,
    status: "complete",
    ...overrides,
    importedSourceRange: overrides.importedSourceRange ? { ...overrides.importedSourceRange } : undefined,
    issues: overrides.issues ? overrides.issues.map((issue) => ({ ...issue })) : undefined,
  };
}

export function makeProjectionRevisionRecord(
  overrides: Partial<ProjectionRevisionRecord> = {},
): ProjectionRevisionRecord {
  return {
    revisionId: "projection-001",
    threadId: "thread-001",
    targetRuntime: "pi",
    generatedFilePath: "/tmp/generated/session-001.jsonl",
    createdAt: DEFAULT_TEST_TIMESTAMP,
    status: "available",
    ...overrides,
  };
}

export function makeFixtureRecord(overrides: Partial<FixtureRecord> = {}): FixtureRecord {
  return {
    fixtureId: "fixture-001",
    fixtureName: "fixture-001",
    sourceType: "managed_thread",
    sourceThreadId: "thread-001",
    createdAt: DEFAULT_TEST_TIMESTAMP,
    threadShape: "thread_shaped_data",
    repairStatus: "unknown",
    status: "available",
    ...overrides,
    sourceRange: overrides.sourceRange ? { ...overrides.sourceRange } : undefined,
    issues: overrides.issues ? overrides.issues.map((issue) => ({ ...issue })) : undefined,
  };
}

export function makeThreadRecord(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  const target = makeThreadTarget(overrides.target);
  const baseRecord = createThreadRecord({
    threadId: overrides.threadId ?? "thread-001",
    target,
    createdAt: overrides.createdAt ?? DEFAULT_TEST_TIMESTAMP,
    updatedAt: overrides.updatedAt,
    sourceRevision: overrides.sourceRevision,
    messageHighWatermark: overrides.messageHighWatermark,
    importSummary: overrides.importSummary,
    projectionSummary: overrides.projectionSummary,
    status: overrides.status,
    indexes: overrides.indexes,
  });

  return {
    ...baseRecord,
    ...overrides,
    target,
    importSummary: {
      ...baseRecord.importSummary,
      ...overrides.importSummary,
    },
    projectionSummary: {
      ...baseRecord.projectionSummary,
      ...overrides.projectionSummary,
    },
    status: {
      ...baseRecord.status,
      ...overrides.status,
    },
    indexes: {
      targetEventKeys: {
        ...baseRecord.indexes.targetEventKeys,
        ...overrides.indexes?.targetEventKeys,
      },
    },
  };
}

export function makeThreadSnapshot(overrides: Partial<ThreadSnapshotFixture> = {}): ThreadSnapshotFixture {
  const thread = overrides.thread ? makeThreadRecord(overrides.thread) : makeThreadRecord();

  return {
    thread,
    actors: overrides.actors ? overrides.actors.map((actor) => makeActorRecord(actor)) : [],
    messages: overrides.messages ? overrides.messages.map((message) => makeMessageRecord(message)) : [],
    turns: overrides.turns ? overrides.turns.map((turn) => makeTurnRecord(turn)) : [],
    imports: overrides.imports ? overrides.imports.map((record) => makeImportRecord(record)) : [],
    projections: overrides.projections
      ? overrides.projections.map((record) => makeProjectionRevisionRecord(record))
      : [],
  };
}

export function makePiUserMessage(overrides: Partial<PiUserMessageFixture> = {}): PiUserMessageFixture {
  const content =
    overrides.content === undefined
      ? "Summarize the latest work."
      : Array.isArray(overrides.content)
        ? overrides.content.map((part) => ({ ...part }))
        : overrides.content;

  return {
    role: "user",
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
    ...overrides,
    content,
  };
}

export function makePiAssistantMessage(
  overrides: Partial<PiAssistantMessageFixture> = {},
): PiAssistantMessageFixture {
  const content: PiAssistantContentBlockFixture[] = overrides.content
    ? overrides.content.map((part) => ({ ...part }))
    : [{ type: "text", text: "Here is the latest summary." }];
  const usage = overrides.usage
    ? {
        ...overrides.usage,
        cost: { ...overrides.usage.cost },
      }
    : {
        ...DEFAULT_PI_USAGE,
        cost: { ...DEFAULT_PI_USAGE.cost },
      };

  return {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    stopReason: "stop",
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
    ...overrides,
    content,
    usage,
  };
}

export function makePiToolResultMessage(
  overrides: Partial<PiToolResultMessageFixture> = {},
): PiToolResultMessageFixture {
  const content: Array<PiTextContentBlockFixture | PiImageContentBlockFixture> = overrides.content
    ? overrides.content.map((part) => ({ ...part }))
    : [{ type: "text", text: "tool output" }];

  return {
    role: "toolResult",
    toolCallId: "call-001",
    toolName: "bash",
    isError: false,
    timestamp: DEFAULT_PI_MESSAGE_TIMESTAMP,
    ...overrides,
    content,
  };
}

export function makeRuntimeNoteActivity(
  overrides: Partial<CanonicalActivityFixture> = {},
): CanonicalActivityFixture {
  const parts = overrides.parts
    ? overrides.parts.map((part) => ({ ...part }))
    : [
        makePartRecord({
          partId: "part-runtime-001",
          partType: "runtime_note",
          content: {
            note: "session_start",
          },
        }),
      ];

  return {
    actor: makeActorRecord({
      actorId: "runtime-001",
      actorType: "runtime",
      displayName: "PI Runtime",
    }),
    messageKind: "runtime_event",
    createdAt: DEFAULT_TEST_TIMESTAMP,
    targetMetadata: makePiTargetMetadata({
      piRole: "assistant",
      rawType: "runtime_note",
    }),
    targetEventKey: "pi:session-001:runtime-note-001",
    ...overrides,
    parts,
  };
}

export function makePiExtensionContext(
  target: ThreadTargetMetadata = makeThreadTarget(),
): PiExtensionContextFixture {
  return {
    cwd: target.cwd ?? "/tmp/project",
    sessionManager: {
      getSessionId: () => target.sessionId ?? "session-001",
      getSessionFile: () => target.sessionFilePath,
    } as PiExtensionContextFixture["sessionManager"],
  };
}

export function makePiSessionEntries(options: MakePiSessionEntriesOptions = {}): PiSessionMessageEntryFixture[] {
  const messages = options.messages ?? [
    makePiUserMessage(),
    makePiAssistantMessage(),
    makePiToolResultMessage(),
  ];
  const branchMessages = options.branchMessages ?? [];
  const baseTimestamp = Date.parse(options.startedAt ?? DEFAULT_TEST_TIMESTAMP);

  const entries = messages.map<PiSessionMessageEntryFixture>((message, index) => ({
    type: "message",
    id: `entry-${String(index + 1).padStart(3, "0")}`,
    parentId: index === 0 ? null : `entry-${String(index).padStart(3, "0")}`,
    timestamp: new Date(baseTimestamp + index * 1_000).toISOString(),
    message,
  }));

  if (options.branchFromIndex === undefined || branchMessages.length === 0) {
    return entries;
  }

  const branchParent = entries[options.branchFromIndex];
  if (!branchParent) {
    throw new RangeError("branchFromIndex must point to an existing session entry.");
  }

  const branchedEntries = branchMessages.map<PiSessionMessageEntryFixture>((message, index) => ({
    type: "message",
    id: `branch-entry-${String(index + 1).padStart(3, "0")}`,
    parentId: index === 0 ? branchParent.id : `branch-entry-${String(index).padStart(3, "0")}`,
    timestamp: new Date(baseTimestamp + (entries.length + index) * 1_000).toISOString(),
    message,
  }));

  return [...entries, ...branchedEntries];
}

export function makeSourceRange(overrides: Partial<SourceRange> = {}): SourceRange {
  return createSourceRange(overrides.fromSourceOrder ?? 1, overrides.toSourceOrder ?? overrides.fromSourceOrder ?? 1);
}

export function makeRootIndex(threadByTargetKey: Record<string, string> = {}) {
  return createStewardRootIndex(threadByTargetKey);
}
