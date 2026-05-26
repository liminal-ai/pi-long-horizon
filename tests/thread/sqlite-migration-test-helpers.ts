import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { StewardResult } from "../../src/thread/domain/errors.js";
import type {
  ActorRecord,
  ImportRecord,
  MessageRecord,
  ProjectionRevisionRecord,
  ThreadRecord,
  TurnRecord,
} from "../../src/thread/domain/records.js";
import type { ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";

export interface CreateLegacyThreadFixtureInput {
  storeRootDir: string;
  thread: ThreadRecord;
  actors?: readonly ActorRecord[];
  messages?: readonly MessageRecord[];
  turns?: readonly TurnRecord[];
  chunks?: readonly ChunkState[];
  imports?: readonly ImportRecord[];
  projections?: readonly ProjectionRevisionRecord[];
  generatedFileContents?: Readonly<Record<string, string>>;
}

export function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

export function makePendingMessage(message: MessageRecord) {
  const {
    sourceOrder: _sourceOrder,
    sourceRevision: _sourceRevision,
    capturedAt: _capturedAt,
    ...pending
  } = message;

  return pending;
}

export async function createLegacyThreadFixture(input: CreateLegacyThreadFixtureInput): Promise<{
  fileStore: FileThreadStore;
  threadDir: string;
}> {
  const fileStore = new FileThreadStore(input.storeRootDir);
  const createdThread = expectOk(
    await fileStore.createThread({
      thread: input.thread,
      targetRef: {
        runtime: input.thread.target.runtime,
        sessionId: input.thread.target.sessionId,
        sessionFilePath: input.thread.target.sessionFilePath,
      },
    }),
  );

  const actorById = new Map<string, ActorRecord>();
  for (const actor of input.actors ?? []) {
    actorById.set(actor.actorId, structuredClone(actor));
    expectOk(await fileStore.upsertActor(createdThread.threadId, actor));
  }

  for (const message of input.messages ?? []) {
    const actor = actorById.get(message.actorId) ?? {
      actorId: message.actorId,
      actorType: message.actorType,
    };
    actorById.set(actor.actorId, structuredClone(actor));
    expectOk(
      await fileStore.appendMessage({
        threadId: createdThread.threadId,
        actor,
        message: makePendingMessage(message),
      }),
    );
  }

  let currentThread = expectOk(await fileStore.openThread(createdThread.threadId)).thread;
  if (input.turns) {
    expectOk(
      await fileStore.writeTurns({
        threadId: createdThread.threadId,
        expectedSourceRevision: currentThread.sourceRevision,
        expectedMessageHighWatermark: currentThread.messageHighWatermark,
        expectedTurnsRevision: currentThread.turnsRevision,
        turns: [...input.turns],
        turnState: input.thread.status.turnState,
      }),
    );
    currentThread = expectOk(await fileStore.openThread(createdThread.threadId)).thread;
  }

  if (input.chunks) {
    expectOk(
      await fileStore.writeChunks({
        threadId: createdThread.threadId,
        expectedSourceRevision: currentThread.sourceRevision,
        expectedMessageHighWatermark: currentThread.messageHighWatermark,
        expectedTurnsRevision: currentThread.turnsRevision,
        chunks: [...input.chunks],
      }),
    );
  }

  for (const record of input.imports ?? []) {
    expectOk(await fileStore.recordImport(createdThread.threadId, record));
  }

  if (input.projections) {
    for (const record of input.projections) {
      const content = input.generatedFileContents?.[record.generatedFilePath];
      if (content !== undefined) {
        await mkdir(dirname(record.generatedFilePath), { recursive: true });
        await writeFile(record.generatedFilePath, content, "utf8");
      }
    }

    await writeFile(
      join(input.storeRootDir, "threads", createdThread.threadId, "projections.json"),
      `${JSON.stringify(input.projections, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    fileStore,
    threadDir: join(input.storeRootDir, "threads", createdThread.threadId),
  };
}
