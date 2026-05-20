import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type ExtensionAPI, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import registerContextStewardExtension from "../../src/context-steward/pi/pi-extension.js";
import { commandResultFromSmartCompact } from "../../src/context-steward/pi/pi-extension.js";
import { OpenAIInputTokenCounter } from "../../src/token-accounting/index.js";
import type { SmartCompactCommandResult } from "../../src/thread-view/domain/pi-thread-view-file.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import type { WriteTurnsInput } from "../../src/context-steward/store/thread-store.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeActorRecord,
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiSessionEntries,
  makePiUserMessage,
  makePartRecord,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import {
  makeBandRecord,
  makeThreadView,
  withTempFeature3Store,
} from "../../src/thread-view/test/fixtures.js";
import {
  seedDeterministicRebuildThread,
  seedMissingDetailedLowerBandArtifactThread,
} from "../thread-view/helpers.js";

const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens() {
    return 1;
  },
}, "gpt-test");
const fakeOverTargetOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens(request) {
    return request.input.length === 1 ? 1 : 1_500;
  },
}, "gpt-test");
const fakeBlockedPolicyCounter = Object.assign(
  new OpenAIInputTokenCounter({
    async countInputTokens() {
      return 1;
    },
  }, "gpt-test"),
  {
    async countGeneratedSession() {
      return {
        count: 100,
        scope: "generated_session",
        source: "pi_heuristic",
        trustClass: "heuristic_estimate",
        representationHash: "sha256:blocked-policy",
        createdAt: DEFAULT_TEST_TIMESTAMP,
      };
    },
  },
) as OpenAIInputTokenCounter;

interface RegisteredCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface RegisteredEvent {
  handler: (event: Record<string, unknown>, ctx: ExtensionCommandContext) => Promise<void>;
}

