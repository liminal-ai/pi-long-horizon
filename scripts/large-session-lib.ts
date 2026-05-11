import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { StewardResult } from "../src/thread/domain/errors.js";
import type { ActorRecord, MessageRecord, MessageKind, PartType, TurnRecord } from "../src/thread/domain/records.js";
import { appendSourceMessage, openOrCreateManagedThread } from "../src/thread/services/thread-service.js";
import { prepareAsyncThread } from "../src/thread/async-thread/services/async-thread-run-service.js";
import { estimateDeterministicTokenCount } from "../src/thread/async-thread/domain/smooth-turn-state.js";
import { FileThreadStore } from "../src/thread/store/file-thread-store.js";
import { FileThreadViewStore } from "../src/thread-view/store/file-thread-view-store.js";

export interface SeedLargeSessionOptions {
  targetTokenCount: number;
  storeRootDir?: string;
  sessionId?: string;
  openTurnCount?: number;
}

export interface LargeSessionSummary {
  storeRootDir: string;
  threadId: string;
  totalTurns: number;
  totalMessages: number;
  totalTokens: number;
  closedChunks: number;
  openChunks: number;
  smoothTurns: number;
  closedTurns: number;
}

export interface SeedLargeSessionResult extends LargeSessionSummary {
  threadStore: FileThreadStore;
  threadViewStore: FileThreadViewStore;
}

const now = new Date("2026-01-15T12:00:00.000Z");

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.message).join("\n"));
  return result.value;
}

export async function resolveStoreRootDir(storeRootDir?: string): Promise<string> {
  return storeRootDir ?? mkdtemp(join(tmpdir(), "pi-large-session-"));
}

function formatBlockers(blockers: readonly { code: string; message: string }[]): string {
  return blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join("\n");
}

function tokenWords(prefix: string, count: number): string {
  return Array.from({ length: Math.max(0, count) }, (_, index) => `${prefix}_${index + 1}`).join(" ");
}

function paragraph(label: string, tokens: number): string {
  const intro = `${label}: We are tracing a TypeScript long-horizon compaction issue with deterministic stores, turn repair, and async chunk preparation.`;
  return `${intro}\n\n${tokenWords(label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), tokens)}`;
}

function codeBlock(label: string, tokens: number): string {
  return [
    `Here is the current implementation slice for ${label}:`,
    "```ts",
    "export async function rebuildThreadView(input: RebuildInput) {",
    "  const snapshot = await input.threadStore.openThread(input.threadId);",
    "  if (!snapshot.ok) return { status: \"blocked\", issues: snapshot.issues };",
    "  return buildDraftThreadView(input, { threadStore: input.threadStore, threadViewStore: input.threadViewStore });",
    "}",
    "```",
    paragraph(`${label} analysis`, tokens),
  ].join("\n");
}

function toolOutput(label: string, tokens: number): string {
  const lines = Array.from({ length: Math.max(8, Math.ceil(tokens / 24)) }, (_, index) => {
    const file = `src/thread-view/services/thread-view-builder.ts:${80 + index}`;
    return `${file} info ${label} selected turn-${index} smooth=${120 + index} raw=${450 + index} ${tokenWords(`${label}_trace_${index}`, 12)}`;
  });
  return ["$ npx tsc --noEmit", ...lines, "diagnostics: no type errors after deterministic rebuild pass"].join("\n");
}

function actors(): Record<"user" | "assistant" | "tool", ActorRecord> {
  return {
    user: { actorId: "actor-large-user", actorType: "human", displayName: "Developer" },
    assistant: { actorId: "actor-large-assistant", actorType: "agent", displayName: "Codex" },
    tool: { actorId: "actor-large-tool", actorType: "tool", displayName: "Shell" },
  };
}

async function appendMessage(input: {
  store: FileThreadStore;
  threadId: string;
  actor: ActorRecord;
  messageId: string;
  messageKind: MessageKind;
  partType?: PartType;
  content: string;
  piRole: string;
  turnIndex: number;
  toolName?: string;
  toolCallId?: string;
}): Promise<MessageRecord> {
  return expectOk(
    await appendSourceMessage({
      store: input.store,
      threadId: input.threadId,
      actor: input.actor,
      message: {
        messageId: input.messageId,
        threadId: input.threadId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        messageKind: input.messageKind,
        parts: [
          {
            partId: `${input.messageId}-part-1`,
            partOrder: 1,
            partType: input.partType ?? "text",
            content: input.content,
          },
        ],
        targetMetadata: {
          runtime: "pi",
          piRole: input.piRole,
          turnIndex: input.turnIndex,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
        },
      },
    }),
  );
}

