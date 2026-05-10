import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const PI_BIN = join(PROJECT_ROOT, "node_modules/.bin/pi");
const EXTENSION_PATH = join(PROJECT_ROOT, ".pi/extensions/context-steward.ts");
const PI_AGENT_DIR = join(PROJECT_ROOT, ".pi/agent");

interface PiRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function piEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: PI_AGENT_DIR };
  delete env["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"];
  return env;
}

async function runPi(options: {
  cwd: string;
  sessionDir: string;
  prompt: string;
  sessionFile?: string;
  withExtension?: boolean;
  timeout?: number;
}): Promise<PiRunResult> {
  const args = [
    "-p",
    "--provider", "openai-codex",
    "--model", "gpt-5.4-mini",
    "--thinking", "low",
    "--no-tools",
    "--session-dir", options.sessionDir,
  ];

  if (options.withExtension !== false) {
    args.push("--extension", EXTENSION_PATH);
  }

  if (options.sessionFile) {
    args.push("--session", options.sessionFile);
  }

  args.push(options.prompt);

  const timeout = options.timeout ?? 60_000;

  return new Promise<PiRunResult>((resolve) => {
    const child = spawn(PI_BIN, args, {
      cwd: options.cwd,
      env: piEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr, exitCode: 124 });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function findSessionFile(sessionDir: string): Promise<string> {
  const files = await readdir(sessionDir, { recursive: true });
  const jsonl = files.find((f) => f.endsWith(".jsonl"));
  assert.ok(jsonl, `No PI session JSONL found in ${sessionDir}`);
  return join(sessionDir, jsonl);
}

async function findThreadDir(stewardRoot: string): Promise<string> {
  const threadsDir = join(stewardRoot, "threads");
  const entries = await readdir(threadsDir);
  const threadDirs = entries.filter((e) => !e.startsWith("."));
  assert.ok(threadDirs.length > 0, "No thread directories found");
  return join(threadsDir, threadDirs[0]);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function assertPiCleanExit(result: PiRunResult, label: string): void {
  assert.equal(result.exitCode, 0, `${label}: PI exited with code ${result.exitCode}\nstderr: ${result.stderr}`);
  assert.doesNotMatch(
    result.stderr,
    /Extension error|TARGET_ASSOCIATION_CONFLICT|CAPTURE_APPEND_FAILED|STORE_UNAVAILABLE/,
    `${label}: PI stderr contains extension error: ${result.stderr}`,
  );
}

async function countThreadDirs(stewardRoot: string): Promise<number> {
  const threadsDir = join(stewardRoot, "threads");
  const entries = (await readdir(threadsDir)).filter((e) => !e.startsWith("."));
  return entries.length;
}

interface ThreadJson {
  threadId: string;
  schemaVersion: string;
  sourceRevision: number;
  messageHighWatermark: number;
  target: { runtime: string; sessionId?: string; sessionFilePath?: string };
  status: { turnState: string };
  importSummary: { count: number };
}

interface MessageJson {
  messageId: string;
  sourceOrder: number;
  actorType: string;
  messageKind: string;
  parts: Array<{ partType: string }>;
}

interface TurnJson {
  turnId: string;
  turnOrder: number;
  lifecycleStatus: string;
  messageIds: string[];
  sourceRange: { fromSourceOrder: number; toSourceOrder: number };
}

interface ActorJson {
  actorId: string;
  actorType: string;
}

interface IndexJson {
  schemaVersion: string;
  threadByTargetKey: Record<string, string>;
}

interface FixtureJson {
  fixtureId: string;
  sourceType: string;
  status: string;
  repairStatus: string;
  threadShape: string;
}

// Test 1: New Session Creates Artifacts

describe("e2e: new session creates artifacts", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;

  before(async () => {
    tmpDir = await mkdtemp(join("/private/tmp/", "pi-e2e-new-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    const result = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: hello",
    });

    assertPiCleanExit(result, "new session");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("PI session JSONL exists", async () => {
    const sessionFile = await findSessionFile(sessionDir);
    const stat = await readFile(sessionFile, "utf8");
    assert.ok(stat.length > 0, "PI session file is empty");
  });

  test("steward index.json exists", async () => {
    const index = await readJson<IndexJson>(join(stewardRoot, "index.json"));
    assert.equal(index.schemaVersion, "context-steward.thread.v1");
    assert.ok(Object.keys(index.threadByTargetKey).length > 0, "No target keys in index");
  });

  test("thread directory has all expected files", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const files = (await readdir(threadDir)).sort();
    assert.deepEqual(files, [
      "actors.json",
      "imports.json",
      "messages.jsonl",
      "projections.json",
      "thread.json",
      "turns.json",
    ]);
  });

  test("messages include prompt and response", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const kinds = messages.map((m) => m.messageKind);
    assert.ok(kinds.includes("prompt"), "No prompt message captured");
    assert.ok(kinds.includes("response"), "No response message captured");
  });

  test("actors include human and agent", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const actors = await readJson<ActorJson[]>(join(threadDir, "actors.json"));
    const types = actors.map((a) => a.actorType);
    assert.ok(types.includes("human"), "No human actor");
    assert.ok(types.includes("agent"), "No agent actor");
  });

  test("one open turn exists", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const turns = await readJson<TurnJson[]>(join(threadDir, "turns.json"));
    assert.ok(turns.length >= 1, "No turns created");
    const openTurns = turns.filter((t) => t.lifecycleStatus === "open");
    assert.equal(openTurns.length, 1, `Expected 1 open turn, got ${openTurns.length}`);
  });

  test("thread status is ready", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const thread = await readJson<ThreadJson>(join(threadDir, "thread.json"));
    assert.equal(thread.status.turnState, "ready");
    assert.equal(thread.target.runtime, "pi");
  });
});

