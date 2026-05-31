import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/commands/run.js";
import { ThreadEventStore } from "../../src/thread-events/store.js";
import type { ThreadEventAppendInput } from "../../src/thread-events/schema.js";

function tempThreadDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "lhx-thread-events-")), "thread.sqlite");
}

function appendInput(overrides: Partial<ThreadEventAppendInput> = {}): ThreadEventAppendInput {
  return {
    threadId: "thread_alpha",
    idempotencyKey: "idem-1",
    eventKind: "user_prompt",
    actor: { actorKind: "user", actorId: "user-1", displayName: "Lee" },
    harness: { runtime: "codex", externalThreadId: "external-thread-1" },
    occurredAt: "2026-05-30T12:00:00.000Z",
    origin: { envelopeId: "env-1", envelopeOrder: 1 },
    payload: { text: "Hello" },
    ...overrides,
  };
}

describe("ThreadEventStore", () => {
  it("appends and lists schema-backed events in event order", () => {
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => "event-1",
    });

    try {
      const appended = store.append(appendInput());
      expect(appended.duplicate).toBe(false);
      expect(appended.event).toMatchObject({
        schemaVersion: "thread_event.v1",
        threadEventId: "event-1",
        threadId: "thread_alpha",
        eventOrder: 1,
        eventKind: "user_prompt",
        recordedAt: "2026-05-30T12:01:00.000Z",
        payload: { _tag: "user_prompt", text: "Hello" },
      });

      expect(store.list()).toEqual([appended.event]);
    } finally {
      store.close();
    }
  });

  it("returns the existing event for duplicate idempotency keys", () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `event-${++idCounter}`,
    });

    try {
      const first = store.append(appendInput());
      const duplicate = store.append(appendInput({ payload: { text: "Different ignored text" } }));

      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.event).toEqual(first.event);
      expect(store.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects empty thread ids without persisting an event", () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      expect(() => store.append(appendInput({ threadId: "" }))).toThrow(/nonEmptyString/);
      expect(store.list()).toEqual([]);

      const valid = store.append(appendInput({ threadId: "thread_after_empty", idempotencyKey: "after-empty-thread" }));
      expect(valid.duplicate).toBe(false);
      expect(store.list()).toEqual([valid.event]);
    } finally {
      store.close();
    }
  });

  it("rejects empty idempotency keys instead of silently deduplicating distinct events", () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      expect(() => store.append(appendInput({ idempotencyKey: "", payload: { text: "first empty key" } }))).toThrow(
        /nonEmptyString/,
      );
      expect(() => store.append(appendInput({ idempotencyKey: "", payload: { text: "second empty key" } }))).toThrow(
        /nonEmptyString/,
      );
      expect(store.list()).toEqual([]);

      const first = store.append(appendInput({ idempotencyKey: "idem-valid-1", payload: { text: "first valid key" } }));
      const second = store.append(appendInput({ idempotencyKey: "idem-valid-2", payload: { text: "second valid key" } }));
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(false);
      expect(store.list().map((event) => event.payload)).toEqual([
        { _tag: "user_prompt", text: "first valid key" },
        { _tag: "user_prompt", text: "second valid key" },
      ]);
    } finally {
      store.close();
    }
  });

  it("persists assistant thinking variants and distinct actor ids", () => {
    let idCounter = 0;
    const store = new ThreadEventStore({
      threadDbPath: tempThreadDbPath(),
      now: () => new Date("2026-05-30T12:01:00.000Z"),
      idGenerator: () => `event-${++idCounter}`,
    });

    try {
      const reasoning = store.append(appendInput({
        idempotencyKey: "thinking-1",
        eventKind: "assistant_thinking",
        actor: { actorKind: "assistant", actorId: "assistant-main" },
        payload: { thinkingKind: "reasoning_summary", text: "condensed reasoning" },
      }));
      const encrypted = store.append(appendInput({
        idempotencyKey: "thinking-2",
        eventKind: "assistant_thinking",
        actor: { actorKind: "assistant", actorId: "assistant-shadow" },
        payload: {
          thinkingKind: "encrypted_reasoning",
          encryptedContent: "ciphertext",
          signature: "sig",
        },
      }));
      const redacted = store.append(appendInput({
        idempotencyKey: "thinking-3",
        eventKind: "assistant_thinking",
        actor: { actorKind: "assistant", actorId: "assistant-redacted" },
        payload: { thinkingKind: "redacted_reasoning" },
      }));

      expect(reasoning.event.eventOrder).toBe(1);
      expect(encrypted.event.eventOrder).toBe(2);
      expect(redacted.event.eventOrder).toBe(3);
      expect(store.list().map((event) => event.actor.actorId)).toEqual([
        "assistant-main",
        "assistant-shadow",
        "assistant-redacted",
      ]);
      expect(store.list().map((event) => event.payload)).toEqual([
        { _tag: "assistant_thinking", thinkingKind: "reasoning_summary", text: "condensed reasoning" },
        {
          _tag: "assistant_thinking",
          thinkingKind: "encrypted_reasoning",
          encryptedContent: "ciphertext",
          signature: "sig",
        },
        { _tag: "assistant_thinking", thinkingKind: "redacted_reasoning" },
      ]);
    } finally {
      store.close();
    }
  });

  it("rejects invalid assistant thinking payloads and excess payload fields", () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      expect(() =>
        store.append(appendInput({
          eventKind: "assistant_thinking",
          payload: { text: "missing thinking kind" },
        })),
      ).toThrow(/Invalid assistant_thinking payload/);
      expect(() =>
        store.append(appendInput({
          idempotencyKey: "thinking-encrypted-missing-content",
          eventKind: "assistant_thinking",
          payload: { thinkingKind: "encrypted_reasoning" },
        })),
      ).toThrow(/Invalid assistant_thinking payload/);
      expect(() =>
        store.append(appendInput({
          idempotencyKey: "thinking-text-missing-text",
          eventKind: "assistant_thinking",
          payload: { thinkingKind: "reasoning_text" },
        })),
      ).toThrow(/Invalid assistant_thinking payload/);
      expect(() =>
        store.append(appendInput({
          idempotencyKey: "thinking-redacted-extra-text",
          eventKind: "assistant_thinking",
          payload: { thinkingKind: "redacted_reasoning", text: "should not be here" },
        })),
      ).toThrow(/Invalid assistant_thinking payload/);
      expect(() =>
        store.append(appendInput({
          idempotencyKey: "prompt-extra-field",
          payload: { text: "hello", surprise: true },
        })),
      ).toThrow(/unexpected/);
      expect(() =>
        store.append(appendInput({
          idempotencyKey: "prompt-tagged-input",
          payload: { _tag: "user_prompt", text: "hello" },
        })),
      ).toThrow(/must not include generated field: _tag/);
    } finally {
      store.close();
    }
  });

  it("rejects append input that provides service-generated fields", () => {
    const store = new ThreadEventStore({ threadDbPath: tempThreadDbPath() });

    try {
      expect(() =>
        store.append({
          ...appendInput(),
          schemaVersion: "thread_event.v1",
          eventOrder: 99,
        }),
      ).toThrow(/must not include generated field/);
    } finally {
      store.close();
    }
  });
});

