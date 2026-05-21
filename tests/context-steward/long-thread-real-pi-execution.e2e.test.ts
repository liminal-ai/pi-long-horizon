import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { runSmartCompact } from "../../src/commands/smart-compact.js";
import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import type { MessageRecord, TurnRecord } from "../../src/thread/domain/records.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import type { ThreadSnapshot } from "../../src/thread/store/thread-store.js";
import { FileThreadViewStore } from "../../src/thread-view/store/file-thread-view-store.js";
import { createTempFeature3StoreContext } from "../../src/thread-view/test/fixtures.js";
import { OpenAIInputTokenCounter } from "../../src/token-accounting/index.js";
import {
  prepareRealLongThreadFixtureClone,
  REAL_LONG_THREAD_FIXTURE,
} from "../thread-view/real-long-thread-fixture-prep.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const SOURCE_STORE_ROOT = join(PROJECT_ROOT, ".context-steward");
const SOURCE_THREAD_PATH = join(SOURCE_STORE_ROOT, "threads", REAL_LONG_THREAD_FIXTURE.threadId, "thread.json");
const PI_BIN = join(PROJECT_ROOT, "node_modules/.bin/pi");
const EXTENSION_PATH = join(PROJECT_ROOT, ".pi/extensions/context-steward.ts");
const PI_AGENT_DIR = join(PROJECT_ROOT, ".pi/agent");
const SMART_COMPACT_LOWER_BOUND = 220_000;
const FETCH_OBSERVER_PATH = join(PROJECT_ROOT, "tests/context-steward/pi-fetch-observer.mjs");

const fakeOpenAICounter = new OpenAIInputTokenCounter({
  async countInputTokens(request) {
    return Math.max(1, Math.ceil(JSON.stringify(request.input).length / 4));
  },
}, "gpt-5.4-mini");

interface PiRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  logPath: string;
  fetchLogPath: string;
}

let piRunCounter = 0;

function createGeneratedPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(
        input.threadId,
        `${stamp}-${basename(input.file.fileName)}`,
      );
    },
  };
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

function piEnv(fetchLogPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: PI_AGENT_DIR };
  delete env["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"];
  delete env["NODE_TEST_CONTEXT"];
  if (fetchLogPath) {
    env["PI_LONG_HORIZON_FETCH_LOG"] = fetchLogPath;
    env["NODE_OPTIONS"] = [env["NODE_OPTIONS"], "--import", FETCH_OBSERVER_PATH].filter(Boolean).join(" ");
  }
  return env;
}

