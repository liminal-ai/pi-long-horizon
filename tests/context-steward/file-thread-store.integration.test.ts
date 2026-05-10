import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import { createRealSessionFixture } from "../../src/context-steward/services/fixture-service.js";
import { openOrCreateManagedThread, updateGeneratedSessionMetadata } from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiSessionEntries,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n');
}

async function writePiSessionFile(input: {
  sessionFilePath: string;
  sessionId: string;
  cwd: string;
  entries: readonly SessionEntry[];
}): Promise<void> {
  await mkdir(dirname(input.sessionFilePath), { recursive: true });

  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.sessionId,
    timestamp: DEFAULT_TEST_TIMESTAMP,
    cwd: input.cwd,
  };

  const lines = [JSON.stringify(header), ...input.entries.map((entry) => JSON.stringify(entry))];
  await writeFile(input.sessionFilePath, `${lines.join("\n")}\n`, "utf8");
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const content = await readFile(filePath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function createSessionFixture(
  resolveProjectPath: (...segments: string[]) => string,
  options: {
    sessionId?: string;
    entries: readonly SessionEntry[];
    cwd?: string;
  },
) {
  const sessionId = options.sessionId ?? "session-integration-001";
  const cwd = options.cwd ?? resolveProjectPath("project");
  const sessionFilePath = resolveProjectPath("pi-sessions", `${sessionId}.jsonl`);

  await writePiSessionFile({
    sessionFilePath,
    sessionId,
    cwd,
    entries: options.entries,
  });

  return makeThreadTarget({
    sessionId,
    sessionFilePath,
    cwd,
  });
}

async function capturePiMessage(
  store: FileThreadStore,
  threadId: string,
  ctx: ReturnType<typeof makePiExtensionContext>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(
    mapPiMessageEnd({
      message,
      ctx,
    }),
  );

  return expectOk(
    await captureFinalizedActivity({
      store,
      threadId,
      activity,
    }),
  );
}

class FirstReadTurnsBlockingFileThreadStore extends FileThreadStore {
  private firstReadTurnsStarted = false;
  private secondReadTurnsStarted = false;
  private readonly firstReadTurnsStartedSignal = createDeferred<void>();
  private readonly releaseFirstReadTurnsSignal = createDeferred<void>();

  async waitForFirstReadTurns(): Promise<void> {
    await this.firstReadTurnsStartedSignal.promise;
  }

  releaseFirstReadTurns(): void {
    this.releaseFirstReadTurnsSignal.resolve();
  }

  async secondReadTurnsStartedWhileFirstBlocked(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.secondReadTurnsStarted) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return this.secondReadTurnsStarted;
  }

  override async readTurns(threadId: string) {
    if (!this.firstReadTurnsStarted) {
      this.firstReadTurnsStarted = true;
      this.firstReadTurnsStartedSignal.resolve();
      await this.releaseFirstReadTurnsSignal.promise;
    } else {
      this.secondReadTurnsStarted = true;
    }

    return super.readTurns(threadId);
  }
}

test("managed Thread survives process-style reopen", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-reopen-001",
      sessionFilePath: resolveProjectPath("pi", "session-reopen-001.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const ctx = makePiExtensionContext(target);
    await capturePiMessage(store, thread.threadId, ctx, makePiUserMessage({ content: "Persist this prompt across reopen." }));

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopenedThread = expectOk(await reopenedStore.findManagedThread(target));
    assert.ok(reopenedThread);

    const snapshot = expectOk(await reopenedStore.openThread(reopenedThread.threadId));
    assert.equal(reopenedThread.threadId, thread.threadId);
    assert.deepEqual(snapshot.messages.map((message) => message.messageKind), ["prompt"]);
    assert.equal(snapshot.turns.length, 1);
    assert.equal(snapshot.thread.messageHighWatermark, 1);
  });
});

