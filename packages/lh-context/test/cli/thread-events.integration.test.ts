import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGE_CLI_PATH = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/thread-events/basic-session/events.json", import.meta.url),
);
const FIXTURE_CLIENT_THREAD_ID = "fixture-basic-session";

function runLhx(args: readonly string[], cwd = PACKAGE_ROOT) {
  return spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", PACKAGE_CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function parseStdoutJson(result: ReturnType<typeof runLhx>): unknown {
  expect(result.stdout).not.toBe("");
  return JSON.parse(result.stdout) as unknown;
}

describe("spawned thread-events CLI", () => {
  it("creates, appends, lists, and reads canonical thread-events against a temp DB", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lhx-thread-events-spawned-cli-"));
    try {
      const eventDbPath = join(tempDir, "thread-events.sqlite");

      const create = runLhx([
        "thread-events",
        "create",
        "--event-db",
        eventDbPath,
        "--client-thread-id",
        FIXTURE_CLIENT_THREAD_ID,
        "--title",
        "Spawned fixture session",
      ]);
      expect(create.status).toBe(0);
      expect(create.stderr).toBe("");
      expect(parseStdoutJson(create)).toMatchObject({
        created: true,
        thread: { clientThreadId: FIXTURE_CLIENT_THREAD_ID, title: "Spawned fixture session" },
        event: { schemaVersion: "thread_event.v1", eventKind: "thread_created" },
      });

      const append = runLhx([
        "thread-events",
        "append",
        "--event-db",
        eventDbPath,
        "--client-thread-id",
        FIXTURE_CLIENT_THREAD_ID,
        "--file",
        FIXTURE_PATH,
      ]);
      expect(append.status).toBe(0);
      expect(append.stderr).toBe("");
      const appendJson = parseStdoutJson(append) as { ok?: boolean; results?: Array<Record<string, unknown>> };
      expect(appendJson.ok).toBe(true);
      expect(appendJson.results).toHaveLength(9);
      expect(appendJson.results?.every((result) => result.ok === true && result.duplicate === false)).toBe(true);

      const list = runLhx(["thread-events", "list", "--event-db", eventDbPath, "--json"]);
      expect(list.status).toBe(0);
      expect(list.stderr).toBe("");
      const events = parseStdoutJson(list) as Array<{ eventKind: string; idempotencyKey: string }>;
      expect(events.map((event) => event.eventKind)).toEqual([
        "thread_created",
        "user_prompt",
        "assistant_thinking",
        "tool_call",
        "tool_result",
        "assistant_text",
        "turn_end",
        "user_prompt",
        "assistant_text",
        "turn_end",
      ]);
      expect(events.map((event) => event.idempotencyKey)).toContain("basic-session-003-tool-call");
      expect(events.map((event) => event.idempotencyKey)).toContain("basic-session-009-turn-end");

      const read = runLhx([
        "thread-events",
        "read",
        "--event-db",
        eventDbPath,
        "--client-thread-id",
        FIXTURE_CLIENT_THREAD_ID,
        "--json",
      ]);
      expect(read.status).toBe(0);
      expect(read.stderr).toBe("");
      const projected = parseStdoutJson(read) as {
        thread?: { clientThreadId?: string };
        messages?: Array<{ messageKind: string; blocks: Array<{ blockKind: string }> }>;
      };
      expect(projected.thread).toMatchObject({ clientThreadId: FIXTURE_CLIENT_THREAD_ID });
      expect(projected.messages?.map((message) => message.messageKind)).toEqual([
        "user",
        "assistant",
        "assistant",
        "tool_result",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(projected.messages?.flatMap((message) => message.blocks.map((block) => block.blockKind))).toEqual([
        "text",
        "thinking",
        "tool_call",
        "tool_result",
        "text",
        "text",
        "text",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns a structured JSON append failure when the target thread is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lhx-thread-events-spawned-cli-negative-"));
    try {
      const eventDbPath = join(tempDir, "thread-events.sqlite");
      const eventPath = join(tempDir, "event.json");
      await writeFile(
        eventPath,
        JSON.stringify({
          idempotencyKey: "missing-thread-user-prompt",
          eventKind: "user_prompt",
          actor: { actorKind: "user", actorId: "user-lee" },
          harness: { runtime: "codex", externalThreadId: "missing-thread" },
          occurredAt: "2026-05-30T16:00:00.000Z",
          payload: { text: "This should not append without a created thread." },
        }),
      );

      const append = runLhx([
        "thread-events",
        "append",
        "--event-db",
        eventDbPath,
        "--client-thread-id",
        "missing-thread",
        "--file",
        eventPath,
      ]);
      expect(append.status).toBe(1);
      expect(append.stderr).toBe("");
      expect(parseStdoutJson(append)).toMatchObject({
        ok: false,
        error: { code: "thread_not_found" },
        results: [],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