// Test 2: Continue Session Reuses Thread

describe("e2e: continue session reuses thread", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;
  let firstThreadId: string;
  let firstMessageCount: number;

  before(async () => {
    tmpDir = await mkdtemp(join("/private/tmp/", "pi-e2e-continue-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    // First prompt
    const r1 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: first",
    });
    assertPiCleanExit(r1, "continue: first prompt");

    const threadDir = await findThreadDir(stewardRoot);
    const thread = await readJson<ThreadJson>(join(threadDir, "thread.json"));
    firstThreadId = thread.threadId;
    firstMessageCount = (await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"))).length;

    // Second prompt, continuing same session
    const sessionFile = await findSessionFile(sessionDir);
    const r2 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: second",
      sessionFile,
    });
    assertPiCleanExit(r2, "continue: second prompt");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("same thread is reused", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const thread = await readJson<ThreadJson>(join(threadDir, "thread.json"));
    assert.equal(thread.threadId, firstThreadId);
  });

  test("only one thread directory exists", async () => {
    const threadsDir = join(stewardRoot, "threads");
    const entries = (await readdir(threadsDir)).filter((e) => !e.startsWith("."));
    assert.equal(entries.length, 1, `Expected 1 thread dir, got ${entries.length}`);
  });

  test("source order increases with new messages", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    assert.ok(messages.length > firstMessageCount, "No new messages after continuation");

    const orders = messages.map((m) => m.sourceOrder);
    for (let i = 1; i < orders.length; i++) {
      assert.ok(orders[i] > orders[i - 1], `Source order not increasing at index ${i}`);
    }
  });

  test("first turn is closed and second turn is open", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const turns = await readJson<TurnJson[]>(join(threadDir, "turns.json"));
    assert.ok(turns.length >= 2, `Expected at least 2 turns, got ${turns.length}`);

    const sorted = [...turns].sort((a, b) => a.turnOrder - b.turnOrder);
    assert.equal(sorted[0].lifecycleStatus, "closed", "First turn should be closed");

    const lastTurn = sorted[sorted.length - 1];
    assert.equal(lastTurn.lifecycleStatus, "open", "Last turn should be open");
  });
});

// Test 3: Path Stability Regression