function plannedTurnTokens(turnIndex: number): { user: number; assistant: number; tool: number } {
  const longEvery = turnIndex % 7 === 0;
  const toolEvery = turnIndex % 5 === 0 || turnIndex % 9 === 0;
  return {
    user: turnIndex % 6 === 0 ? 950 : turnIndex % 4 === 0 ? 420 : 90,
    assistant: longEvery ? 1_600 : turnIndex % 3 === 0 ? 700 : 220,
    tool: toolEvery ? (turnIndex % 10 === 0 ? 2_400 : 1_200) : 0,
  };
}

async function appendSyntheticTurn(input: {
  store: FileThreadStore;
  threadId: string;
  turnIndex: number;
}): Promise<MessageRecord[]> {
  const actorSet = actors();
  const tokenPlan = plannedTurnTokens(input.turnIndex);
  const messages: MessageRecord[] = [];
  messages.push(
    await appendMessage({
      store: input.store,
      threadId: input.threadId,
      actor: actorSet.user,
      messageId: `large-turn-${input.turnIndex}-user`,
      messageKind: "prompt",
      content:
        input.turnIndex % 11 === 0
          ? "status?"
          : paragraph(`Turn ${input.turnIndex} user request`, tokenPlan.user),
      piRole: "user",
      turnIndex: input.turnIndex,
    }),
  );

  if (tokenPlan.tool > 0) {
    const toolCallId = `tool-call-${input.turnIndex}`;
    messages.push(
      await appendMessage({
        store: input.store,
        threadId: input.threadId,
        actor: actorSet.assistant,
        messageId: `large-turn-${input.turnIndex}-tool-call`,
        messageKind: "response",
        partType: "tool_call",
        content: `Need to inspect repository state. tool=${toolCallId} command="rg -n prepareAsyncThread src tests"`,
        piRole: "assistant",
        turnIndex: input.turnIndex,
        toolName: "shell",
        toolCallId,
      }),
    );
    messages.push(
      await appendMessage({
        store: input.store,
        threadId: input.threadId,
        actor: actorSet.tool,
        messageId: `large-turn-${input.turnIndex}-tool-result`,
        messageKind: "tool_result",
        partType: "tool_result",
        content: toolOutput(`turn_${input.turnIndex}`, tokenPlan.tool),
        piRole: "toolResult",
        turnIndex: input.turnIndex,
        toolName: "shell",
        toolCallId,
      }),
    );
  }

  messages.push(
    await appendMessage({
      store: input.store,
      threadId: input.threadId,
      actor: actorSet.assistant,
      messageId: `large-turn-${input.turnIndex}-assistant`,
      messageKind: "response",
      content: codeBlock(`turn ${input.turnIndex}`, tokenPlan.assistant),
      piRole: "assistant",
      turnIndex: input.turnIndex,
    }),
  );
  return messages;
}

async function writeSyntheticTurns(input: {
  store: FileThreadStore;
  threadId: string;
  turns: { turnId: string; turnOrder: number; messages: MessageRecord[]; closed: boolean }[];
}): Promise<void> {
  const snapshot = expectOk(await input.store.openThread(input.threadId));
  const records: TurnRecord[] = input.turns.map((turn) => ({
    threadId: input.threadId,
    turnId: turn.turnId,
    turnOrder: turn.turnOrder,
    lifecycleStatus: turn.closed ? "closed" : "open",
    repairStatus: "ready",
    initiatingMessageId: turn.messages[0]?.messageId ?? `${turn.turnId}-missing`,
    messageIds: turn.messages.map((message) => message.messageId),
    sourceRange: {
      fromSourceOrder: turn.messages[0]?.sourceOrder ?? 0,
      toSourceOrder: turn.messages.at(-1)?.sourceOrder ?? 0,
    },
    openedAt: turn.messages[0]?.capturedAt,
    closedAt: turn.closed ? turn.messages.at(-1)?.capturedAt : undefined,
    sourceRevision: snapshot.thread.sourceRevision,
  }));

  expectOk(
    await input.store.writeTurns({
      threadId: input.threadId,
      expectedSourceRevision: snapshot.thread.sourceRevision,
      expectedMessageHighWatermark: snapshot.thread.messageHighWatermark,
      expectedTurnsRevision: snapshot.thread.turnsRevision,
      turns: records,
      turnState: "ready",
    }),
  );
}

