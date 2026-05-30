import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  AmbiguousThreadCatalogReferenceError,
  ThreadCatalog,
  type ThreadCatalogRow,
  type ThreadResumeCommand,
} from "../../src/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGE_CLI_PATH = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

async function withTempDir<T>(run: (rootDir: string) => Promise<T> | T): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), "lhx-thread-catalog-"));
  try {
    return await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function seedCanonicalThread(input: {
  rootDir: string;
  threadId: string;
  projectName?: string;
  updatedAt?: string;
  prompt?: string;
  messageCount?: number;
  turnCount?: number;
  chunkCount?: number;
  projectionCount?: number;
  generatedTokenCount?: number;
  maintenance?: Record<string, unknown>;
}): Promise<{ projectRoot: string; storeRoot: string; threadDbPath: string }> {
  const projectName = input.projectName ?? "alpha-project";
  const projectRoot = join(input.rootDir, projectName);
  const storeRoot = join(projectRoot, ".context-steward");
  const threadDir = join(storeRoot, "threads", input.threadId);
  const threadDbPath = join(threadDir, "thread.sqlite");
  const sessionId = `session-${input.threadId}`;
  const projectionRevisionId = `projection-${input.threadId}`;
  const generatedFilePath = join(projectRoot, ".pi", `${sessionId}.jsonl`);
  const updatedAt = input.updatedAt ?? "2026-01-01T00:00:00.000Z";
  const messageCount = input.messageCount ?? 1;
  const turnCount = input.turnCount ?? 1;
  const chunkCount = input.chunkCount ?? 1;
  const projectionCount = input.projectionCount ?? 1;

  await mkdir(dirname(threadDbPath), { recursive: true });
  const db = new Database(threadDbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        updated_at TEXT,
        source_revision INTEGER,
        target_session_id TEXT,
        target_session_file_path TEXT,
        current_generated_file_path TEXT,
        thread_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        source_order INTEGER NOT NULL,
        message_kind TEXT NOT NULL,
        message_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turns (
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        turn_order INTEGER NOT NULL,
        turn_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        thread_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        chunk_position INTEGER NOT NULL,
        chunk_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projection_revisions (
        thread_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT,
        generated_file_path TEXT,
        projection_json TEXT
      );
    `);

    const reset = db.transaction(() => {
      for (const table of ["threads", "messages", "turns", "chunks", "projection_revisions"]) {
        db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(input.threadId);
      }
    });
    reset();

    const threadJson = {
      threadId: input.threadId,
      updatedAt,
      sourceRevision: messageCount,
      target: {
        sessionId,
        sessionFilePath: join(projectRoot, ".pi", `${sessionId}-source.jsonl`),
        cwd: projectRoot,
        currentGeneratedFilePath: generatedFilePath,
      },
      threadViewOutputSummary: {
        currentProjectionRevisionId: projectionRevisionId,
        currentGeneratedSessionId: sessionId,
        currentGeneratedFilePath: generatedFilePath,
        lastRevisionStatus: "available",
        generatedOutput: {
          projectionRevisionId,
          generatedSessionId: sessionId,
          generatedFilePath,
          status: "available",
          generatedSessionTokenCount: input.generatedTokenCount ?? 1234,
        },
      },
      status: {
        turnState: "ready",
        tokenCounting: { status: "ready", updatedAt },
        maintenance: input.maintenance ?? {
          prepare: {
            mode: "prepare",
            scope: "full",
            status: "ready",
            updatedAt,
          },
        },
      },
    };

    db.prepare(
      `INSERT INTO threads (
        thread_id,
        updated_at,
        source_revision,
        target_session_id,
        target_session_file_path,
        current_generated_file_path,
        thread_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.threadId,
      updatedAt,
      messageCount,
      sessionId,
      join(projectRoot, ".pi", `${sessionId}-source.jsonl`),
      generatedFilePath,
      JSON.stringify(threadJson),
    );

    for (let index = 0; index < messageCount; index += 1) {
      const order = index + 1;
      const isPrompt = index === 0;
      db.prepare(
        `INSERT INTO messages (thread_id, message_id, source_order, message_kind, message_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        input.threadId,
        `message-${order}`,
        order,
        isPrompt ? "prompt" : "response",
        JSON.stringify({
          messageId: `message-${order}`,
          threadId: input.threadId,
          sourceOrder: order,
          messageKind: isPrompt ? "prompt" : "response",
          parts: [{ partId: `part-${order}`, content: isPrompt ? input.prompt ?? "Map the catalog." : `Response ${order}` }],
        }),
      );
    }

    for (let index = 0; index < turnCount; index += 1) {
      db.prepare(
        `INSERT INTO turns (thread_id, turn_id, turn_order, turn_json)
         VALUES (?, ?, ?, ?)`,
      ).run(input.threadId, `turn-${index + 1}`, index + 1, JSON.stringify({ turnId: `turn-${index + 1}` }));
    }

    for (let index = 0; index < chunkCount; index += 1) {
      db.prepare(
        `INSERT INTO chunks (thread_id, chunk_id, chunk_position, chunk_json)
         VALUES (?, ?, ?, ?)`,
      ).run(input.threadId, `chunk-${index + 1}`, index + 1, JSON.stringify({ chunkId: `chunk-${index + 1}` }));
    }

    for (let index = 0; index < projectionCount; index += 1) {
      const revisionId = index === projectionCount - 1 ? projectionRevisionId : `projection-${input.threadId}-${index + 1}`;
      db.prepare(
        `INSERT INTO projection_revisions (
          thread_id,
          revision_id,
          created_at,
          status,
          generated_file_path,
          projection_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        input.threadId,
        revisionId,
        new Date(Date.parse(updatedAt) + index * 1_000).toISOString(),
        "available",
        generatedFilePath,
        JSON.stringify({ revisionId }),
      );
    }
  } finally {
    db.close();
  }

  return { projectRoot, storeRoot, threadDbPath };
}

describe("ThreadCatalog", () => {
  it("creates and reopens its SQLite schema", async () => {
    await withTempDir((rootDir) => {
      const catalogDbPath = join(rootDir, "catalog.sqlite");
      const catalog = new ThreadCatalog({ catalogDbPath });
      catalog.initialize();
      catalog.close();

      const db = new Database(catalogDbPath, { readonly: true });
      try {
        expect(db.prepare("SELECT version, name FROM schema_migrations").all()).toEqual([
          { version: 1, name: "manual-thread-catalog-v1" },
          { version: 2, name: "manual-thread-catalog-row-ids" },
        ]);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'").get()).toEqual({
          name: "threads",
        });
        expect(db.prepare("PRAGMA table_info(threads)").all()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "id", type: "INTEGER", pk: 1 }),
            expect.objectContaining({ name: "thread_id", type: "TEXT" }),
          ]),
        );
      } finally {
        db.close();
      }
    });
  });

  it("upserts canonical thread facts and preserves user names across refresh", async () => {
    await withTempDir(async (rootDir) => {
      const catalog = new ThreadCatalog({
        catalogDbPath: join(rootDir, "catalog.sqlite"),
        now: () => new Date("2026-02-01T00:00:00.000Z"),
      });
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-upsert-001",
        prompt: "Track every known long horizon thread.",
        messageCount: 1,
      });

      const first = catalog.upsertFromThreadDb({ threadDbPath: seeded.threadDbPath, name: "Important Catalog Thread" });
      expect(first.id).toBe(1);
      expect(first).toMatchObject({
        threadId: "thread-catalog-upsert-001",
        name: "Important Catalog Thread",
        nameSource: "user",
        projectRoot: seeded.projectRoot,
        storeRoot: seeded.storeRoot,
        messageCount: 1,
        turnCount: 1,
        chunkCount: 1,
        projectionCount: 1,
        generatedTokenCount: 1234,
        observationSource: "manual",
        observationStatus: "ok",
      });

      await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-upsert-001",
        prompt: "A new fallback should not overwrite the user name.",
        messageCount: 3,
        updatedAt: "2026-02-01T01:00:00.000Z",
      });

      const refreshed = catalog.refresh("Important");
      expect(refreshed.id).toBe(first.id);
      expect(refreshed.name).toBe("Important Catalog Thread");
      expect(refreshed.nameSource).toBe("user");
      expect(refreshed.messageCount).toBe(3);
      expect(refreshed.observationSource).toBe("refresh");

      const renamed = catalog.upsertFromThreadDb({ threadDbPath: seeded.threadDbPath, name: "Renamed By User" });
      expect(renamed.id).toBe(first.id);
      expect(renamed.name).toBe("Renamed By User");
      expect(renamed.nameSource).toBe("user");
      expect(catalog.list()).toHaveLength(1);
      catalog.close();
    });
  });

  it("refresh-upserts directly from canonical thread.sqlite while preserving catalog-owned fields", async () => {
    await withTempDir(async (rootDir) => {
      const catalog = new ThreadCatalog({ catalogDbPath: join(rootDir, "catalog.sqlite") });
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-refresh-upsert-001",
        prompt: "Initial catalog prompt.",
        messageCount: 1,
      });

      const first = catalog.refreshFromThreadDb({ threadDbPath: seeded.threadDbPath });
      expect(first.id).toBe(1);
      expect(first).toMatchObject({
        threadId: "thread-catalog-refresh-upsert-001",
        nameSource: "fallback",
        messageCount: 1,
        observationSource: "refresh",
        observationStatus: "ok",
      });

      const named = catalog.upsertFromThreadDb({ threadDbPath: seeded.threadDbPath, name: "Catalog Keeper" });
      await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-refresh-upsert-001",
        prompt: "Updated canonical facts should not replace the user name.",
        messageCount: 4,
        updatedAt: "2026-02-01T02:00:00.000Z",
      });

      const refreshed = catalog.refreshFromThreadDb({ threadDbPath: seeded.threadDbPath });
      expect(refreshed.id).toBe(named.id);
      expect(refreshed.name).toBe("Catalog Keeper");
      expect(refreshed.nameSource).toBe("user");
      expect(refreshed.messageCount).toBe(4);
      expect(catalog.list()).toHaveLength(1);
      catalog.close();
    });
  });

  it("clears transient refresh notes after a later successful canonical read", async () => {
    await withTempDir(async (rootDir) => {
      const catalog = new ThreadCatalog({ catalogDbPath: join(rootDir, "catalog.sqlite") });
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-notes-001",
      });
      catalog.upsertFromThreadDb({ threadDbPath: seeded.threadDbPath, name: "Recoverable Thread" });

      const db = new Database(seeded.threadDbPath);
      try {
        db.exec("DROP TABLE threads");
      } finally {
        db.close();
      }

      const unreadable = catalog.refresh("Recoverable");
      expect(unreadable.observationStatus).toBe("unreadable");
      expect(unreadable.notes).toContain("no such table");

      await rm(seeded.threadDbPath, { force: true });
      const missing = catalog.refresh("Recoverable");
      expect(missing.observationStatus).toBe("missing");
      expect(missing.notes).toBeUndefined();

      await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-notes-001",
        messageCount: 2,
        updatedAt: "2026-02-02T00:00:00.000Z",
      });

      const recovered = catalog.refresh("Recoverable");
      expect(recovered).toMatchObject({
        observationStatus: "ok",
        messageCount: 2,
      });
      expect(recovered.notes).toBeUndefined();
      expect(catalog.show("Recoverable").notes).toBeUndefined();
      catalog.close();
    });
  });

  it("treats a current clean manual repair as effective maintenance health", async () => {
    await withTempDir(async (rootDir) => {
      const catalogDbPath = join(rootDir, "catalog.sqlite");
      const catalog = new ThreadCatalog({ catalogDbPath });
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-stale-maintenance-001",
        maintenance: {
          prepare: {
            mode: "prepare",
            scope: "full",
            status: "repair_needed",
            remainingDebtCount: 8,
          },
          manualRepair: {
            mode: "manualRepair",
            scope: "full",
            status: "ready",
            remainingDebtCount: 0,
          },
          background: {
            mode: "background",
            scope: "bounded",
            status: "failed",
            remainingDebtCount: 3,
          },
        },
      });

      const row = catalog.upsertFromThreadDb({
        threadDbPath: seeded.threadDbPath,
        name: "Clean Manual Repair",
      });
      expect(row.maintenanceState).toBe("ready");
      catalog.close();

      const humanList = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "list", "--catalog-db", catalogDbPath],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(humanList.status, humanList.stderr).toBe(0);
      expect(humanList.stdout).toContain(" ok ");
      expect(humanList.stdout).toContain("Clean Manual Repair");
    });
  });

  it("generates a structured pi-lh resume command by easy identifier", async () => {
    await withTempDir(async (rootDir) => {
      const catalog = new ThreadCatalog({ catalogDbPath: join(rootDir, "catalog.sqlite") });
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-resume-001",
        projectName: "alpha project",
      });

      catalog.upsertFromThreadDb({ threadDbPath: seeded.threadDbPath, name: "Resume Me" });

      const resume = catalog.generateResumeCommand("Resume", {
        executable: "pi-lh",
        additionalArgs: ["--model", "openai/gpt-5.1-codex-max"],
      });

      const sessionFilePath = join(seeded.projectRoot, ".pi", "session-thread-catalog-resume-001-source.jsonl");
      const generatedFilePath = join(seeded.projectRoot, ".pi", "session-thread-catalog-resume-001.jsonl");
      expect(resume).toMatchObject({
        threadId: "thread-catalog-resume-001",
        name: "Resume Me",
        projectRoot: seeded.projectRoot,
        sessionId: "session-thread-catalog-resume-001",
        sessionFilePath,
        currentGeneratedFilePath: generatedFilePath,
        threadDbPath: seeded.threadDbPath,
        executable: "pi-lh",
        argv: ["pi-lh", "--session", sessionFilePath, "--model", "openai/gpt-5.1-codex-max"],
        cwd: seeded.projectRoot,
      });
      expect(resume.shellCommand).toBe(
        `cd '${seeded.projectRoot}' && pi-lh --session '${sessionFilePath}' --model openai/gpt-5.1-codex-max`,
      );
      catalog.close();
    });
  });

  it("uses deterministic fallback names, list ordering, and identifier resolution", async () => {
    await withTempDir(async (rootDir) => {
      const catalog = new ThreadCatalog({ catalogDbPath: join(rootDir, "catalog.sqlite") });
      const older = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-alpha-001",
        prompt: "Alpha long work.",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const newer = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-beta-001",
        prompt: "Beta catalog thread.",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });

      const alpha = catalog.upsertFromThreadDb({ threadDbPath: older.threadDbPath });
      catalog.upsertFromThreadDb({ threadDbPath: newer.threadDbPath, name: "Beta Catalog Thread" });

      expect(alpha.name).toBe("alpha-project: Alpha long work.");
      const listed = catalog.list();
      expect(listed.map((row) => row.threadId)).toEqual([
        "thread-catalog-beta-001",
        "thread-catalog-alpha-001",
      ]);
      expect(listed.map((row) => row.id)).toEqual([2, 1]);
      expect(catalog.show("2").threadId).toBe("thread-catalog-beta-001");
      expect(catalog.show("thread-catalog-alpha").threadId).toBe("thread-catalog-alpha-001");
      expect(catalog.show("Beta Catalog Thread").threadId).toBe("thread-catalog-beta-001");
      expect(catalog.show("Catalog Thread").threadId).toBe("thread-catalog-beta-001");
      expect(catalog.show("session-thread-catalog-beta").threadId).toBe("thread-catalog-beta-001");
      expect(() => catalog.show("thread-catalog")).toThrow(AmbiguousThreadCatalogReferenceError);
      catalog.close();
    });
  });
});

