import { describe, expect, it } from "vitest";
import { runCli } from "../../src/commands/run.js";

describe("CLI", () => {
  it("prints onboarding help with no args", async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lhx - PI Long Horizon context inspection");
    expect(result.stdout).toContain("Canonical Thread");
    expect(result.stdout).toContain("lhx inspect summary");
    expect(result.stdout).toContain("lhx inspect tokens");
    expect(result.stdout).toContain("lhx inspect bands");
    expect(result.stdout).toContain("lhx inspect report post-compact");
    expect(result.stdout).toContain("lhx threads upsert --thread-db <path>");
    expect(result.stdout).toContain("lhx threads refresh --all");
    expect(result.stdout).toContain("lhx threads resume <id-or-name>");
    expect(result.stdout).toContain("lhx thread-events create --event-db <path>");
    expect(result.stdout).toContain("lhx thread-events append --event-db <path> --client-thread-id <id> --file <event.json>");
    expect(result.stdout).toContain("lhx thread-events list --event-db <path> [--json]");
    expect(result.stdout).not.toContain("lhx thread-events create --thread-db .context-steward/threads/");
    expect(result.stdout).not.toContain("lhx thread-events append --thread-db .context-steward/threads/");
    expect(result.stdout).not.toContain("lhx thread-events list --thread-db .context-steward/threads/");
    expect(result.stdout).toContain("ALIASES");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--root");
    expect(result.stdout).toContain("--thread");
    expect(result.stdout).toContain("--thread-dir");
    expect(result.stdout).toContain("--thread-view");
    expect(result.stdout).toContain("--catalog-db");
    expect(result.stdout).toContain("--thread-db");
    expect(result.stdout).toContain("--event-db");
    expect(result.stdout).toContain("--file");
  });

  it("prints command-specific help for threads", async () => {
    const result = await runCli(["threads", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lhx threads - Manual Long Horizon thread catalog");
    expect(result.stdout).toContain("lhx threads upsert --thread-db <path>");
    expect(result.stdout).toContain("lhx threads refresh --all");
    expect(result.stdout).toContain("lhx threads resume <id-or-name>");
    expect(result.stdout).toContain("catalog-local integer ID");
  });

  it("prints command-specific help for thread events", async () => {
    const result = await runCli(["thread-events", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lhx thread-events - Create, append, and inspect schema-backed thread events");
    expect(result.stdout).toContain("lhx thread-events create --event-db <path>");
    expect(result.stdout).toContain("lhx thread-events append --event-db <path> --client-thread-id <id> --file <event.json>");
    expect(result.stdout).not.toContain(".context-steward/threads/thread_abc/thread.sqlite");
    expect(result.stdout).toContain("generates schemaVersion, threadEventId, canonical threadId, eventOrder");
  });
});