export async function summarizeLargeSession(input: {
  storeRootDir: string;
  threadStore: FileThreadStore;
  threadId: string;
}): Promise<LargeSessionSummary> {
  const snapshot = expectOk(await input.threadStore.openThread(input.threadId));
  const chunks = expectOk(await input.threadStore.readChunks(input.threadId));
  return {
    storeRootDir: input.storeRootDir,
    threadId: input.threadId,
    totalTurns: snapshot.turns.length,
    totalMessages: snapshot.messages.length,
    totalTokens: snapshot.messages.reduce(
      (total, message) =>
        total +
        message.parts.reduce((partTotal, part) => {
          const content = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
          return partTotal + estimateDeterministicTokenCount(content);
        }, 0),
      0,
    ),
    closedChunks: chunks.filter((chunk) => chunk.lifecycleStatus === "closed").length,
    openChunks: chunks.filter((chunk) => chunk.lifecycleStatus === "open").length,
    smoothTurns: snapshot.turns.filter((turn) => turn.lifecycleStatus === "closed" && turn.smooth?.status === "ready").length,
    closedTurns: snapshot.turns.filter((turn) => turn.lifecycleStatus === "closed").length,
  };
}

export async function seedLargeSession(options: SeedLargeSessionOptions): Promise<SeedLargeSessionResult> {
  const storeRootDir = await resolveStoreRootDir(options.storeRootDir);
  const threadStore = new FileThreadStore(storeRootDir);
  const threadViewStore = new FileThreadViewStore(storeRootDir, threadStore);
  const thread = expectOk(
    await openOrCreateManagedThread(
      {
        target: {
          runtime: "pi",
          sessionId: options.sessionId ?? `large-session-${options.targetTokenCount}-${Date.now()}`,
          cwd: process.cwd(),
        },
        now: () => now,
      },
      threadStore,
    ),
  );

  const turns: { turnId: string; turnOrder: number; messages: MessageRecord[]; closed: boolean }[] = [];
  let sourceTokens = 0;
  for (let turnIndex = 1; sourceTokens < options.targetTokenCount || turns.length < 18; turnIndex += 1) {
    const messages = await appendSyntheticTurn({ store: threadStore, threadId: thread.threadId, turnIndex });
    sourceTokens += messages.reduce(
      (total, message) =>
        total +
        message.parts.reduce((partTotal, part) => {
          const content = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
          return partTotal + estimateDeterministicTokenCount(content);
        }, 0),
      0,
    );
    turns.push({
      turnId: `large-turn-${String(turnIndex).padStart(3, "0")}`,
      turnOrder: turnIndex,
      messages,
      closed: true,
    });
  }

  const openTurnCount = options.openTurnCount ?? 3;
  for (const turn of turns.slice(-openTurnCount)) {
    turn.closed = false;
  }
  await writeSyntheticTurns({ store: threadStore, threadId: thread.threadId, turns });

  const readiness = await prepareAsyncThread(
    {
      threadId: thread.threadId,
      mode: "prepare",
      requestedLowerBound: Math.max(4_000, Math.floor(options.targetTokenCount * 0.3)),
      requestedBandPercentages: { fullFidelity: 20, smooth: 30, detailed: 30, brief: 20 },
      requiredPlaceholderBands: { detailed: true, brief: true },
    },
    { store: threadStore, now: () => now },
  );
  if (readiness.blockers.length > 0) {
    throw new Error(`prepareAsyncThread blockers for ${thread.threadId}:\n${formatBlockers(readiness.blockers)}`);
  }

  return {
    threadStore,
    threadViewStore,
    ...(await summarizeLargeSession({ storeRootDir, threadStore, threadId: thread.threadId })),
  };
}

export function printLargeSessionSummary(summary: LargeSessionSummary): void {
  console.log(`storeRootDir=${summary.storeRootDir}`);
  console.log(`threadId=${summary.threadId}`);
  console.log(`totalTurns=${summary.totalTurns}`);
  console.log(`totalMessages=${summary.totalMessages}`);
  console.log(`totalTokens=${summary.totalTokens}`);
  console.log(`closedChunks=${summary.closedChunks}`);
  console.log(`openChunks=${summary.openChunks}`);
  console.log(`smoothCoverage=${summary.smoothTurns}/${summary.closedTurns}`);
}