describe("thread-events CLI", () => {
  it("appends from input JSON and lists persisted events as JSON", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lhx-thread-events-cli-"));
    const threadDbPath = path.join(tempDir, "thread.sqlite");
    const eventPath = path.join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(appendInput({ eventKind: "runtime_note", payload: { text: "captured" } })));

    const append = await runCli(["thread-events", "append", "--thread-db", threadDbPath, "--file", eventPath]);
    expect(append.exitCode).toBe(0);
    expect(append.stderr).toBe("");
    expect(JSON.parse(append.stdout)).toMatchObject({
      duplicate: false,
      event: {
        schemaVersion: "thread_event.v1",
        eventKind: "runtime_note",
        eventOrder: 1,
        payload: { _tag: "runtime_note", text: "captured" },
      },
    });

    const list = await runCli(["thread-events", "list", "--thread-db", threadDbPath, "--json"]);
    expect(list.exitCode).toBe(0);
    expect(list.stderr).toBe("");
    const events = JSON.parse(list.stdout);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threadId: "thread_alpha", eventKind: "runtime_note" });
  });

  it("surfaces invalid payloads as CLI errors", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lhx-thread-events-cli-invalid-"));
    const eventPath = path.join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(appendInput({
      eventKind: "assistant_thinking",
      payload: { text: "no thinking kind" },
    })));

    const result = await runCli([
      "thread-events",
      "append",
      "--thread-db",
      path.join(tempDir, "thread.sqlite"),
      "--file",
      eventPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid assistant_thinking payload");
  });
});
