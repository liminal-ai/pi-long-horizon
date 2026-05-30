import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { ThreadCatalogRefreshScheduler } from "../../src/context-steward/services/thread-catalog-refresh-service.js";

test("thread catalog refresh scheduler debounces per thread and logs failures without throwing", async () => {
  const calls: Array<{ threadId: string; threadDbPath: string; catalogDbPath: string }> = [];
  const logs: Array<{ label: string; parts?: Record<string, unknown> }> = [];
  const scheduler = new ThreadCatalogRefreshScheduler({
    catalogDbPath: "/tmp/catalog.sqlite",
    debounceMs: 5,
    refreshThreadDb: (input) => {
      calls.push(input);
      if (input.threadId === "thread-fails") {
        throw new Error("catalog unavailable");
      }
    },
    logger: (label, _startedAt, parts) => {
      logs.push({ label, parts });
    },
  });

  scheduler.schedule({ threadId: "thread-a", threadDbPath: "/tmp/thread-a-old.sqlite" });
  scheduler.schedule({ threadId: "thread-a", threadDbPath: "/tmp/thread-a-new.sqlite" });
  scheduler.schedule({ threadId: "thread-b", threadDbPath: "/tmp/thread-b.sqlite" });
  scheduler.schedule({ threadId: "thread-fails", threadDbPath: "/tmp/thread-fails.sqlite" });

  await sleep(40);

  assert.deepEqual(
    calls.map((call) => ({ threadId: call.threadId, threadDbPath: call.threadDbPath, catalogDbPath: call.catalogDbPath })),
    [
      {
        threadId: "thread-a",
        threadDbPath: "/tmp/thread-a-new.sqlite",
        catalogDbPath: "/tmp/catalog.sqlite",
      },
      {
        threadId: "thread-b",
        threadDbPath: "/tmp/thread-b.sqlite",
        catalogDbPath: "/tmp/catalog.sqlite",
      },
      {
        threadId: "thread-fails",
        threadDbPath: "/tmp/thread-fails.sqlite",
        catalogDbPath: "/tmp/catalog.sqlite",
      },
    ],
  );
  assert.ok(
    logs.some(
      (log) =>
        log.label === "threadCatalogRefreshError" &&
        log.parts?.threadId === "thread-fails" &&
        log.parts?.cause === "catalog unavailable",
    ),
  );
});