function createMockPiApi() {
  const commands = new Map<string, RegisteredCommand>();
  const events = new Map<string, RegisteredEvent>();

  const api = {
    on: (name: string, handler: RegisteredEvent["handler"]) => {
      events.set(name, { handler });
    },
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;

  return { api, commands, events };
}

function createCommandContext(
  target: ReturnType<typeof makeThreadTarget>,
  sessionManagerOverrides: Record<string, unknown> = {},
) {
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    cwd: target.cwd!,
    model: {
      provider: "openai-codex",
      id: "gpt-5.4-mini",
    },
    getThinkingLevel: () => "high",
    sessionManager: {
      getSessionId: () => target.sessionId ?? "",
      getSessionFile: () => target.sessionFilePath,
      ...sessionManagerOverrides,
    },
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionCommandContext;

  return { ctx, notifications };
}

function createSwitchingCommandContext(
  target: ReturnType<typeof makeThreadTarget>,
  sessionManagerOverrides: Record<string, unknown> = {},
) {
  const { ctx, notifications } = createCommandContext(target, sessionManagerOverrides);
  const replacementNotifications: Array<{ message: string; level: string }> = [];
  const switchedTo: string[] = [];

  const switchingContext = {
    ...ctx,
    switchSession: async (
      sessionPath: string,
      options?: {
        withSession?: (ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) => {
      switchedTo.push(sessionPath);
      await options?.withSession?.({
        ...ctx,
        sessionManager: {
          ...ctx.sessionManager,
          getSessionFile: () => sessionPath,
        },
        ui: {
          notify: (message: string, level: string) => {
            replacementNotifications.push({ message, level });
          },
        },
      } as unknown as ExtensionCommandContext);

      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext;

  return {
    ctx: switchingContext,
    notifications,
    replacementNotifications,
    switchedTo,
  };
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

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n');
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function capturePiMessage(
  store: FileThreadStore,
  threadId: string,
  target: ReturnType<typeof makeThreadTarget>,
  message: Parameters<typeof mapPiMessageEnd>[0]["message"],
) {
  const activity = expectOk(
    mapPiMessageEnd({
      message,
      ctx: makePiExtensionContext(target),
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

async function clearTurnState(store: FileThreadStore, threadId: string) {
  const snapshot = expectOk(await store.openThread(threadId));
  expectOk(
    await store.writeTurns({
      threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: [],
      turnState: "repair_needed",
    }),
  );
}

class StaleRepairStore extends FileThreadStore {
  private appendedDuringRepair = false;

  override async writeTurns(input: WriteTurnsInput) {
    if (!this.appendedDuringRepair) {
      this.appendedDuringRepair = true;
      const actor = makeActorRecord({
        actorId: "actor-stale-command-repair-001",
        actorType: "agent",
      });

      await this.appendMessage({
        threadId: input.threadId,
        actor,
        targetEventKey: "pi:session-001:stale-command-repair",
        message: {
          messageId: "message-stale-command-repair-001",
          threadId: input.threadId,
          actorId: actor.actorId,
          actorType: actor.actorType,
          messageKind: "response",
          createdAt: "2026-05-10T00:01:00.000Z",
          parts: [
            makePartRecord({
              partId: "part-stale-command-repair-001",
              partOrder: 1,
              partType: "text",
              content: "Response captured while repair was running.",
            }),
          ],
        },
      });
    }

    return super.writeTurns(input);
  }
}

async function seedCompactReportThread(storeRootDir: string) {
  const context = await seedDeterministicRebuildThread(storeRootDir);
  const olderThreadViewId = "thread-view-older";
  const newerThreadViewId = "thread-view-newer";

  const olderView = makeThreadView({
    threadId: context.threadId,
    threadViewId: olderThreadViewId,
    updatedAt: "2026-05-10T00:00:00.000Z",
    status: "ready",
    fullFidelityBand: makeBandRecord({
      bandType: "full_fidelity",
      selectedIds: [context.turns.oldest.turnId],
      renderedStatus: "ready",
    }),
  });
  const newerView = makeThreadView({
    threadId: context.threadId,
    threadViewId: newerThreadViewId,
    updatedAt: "2026-05-11T00:00:00.000Z",
    status: "ready",
    smoothBand: makeBandRecord({
      bandType: "smooth",
      selectedIds: [context.turns.middleOlder.turnId],
      renderedStatus: "ready",
    }),
  });

  expectOk(await context.threadStore.writeProjectionRevision({
    revisionId: "projection-older",
    threadId: context.threadId,
    threadViewId: olderThreadViewId,
    targetRuntime: "pi",
    generatedFilePath: "/tmp/older-generated.jsonl",
    createdAt: "2026-05-10T00:00:00.000Z",
    sourceStateReference: olderView.sourceStateReference,
    status: "available",
    compactSnapshot: {
      schemaVersion: "projection.compact-snapshot.v1",
      sourceStateReference: olderView.sourceStateReference,
      bands: {
        full_fidelity: olderView.fullFidelityBand,
        smooth: olderView.smoothBand,
        detailed: olderView.detailedBand,
        brief: olderView.briefBand,
      },
      generatedEntries: [],
    },
  }));
  expectOk(await context.threadStore.writeProjectionRevision({
    revisionId: "projection-newer",
    threadId: context.threadId,
    threadViewId: newerThreadViewId,
    targetRuntime: "pi",
    generatedFilePath: "/tmp/newer-generated.jsonl",
    createdAt: "2026-05-11T00:00:00.000Z",
    sourceStateReference: newerView.sourceStateReference,
    status: "available",
    compactSnapshot: {
      schemaVersion: "projection.compact-snapshot.v1",
      sourceStateReference: newerView.sourceStateReference,
      bands: {
        full_fidelity: newerView.fullFidelityBand,
        smooth: newerView.smoothBand,
        detailed: newerView.detailedBand,
        brief: newerView.briefBand,
      },
      generatedEntries: [],
    },
  }));

  const snapshot = expectOk(await context.threadStore.openThread(context.threadId));
  expectOk(
    await context.threadStore.updateThreadMetadata({
      threadId: context.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      patch: {
        threadViewOutputSummary: {
          count: 1,
          currentGeneratedFilePath: "/tmp/newer-generated.jsonl",
          lastRevisionStatus: "available",
          generatedOutput: {
            threadId: context.threadId,
            threadViewId: newerThreadViewId,
            generatedFilePath: "/tmp/newer-generated.jsonl",
            archivePath: "/tmp/newer-archive.jsonl",
            status: "available",
            generatedSource: "thread_view",
            placeholderExplicit: true,
          },
        },
      },
    }),
  );

  return {
    ...context,
    olderThreadViewId,
    newerThreadViewId,
  };
}

test("/lh-fixture renders created fixture id and failure code", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const target = makeThreadTarget({
      cwd: projectDir,
      sessionFilePath: `${projectDir}/pi/session-001.jsonl`,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = await openOrCreateManagedThread({ target }, store);
    assert.equal(thread.ok, true);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api);

    const fixtureCommand = commands.get("lh-fixture");
    assert.ok(fixtureCommand);

    const successContext = createCommandContext(target);
    await fixtureCommand!.handler("managed-thread", successContext.ctx);
    assert.equal(successContext.notifications.length, 1);
    assert.equal(successContext.notifications[0]!.level, "info");
    assert.match(
      successContext.notifications[0]!.message,
      new RegExp(`^Fixture created: Created fixture fixture_[^ ]+ from thread ${thread.value!.threadId}\\.$`),
    );

    const failureTarget = makeThreadTarget({
      cwd: projectDir,
      sessionId: "session-empty",
      sessionFilePath: `${projectDir}/pi/session-empty.jsonl`,
    });
    await ensureTargetSessionFile(failureTarget);
    const failureContext = createCommandContext(failureTarget);
    await fixtureCommand!.handler("managed-thread", failureContext.ctx);

    assert.equal(failureContext.notifications.length, 1);
    assert.equal(failureContext.notifications[0]!.level, "error");
    assert.equal(
      failureContext.notifications[0]!.message,
      "Fixture failed: No managed thread exists for the current PI session. [FIXTURE_CREATE_FAILED]",
    );
  });
});

test("session_start switches an older resumed PI session to the latest generated rollout for the same thread", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const baseSessionFile = `${projectDir}/pi/base-session.jsonl`;
    const oldGeneratedSessionFile = `${projectDir}/.context-steward/threads/thread-resume/generated/old.jsonl`;
    const generatedSessionFile = `${projectDir}/.context-steward/threads/thread-resume/generated/latest.jsonl`;
    const target = makeThreadTarget({
      sessionId: "session-base",
      sessionFilePath: baseSessionFile,
      cwd: projectDir,
    });

    await writePiSessionFile({
      sessionFilePath: baseSessionFile,
      sessionId: "session-base",
      cwd: projectDir,
      entries: [],
    });
    await writePiSessionFile({
      sessionFilePath: oldGeneratedSessionFile,
      sessionId: "session-generated-old",
      cwd: projectDir,
      entries: [],
    });
    await writePiSessionFile({
      sessionFilePath: generatedSessionFile,
      sessionId: "session-generated-latest",
      cwd: projectDir,
      entries: [],
    });

    const store = new FileThreadStore(storeRootDir);
    const opened = await openOrCreateManagedThread({ target }, store);
    assert.equal(opened.ok, true);
    const thread = opened.value!;
    const snapshot = await store.openThread(thread.threadId);
    assert.equal(snapshot.ok, true);

    assert.equal(
      (
        await store.writeProjectionRevision({
          revisionId: "projection-old",
          threadId: thread.threadId,
          threadViewId: "thread-view-old",
          targetRuntime: "pi",
          generatedSessionId: "session-generated-old",
          generatedFilePath: oldGeneratedSessionFile,
          createdAt: "2026-05-10T00:00:00.000Z",
          modelProvider: "openai-codex",
          modelId: "gpt-5.4",
          thinkingLevel: "high",
          status: "available",
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await store.updateThreadMetadata({
          threadId: thread.threadId,
          expectedSourceRevision: snapshot.value.thread.sourceRevision,
          patch: {
            target: {
              ...snapshot.value.thread.target,
              currentGeneratedFilePath: generatedSessionFile,
            },
            threadViewOutputSummary: {
              count: 1,
              currentProjectionRevisionId: "projection-latest",
              currentThreadViewId: "thread-view-latest",
              currentGeneratedSessionId: "session-generated-latest",
              currentGeneratedFilePath: generatedSessionFile,
              lastRevisionStatus: "available",
              generatedOutput: {
                threadId: thread.threadId,
                projectionRevisionId: "projection-latest",
                threadViewId: "thread-view-latest",
                generatedSessionId: "session-generated-latest",
                generatedFilePath: generatedSessionFile,
                generatedAt: "2026-05-11T00:00:00.000Z",
                status: "available",
                generatedSource: "thread_view",
                modelProvider: "openai-codex",
                modelId: "gpt-5.5",
                thinkingLevel: "low",
                placeholderExplicit: false,
              },
            },
          },
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await store.writeProjectionRevision({
          revisionId: "projection-latest",
          threadId: thread.threadId,
          threadViewId: "thread-view-latest",
          targetRuntime: "pi",
          generatedSessionId: "session-generated-latest",
          generatedFilePath: generatedSessionFile,
          createdAt: "2026-05-11T00:00:00.000Z",
          modelProvider: "openai-codex",
          modelId: "gpt-5.5",
          thinkingLevel: "low",
          status: "available",
        })
      ).ok,
      true,
    );

    const { api, events } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });
    const sessionStart = events.get("session_start");
    assert.ok(sessionStart);

    const olderGeneratedTarget = makeThreadTarget({
      sessionId: "session-generated-old",
      sessionFilePath: oldGeneratedSessionFile,
      cwd: projectDir,
    });
    const { ctx, switchedTo } = createSwitchingCommandContext(olderGeneratedTarget);
    await sessionStart!.handler({ type: "session_start", reason: "resume" }, ctx);

    assert.deepEqual(switchedTo, [generatedSessionFile]);
  });
});

test("/lh-fixture pi-session imports the active branch from the live session manager", async () => {
  await withTempThreadStore(async ({ projectDir, resolveProjectPath, resolveStorePath }) => {
    const sessionId = "session-command-branch";
    const sessionFilePath = resolveProjectPath("pi", `${sessionId}.jsonl`);
    const entries = makePiSessionEntries({
      messages: [
        makePiUserMessage({ content: "Root command prompt" }),
        makePiAssistantMessage({ content: [{ type: "text", text: "Main branch response" }] }),
      ],
      branchFromIndex: 0,
      branchMessages: [
        makePiAssistantMessage({ content: [{ type: "text", text: "Active branch response" }] }),
        makePiUserMessage({ content: "Active branch follow-up" }),
      ],
    });
    const activeLeafId = entries.at(-1)!.id;
    const activeBranch = [entries[0]!, entries[2]!, entries[3]!];
    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api);

    const fixtureCommand = commands.get("lh-fixture");
    assert.ok(fixtureCommand);

    const { ctx, notifications } = createCommandContext(target, {
      getBranch: () => activeBranch,
      getCwd: () => projectDir,
      getEntries: () => entries,
      getLeafId: () => activeLeafId,
    });
    await fixtureCommand!.handler("pi-session", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");

    const fixtureIds = await readdir(resolveStorePath("fixtures"));
    assert.equal(fixtureIds.length, 1);
    const messages = (await readFile(resolveStorePath("fixtures", fixtureIds[0]!, "messages.jsonl"), "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as {
        targetMetadata?: { sessionEntryId?: string };
        parts: Array<{ content: unknown }>;
      });
    const threadRecord = JSON.parse(
      await readFile(resolveStorePath("fixtures", fixtureIds[0]!, "thread.json"), "utf8"),
    ) as { target: { cwd?: string } };

    assert.deepEqual(
      messages.map((message) => message.targetMetadata?.sessionEntryId),
      ["entry-001", "branch-entry-001", "branch-entry-002"],
    );
    assert.equal(
      messages.some((message) => message.parts.some((part) => part.content === "Main branch response")),
      false,
    );
    assert.equal(threadRecord.target.cwd, projectDir);
  });
});

test("/lh-attach imports the active branch from the live session manager", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const sessionId = "session-command-attach-branch";
    const sessionFilePath = resolveProjectPath("pi", `${sessionId}.jsonl`);
    const entries = makePiSessionEntries({
      messages: [
        makePiUserMessage({ content: "Root attach prompt" }),
        makePiAssistantMessage({ content: [{ type: "text", text: "Main branch attach response" }] }),
      ],
      branchFromIndex: 0,
      branchMessages: [
        makePiAssistantMessage({ content: [{ type: "text", text: "Active attach branch response" }] }),
        makePiUserMessage({ content: "Active attach branch follow-up" }),
      ],
    });
    const activeLeafId = entries.at(-1)!.id;
    const activeBranch = [entries[0]!, entries[2]!, entries[3]!];
    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries,
    });

    const store = new FileThreadStore(storeRootDir);
    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const attachCommand = commands.get("lh-attach");
    assert.ok(attachCommand);

    const { ctx, notifications } = createCommandContext(target, {
      getBranch: () => activeBranch,
      getCwd: () => projectDir,
      getEntries: () => entries,
      getLeafId: () => activeLeafId,
    });
    await attachCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");

    const thread = await store.findManagedThread(target);
    assert.equal(thread.ok, true);
    assert.ok(thread.value);

    const snapshot = await store.openThread(thread.value!.threadId);
    assert.equal(snapshot.ok, true);
    assert.deepEqual(
      snapshot.value.messages.map((message) => message.targetMetadata?.sessionEntryId),
      ["entry-001", "branch-entry-001", "branch-entry-002"],
    );
    assert.equal(
      snapshot.value.messages.some((message) => message.parts.some((part) => part.content === "Main branch attach response")),
      false,
    );
  });
});

test("/lh-attach binds imported history to the requested session file instead of the live context target", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const liveTarget = makeThreadTarget({
      sessionId: "session-live-current",
      sessionFilePath: resolveProjectPath("pi", "session-live-current.jsonl"),
      cwd: projectDir,
    });
    const importedSessionId = "session-imported-file";
    const importedSessionFilePath = resolveProjectPath("pi", `${importedSessionId}.jsonl`);
    const importedEntries = makePiSessionEntries({
      messages: [
        makePiUserMessage({ content: "Imported file prompt" }),
        makePiAssistantMessage({ content: [{ type: "text", text: "Imported file response" }] }),
      ],
    });

    await writePiSessionFile({
      sessionFilePath: importedSessionFilePath,
      sessionId: importedSessionId,
      cwd: projectDir,
      entries: importedEntries,
    });

    const store = new FileThreadStore(storeRootDir);
    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const attachCommand = commands.get("lh-attach");
    assert.ok(attachCommand);

    const { ctx, notifications } = createCommandContext(liveTarget);
    await attachCommand!.handler(importedSessionFilePath, ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");

    const importedThread = await store.findThreadByTarget({
      runtime: "pi",
      sessionFilePath: importedSessionFilePath,
    });
    assert.equal(importedThread.ok, true);
    assert.ok(importedThread.value);
    assert.equal(importedThread.value!.target.sessionId, importedSessionId);
    assert.equal(importedThread.value!.target.sessionFilePath, importedSessionFilePath);

    const liveThread = await store.findManagedThread(liveTarget);
    assert.equal(liveThread.ok, true);
    assert.equal(liveThread.value, undefined);

    const snapshot = await store.openThread(importedThread.value!.threadId);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.value.imports[0]?.sourceSessionId, importedSessionId);
    assert.equal(snapshot.value.imports[0]?.sourcePath, importedSessionFilePath);
  });
});

