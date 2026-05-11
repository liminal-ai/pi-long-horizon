import type { StewardResult } from "../domain/errors.js";
import type {
  ActorRecord,
  FixtureRecord,
  ImportRecord,
  MessageRecord,
  ProjectionRevisionRecord,
  SourceRange,
  ThreadRecord,
  ThreadTargetMetadata,
  TurnRecord,
} from "../domain/records.js";
import type { TargetSessionKey, TargetSessionKeySet, ThreadTargetRef } from "../domain/ids.js";
import type { ChunkState } from "../../thread/async-thread/domain/chunk-state.js";

export type { TargetSessionKey, TargetSessionKeySet, ThreadTargetRef } from "../domain/ids.js";

export interface CreateThreadInput {
  thread: ThreadRecord;
  targetRef: ThreadTargetRef;
}

export interface ThreadSnapshot {
  thread: ThreadRecord;
  actors: ActorRecord[];
  messages: MessageRecord[];
  turns: TurnRecord[];
  imports: ImportRecord[];
  projections: ProjectionRevisionRecord[];
}

export interface FixtureSnapshot {
  fixture: FixtureRecord;
  snapshot: ThreadSnapshot;
}

export interface AppendMessageInput {
  threadId: string;
  actor: ActorRecord;
  message: Omit<MessageRecord, "sourceOrder" | "sourceRevision" | "capturedAt"> & {
    capturedAt?: string;
  };
  targetEventKey?: string;
}

export interface UpdateThreadMetadataInput {
  threadId: string;
  expectedSourceRevision?: number;
  patch: Partial<Pick<ThreadRecord, "target" | "status" | "importSummary" | "projectionSummary" | "updatedAt">> & {
    activeThreadViewId?: string | null;
  };
}

export interface WriteTurnsInput {
  threadId: string;
  expectedSourceRevision: number;
  expectedMessageHighWatermark: number;
  expectedTurnsRevision: number;
  turns: TurnRecord[];
  turnState: ThreadRecord["status"]["turnState"];
}

export interface WriteChunksInput {
  threadId: string;
  expectedSourceRevision: number;
  expectedMessageHighWatermark: number;
  expectedTurnsRevision: number;
  chunks: ChunkState[];
}

export interface CreateFixtureInput {
  fixture: FixtureRecord;
  snapshot: ThreadSnapshot;
}

export interface ThreadStore {
  createThread(input: CreateThreadInput): Promise<StewardResult<ThreadRecord>>;
  openThread(threadId: string): Promise<StewardResult<ThreadSnapshot>>;
  openFixture(fixtureId: string): Promise<StewardResult<FixtureSnapshot>>;
  findThreadByTarget(target: ThreadTargetRef): Promise<StewardResult<ThreadRecord | undefined>>;
  findManagedThread(target: ThreadTargetMetadata): Promise<StewardResult<ThreadRecord | undefined>>;
  assertCanMutate(threadId: string): Promise<StewardResult<ThreadRecord>>;

  upsertActor(threadId: string, actor: ActorRecord): Promise<StewardResult<ActorRecord>>;
  listActors(threadId: string): Promise<StewardResult<ActorRecord[]>>;

  appendMessage(input: AppendMessageInput): Promise<StewardResult<MessageRecord>>;
  readMessages(threadId: string, range?: SourceRange): Promise<StewardResult<MessageRecord[]>>;

  readTurns(threadId: string): Promise<StewardResult<TurnRecord[]>>;
  writeTurns(input: WriteTurnsInput): Promise<StewardResult<TurnRecord[]>>;
  readChunks(threadId: string): Promise<StewardResult<ChunkState[]>>;
  writeChunks(input: WriteChunksInput): Promise<StewardResult<ChunkState[]>>;

  updateThreadMetadata(input: UpdateThreadMetadataInput): Promise<StewardResult<ThreadRecord>>;
  recordImport(threadId: string, record: ImportRecord): Promise<StewardResult<ThreadRecord>>;
  readProjectionRevisions(threadId: string): Promise<StewardResult<ProjectionRevisionRecord[]>>;
  writeProjectionRevision(record: ProjectionRevisionRecord): Promise<StewardResult<ProjectionRevisionRecord>>;

  createFixture(input: CreateFixtureInput): Promise<StewardResult<FixtureRecord>>;
}
