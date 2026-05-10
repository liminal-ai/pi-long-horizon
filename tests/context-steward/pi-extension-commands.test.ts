import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { CURRENT_SESSION_VERSION, type ExtensionAPI, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

import registerContextStewardExtension from "../../src/context-steward/pi/pi-extension.js";
import { openOrCreateManagedThread } from "../../src/context-steward/services/thread-service.js";
import { FileThreadStore } from "../../src/context-steward/store/file-thread-store.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makePiAssistantMessage,
  makePiSessionEntries,
  makePiUserMessage,
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

test("command formatter returns concise success and error summaries", async () => {
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
    assert.match(successContext.notifications[0]!.message, /^Fixture created: Created fixture fixture_/);

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