describe("lhx threads package CLI", () => {
  it("upserts, lists, shows, and refreshes through packages/lh-context/src/cli.ts", async () => {
    await withTempDir(async (rootDir) => {
      const catalogDbPath = join(rootDir, "catalog.sqlite");
      const seeded = await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-cli-001",
        prompt: "Exercise the package CLI wrapper.",
      });

      const upsert = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          PACKAGE_CLI_PATH,
          "threads",
          "upsert",
          "--catalog-db",
          catalogDbPath,
          "--thread-db",
          seeded.threadDbPath,
          "--name",
          "CLI Catalog Thread",
        ],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(upsert.status, upsert.stderr).toBe(0);
      expect((JSON.parse(upsert.stdout) as ThreadCatalogRow).name).toBe("CLI Catalog Thread");

      const list = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "list", "--catalog-db", catalogDbPath, "--json"],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(list.status, list.stderr).toBe(0);
      expect((JSON.parse(list.stdout) as ThreadCatalogRow[])[0]).toMatchObject({
        id: 1,
        threadId: "thread-catalog-cli-001",
      });

      const humanList = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "list", "--catalog-db", catalogDbPath],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(humanList.status, humanList.stderr).toBe(0);
      expect(humanList.stdout).toContain("ID");
      expect(humanList.stdout).toContain("PROJECT");
      expect(humanList.stdout).toContain("AGE");
      expect(humanList.stdout).toContain("TURNS");
      expect(humanList.stdout).toContain("TOKENS");
      expect(humanList.stdout).toContain("HEALTH");
      expect(humanList.stdout).toContain("NAME");
      expect(humanList.stdout).not.toContain("MSGS");
      expect(humanList.stdout).toContain("CLI Catalog Thread");

      const show = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "show", "1", "--catalog-db", catalogDbPath],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(show.status, show.stderr).toBe(0);
      expect((JSON.parse(show.stdout) as ThreadCatalogRow).threadId).toBe("thread-catalog-cli-001");

      const resume = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "resume", "CLI Catalog", "--catalog-db", catalogDbPath],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(resume.status, resume.stderr).toBe(0);
      expect(resume.stdout).toContain("Long Horizon thread resume command");
      expect(resume.stdout).toContain("CLI Catalog Thread (thread-catalog-cli-001)");
      expect(resume.stdout).toContain(`cd ${seeded.projectRoot} && pi-lh --session`);

      const resumeJson = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "resume", "CLI Catalog", "--catalog-db", catalogDbPath, "--json"],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(resumeJson.status, resumeJson.stderr).toBe(0);
      expect(JSON.parse(resumeJson.stdout) as ThreadResumeCommand).toMatchObject({
        threadId: "thread-catalog-cli-001",
        name: "CLI Catalog Thread",
        projectRoot: seeded.projectRoot,
        sessionId: "session-thread-catalog-cli-001",
        threadDbPath: seeded.threadDbPath,
        argv: ["pi-lh", "--session", join(seeded.projectRoot, ".pi", "session-thread-catalog-cli-001-source.jsonl")],
      });

      await seedCanonicalThread({
        rootDir,
        threadId: "thread-catalog-cli-001",
        messageCount: 2,
        updatedAt: "2026-03-01T00:00:00.000Z",
      });

      const refresh = spawnSync(
        process.execPath,
        ["--import", "tsx", PACKAGE_CLI_PATH, "threads", "refresh", "--all", "--catalog-db", catalogDbPath],
        { cwd: PACKAGE_ROOT, encoding: "utf8" },
      );
      expect(refresh.status, refresh.stderr).toBe(0);
      expect((JSON.parse(refresh.stdout) as ThreadCatalogRow[])[0]).toMatchObject({
        name: "CLI Catalog Thread",
        nameSource: "user",
        messageCount: 2,
      });
    });
  });
});