test("/lh-attach renders success and conflict summaries", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const sessionId = "session-command-attach-summary";
    const sessionFilePath = resolveProjectPath("pi", `${sessionId}.jsonl`);
    const target = makeThreadTarget({
      sessionId,
      sessionFilePath,
      cwd: projectDir,
    });
    await writePiSessionFile({
      sessionFilePath,
      sessionId,
      cwd: projectDir,
      entries: makePiSessionEntries({
        messages: [
          makePiUserMessage({ content: "Attach summary prompt" }),
          makePiAssistantMessage({ content: [{ type: "text", text: "Attach summary response" }] }),
        ],
      }),
    });

    const store = new FileThreadStore(storeRootDir);
    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const attachCommand = commands.get("lh-attach");
    assert.ok(attachCommand);

    const successContext = createCommandContext(target);
    await attachCommand!.handler("", successContext.ctx);
    const thread = expectOk(await store.findManagedThread(target));

    assert.ok(thread);
    assert.equal(successContext.notifications.length, 1);
    assert.equal(successContext.notifications[0]!.level, "info");
    assert.equal(
      successContext.notifications[0]!.message,
      `Attach complete: Imported 2 messages into thread ${thread.threadId}.`,
    );

    const conflictContext = createCommandContext(target);
    await attachCommand!.handler("", conflictContext.ctx);

    assert.equal(conflictContext.notifications.length, 1);
    assert.equal(conflictContext.notifications[0]!.level, "error");
    assert.equal(
      conflictContext.notifications[0]!.message,
      `Attach failed: PI target ${sessionId} is already managed by thread ${thread.threadId}. [TARGET_ASSOCIATION_CONFLICT]`,
    );
  });
});