test("PI session fixture imports through file path", async () => {
  await withTempThreadStore(async ({ storeRootDir, resolveProjectPath, resolveStorePath }) => {
    const store = new FileThreadStore(storeRootDir);
    const target = await createSessionFixture(resolveProjectPath, {
      entries: makePiSessionEntries(),
    });

    const fixture = expectOk(
      await createRealSessionFixture({
        store,
        source: {
          type: "pi_session",
          sessionFilePath: target.sessionFilePath!,
        },
      }),
    );

    const threadRecord = JSON.parse(
      await readFile(resolveStorePath("fixtures", fixture.fixtureId, "thread.json"), "utf8"),
    ) as { target: { sessionId?: string; sessionFilePath?: string } };
    const messages = await readJsonLines<{
      targetMetadata?: { sessionEntryId?: string };
    }>(resolveStorePath("fixtures", fixture.fixtureId, "messages.jsonl"));

    assert.equal(fixture.sourceType, "pi_session");
    assert.equal(fixture.sourcePath, target.sessionFilePath);
    assert.equal(fixture.importStatus, "complete");
    assert.equal(threadRecord.target.sessionId, target.sessionId);
    assert.equal(threadRecord.target.sessionFilePath, target.sessionFilePath);
    assert.deepEqual(
      messages.map((message) => message.targetMetadata?.sessionEntryId),
      ["entry-001", "entry-002", "entry-003"],
    );
  });
});

test("concurrent capture requests serialize by source order", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-concurrency-001",
      sessionFilePath: resolveProjectPath("pi", "session-concurrency-001.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FirstReadTurnsBlockingFileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    const ctx = makePiExtensionContext(target);
    const prompt = expectOk(
      mapPiMessageEnd({
        message: makePiUserMessage({ content: "Open the integration turn." }),
        ctx,
      }),
    );
    const response = expectOk(
      mapPiMessageEnd({
        message: makePiAssistantMessage({
          content: [{ type: "text", text: "Serialize this overlapping response." }],
        }),
        ctx,
      }),
    );

    const promptCapturePromise = captureFinalizedActivity({
      store,
      threadId: thread.threadId,
      activity: prompt,
    });
    await store.waitForFirstReadTurns();

    const responseCapturePromise = captureFinalizedActivity({
      store,
      threadId: thread.threadId,
      activity: response,
    });
    assert.equal(await store.secondReadTurnsStartedWhileFirstBlocked(50), false);

    store.releaseFirstReadTurns();

    const promptCaptured = expectOk(await promptCapturePromise);
    const responseCaptured = expectOk(await responseCapturePromise);
    const reopenedStore = new FileThreadStore(storeRootDir);
    const snapshot = expectOk(await reopenedStore.openThread(thread.threadId));

    assert.deepEqual(snapshot.messages.map((message) => message.sourceOrder), [1, 2]);
    assert.deepEqual(snapshot.turns.map((turn) => turn.messageIds), [
      [promptCaptured.message.messageId, responseCaptured.message.messageId],
    ]);
  });
});

test("stale temp metadata file does not replace the last committed snapshot", async () => {
  await withTempThreadStore(async ({ storeRootDir, projectDir, resolveProjectPath, resolveStorePath }) => {
    const target = makeThreadTarget({
      sessionId: "session-stale-temp-001",
      sessionFilePath: resolveProjectPath("pi", "session-stale-temp-001.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    expectOk(
      await updateGeneratedSessionMetadata({
        store,
        threadId: thread.threadId,
        generatedFilePath: "/tmp/generated/committed-session.jsonl",
      }),
    );

    const threadDir = resolveStorePath("threads", thread.threadId);
    const staleTempPath = join(threadDir, ".thread.json.stale.tmp");
    const staleThread = {
      ...expectOk(await store.openThread(thread.threadId)).thread,
      target: {
        ...thread.target,
        currentGeneratedFilePath: "/tmp/generated/stale-session.jsonl",
      },
    };
    await writeFile(staleTempPath, `${JSON.stringify(staleThread, null, 2)}\n`, "utf8");

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopened = expectOk(await reopenedStore.openThread(thread.threadId));
    const threadFiles = await readdir(threadDir);

    assert.equal(reopened.thread.target.currentGeneratedFilePath, "/tmp/generated/committed-session.jsonl");
    assert.equal(threadFiles.some((fileName) => fileName.endsWith(".tmp")), false);
  });
});
