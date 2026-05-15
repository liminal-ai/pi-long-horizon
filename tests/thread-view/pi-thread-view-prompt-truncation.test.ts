import assert from "node:assert/strict";
import test from "node:test";

import { makePiThreadViewFile } from "../../src/thread-view/test/fixtures.js";
import { applyPromptVisibleToolResultTruncationToPiThreadViewFile } from "../../src/thread-view/targets/pi/pi-thread-view-prompt-truncation.js";

test("prompt-visible PI Thread View truncation applies the live raw-zone policy before write", () => {
  const file = makePiThreadViewFile({
    threadId: "thread-prompt-truncation",
    threadViewId: "thread-view-prompt-truncation",
    entries: [
      {
        entryType: "message",
        role: "toolResult",
        generatedSource: "raw_turn_message",
        content: {
          parts: [
            {
              partType: "tool_result",
              content: {
                output: "A".repeat(200),
                toolCallId: "call-old",
                toolName: "read",
                isError: false,
              },
            },
          ],
        },
        metadata: {
          toolCallId: "call-old",
          toolName: "read",
        },
      },
      {
        entryType: "message",
        role: "assistant",
        generatedSource: "raw_turn_message",
        content: "newer ordinary context ".repeat(20),
      },
      {
        entryType: "message",
        role: "assistant",
        generatedSource: "smooth_turn",
        content: "older compacted context",
      },
    ],
    entryCount: 3,
  });

  const result = applyPromptVisibleToolResultTruncationToPiThreadViewFile(file, {
    rawZoneTokenThreshold: 100,
    truncatedCharLimit: 12,
  });
  const toolEntry = result.file.entries[0]!;
  const output = (toolEntry.content as { parts: Array<{ content: { output: string } }> }).parts[0]!.content.output;
  const originalOutput = (file.entries[0]!.content as { parts: Array<{ content: { output: string } }> }).parts[0]!.content.output;

  assert.deepEqual(result.truncatedToolCallIds, ["call-old"]);
  assert.equal(output, `${"A".repeat(12)}...`);
  assert.equal(originalOutput, "A".repeat(200));
});

test("prompt-visible PI Thread View truncation uses default 500-character cap", () => {
  const file = makePiThreadViewFile({
    threadId: "thread-prompt-truncation-default",
    threadViewId: "thread-view-prompt-truncation-default",
    entries: [
      {
        entryType: "message",
        role: "toolResult",
        generatedSource: "raw_turn_message",
        content: {
          parts: [
            {
              partType: "tool_result",
              content: {
                output: "Q".repeat(700),
                toolCallId: "call-default",
                toolName: "read",
                isError: false,
              },
            },
          ],
        },
        metadata: {
          toolCallId: "call-default",
          toolName: "read",
        },
      },
      {
        entryType: "message",
        role: "assistant",
        generatedSource: "raw_turn_message",
        content: "newer ordinary context ".repeat(20),
      },
    ],
    entryCount: 2,
  });

  const result = applyPromptVisibleToolResultTruncationToPiThreadViewFile(file, {
    rawZoneTokenThreshold: 100,
  });
  const toolEntry = result.file.entries[0]!;
  const output = (toolEntry.content as { parts: Array<{ content: { output: string } }> }).parts[0]!.content.output;

  assert.deepEqual(result.truncatedToolCallIds, ["call-default"]);
  assert.equal(output, `${"Q".repeat(500)}...`);
});
