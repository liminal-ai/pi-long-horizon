import assert from "node:assert/strict";
import test from "node:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  makePiAssistantMessage,
  makePiToolResultMessage,
  makePiUserMessage,
} from "../../src/context-steward/test/fixtures.js";
import { PromptVisibleToolResultProjection } from "../../src/thread-view/services/prompt-visible-tool-result-projection.js";

function makeCompactedBoundaryMessage(): AgentMessage {
  return {
    role: "custom",
    customType: "pi-long-horizon.compacted-content",
    content: [],
  } as unknown as AgentMessage;
}

test("incremental prompt projection truncates a tool result when newer ordinary messages push it past the frontier", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 12,
  });
  const oldToolResult = makePiToolResultMessage({
    toolCallId: "call-frontier-001",
    content: [{ type: "text", text: "A".repeat(200) }],
  });
  const newerAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
  });
  const newestUser = makePiUserMessage({
    content: "follow-up prompt ".repeat(20),
  });

  assert.deepEqual(projection.observeMessage(oldToolResult).newlyTruncatedToolCallIds, []);
  assert.deepEqual(projection.observeMessage(newerAssistant).newlyTruncatedToolCallIds, ["call-frontier-001"]);
  assert.deepEqual(projection.observeMessage(newestUser).newlyTruncatedToolCallIds, []);

  const applied = projection.applyToMessages([oldToolResult, newerAssistant, newestUser]);
  const appliedToolResult = applied[0] as typeof oldToolResult;

  assert.equal((appliedToolResult.content[0] as { text: string }).text, `${"A".repeat(12)}...`);
  assert.equal((oldToolResult.content[0] as { text: string }).text, "A".repeat(200));
});

test("prompt projection default truncation cap is 500 characters", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
  });
  const oldToolResult = makePiToolResultMessage({
    toolCallId: "call-default-cap",
    content: [{ type: "text", text: "Z".repeat(700) }],
  });
  const newerAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
  });

  projection.hydrateFromMessages([oldToolResult, newerAssistant]);
  const applied = projection.applyToMessages([oldToolResult, newerAssistant]);
  const appliedToolResult = applied[0] as typeof oldToolResult;

  assert.equal((appliedToolResult.content[0] as { text: string }).text, `${"Z".repeat(500)}...`);
});

test("prompt projection hydrates from an existing message list and applies known truncations cheaply", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 10,
    truncatedCharLimit: 8,
  });
  const messages = [
    makePiToolResultMessage({
      toolCallId: "call-hydrate-001",
      content: [{ type: "text", text: "B".repeat(200) }],
    }),
    makePiAssistantMessage({ content: [{ type: "text", text: "newer" }] }),
  ];

  projection.hydrateFromMessages(messages);
  assert.deepEqual(projection.getDirtyToolCallIds(), ["call-hydrate-001"]);
  assert.equal(projection.getDecisions().map((decision) => decision.toolCallId).includes("call-hydrate-001"), true);

  const applied = projection.applyToMessages(messages);
  const appliedToolResult = applied[0] as ReturnType<typeof makePiToolResultMessage>;

  assert.equal((appliedToolResult.content[0] as { text: string }).text, `${"B".repeat(8)}...`);
});

test("prompt projection can truncate multiple crossed tool results from one newer message", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 10,
  });
  const firstToolResult = makePiToolResultMessage({
    toolCallId: "call-multi-001",
    content: [{ type: "text", text: "C".repeat(120) }],
  });
  const secondToolResult = makePiToolResultMessage({
    toolCallId: "call-multi-002",
    content: [{ type: "text", text: "D".repeat(120) }],
  });
  const newestAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "newer ordinary response ".repeat(30) }],
  });

  projection.observeMessage(firstToolResult);
  projection.observeMessage(secondToolResult);

  assert.deepEqual(
    projection.observeMessage(newestAssistant).newlyTruncatedToolCallIds,
    ["call-multi-001", "call-multi-002"],
  );
  assert.deepEqual(projection.getDirtyToolCallIds(), ["call-multi-001", "call-multi-002"]);
});

test("prompt projection recovers by hydrating from context messages after an early observe", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 9,
  });
  const oldToolResult = makePiToolResultMessage({
    toolCallId: "call-race-001",
    content: [{ type: "text", text: "E".repeat(200) }],
  });
  const newerAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "newer ordinary response ".repeat(20) }],
  });

  projection.observeMessage(newerAssistant);
  assert.equal(projection.getStatus().hydrated, false);

  const applied = projection.applyToMessages([oldToolResult, newerAssistant]);
  const appliedToolResult = applied[0] as typeof oldToolResult;

  assert.equal(projection.getStatus().hydrated, true);
  assert.equal((appliedToolResult.content[0] as { text: string }).text, `${"E".repeat(9)}...`);
});

test("prompt projection does not apply pre-boundary decisions before the latest compacted marker", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 8,
  });
  const preBoundaryToolResult = makePiToolResultMessage({
    toolCallId: "call-boundary-old",
    content: [{ type: "text", text: "F".repeat(200) }],
  });
  const preBoundaryAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "pre-boundary response ".repeat(20) }],
  });
  const boundary = makeCompactedBoundaryMessage();
  const postBoundaryToolResult = makePiToolResultMessage({
    toolCallId: "call-boundary-new",
    content: [{ type: "text", text: "G".repeat(200) }],
  });
  const postBoundaryAssistant = makePiAssistantMessage({
    content: [{ type: "text", text: "post-boundary response ".repeat(20) }],
  });

  const messages = [
    preBoundaryToolResult,
    preBoundaryAssistant,
    boundary,
    postBoundaryToolResult,
    postBoundaryAssistant,
  ];

  projection.hydrateFromMessages(messages);
  const applied = projection.applyToMessages(messages);
  const appliedPreBoundaryToolResult = applied[0] as typeof preBoundaryToolResult;
  const appliedPostBoundaryToolResult = applied[3] as typeof postBoundaryToolResult;

  assert.equal(
    (appliedPreBoundaryToolResult.content[0] as { text: string }).text,
    "F".repeat(200),
  );
  assert.equal(
    (appliedPostBoundaryToolResult.content[0] as { text: string }).text,
    `${"G".repeat(8)}...`,
  );
});

test("prompt projection markClean clears only reported tool results", () => {
  const projection = new PromptVisibleToolResultProjection({
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 10,
  });

  projection.observeMessage(makePiToolResultMessage({
    toolCallId: "call-clean-001",
    content: [{ type: "text", text: "H".repeat(120) }],
  }));
  projection.observeMessage(makePiToolResultMessage({
    toolCallId: "call-clean-002",
    content: [{ type: "text", text: "I".repeat(120) }],
  }));
  projection.observeMessage(makePiAssistantMessage({
    content: [{ type: "text", text: "newer ordinary response ".repeat(30) }],
  }));

  projection.markClean(["call-clean-001"]);

  assert.deepEqual(projection.getDirtyToolCallIds(), ["call-clean-002"]);
});
