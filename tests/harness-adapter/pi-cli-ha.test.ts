import assert from "node:assert/strict";
import test from "node:test";

import { createPiCliHarnessAdapter } from "../../src/harness-adapter/pi-cli-ha/pi-cli-ha.js";

test("PI load is triggered after successful write", async () => {
  const switchedTo: string[] = [];
  const adapter = createPiCliHarnessAdapter({
    switchSession: async (sessionPath) => {
      switchedTo.push(sessionPath);
      return { cancelled: false };
    },
  });

  const result = await adapter.loadThreadViewFile({
    threadId: "thread-load-success",
    threadViewId: "thread-view-load-success",
    filePath: "/tmp/generated/thread-view-load-success.jsonl",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(switchedTo, ["/tmp/generated/thread-view-load-success.jsonl"]);
});

test("reload failure is explicit", async () => {
  const adapter = createPiCliHarnessAdapter({
    switchSession: async () => {
      throw new Error("switch failed");
    },
  });

  const result = await adapter.loadThreadViewFile({
    threadId: "thread-load-failure",
    threadViewId: "thread-view-load-failure",
    filePath: "/tmp/generated/thread-view-load-failure.jsonl",
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.code, "PI_RELOAD_FAILED");
  assert.match(result.issues[0]?.cause ?? "", /switch failed/);
});

test("load requests still use the session-switch path when the generated file is already current", async () => {
  const switchedTo: string[] = [];
  const input = {
    threadId: "thread-load-repeat",
    threadViewId: "thread-view-load-repeat",
    filePath: "/tmp/generated/thread-view-load-repeat.jsonl",
  };
  const adapter = createPiCliHarnessAdapter({
    currentSessionFile: () => input.filePath,
    switchSession: async (sessionPath) => {
      switchedTo.push(sessionPath);
      return { cancelled: false };
    },
  });

  const result = await adapter.loadThreadViewFile(input);

  assert.equal(result.ok, true);
  assert.deepEqual(switchedTo, [input.filePath]);
});