test("/lh-turn-health renders ready and blocked states", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-command-turn-health",
      sessionFilePath: resolveProjectPath("pi", "session-command-turn-health.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Turn health prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-command-turn-health",
        content: [{ type: "text", text: "Turn health response" }],
      }),
    );

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const turnHealthCommand = commands.get("lh-turn-health");
    assert.ok(turnHealthCommand);

    const readyContext = createCommandContext(target);
    await turnHealthCommand!.handler("", readyContext.ctx);

    assert.equal(readyContext.notifications.length, 1);
    assert.equal(readyContext.notifications[0]!.level, "info");
    assert.equal(readyContext.notifications[0]!.message, `Turn health: Thread ${thread.threadId} is ready.`);

    await clearTurnState(store, thread.threadId);

    const blockedContext = createCommandContext(target);
    await turnHealthCommand!.handler("", blockedContext.ctx);

    assert.equal(blockedContext.notifications.length, 1);
    assert.equal(blockedContext.notifications[0]!.level, "error");
    assert.equal(
      blockedContext.notifications[0]!.message,
      `Turn health failed: Thread ${thread.threadId} is repair_needed across 1 uncovered ranges. [TURN_STATE_MISSING]`,
    );
  });
});

test("/lh-repair-turns renders repair success and stale-source failure", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-command-repair",
      sessionFilePath: resolveProjectPath("pi", "session-command-repair.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Repair prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-command-repair",
        content: [{ type: "text", text: "Repair response" }],
      }),
    );
    await clearTurnState(store, thread.threadId);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const repairCommand = commands.get("lh-repair-turns");
    assert.ok(repairCommand);

    const successContext = createCommandContext(target);
    await repairCommand!.handler("", successContext.ctx);

    assert.equal(successContext.notifications.length, 1);
    assert.equal(successContext.notifications[0]!.level, "info");
    assert.equal(
      successContext.notifications[0]!.message,
      `Turn repair: Rebuilt 1 turns for thread ${thread.threadId}; health is ready.`,
    );

    await clearTurnState(store, thread.threadId);

    const staleStore = new StaleRepairStore(storeRootDir);
    const staleApi = createMockPiApi();
    registerContextStewardExtension(staleApi.api, {
      createStore: () => staleStore,
    });

    const staleRepairCommand = staleApi.commands.get("lh-repair-turns");
    assert.ok(staleRepairCommand);

    const failureContext = createCommandContext(target);
    await staleRepairCommand!.handler("", failureContext.ctx);

    assert.equal(failureContext.notifications.length, 1);
    assert.equal(failureContext.notifications[0]!.level, "error");
    assert.equal(
      failureContext.notifications[0]!.message,
      `Turn repair failed: Thread ${thread.threadId} source revision 3 does not match expected 2. [STALE_SOURCE_REVISION]`,
    );
  });
});