async function runPiWithTools(options: {
  cwd: string;
  sessionDir: string;
  sessionFile: string;
  prompt: string;
  timeout?: number;
}): Promise<PiRunResult> {
  const runId = `${Date.now()}-${++piRunCounter}`;
  const logDir = join(tmpdir(), "pi-long-horizon-e2e-pi-runs");
  const logPath = join(logDir, `${runId}.log`);
  const fetchLogPath = join(logDir, `${runId}.fetch.jsonl`);
  const args = [
    "-p",
    "--verbose",
    "--provider", "openai-codex",
    "--model", "gpt-5.4-mini",
    "--thinking", "low",
    "--session-dir", options.sessionDir,
    "--extension", EXTENSION_PATH,
    "--session", options.sessionFile,
    options.prompt,
  ];

  const timeout = options.timeout ?? 180_000;

  async function persistRunLog(result: Omit<PiRunResult, "logPath" | "fetchLogPath">): Promise<PiRunResult> {
    await mkdir(logDir, { recursive: true });
    const payload = [
      `cwd=${options.cwd}`,
      `sessionDir=${options.sessionDir}`,
      `sessionFile=${options.sessionFile}`,
      `exitCode=${result.exitCode}`,
      `args=${JSON.stringify(args)}`,
      `fetchLog=${fetchLogPath}`,
      "----- stdout -----",
      result.stdout,
      "----- stderr -----",
      result.stderr,
      "",
    ].join("\n");
    await writeFile(logPath, payload, "utf8");
    if (result.exitCode !== 0) {
      console.error(`PI e2e run failed; log preserved at ${logPath}`);
    }
    return { ...result, logPath, fetchLogPath };
  }

  return new Promise<PiRunResult>((resolveRun) => {
    const child = spawn(PI_BIN, args, {
      cwd: options.cwd,
      env: piEnv(fetchLogPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      void persistRunLog({ stdout, stderr, exitCode: 124 }).then(resolveRun);
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      void persistRunLog({ stdout, stderr, exitCode: code ?? 1 }).then(resolveRun);
    });
  });
}

function assertPiCleanExit(
  result: PiRunResult,
  label: string,
  options: { allowedStderrPattern?: RegExp } = {},
): void {
  assert.equal(
    result.exitCode,
    0,
    `${label}: PI exited with code ${result.exitCode}; PI run log: ${result.logPath}\nstderr: ${result.stderr}`,
  );
  const stderr = options.allowedStderrPattern
    ? result.stderr.replace(options.allowedStderrPattern, "")
    : result.stderr;
  assert.doesNotMatch(
    stderr,
    /Extension error|TARGET_ASSOCIATION_CONFLICT|CAPTURE_APPEND_FAILED|STORE_UNAVAILABLE/,
    `${label}: PI stderr contains extension error: ${result.stderr}`,
  );
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  const text = await readFile(filePath, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

async function waitForAssertion(
  assertion: () => Promise<void> | void,
  description: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${description}: ${lastError.message}`;
    throw lastError;
  }

  throw new Error(description);
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => flattenStrings(entry));
  }
  return [];
}

function messageText(message: MessageRecord): string {
  return flattenStrings(message.parts.map((part) => part.content)).join("\n");
}

function messagesForTurn(snapshot: ThreadSnapshot, turn: TurnRecord): MessageRecord[] {
  const byId = new Map(snapshot.messages.map((message) => [message.messageId, message]));
  return turn.messageIds.flatMap((messageId) => {
    const message = byId.get(messageId);
    return message ? [message] : [];
  });
}

function findNewPrompt(messages: readonly MessageRecord[], marker: string): MessageRecord {
  const prompt = messages.find(
    (message) => message.actorType === "human" &&
      message.messageKind === "prompt" &&
      messageText(message).includes(marker),
  );
  assert.ok(prompt, `Expected appended source thread prompt to mention ${marker}`);
  return prompt;
}

interface VerifiedAppendedTurn {
  snapshot: ThreadSnapshot;
  prompt: MessageRecord;
  turn: TurnRecord;
  turnMessages: MessageRecord[];
  smoothedPrompt: string;
}

interface GeneratedOutputMetadataRow {
  type?: string;
  customType?: string;
  data?: {
    threadId?: string;
    threadViewId?: string;
    fileName?: string;
    placeholderExplicit?: boolean;
    entries?: Array<{
      generatedSource?: string;
      role?: string;
      metadata?: {
        sourceReference?: string;
        bandType?: string;
        sourceKind?: string;
      };
    }>;
  };
}

interface FetchObserverEvent {
  event?: string;
  url?: string;
  callSite?: string;
}

interface LowerBandArtifactWithProviderMetadata {
  status?: string;
  text?: string;
  providerMetadata?: {
    providerId?: string;
    modelId?: string;
    reasoningEffort?: string;
    promptVersion?: string;
    elapsedMs?: number;
  };
}

async function readFetchObserverEvents(filePath: string): Promise<FetchObserverEvent[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  return (await readJsonl(filePath)) as FetchObserverEvent[];
}

async function assertOpenAIInputTokenCountingObserved(input: {
  store: FileThreadStore;
  threadId: string;
  turnId: string;
  description: string;
}): Promise<void> {
  await waitForAssertion(async () => {
    const snapshot = expectOk(await input.store.openThread(input.threadId));
    const turn = snapshot.turns.find((candidate) => candidate.turnId === input.turnId);
    assert.ok(turn, `${input.description}: expected repaired turn ${input.turnId}.`);
    assert.equal(turn.rawTokenCountMetadata?.source, "provider_input_count");
    assert.equal(turn.rawTokenCountMetadata?.trustClass, "exact");
    assert.equal(turn.smooth?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(turn.smooth?.tokenCountMetadata?.trustClass, "exact");
  }, input.description);
}

async function waitForClosedModelSmoothedTurn(input: {
  store: FileThreadStore;
  threadId: string;
  baselineSourceRevision: number;
  baselineMessageHighWatermark: number;
  promptMarker: string;
  expectedPromptText: readonly string[];
  expectedNewMessageText?: readonly string[];
  description: string;
}): Promise<VerifiedAppendedTurn> {
  let verified: VerifiedAppendedTurn | undefined;
  await waitForAssertion(async () => {
    const snapshot = expectOk(await input.store.openThread(input.threadId));
    assert.ok(
      snapshot.thread.sourceRevision > input.baselineSourceRevision,
      "Expected source thread revision to advance.",
    );
    assert.ok(
      snapshot.messages.length > input.baselineMessageHighWatermark,
      "Expected source thread to capture appended messages.",
    );

    const newMessages = snapshot.messages.filter(
      (message) => message.sourceOrder > input.baselineMessageHighWatermark,
    );
    const newPrompt = findNewPrompt(newMessages, input.promptMarker);
    const promptText = messageText(newPrompt);
    for (const expected of input.expectedPromptText) {
      assert.ok(promptText.includes(expected), `Expected canonical prompt to preserve ${expected}.`);
    }

    assert.ok(
      newMessages.some((message) => message.actorType === "agent" && message.messageKind === "response"),
      "Expected appended agent response activity.",
    );
    assert.ok(
      newMessages.some((message) => message.messageKind === "tool_result"),
      "Expected appended tool activity.",
    );
    for (const expected of input.expectedNewMessageText ?? []) {
      assert.ok(
        newMessages.some((message) => messageText(message).includes(expected)),
        `Expected canonical thread to capture ${expected}.`,
      );
    }

    const newTurn = snapshot.turns.find((turn) => turn.initiatingMessageId === newPrompt.messageId);
    assert.ok(newTurn, "Expected appended prompt to initiate a new turn.");
    assert.equal(newTurn.lifecycleStatus, "closed", "Expected appended turn to close after final answer.");
    assert.ok(newTurn.messageIds.length >= 3, "Expected appended turn to include prompt, tool, and assistant activity.");
    assert.equal(newTurn.sourceRange.fromSourceOrder, newPrompt.sourceOrder);

    const turnMessages = messagesForTurn(snapshot, newTurn);
    assert.ok(
      newTurn.sourceRange.toSourceOrder >= Math.max(...turnMessages.map((message) => message.sourceOrder)),
      "Expected new turn source range to cover its appended messages.",
    );
    assert.ok(
      turnMessages.some((message) => message.messageKind === "tool_result"),
      "Expected closed turn to retain tool result message.",
    );
    assert.ok(
      turnMessages.some((message) => message.actorType === "agent" && message.messageKind === "response"),
      "Expected closed turn to retain assistant response message.",
    );

    const userPromptComponent = newTurn.smooth?.components?.find(
      (component) => component.kind === "user_prompt" && component.sourceMessageIds.includes(newPrompt.messageId),
    );
    assert.ok(userPromptComponent, "Expected persisted user_prompt smooth component.");
    assert.equal(userPromptComponent.quality, "model_smoothed");
    assert.equal(userPromptComponent.status, "ready");
    const smoothedPrompt = userPromptComponent.text ?? "";
    assert.ok(smoothedPrompt.trim(), "Expected non-empty smoothed prompt text.");
    for (const expected of input.expectedPromptText) {
      assert.ok(smoothedPrompt.includes(expected), `Expected smoothed prompt to preserve ${expected}.`);
    }

    verified = {
      snapshot,
      prompt: newPrompt,
      turn: structuredClone(newTurn),
      turnMessages,
      smoothedPrompt,
    };
  }, input.description);

  assert.ok(verified, input.description);
  return verified;
}

async function waitForAsyncThreadViewProjectionAndChunking(input: {
  store: FileThreadStore;
  threadId: string;
  turnId: string;
  description: string;
}): Promise<void> {
  await waitForAssertion(async () => {
    const snapshot = expectOk(await input.store.openThread(input.threadId));
    const turn = snapshot.turns.find((candidate) => candidate.turnId === input.turnId);
    assert.ok(turn, `Expected turn ${input.turnId} to remain in the source thread.`);
    assert.equal(
      turn.smooth?.lowerBandProjection?.status,
      "ready",
      `${input.description}: expected exact lower-band projection to be persisted for the appended turn.`,
    );
    assert.equal(
      turn.smooth?.lowerBandProjection?.tokenCountMetadata?.scope,
      "turn_lower_band_projection_materialized",
    );
    assert.equal(turn.smooth?.lowerBandProjection?.tokenCountMetadata?.source, "provider_input_count");
    assert.equal(turn.smooth?.lowerBandProjection?.tokenCountMetadata?.trustClass, "exact");

    const chunks = expectOk(await input.store.readChunks(input.threadId));
    assert.ok(
      chunks.some((chunk) => chunk.sourceTurnIds.includes(input.turnId)),
      `${input.description}: expected chunking to consume projected turn ${input.turnId}.`,
    );
  }, input.description);
}

async function assertInferenceGeneratedLowerBandArtifacts(input: {
  store: FileThreadStore;
  threadId: string;
  description: string;
}): Promise<void> {
  const chunks = expectOk(await input.store.readChunks(input.threadId));
  const closedChunks = chunks.filter((chunk) => chunk.lifecycleStatus === "closed");
  assert.ok(closedChunks.length > 0, `${input.description}: expected at least one closed lower-band chunk.`);

  const detailed = closedChunks
    .map((chunk) => chunk.lowerBand?.detailed as LowerBandArtifactWithProviderMetadata | undefined)
    .find((artifact) => artifact?.status === "ready" && artifact.providerMetadata?.providerId === "openai-codex");
  const brief = closedChunks
    .map((chunk) => chunk.lowerBand?.brief as LowerBandArtifactWithProviderMetadata | undefined)
    .find((artifact) => artifact?.status === "ready" && artifact.providerMetadata?.providerId === "openai-codex");

  assert.ok(detailed, `${input.description}: expected inference-generated detailed lower-band text.`);
  assert.ok(detailed.text?.trim(), `${input.description}: expected non-empty detailed lower-band text.`);
  assert.equal(detailed.providerMetadata?.providerId, "openai-codex");
  assert.equal(detailed.providerMetadata?.promptVersion, "lower_band_detailed_v1");
  assert.equal(typeof detailed.providerMetadata?.modelId, "string");
  assert.equal(typeof detailed.providerMetadata?.reasoningEffort, "string");
  assert.equal(typeof detailed.providerMetadata?.elapsedMs, "number");

  assert.ok(brief, `${input.description}: expected inference-generated brief lower-band text.`);
  assert.ok(brief.text?.trim(), `${input.description}: expected non-empty brief lower-band text.`);
  assert.equal(brief.providerMetadata?.providerId, "openai-codex");
  assert.equal(brief.providerMetadata?.promptVersion, "lower_band_brief_v1");
  assert.equal(typeof brief.providerMetadata?.modelId, "string");
  assert.equal(typeof brief.providerMetadata?.reasoningEffort, "string");
  assert.equal(typeof brief.providerMetadata?.elapsedMs, "number");
}

async function readGeneratedOutputMetadata(filePath: string): Promise<GeneratedOutputMetadataRow> {
  const rows = await readJsonl(filePath) as GeneratedOutputMetadataRow[];
  const metadata = rows.find(
    (row) => row.type === "custom" && row.customType === "pi-long-horizon.thread-view.output",
  );
  assert.ok(metadata, `Expected generated output metadata in ${filePath}`);
  return metadata;
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }
  assert.fail(`Expected ${filePath} to have been deleted`);
}

test(
  "real PI execution appends one closed turn to a prepared long-thread clone",
  {
    skip: existsSync(SOURCE_THREAD_PATH) && existsSync(PI_BIN)
      ? false
      : "real audited source thread or PI binary is not present in this checkout",
    timeout: 240_000,
  },
  async () => {
    const context = await createTempFeature3StoreContext("pi-long-thread-real-exec-");
    let passed = false;

    try {
      const prepared = await prepareRealLongThreadFixtureClone({
        sourceStoreRootDir: SOURCE_STORE_ROOT,
        targetStoreRootDir: context.storeRootDir,
      });
      const store = new FileThreadStore(context.storeRootDir);
      const beforeSnapshot = expectOk(await store.openThread(prepared.threadId));
      const beforeSessionRows = await readJsonl(prepared.activeGeneratedFilePath);
      const sessionDir = context.resolveProjectPath("sessions");
      const targetDirPath = context.resolveProjectPath("scratch");
      await mkdir(sessionDir, { recursive: true });
      await mkdir(targetDirPath, { recursive: true });
      const targetDir = await realpath(targetDirPath);

      const uniqueToken = `long-thread-real-pi-${randomUUID()}`;
      const fileName = `long-thread-real-pi-${randomUUID()}.md`;
      const targetFile = join(targetDir, fileName);
      const prompt = [
        "I need a tiny but very real smoke check, and I'm phrasing this messily on purpose so prompt smoothing has real work to do.",
        `The unique markdown file name is ${fileName}; the target directory is ${targetDir}; the unique content token is ${uniqueToken}.`,
        "Please use shell commands/tools, not just prose:",
        "1. run `ls` in the current directory first.",
        `2. create ${targetFile} as a markdown file with a heading, the target directory, and the token ${uniqueToken}.`,
        `3. verify ${fileName} exists in ${targetDir} and show evidence that includes the file name.`,
        `4. delete ${targetFile}.`,
        `5. verify deletion of ${fileName} and show evidence that it is gone.`,
        "Then give a short final answer saying what happened.",
      ].join("\n");

      const result = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: prepared.activeGeneratedFilePath,
        prompt,
      });

      assertPiCleanExit(result, "long-thread prepared clone real PI execution");
      await assertFileDoesNotExist(targetFile);

      const afterSessionRows = await readJsonl(prepared.activeGeneratedFilePath);
      assert.ok(
        afterSessionRows.length > beforeSessionRows.length,
        "Expected PI to append interaction rows to the generated rollout session file.",
      );
      const appendedRowsText = JSON.stringify(afterSessionRows.slice(beforeSessionRows.length));
      assert.ok(appendedRowsText.includes(fileName), "Expected appended session rows to mention the unique file.");
      assert.ok(appendedRowsText.includes(uniqueToken), "Expected appended session rows to include the unique token.");

      const verified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: beforeSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: beforeSnapshot.thread.messageHighWatermark,
        promptMarker: fileName,
        expectedPromptText: [fileName, targetDir],
        expectedNewMessageText: [uniqueToken],
        description: "real PI execution should persist closed turn and model-smoothed user prompt",
      });
      await assertOpenAIInputTokenCountingObserved({
        store,
        threadId: prepared.threadId,
        turnId: verified.turn.turnId,
        description: "real PI execution async thread view",
      });
      await waitForAsyncThreadViewProjectionAndChunking({
        store,
        threadId: prepared.threadId,
        turnId: verified.turn.turnId,
        description:
          "real PI execution async thread view should exact-count lower-band projection and advance chunking",
      });
      passed = true;
    } catch (error) {
      const smoothingLogPath = context.resolveStorePath("debug", "user-prompt-smoothing.log");
      console.error(`Retaining failed PI execution fixture workspace at ${context.projectDir}`);
      if (existsSync(smoothingLogPath)) {
        console.error(`User prompt smoothing log at ${smoothingLogPath}:`);
        console.error(await readFile(smoothingLogPath, "utf8"));
      } else {
        console.error(`No user prompt smoothing log found at ${smoothingLogPath}`);
      }
      throw error;
    } finally {
      if (passed) {
        await context.cleanup();
      }
    }
  },
);

test(
  "real PI execution continues the same prepared long-thread clone session with a second closed turn",
  {
    skip: existsSync(SOURCE_THREAD_PATH) && existsSync(PI_BIN)
      ? false
      : "real audited source thread or PI binary is not present in this checkout",
    timeout: 360_000,
  },
  async () => {
    const context = await createTempFeature3StoreContext("pi-long-thread-real-continuation-");
    let passed = false;

    try {
      const prepared = await prepareRealLongThreadFixtureClone({
        sourceStoreRootDir: SOURCE_STORE_ROOT,
        targetStoreRootDir: context.storeRootDir,
      });
      const store = new FileThreadStore(context.storeRootDir);
      const baselineSnapshot = expectOk(await store.openThread(prepared.threadId));
      const sessionDir = context.resolveProjectPath("sessions");
      const targetDirPath = context.resolveProjectPath("scratch");
      await mkdir(sessionDir, { recursive: true });
      await mkdir(targetDirPath, { recursive: true });
      const targetDir = await realpath(targetDirPath);
      const continuationDir = join(targetDir, "continuation");
      await mkdir(continuationDir, { recursive: true });

      const firstToken = `long-thread-first-continuation-${randomUUID()}`;
      const firstFileName = `long-thread-first-continuation-${randomUUID()}.md`;
      const firstTargetFile = join(targetDir, firstFileName);
      const firstPrompt = [
        "Please do this as a real shell-backed check; the phrasing is intentionally wordy so smoothing has to clean it up.",
        `Use file ${firstFileName} in directory ${targetDir}; include unique token ${firstToken}.`,
        "Run `ls` in the current directory first.",
        `Create ${firstTargetFile} as markdown with the token ${firstToken}.`,
        `Verify ${firstFileName} exists, then delete it, then verify it is gone.`,
        "Finish with a short final answer.",
      ].join("\n");

      const firstSessionRowsBefore = await readJsonl(prepared.activeGeneratedFilePath);
      const firstResult = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: prepared.activeGeneratedFilePath,
        prompt: firstPrompt,
      });
      assertPiCleanExit(firstResult, "long-thread prepared clone first continuation setup run");
      await assertFileDoesNotExist(firstTargetFile);
      const firstSessionRowsAfter = await readJsonl(prepared.activeGeneratedFilePath);
      assert.ok(
        firstSessionRowsAfter.length > firstSessionRowsBefore.length,
        "Expected first PI run to append rows to the generated rollout session file.",
      );

      const firstVerified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: baselineSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: baselineSnapshot.thread.messageHighWatermark,
        promptMarker: firstFileName,
        expectedPromptText: [firstFileName, targetDir],
        expectedNewMessageText: [firstToken],
        description: "first real PI continuation setup turn should close and be model-smoothed",
      });

      const secondBaselineSnapshot = expectOk(await store.openThread(prepared.threadId));
      const firstTurnBeforeSecondRun = structuredClone(firstVerified.turn);
      const secondMarker = `long-thread-second-continuation-${randomUUID()}`;
      const secondPrompt = [
        "Continuation check, still a little rambly on purpose so the user prompt smoother has meaningful text.",
        `Please work in this exact subdirectory: ${continuationDir}.`,
        `Use this unique marker in your final answer so I can identify the turn: ${secondMarker}.`,
        `Run a shell command equivalent to changing into ${continuationDir} and printing pwd.`,
        "Then give a short final answer with the directory you observed and the marker. No file creation is needed this time.",
      ].join("\n");

      const secondSessionRowsBefore = await readJsonl(prepared.activeGeneratedFilePath);
      const secondResult = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: prepared.activeGeneratedFilePath,
        prompt: secondPrompt,
      });
      assertPiCleanExit(secondResult, "long-thread prepared clone second continuation run");
      const secondSessionRowsAfter = await readJsonl(prepared.activeGeneratedFilePath);
      assert.ok(
        secondSessionRowsAfter.length > secondSessionRowsBefore.length,
        "Expected second PI run to append rows to the same generated rollout session file.",
      );
      const secondAppendedRowsText = JSON.stringify(secondSessionRowsAfter.slice(secondSessionRowsBefore.length));
      assert.ok(secondAppendedRowsText.includes(secondMarker), "Expected second appended session rows to mention marker.");

      const secondVerified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: secondBaselineSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: secondBaselineSnapshot.thread.messageHighWatermark,
        promptMarker: secondMarker,
        expectedPromptText: [secondMarker, continuationDir],
        expectedNewMessageText: [continuationDir],
        description: "second real PI continuation turn should close and be model-smoothed",
      });

      assert.equal(secondVerified.snapshot.thread.threadId, prepared.threadId);
      const threadDirs = (await readdir(context.resolveStorePath("threads"))).filter((entry) => !entry.startsWith("."));
      assert.deepEqual(threadDirs, [prepared.threadId], "Expected continuation to reuse the cloned canonical thread.");

      const firstTurnAfterSecondRun = secondVerified.snapshot.turns.find(
        (turn) => turn.turnId === firstTurnBeforeSecondRun.turnId,
      );
      assert.deepEqual(
        firstTurnAfterSecondRun,
        firstTurnBeforeSecondRun,
        "Expected first appended turn to remain closed and unchanged after second run.",
      );

      const messagesById = new Map(secondVerified.snapshot.messages.map((message) => [message.messageId, message]));
      const appendedTurns = secondVerified.snapshot.turns.filter((turn) => {
        const initiating = messagesById.get(turn.initiatingMessageId);
        return (initiating?.sourceOrder ?? 0) > baselineSnapshot.thread.messageHighWatermark;
      });
      assert.equal(appendedTurns.length, 2, "Expected exactly two newly appended turns from this test flow.");
      assert.deepEqual(
        appendedTurns.map((turn) => turn.lifecycleStatus),
        ["closed", "closed"],
        "Expected both newly appended turns to be closed.",
      );
      assert.notEqual(firstVerified.turn.turnId, secondVerified.turn.turnId, "Expected distinct turn ids.");
      assert.notEqual(firstVerified.prompt.messageId, secondVerified.prompt.messageId, "Expected distinct prompt messages.");
      assert.ok(
        secondVerified.prompt.sourceOrder > firstVerified.prompt.sourceOrder,
        "Expected second prompt to be appended after first prompt.",
      );

      const appendedMessages = secondVerified.snapshot.messages.filter(
        (message) => message.sourceOrder > baselineSnapshot.thread.messageHighWatermark,
      );
      const sourceOrders = appendedMessages.map((message) => message.sourceOrder);
      assert.equal(new Set(sourceOrders).size, sourceOrders.length, "Expected appended source orders to be unique.");
      assert.deepEqual(
        sourceOrders,
        [...sourceOrders].sort((left, right) => left - right),
        "Expected appended messages to remain in source order.",
      );

      passed = true;
    } catch (error) {
      const smoothingLogPath = context.resolveStorePath("debug", "user-prompt-smoothing.log");
      console.error(`Retaining failed PI execution fixture workspace at ${context.projectDir}`);
      if (existsSync(smoothingLogPath)) {
        console.error(`User prompt smoothing log at ${smoothingLogPath}:`);
        console.error(await readFile(smoothingLogPath, "utf8"));
      } else {
        console.error(`No user prompt smoothing log found at ${smoothingLogPath}`);
      }
      throw error;
    } finally {
      if (passed) {
        await context.cleanup();
      }
    }
  },
);

test(
  "smart compact writes a generated rollout after live PI turns on a prepared long-thread clone",
  {
    skip: existsSync(SOURCE_THREAD_PATH) && existsSync(PI_BIN)
      ? false
      : "real audited source thread or PI binary is not present in this checkout",
    timeout: 540_000,
  },
  async () => {
    const context = await createTempFeature3StoreContext("pi-long-thread-smart-compact-");
    let passed = false;

    try {
      const prepared = await prepareRealLongThreadFixtureClone({
        sourceStoreRootDir: SOURCE_STORE_ROOT,
        targetStoreRootDir: context.storeRootDir,
      });
      const store = new FileThreadStore(context.storeRootDir);
      const threadViewStore = new FileThreadViewStore(context.storeRootDir, store);
      const baselineSnapshot = expectOk(await store.openThread(prepared.threadId));
      const sessionDir = context.resolveProjectPath("sessions");
      const targetDirPath = context.resolveProjectPath("scratch");
      await mkdir(sessionDir, { recursive: true });
      await mkdir(targetDirPath, { recursive: true });
      const targetDir = await realpath(targetDirPath);
      const continuationDir = join(targetDir, "smart-compact-continuation");
      await mkdir(continuationDir, { recursive: true });

      const firstToken = `smart-compact-live-first-${randomUUID()}`;
      const firstFileName = `smart-compact-live-first-${randomUUID()}.md`;
      const firstTargetFile = join(targetDir, firstFileName);
      const firstPrompt = [
        "Please do one live filesystem turn before compaction; this is intentionally verbose enough for smoothing.",
        `Use file ${firstFileName} in target directory ${targetDir}, and write unique token ${firstToken}.`,
        "Use shell commands for every filesystem operation in this turn; do not use the read or write tool for create, delete, or verification.",
        "Run `ls` in the current directory first.",
        `Create ${firstTargetFile} with a shell command, verify it exists with a shell command, delete it with rm, and verify deletion with a shell command like test ! -e.`,
        "End with a short final answer.",
      ].join("\n");

      const firstResult = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: prepared.activeGeneratedFilePath,
        prompt: firstPrompt,
      });
      assertPiCleanExit(firstResult, "long-thread smart compact first live run");
      await assertFileDoesNotExist(firstTargetFile);
      const firstVerified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: baselineSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: baselineSnapshot.thread.messageHighWatermark,
        promptMarker: firstFileName,
        expectedPromptText: [firstFileName, targetDir],
        expectedNewMessageText: [firstToken],
        description: "first live turn before smart compact should close and be model-smoothed",
      });

      const secondBaselineSnapshot = expectOk(await store.openThread(prepared.threadId));
      const secondMarker = `smart-compact-live-second-${randomUUID()}`;
      const secondPrompt = [
        "Second live turn before smart compact, with enough natural language that smoothing still has real material.",
        `Work in this exact subdirectory: ${continuationDir}.`,
        `Run pwd from that subdirectory and include marker ${secondMarker} in the final answer.`,
        "Keep the final answer short.",
      ].join("\n");
      const secondResult = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: prepared.activeGeneratedFilePath,
        prompt: secondPrompt,
      });
      assertPiCleanExit(secondResult, "long-thread smart compact second live run");
      const secondVerified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: secondBaselineSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: secondBaselineSnapshot.thread.messageHighWatermark,
        promptMarker: secondMarker,
        expectedPromptText: [secondMarker, continuationDir],
        expectedNewMessageText: [continuationDir],
        description: "second live turn before smart compact should close and be model-smoothed",
      });

      const beforeCompactSnapshot = expectOk(await store.openThread(prepared.threadId));
      const beforeCompactMessages = structuredClone(beforeCompactSnapshot.messages);
      const loadedGeneratedFiles: string[] = [];
      const compactResult = await runSmartCompact(
        {
          threadId: prepared.threadId,
          requestedLowerBound: SMART_COMPACT_LOWER_BOUND,
          requestedBandPercentages: { fullFidelity: 45, smooth: 20, detailed: 25, brief: 10 },
          mode: "prepare",
          modelProvider: "openai-codex",
          modelId: "gpt-5.4-mini",
          thinkingLevel: "low",
        },
        {
          threadStore: store,
          openAIInputTokenCounter: fakeOpenAICounter,
          asyncThreadDependencies: {
            tokenCountModel: "gpt-5.4-mini",
          },
          piThreadViewWriterOptions: {
            pathResolver: createGeneratedPathResolver(context),
            now: () => new Date("2026-05-17T03:00:00.000Z"),
          },
          piCliHarnessAdapter: createPiCliHarnessAdapter({
            switchSession: async (sessionPath) => {
              loadedGeneratedFiles.push(sessionPath);
              return { cancelled: false };
            },
          }),
          now: () => new Date("2026-05-17T03:00:00.000Z"),
        },
      );

      assert.match(compactResult.compactStatus, /^(success|degraded)$/);
      const unexpectedBlockers = compactResult.blockers.filter((issue) => issue.code !== "SMOOTH_DEGRADED");
      assert.deepEqual(unexpectedBlockers, [], "Smart compact should not degrade for unexplained reasons.");
      assert.ok(compactResult.generatedFilePath, "Expected smart compact to write a generated rollout file.");
      assert.ok(existsSync(compactResult.generatedFilePath), "Expected generated rollout file to exist.");
      assert.deepEqual(loadedGeneratedFiles, [compactResult.generatedFilePath]);

      const afterCompactSnapshot = expectOk(await store.openThread(prepared.threadId));
      assert.deepEqual(
        afterCompactSnapshot.messages,
        beforeCompactMessages,
        "Smart compact should not mutate source-of-truth raw messages.",
      );
      assert.equal(afterCompactSnapshot.thread.threadId, prepared.threadId);
      assert.equal(afterCompactSnapshot.thread.threadViewOutputSummary.currentProjectionRevisionId, compactResult.projectionRevisionId);
      assert.equal(afterCompactSnapshot.thread.threadViewOutputSummary.currentThreadViewId, compactResult.threadViewId);
      assert.equal(afterCompactSnapshot.thread.threadViewOutputSummary.currentGeneratedFilePath, compactResult.generatedFilePath);
      assert.equal(afterCompactSnapshot.thread.threadViewOutputSummary.generatedOutput?.generatedFilePath, compactResult.generatedFilePath);
      assert.equal(afterCompactSnapshot.thread.target.currentGeneratedFilePath, compactResult.generatedFilePath);
      const activeProjection = afterCompactSnapshot.projections.find(
        (projection) => projection.revisionId === compactResult.projectionRevisionId,
      );
      assert.equal(activeProjection?.generatedFilePath, compactResult.generatedFilePath);
      assert.equal(activeProjection?.threadViewId, compactResult.threadViewId);

      const generatedText = await readFile(compactResult.generatedFilePath, "utf8");
      assert.ok(generatedText.includes(firstFileName), "Generated output should preserve first live filename.");
      assert.ok(generatedText.includes(continuationDir), "Generated output should preserve second live directory.");
      assert.ok(generatedText.includes(secondMarker), "Generated output should preserve second live marker.");
      assert.equal(
        generatedText.includes("Detailed semantic lower-band memory") ||
          generatedText.includes("Brief semantic lower-band memory"),
        true,
      );
      assert.equal(generatedText.includes("deterministic-placeholder"), false);
      assert.equal(generatedText.includes("[deterministic-placeholder:detailed]"), false);
      assert.equal(generatedText.includes("[deterministic-placeholder:brief]"), false);
      assert.equal(generatedText.includes("[not-semantic-summary]"), false);

      const outputMetadata = await readGeneratedOutputMetadata(compactResult.generatedFilePath);
      assert.equal(outputMetadata.data?.threadId, prepared.threadId);
      assert.equal(outputMetadata.data?.threadViewId, compactResult.threadViewId);
      assert.equal(outputMetadata.data?.fileName, basename(compactResult.generatedFilePath));
      assert.equal(outputMetadata.data?.placeholderExplicit, false);
      const outputEntries = outputMetadata.data?.entries ?? [];
      const generatedSources = new Set(outputEntries.map((entry) => entry.generatedSource));
      assert.ok(generatedSources.has("raw_turn_message"), "Expected upper-band raw messages in generated output.");
      assert.ok(generatedSources.has("smooth_turn"), "Expected older smooth-turn content in generated output.");
      await assertInferenceGeneratedLowerBandArtifacts({
        store,
        threadId: prepared.threadId,
        description: "smart compact lower-band catch-up",
      });
      assert.ok(generatedSources.has("detailed_chunk_summary"), "Expected detailed lower-band chunk summary content.");
      assert.ok(generatedSources.has("brief_chunk_summary"), "Expected brief lower-band chunk summary content.");
      assert.ok(
        generatedSources.has("detailed_chunk_summary") || generatedSources.has("brief_chunk_summary"),
        "Expected older lower-band chunk summary content in generated output.",
      );

      const rawSourceReferences = outputEntries
        .filter((entry) => entry.generatedSource === "raw_turn_message")
        .map((entry) => entry.metadata?.sourceReference ?? "");
      assert.ok(
        rawSourceReferences.some((sourceReference) => sourceReference.includes(firstVerified.turn.turnId)),
        "Expected first appended live turn to remain represented as upper-band raw messages.",
      );
      assert.ok(
        rawSourceReferences.some((sourceReference) => sourceReference.includes(secondVerified.turn.turnId)),
        "Expected second appended live turn to remain represented as upper-band raw messages.",
      );

      const appendedTurns = afterCompactSnapshot.turns.filter((turn) => {
        const initiating = afterCompactSnapshot.messages.find((message) => message.messageId === turn.initiatingMessageId);
        return (initiating?.sourceOrder ?? 0) > baselineSnapshot.thread.messageHighWatermark;
      });
      assert.equal(appendedTurns.length, 2, "Expected the two live turns to remain in canonical source state.");
      assert.deepEqual(appendedTurns.map((turn) => turn.lifecycleStatus), ["closed", "closed"]);

      const postCompactMarker = `smart-compact-post-compact-${randomUUID()}`;
      const postCompactPrompt = [
        "Now continue from the post-smart-compact generated rollout with one more real shell-backed turn.",
        `Change into this exact directory first: ${continuationDir}.`,
        `Run pwd there and include the unique marker ${postCompactMarker} in your final answer.`,
        "Keep the final answer short and do not create files.",
      ].join("\n");
      const postCompactSessionRowsBefore = await readJsonl(compactResult.generatedFilePath);
      const postCompactResult = await runPiWithTools({
        cwd: context.projectDir,
        sessionDir,
        sessionFile: compactResult.generatedFilePath,
        prompt: postCompactPrompt,
      });
      assertPiCleanExit(postCompactResult, "long-thread smart compact post-compact continuation run");
      const postCompactSessionRowsAfter = await readJsonl(compactResult.generatedFilePath);
      assert.ok(
        postCompactSessionRowsAfter.length > postCompactSessionRowsBefore.length,
        "Expected post-compact PI continuation to append rows to the generated rollout session file.",
      );
      const postCompactAppendedRowsText = JSON.stringify(
        postCompactSessionRowsAfter.slice(postCompactSessionRowsBefore.length),
      );
      assert.ok(
        postCompactAppendedRowsText.includes(postCompactMarker),
        "Expected post-compact appended session rows to mention the unique marker.",
      );
      assert.ok(
        postCompactAppendedRowsText.includes(continuationDir),
        "Expected post-compact appended session rows to mention the continuation directory.",
      );

      const postCompactVerified = await waitForClosedModelSmoothedTurn({
        store,
        threadId: prepared.threadId,
        baselineSourceRevision: afterCompactSnapshot.thread.sourceRevision,
        baselineMessageHighWatermark: afterCompactSnapshot.thread.messageHighWatermark,
        promptMarker: postCompactMarker,
        expectedPromptText: [postCompactMarker, continuationDir],
        expectedNewMessageText: [continuationDir],
        description: "post-smart-compact PI continuation turn should close and be model-smoothed",
      });
      assert.equal(postCompactVerified.snapshot.thread.threadId, prepared.threadId);
      assert.equal(
        postCompactVerified.snapshot.thread.target.currentGeneratedFilePath,
        compactResult.generatedFilePath,
      );
      assert.equal(
        postCompactVerified.snapshot.thread.threadViewOutputSummary.currentGeneratedFilePath,
        compactResult.generatedFilePath,
      );
      assert.ok(
        postCompactVerified.prompt.sourceOrder > secondVerified.prompt.sourceOrder,
        "Expected post-compact prompt to append after the second live pre-compact prompt.",
      );

      const finalAppendedTurns = postCompactVerified.snapshot.turns.filter((turn) => {
        const initiating = postCompactVerified.snapshot.messages.find(
          (message) => message.messageId === turn.initiatingMessageId,
        );
        return (initiating?.sourceOrder ?? 0) > baselineSnapshot.thread.messageHighWatermark;
      });
      assert.equal(
        finalAppendedTurns.length,
        3,
        "Expected the source thread to retain the two pre-compact turns plus one post-compact continuation turn.",
      );
      assert.deepEqual(
        finalAppendedTurns.map((turn) => turn.lifecycleStatus),
        ["closed", "closed", "closed"],
      );
      assert.ok(
        finalAppendedTurns.some((turn) => turn.turnId === postCompactVerified.turn.turnId),
        "Expected the post-compact continuation turn to persist in canonical source state.",
      );

      passed = true;
    } catch (error) {
      const smoothingLogPath = context.resolveStorePath("debug", "user-prompt-smoothing.log");
      console.error(`Retaining failed PI execution fixture workspace at ${context.projectDir}`);
      if (existsSync(smoothingLogPath)) {
        console.error(`User prompt smoothing log at ${smoothingLogPath}:`);
        console.error(await readFile(smoothingLogPath, "utf8"));
      } else {
        console.error(`No user prompt smoothing log found at ${smoothingLogPath}`);
      }
      throw error;
    } finally {
      if (passed) {
        await context.cleanup();
      }
    }
  },
);