describe("e2e: path stability across /tmp symlink", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;

  before(async () => {
    // Use /tmp (symlink to /private/tmp on macOS) to exercise the realpath fix
    tmpDir = await mkdtemp(join("/tmp/", "pi-e2e-symlink-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    const r1 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: first",
    });
    assertPiCleanExit(r1, "symlink: first prompt");

    const sessionFile = await findSessionFile(sessionDir);
    const r2 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: second",
      sessionFile,
    });
    assertPiCleanExit(r2, "symlink: second prompt");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("one thread directory exists (no conflict)", async () => {
    const count = await countThreadDirs(stewardRoot);
    assert.equal(count, 1, `Expected 1 thread dir, got ${count}`);
  });

  test("index keys use stable resolved paths", async () => {
    const index = await readJson<IndexJson>(join(stewardRoot, "index.json"));
    const keys = Object.keys(index.threadByTargetKey);
    for (const key of keys) {
      if (key.includes("session-file:")) {
        assert.ok(
          !key.includes("/tmp/") || key.includes("/private/tmp/"),
          `Index key contains unresolved /tmp path: ${key}`,
        );
      }
    }
  });

  test("second prompt captured (no conflict blocked capture)", async () => {
    // Use the realpath to find steward root since /tmp may have been resolved
    const resolvedStewardRoot = stewardRoot.replace("/tmp/", "/private/tmp/");
    let threadDir: string;
    try {
      threadDir = await findThreadDir(stewardRoot);
    } catch {
      threadDir = await findThreadDir(resolvedStewardRoot);
    }
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const prompts = messages.filter((m) => m.messageKind === "prompt");
    assert.ok(prompts.length >= 2, `Expected at least 2 prompts, got ${prompts.length}`);
  });
});

// Test 4: Attach Existing PI Session

describe("e2e: attach existing PI session", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;
  let sessionFile: string;

  before(async () => {
    tmpDir = await mkdtemp(join("/private/tmp/", "pi-e2e-attach-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    // Run PI WITHOUT the steward extension to create a native-only session
    const r1 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: before-attach",
      withExtension: false,
    });
    assertPiCleanExit(r1, "attach: initial PI run without extension");

    sessionFile = await findSessionFile(sessionDir);

    // Run PI WITH the steward extension and attach via /lh-attach
    const r2 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "/lh-attach",
      sessionFile,
    });
    assertPiCleanExit(r2, "attach: /lh-attach command");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("exactly one steward thread exists after attach", async () => {
    const count = await countThreadDirs(stewardRoot);
    assert.equal(count, 1, `Expected 1 thread dir after attach, got ${count}`);
  });

  test("import metadata records the import", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const imports = await readJson<Array<{ importId: string; importedMessageCount: number; status: string }>>(
      join(threadDir, "imports.json"),
    );
    assert.ok(imports.length >= 1, "No import records");
    assert.ok(imports[0].importedMessageCount > 0, "Import captured zero messages");
    assert.ok(
      imports[0].status === "complete" || imports[0].status === "partial",
      `Import status is ${imports[0].status}, expected complete or partial`,
    );
    assert.notEqual(imports[0].status, "failed", "Import failed entirely");
  });

  test("imported messages exist in messages.jsonl", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    assert.ok(messages.length > 0, "No messages after import");
    const kinds = messages.map((m) => m.messageKind);
    assert.ok(kinds.includes("prompt"), "No imported prompt");
    assert.ok(kinds.includes("response"), "No imported response");
  });

  test("live prompt after attach appends to same thread", async () => {
    const threadDir = await findThreadDir(stewardRoot);
    const threadBefore = await readJson<ThreadJson>(join(threadDir, "thread.json"));
    const messagesBefore = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const maxOrderBefore = Math.max(...messagesBefore.map((m) => m.sourceOrder));

    const r3 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: after-attach",
      sessionFile,
    });
    assertPiCleanExit(r3, "attach: live prompt after attach");

    // Still one thread
    const count = await countThreadDirs(stewardRoot);
    assert.equal(count, 1, `Expected 1 thread after live prompt, got ${count}`);

    // Same thread ID
    const threadAfter = await readJson<ThreadJson>(join(threadDir, "thread.json"));
    assert.equal(threadAfter.threadId, threadBefore.threadId, "Thread ID changed after live prompt");

    // New messages have higher source order than imported range
    const messagesAfter = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const newMessages = messagesAfter.filter((m) => m.sourceOrder > maxOrderBefore);
    assert.ok(newMessages.length > 0, "No new messages after live prompt");
    const newPrompts = newMessages.filter((m) => m.messageKind === "prompt");
    assert.ok(newPrompts.length >= 1, "No new prompt captured after attach");
  });
});

// Test 5: Status and Turn Health Commands