test("/lh-smart-compact accepts explicit inputs through the production command surface and reloads PI", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
    });

    const smartCompactCommand = commands.get("lh-smart-compact");
    assert.ok(smartCompactCommand);

    const { ctx, notifications, replacementNotifications, switchedTo } = createSwitchingCommandContext(target, {
      buildSessionContext: () => ({
        model: {
          provider: "openai-codex",
          modelId: "gpt-5.5",
        },
        thinkingLevel: "low",
      }),
    });
    await smartCompactCommand!.handler(
      "--lower-bound 2000 --full 60 --smooth 40 --detailed 0 --brief 0 --mode prepare",
      ctx,
    );

    assert.deepEqual(notifications, []);
    assert.equal(replacementNotifications.length, 1);
    assert.equal(replacementNotifications[0]!.level, "info");
    assert.match(
      replacementNotifications[0]!.message,
      /^Smart compact: Generated PI session .+ for thread .+ and reloaded PI\. Generated-session token count: 1 \(provider_input_count\/exact\)\.$/,
    );
    assert.equal(switchedTo.length, 1);

    const thread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(thread.ok, true);
    assert.equal(thread.value.thread.target.currentGeneratedFilePath, switchedTo[0]);
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.modelProvider, "openai-codex");
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.modelId, "gpt-5.5");
    assert.equal(thread.value.thread.threadViewOutputSummary.generatedOutput?.thinkingLevel, "low");
    const generatedContent = await readFile(switchedTo[0]!, "utf8");
    assert.match(generatedContent, /"type":"model_change","provider":"openai-codex","modelId":"gpt-5\.5"/);
    assert.match(generatedContent, /"type":"thinking_level_change","thinkingLevel":"low"/);
    await access(switchedTo[0]!);
  });
});

test("/lh-smart-compact surfaces final generated-session count source and trust when output is degraded", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
      openAIInputTokenCounter: fakeOverTargetOpenAICounter,
    });

    const smartCompactCommand = commands.get("lh-smart-compact");
    assert.ok(smartCompactCommand);

    const { ctx, notifications, replacementNotifications, switchedTo } = createSwitchingCommandContext(target);
    await smartCompactCommand!.handler(
      "--lower-bound 1200 --full 60 --smooth 40 --detailed 0 --brief 0 --mode prepare",
      ctx,
    );

    assert.deepEqual(replacementNotifications, []);
    assert.deepEqual(switchedTo, []);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(
      notifications[0]!.message,
      /^Smart compact: Generated PI session for thread .+ was not written or reloaded\. Generated-session token count: 1500 \(provider_input_count\/exact\)\. \[GENERATED_SESSION_OVER_LOWER_BOUND\]$/,
    );
  });
});

