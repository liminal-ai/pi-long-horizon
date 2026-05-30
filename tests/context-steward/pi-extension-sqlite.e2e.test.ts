import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { ThreadCatalog } from "../../packages/lh-context/src/threads/catalog.js";
import registerContextStewardExtension from "../../src/context-steward/pi/pi-extension.js";
import {
  makePiAssistantMessage,
  makePiExtensionContext,
  makePiUserMessage,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";
import { withTempThreadStore } from "../../src/context-steward/test/temp-store.js";
import { SqliteThreadStore, resolveThreadSqlitePath } from "../../src/context-steward/store/sqlite-thread-store.js";
import type { StewardResult } from "../../src/context-steward/domain/errors.js";

class FakeExtensionApi {
  readonly commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  readonly handlers = new Map<string, Array<(event: any, ctx: any) => Promise<unknown> | unknown>>();

  on(eventName: string, handler: (event: any, ctx: any) => Promise<unknown> | unknown): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }): void {
    this.commands.set(name, options);
  }

  async emit(eventName: string, event: any, ctx: any): Promise<void> {
    for (const handler of this.handlers.get(eventName) ?? []) {
      await handler(event, ctx);
    }
  }
}

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function ensureTargetSessionFile(target: ReturnType<typeof makeThreadTarget>) {
  if (!target.sessionFilePath) {
    return;
  }

  await mkdir(dirname(target.sessionFilePath), { recursive: true });
  await writeFile(target.sessionFilePath, '{"type":"session"}\n', "utf8");
}

async function waitForAssertion(assertion: () => void | Promise<void>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(10);
    }
  }

  throw lastError;
}

test("default PI extension wiring captures one closed turn into SQLite and keeps status commands working", async () => {
  await withTempThreadStore(async ({ projectDir, storeRootDir }) => {
    const priorDelay = process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
    const priorCatalogDb = process.env.LH_THREADS_CATALOG_DB;
    const priorCatalogDebounce = process.env.LH_THREAD_CATALOG_REFRESH_DEBOUNCE_MS;
    process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = "0";
    process.env.LH_THREADS_CATALOG_DB = join(projectDir, "catalog.sqlite");
    process.env.LH_THREAD_CATALOG_REFRESH_DEBOUNCE_MS = "0";

    try {
      const target = makeThreadTarget({
        sessionId: "session-pi-extension-sqlite-e2e",
        sessionFilePath: `${projectDir}/pi/session-pi-extension-sqlite-e2e.jsonl`,
        cwd: projectDir,
      });
      await ensureTargetSessionFile(target);

      const api = new FakeExtensionApi();
      registerContextStewardExtension(api as unknown as ExtensionAPI);

      const eventCtx = makePiExtensionContext(target);
      await api.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "E2E prompt" }) }, eventCtx);
      await api.emit(
        "message_end",
        {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-pi-extension-sqlite-e2e",
            content: [{ type: "text", text: "E2E response" }],
          }),
        },
        eventCtx,
      );
      const preTurnStore = new SqliteThreadStore(storeRootDir);
      const preTurnThread = expectOk(await preTurnStore.findManagedThread(target));
      assert.ok(preTurnThread);
      const seededCatalog = new ThreadCatalog({ catalogDbPath: process.env.LH_THREADS_CATALOG_DB });
      try {
        seededCatalog.upsertFromThreadDb({
          threadDbPath: resolveThreadSqlitePath(storeRootDir, preTurnThread.threadId),
          name: "E2E Catalog Name",
        });
      } finally {
        seededCatalog.close();
      }

      await api.emit("turn_end", { type: "turn_end", timestamp: Date.parse("2026-05-26T12:30:00.000Z") }, eventCtx);

      const statusCommand = api.commands.get("lh-status");
      assert.ok(statusCommand);
      const notifications: Array<{ message: string; level: string }> = [];
      const commandCtx = {
        ...eventCtx,
        ui: {
          notify: (message: string, level: string) => {
            notifications.push({ message, level });
          },
        },
      } as unknown as ExtensionCommandContext;
      await statusCommand!.handler("", commandCtx);

      const sqliteStore = new SqliteThreadStore(storeRootDir);
      const thread = expectOk(await sqliteStore.findManagedThread(target));
      assert.ok(thread);

      const snapshot = expectOk(await sqliteStore.openThread(thread.threadId));
      assert.equal(snapshot.turns.length, 1);
      assert.equal(snapshot.turns[0]?.lifecycleStatus, "closed");
      await stat(resolveThreadSqlitePath(storeRootDir, thread.threadId));
      await waitForAssertion(() => {
        const catalog = new ThreadCatalog({ catalogDbPath: process.env.LH_THREADS_CATALOG_DB });
        try {
          const row = catalog.show(thread.threadId);
          assert.equal(row.name, "E2E Catalog Name");
          assert.equal(row.nameSource, "user");
          assert.equal(row.observationSource, "refresh");
          assert.equal(row.messageCount, 2);
          assert.equal(row.turnCount, 1);
        } finally {
          catalog.close();
        }
      });

      assert.deepEqual(notifications, [
        {
          level: "info",
          message: `Status: Thread ${thread.threadId} has 2 messages, 1 turns, and turn state ready.`,
        },
      ]);
    } finally {
      if (priorDelay === undefined) {
        delete process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
      } else {
        process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = priorDelay;
      }
      if (priorCatalogDb === undefined) {
        delete process.env.LH_THREADS_CATALOG_DB;
      } else {
        process.env.LH_THREADS_CATALOG_DB = priorCatalogDb;
      }
      if (priorCatalogDebounce === undefined) {
        delete process.env.LH_THREAD_CATALOG_REFRESH_DEBOUNCE_MS;
      } else {
        process.env.LH_THREAD_CATALOG_REFRESH_DEBOUNCE_MS = priorCatalogDebounce;
      }
    }
  });
});