describe("e2e: status and turn-health commands", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;
  let messageCountAfterSetup: number;

  before(async () => {
    tmpDir = await mkdtemp(join("/private/tmp/", "pi-e2e-cmds-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    // Create a managed session first
    const r1 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: setup",
    });
    assertPiCleanExit(r1, "commands: setup prompt");

    const threadDir = await findThreadDir(stewardRoot);
    messageCountAfterSetup = (await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"))).length;
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("/lh-status executes as a command, not as a model prompt", async () => {
    const sessionFile = await findSessionFile(sessionDir);
    const result = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "/lh-status",
      sessionFile,
    });
    assertPiCleanExit(result, "commands: /lh-status");

    // If the slash command was sent to the model instead of handled as a command,
    // it would generate a new prompt+response pair in messages.jsonl
    const threadDir = await findThreadDir(stewardRoot);
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const newPrompts = messages.filter(
      (m) => m.sourceOrder > messageCountAfterSetup && m.messageKind === "prompt",
    );
    assert.equal(newPrompts.length, 0, "Slash command was sent to model as a prompt instead of handled as a command");
  });

  test("/lh-turn-health executes as a command, not as a model prompt", async () => {
    const sessionFile = await findSessionFile(sessionDir);
    const result = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "/lh-turn-health",
      sessionFile,
    });
    assertPiCleanExit(result, "commands: /lh-turn-health");

    const threadDir = await findThreadDir(stewardRoot);
    const messages = await readJsonl<MessageJson>(join(threadDir, "messages.jsonl"));
    const newPrompts = messages.filter(
      (m) => m.sourceOrder > messageCountAfterSetup && m.messageKind === "prompt",
    );
    assert.equal(newPrompts.length, 0, "Slash command was sent to model as a prompt instead of handled as a command");
  });
});

// Test 6: Fixture Command

describe("e2e: fixture creation command", () => {
  let tmpDir: string;
  let sessionDir: string;
  let stewardRoot: string;

  before(async () => {
    tmpDir = await mkdtemp(join("/private/tmp/", "pi-e2e-fixture-"));
    sessionDir = join(tmpDir, "sessions");
    stewardRoot = join(tmpDir, ".context-steward");

    // Create a managed session with at least one prompt
    const r1 = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "Reply with exactly: fixture-source",
    });
    assertPiCleanExit(r1, "fixture: setup prompt");
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("/lh-fixture creates a fixture directory", async () => {
    const sessionFile = await findSessionFile(sessionDir);
    const result = await runPi({
      cwd: tmpDir,
      sessionDir,
      prompt: "/lh-fixture",
      sessionFile,
    });
    assertPiCleanExit(result, "fixture: /lh-fixture command");

    const fixturesDir = join(stewardRoot, "fixtures");
    const entries = await readdir(fixturesDir);
    const fixtureDirs = entries.filter((e) => !e.startsWith("."));
    assert.ok(fixtureDirs.length >= 1, "No fixture directory created");
  });

  test("fixture has thread-shaped files", async () => {
    const fixturesDir = join(stewardRoot, "fixtures");
    const entries = (await readdir(fixturesDir)).filter((e) => !e.startsWith("."));
    const fixtureDir = join(fixturesDir, entries[0]);
    const files = (await readdir(fixtureDir)).sort();
    assert.ok(files.includes("fixture.json"), "Missing fixture.json");
    assert.ok(files.includes("thread.json"), "Missing thread.json");
    assert.ok(files.includes("messages.jsonl"), "Missing messages.jsonl");
    assert.ok(files.includes("turns.json"), "Missing turns.json");
    assert.ok(files.includes("actors.json"), "Missing actors.json");
  });

  test("fixture metadata is valid", async () => {
    const fixturesDir = join(stewardRoot, "fixtures");
    const entries = (await readdir(fixturesDir)).filter((e) => !e.startsWith("."));
    const fixtureDir = join(fixturesDir, entries[0]);
    const fixture = await readJson<FixtureJson>(join(fixtureDir, "fixture.json"));
    assert.ok(fixture.fixtureId, "Missing fixture id");
    assert.equal(fixture.sourceType, "managed_thread");
    assert.equal(fixture.status, "available");
    assert.equal(fixture.threadShape, "thread_shaped_data");
  });

  test("fixture preserves messages and turns from source", async () => {
    const fixturesDir = join(stewardRoot, "fixtures");
    const entries = (await readdir(fixturesDir)).filter((e) => !e.startsWith("."));
    const fixtureDir = join(fixturesDir, entries[0]);
    const messages = await readJsonl<MessageJson>(join(fixtureDir, "messages.jsonl"));
    const turns = await readJson<TurnJson[]>(join(fixtureDir, "turns.json"));
    assert.ok(messages.length > 0, "Fixture has no messages");
    assert.ok(turns.length > 0, "Fixture has no turns");
  });
});
