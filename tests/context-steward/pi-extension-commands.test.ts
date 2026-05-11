import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type ExtensionAPI, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { StewardResult } from "../../src/context-steward/domain/errors.js";
import { mapPiMessageEnd } from "../../src/context-steward/pi/pi-message-mapper.js";
import { captureFinalizedActivity } from "../../src/context-steward/services/capture-service.js";
import registerContextStewardExtension from "../../src/context-steward/pi/pi-extension.js";
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

interface RegisteredCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function createMockPiApi() {
  const commands = new Map<string, RegisteredCommand>();

  const api = {
    on: () => undefined,
    registerCommand: (name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;

  return { api, commands };
}

function createCommandContext(
  target: ReturnType<typeof makeThreadTarget>,
  sessionManagerOverrides: Record<string, unknown> = {},
) {
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    cwd: target.cwd!,
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