test("/lh-smart-compact surfaces final generated-session count source and trust when output is blocked", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
      openAIInputTokenCounter: fakeBlockedPolicyCounter,
    });

    const smartCompactCommand = commands.get("lh-smart-compact");
    assert.ok(smartCompactCommand);

    const { ctx, notifications, replacementNotifications, switchedTo } = createSwitchingCommandContext(target);
    await smartCompactCommand!.handler(
      "--lower-bound 2000 --full 60 --smooth 40 --detailed 0 --brief 0 --mode prepare",
      ctx,
    );

    assert.deepEqual(replacementNotifications, []);
    assert.deepEqual(switchedTo, []);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "error");
    assert.match(
      notifications[0]!.message,
      /^Smart compact failed: Thread .+ is blocked before generated output could be written\. Generated-session token count: 100 \(pi_heuristic\/heuristic_estimate\)\. \[TOKEN_COUNT_BLOCKED\]$/,
    );
  });
});

test("pi-extension smart compact failed summaries include generated-session count source and trust", () => {
  const generatedSessionTokenCountMetadata = {
    count: 321,
    scope: "generated_session",
    source: "provider_input_count",
    trustClass: "exact",
    representationHash: "sha256:summary-count",
    createdAt: DEFAULT_TEST_TIMESTAMP,
  } as const;
  const baseResult = {
    threadId: "thread-summary",
    requestedLowerBound: 2_000,
    requestedBandPercentages: { fullFidelity: 60, smooth: 40, detailed: 0, brief: 0 },
    threadViewId: "thread-view-summary",
    blockers: [],
    resultingTokenCount: 1,
    generatedSessionTokenCount: generatedSessionTokenCountMetadata.count,
    generatedSessionTokenCountMetadata,
    generatedSessionCountPolicy: {
      status: "usable",
      mode: "strict",
      requestedScope: "generated_session",
      recordScope: "generated_session",
      source: "provider_input_count",
      count: generatedSessionTokenCountMetadata.count,
      usableForSmartCompact: true,
      precedence: 100,
      reasonCode: "COUNT_SOURCE_PROVIDER_INPUT_USABLE",
      reason: "Provider input count is usable.",
    },
  } satisfies Omit<SmartCompactCommandResult, "compactStatus" | "generatedFilePath">;

  const writeFailed = commandResultFromSmartCompact("thread-summary", {
    ...baseResult,
    compactStatus: "write_failed",
  });
  assert.equal(
    writeFailed.summary,
    "Generated PI session output could not be written for thread thread-summary. Generated-session token count: 321 (provider_input_count/exact).",
  );

  const reloadFailed = commandResultFromSmartCompact("thread-summary", {
    ...baseResult,
    compactStatus: "reload_failed",
    generatedFilePath: "/tmp/generated-session.jsonl",
  });
  assert.equal(
    reloadFailed.summary,
    "Generated PI session /tmp/generated-session.jsonl was written for thread thread-summary, but PI reload failed. Generated-session token count: 321 (provider_input_count/exact).",
  );
});

test("/lh-smart-compact rejects unknown arguments and invalid mode explicitly on the production command surface", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
    });

    const smartCompactCommand = commands.get("lh-smart-compact");
    assert.ok(smartCompactCommand);

    const unknownArgContext = createCommandContext(target);
    await smartCompactCommand!.handler(
      "--lower-bound 120 --full 60 --smooth 40 --detailed 0 --brief 0 --bogus 1",
      unknownArgContext.ctx,
    );

    assert.deepEqual(unknownArgContext.notifications, [
      {
        level: "error",
        message:
          "Smart compact failed: Unknown smart compact argument --bogus. Expected --lower-bound, --full, --smooth, --detailed, --brief, and optional --mode. [INVALID_COMMAND_ARGS]",
      },
    ]);

    const invalidModeContext = createCommandContext(target);
    await smartCompactCommand!.handler(
      "--lower-bound 120 --full 60 --smooth 40 --detailed 0 --brief 0 --mode relaxed",
      invalidModeContext.ctx,
    );

    assert.deepEqual(invalidModeContext.notifications, [
      {
        level: "error",
        message:
          'Smart compact failed: Invalid value for --mode: "relaxed". Expected "strict" or "prepare". [INVALID_COMMAND_ARGS]',
      },
    ]);
  });
});

test("/lh-smart-compact reloads through the session-switch path even when PI already has the generated file loaded", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
      openAIInputTokenCounter: fakeOpenAICounter,
    });

    const smartCompactCommand = commands.get("lh-smart-compact");
    assert.ok(smartCompactCommand);

    const firstRun = createSwitchingCommandContext(target);
    await smartCompactCommand!.handler(
      "--lower-bound 2000 --full 60 --smooth 40 --detailed 0 --brief 0 --mode prepare",
      firstRun.ctx,
    );
    assert.equal(firstRun.switchedTo.length, 1);

    const currentGeneratedPath = firstRun.switchedTo[0]!;
    const samePathTarget = makeThreadTarget({
      sessionId: target.sessionId,
      sessionFilePath: currentGeneratedPath,
      cwd: projectDir,
    });
    const secondRun = createSwitchingCommandContext(samePathTarget);
    await smartCompactCommand!.handler(
      "--lower-bound 2000 --full 60 --smooth 40 --detailed 0 --brief 0 --mode prepare",
      secondRun.ctx,
    );

    assert.deepEqual(secondRun.notifications, []);
    assert.equal(secondRun.switchedTo.length, 1);
    assert.notEqual(secondRun.switchedTo[0], currentGeneratedPath);
    assert.equal(secondRun.replacementNotifications.length, 1);
    assert.equal(secondRun.replacementNotifications[0]!.level, "info");
    assert.match(
      secondRun.replacementNotifications[0]!.message,
      /^Smart compact: Generated PI session .+ for thread .+ and reloaded PI\. Generated-session token count: 1 \(provider_input_count\/exact\)\.$/,
    );
  });
});