test("turn_end catalog refresh uses the resolved SQLite store path", async () => {
  await withTempThreadStore(async ({ projectDir }) => {
    const priorDelay = process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
    process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = "0";

    try {
      const customStoreRootDir = join(projectDir, "custom-store-root");
      const catalogDbPath = join(projectDir, "custom-catalog.sqlite");
      await mkdir(customStoreRootDir, { recursive: true });

      const target = makeThreadTarget({
        sessionId: "session-pi-extension-custom-store",
        sessionFilePath: `${projectDir}/pi/session-pi-extension-custom-store.jsonl`,
        cwd: projectDir,
      });
      await ensureTargetSessionFile(target);

      const api = new FakeExtensionApi();
      registerContextStewardExtension(api as unknown as ExtensionAPI, {
        createStore: () => new SqliteThreadStore(customStoreRootDir),
        threadCatalogRefresh: {
          catalogDbPath,
          debounceMs: 0,
        },
      });

      const eventCtx = makePiExtensionContext(target);
      await api.emit("message_end", { type: "message_end", message: makePiUserMessage({ content: "Custom store prompt" }) }, eventCtx);
      await api.emit(
        "message_end",
        {
          type: "message_end",
          message: makePiAssistantMessage({
            responseId: "response-pi-extension-custom-store",
            content: [{ type: "text", text: "Custom store response" }],
          }),
        },
        eventCtx,
      );
      await api.emit("turn_end", { type: "turn_end", timestamp: Date.parse("2026-05-26T12:45:00.000Z") }, eventCtx);

      const sqliteStore = new SqliteThreadStore(customStoreRootDir);
      const thread = expectOk(await sqliteStore.findManagedThread(target));
      assert.ok(thread);

      await waitForAssertion(() => {
        const catalog = new ThreadCatalog({ catalogDbPath });
        try {
          const row = catalog.show(thread.threadId);
          assert.equal(row.threadDbPath, resolveThreadSqlitePath(customStoreRootDir, thread.threadId));
          assert.equal(row.messageCount, 2);
          assert.equal(row.turnCount, 1);
          assert.equal(row.observationSource, "refresh");
        } finally {
          catalog.close();
        }
      });
    } finally {
      if (priorDelay === undefined) {
        delete process.env.LH_TURN_END_MAINTENANCE_DELAY_MS;
      } else {
        process.env.LH_TURN_END_MAINTENANCE_DELAY_MS = priorDelay;
      }
    }
  });
});