test("/lh-compact-report is registered and defaults to the most recent thread view", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedCompactReportThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
    });

    const compactReportCommand = commands.get("lh-compact-report");
    assert.ok(compactReportCommand);

    const { ctx, notifications } = createCommandContext(target);
    await compactReportCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(
      notifications[0]!.message,
      new RegExp(
        `^Compact report: Compaction audit report\\nThread: ${seeded.threadId}\\nThread view: ${seeded.newerThreadViewId}\\nCompact status: available`,
      ),
    );
  });
});

test("/lh-compact-report accepts --thread-view and reports the requested view", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedCompactReportThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
    });

    const compactReportCommand = commands.get("lh-compact-report");
    assert.ok(compactReportCommand);

    const { ctx, notifications } = createCommandContext(target);
    await compactReportCommand!.handler(`--thread-view ${seeded.olderThreadViewId}`, ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(
      notifications[0]!.message,
      new RegExp(
        `^Compact report: Compaction audit report\\nThread: ${seeded.threadId}\\nThread view: ${seeded.olderThreadViewId}\\nCompact status: unknown`,
      ),
    );
  });
});

test("/lh-compact-report validates --thread-view arguments and missing views", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedCompactReportThread(`${projectDir}/.context-steward`);
    const target = makeThreadTarget({
      sessionId: "session-thread-view-builder",
      cwd: projectDir,
    });

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
    });

    const compactReportCommand = commands.get("lh-compact-report");
    assert.ok(compactReportCommand);

    const missingValueContext = createCommandContext(target);
    await compactReportCommand!.handler("--thread-view", missingValueContext.ctx);
    assert.deepEqual(missingValueContext.notifications, [
      {
        level: "error",
        message: "Compact report failed: Missing value for --thread-view. [INVALID_COMMAND_ARGS]",
      },
    ]);

    const missingViewContext = createCommandContext(target);
    await compactReportCommand!.handler("--thread-view missing-view", missingViewContext.ctx);
    assert.equal(missingViewContext.notifications.length, 1);
    assert.equal(missingViewContext.notifications[0]!.level, "error");
    assert.equal(
      missingViewContext.notifications[0]!.message,
      `Compact report failed: Projection compact snapshot missing-view was not found for thread ${seeded.threadId}. [THREAD_VIEW_NOT_FOUND]`,
    );
  });
});

test("/lh-compact-report handles missing managed threads", async () => {
  await withTempThreadStore(async ({ projectDir }) => {
    const target = makeThreadTarget({
      sessionId: "session-command-compact-report-missing",
      sessionFilePath: `${projectDir}/pi/session-command-compact-report-missing.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api);

    const compactReportCommand = commands.get("lh-compact-report");
    assert.ok(compactReportCommand);

    const { ctx, notifications } = createCommandContext(target);
    await compactReportCommand!.handler("", ctx);

    assert.deepEqual(notifications, [
      {
        level: "error",
        message: "Compact report failed: No managed thread exists for the current PI session.",
      },
    ]);
  });
});

test("/lh-status reports active thread id and turn state", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-command-status",
      sessionFilePath: resolveProjectPath("pi", "session-command-status.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Status prompt" }));
    await capturePiMessage(
      store,
      thread.threadId,
      target,
      makePiAssistantMessage({
        responseId: "response-command-status",
        content: [{ type: "text", text: "Status response" }],
      }),
    );

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });

    const statusCommand = commands.get("lh-status");
    assert.ok(statusCommand);

    const { ctx, notifications } = createCommandContext(target);
    await statusCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.equal(
      notifications[0]!.message,
      `Status: Thread ${thread.threadId} has 2 messages, 1 turns, and turn state ready.`,
    );
  });
});

test("/lh-status works when no managed thread exists", async () => {
  await withTempThreadStore(async ({ projectDir }) => {
    const target = makeThreadTarget({
      cwd: projectDir,
      sessionFilePath: `${projectDir}/pi/session-001.jsonl`,
    });
    await ensureTargetSessionFile(target);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api);

    const statusCommand = commands.get("lh-status");
    assert.ok(statusCommand);

    const { ctx, notifications } = createCommandContext(target);
    await statusCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.equal(notifications[0]!.message, "Status: No managed thread exists for the current PI session.");
  });
});

test("/lh-prompt-projection-status reports live projection counters", async () => {
  await withTempThreadStore(async ({ projectDir }) => {
    const target = makeThreadTarget({
      cwd: projectDir,
      sessionFilePath: `${projectDir}/pi/session-prompt-projection-status.jsonl`,
    });
    await ensureTargetSessionFile(target);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      liveToolResultTruncation: {
        rawZoneTokenThreshold: 123,
        truncatedCharLimit: 17,
      },
    });

    const statusCommand = commands.get("lh-prompt-projection-status");
    assert.ok(statusCommand);

    const { ctx, notifications } = createCommandContext(target);
    await statusCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(notifications[0]!.message, /^Prompt projection: hydrated=false; observed=0;/);
    assert.match(notifications[0]!.message, /threshold=123; charLimit=17/);
  });
});

test("/lh-active-thread-view-status and /lh-smoothing-status report machine-readable JSON", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir, resolveProjectPath }) => {
    const target = makeThreadTarget({
      sessionId: "session-inspection-status",
      sessionFilePath: resolveProjectPath("pi", "session-inspection-status.jsonl"),
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const store = new FileThreadStore(storeRootDir);
    const thread = expectOk(await openOrCreateManagedThread({ target }, store));
    await capturePiMessage(store, thread.threadId, target, makePiUserMessage({ content: "Inspect this prompt" }));

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => store,
    });
    const activeCommand = commands.get("lh-active-thread-view-status");
    const smoothingCommand = commands.get("lh-smoothing-status");
    assert.ok(activeCommand);
    assert.ok(smoothingCommand);

    const { ctx, notifications } = createCommandContext(target);
    await activeCommand!.handler("", ctx);
    await smoothingCommand!.handler("", ctx);

    assert.equal(notifications.length, 2);
    const activeReport = JSON.parse(notifications[0]!.message.replace(/^Active thread view: /, ""));
    const smoothingReport = JSON.parse(notifications[1]!.message.replace(/^Smoothing status: /, ""));
    assert.equal(activeReport.threadId, thread.threadId);
    assert.deepEqual(Object.keys(activeReport.bands), ["full_fidelity", "smooth", "detailed", "brief"]);
    assert.equal(Array.isArray(activeReport.warnings), true);
    assert.equal(smoothingReport.threadId, thread.threadId);
    assert.equal(typeof smoothingReport.messageEndUserSmoothing.pending, "number");
    assert.equal(typeof smoothingReport.completeSmoothReadiness.completeUnavailableCount, "number");
  });
});

test("/lh-lower-band-status reports machine-readable lower-band readiness and blocker details", async () => {
  await withTempFeature3Store(async ({ projectDir }) => {
    const seeded = await seedMissingDetailedLowerBandArtifactThread(`${projectDir}/.context-steward`);
    const seededThread = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(seededThread.ok, true);
    const target = makeThreadTarget({
      sessionId: seededThread.value.thread.target.sessionId ?? "session-lower-band-status-command",
      sessionFilePath: `${projectDir}/pi/session-lower-band-status.jsonl`,
      cwd: projectDir,
    });
    await ensureTargetSessionFile(target);

    const chunksResult = await seeded.threadStore.readChunks(seeded.threadId);
    assert.equal(chunksResult.ok, true);
    const snapshot = await seeded.threadStore.openThread(seeded.threadId);
    assert.equal(snapshot.ok, true);
    const updatedChunks = chunksResult.value.map((chunk) =>
      chunk.chunkId === seeded.chunks.newerClosed
        ? {
            ...chunk,
            lowerBand: {
              ...chunk.lowerBand,
              detailed: {
                band: "detailed" as const,
                status: "failed" as const,
                errorCode: "MODEL_UNAVAILABLE",
                errorMessage: "provider unavailable",
                updatedAt: DEFAULT_TEST_TIMESTAMP,
              },
              brief: {
                band: "brief" as const,
                status: "pending" as const,
                updatedAt: DEFAULT_TEST_TIMESTAMP,
              },
            },
          } as typeof chunk
        : chunk,
    );
    const writeChunks = await seeded.threadStore.writeChunks({
      threadId: seeded.threadId,
      expectedSourceRevision: snapshot.value.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.value.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.value.thread.turnsRevision,
      chunks: updatedChunks,
    });
    assert.equal(writeChunks.ok, true);

    const { api, commands } = createMockPiApi();
    registerContextStewardExtension(api, {
      createStore: () => seeded.threadStore,
      createThreadViewStore: () => seeded.threadViewStore,
    });
    const lowerBandCommand = commands.get("lh-lower-band-status");
    assert.ok(lowerBandCommand);

    const { ctx, notifications } = createCommandContext(target);
    await lowerBandCommand!.handler("", ctx);

    assert.equal(notifications.length, 1);
    const rendered = notifications[0]!.message;
    const jsonStart = rendered.indexOf("{");
    const jsonEnd = rendered.lastIndexOf("}");
    assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, rendered);
    const report = JSON.parse(rendered.slice(jsonStart, jsonEnd + 1));
    assert.equal(report.threadId, seeded.threadId);
    assert.ok(Array.isArray(report.chunks));
    assert.ok(
      report.chunks.some((chunk: { chunkId: string; legacyPlaceholderBlocked: boolean; detailed: { status: string } }) =>
        chunk.chunkId === seeded.chunks.newerClosed &&
        chunk.legacyPlaceholderBlocked === true &&
        chunk.detailed.status === "blocked_legacy_placeholder"),
    );
    assert.ok(
      report.compactBlockers.some((blocker: { chunkId?: string; bandLabel?: string }) =>
        blocker.chunkId === seeded.chunks.newerClosed &&
        blocker.bandLabel === "detailed/brief"),
    );
  });
});
