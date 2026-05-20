import assert from "node:assert/strict";
import test from "node:test";

import { makeThreadViewMessage } from "../../src/thread-view/test/fixtures.js";
import { buildDraftThreadView } from "../../src/thread-view/services/thread-view-builder.js";
import { buildPiThreadViewFile } from "../../src/thread-view/targets/pi/pi-thread-view-builder.js";
import { withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { seedDeterministicRebuildThread } from "./helpers.js";

test("legacy placeholder lower-band outputs are blocked from PI-target output", async () => {
  await withTempFeature3Store(async ({ storeRootDir }) => {
    const context = await seedDeterministicRebuildThread(storeRootDir);
    const buildResult = await buildDraftThreadView(
      {
        threadId: context.threadId,
        requestedLowerBound: 30,
        requestedBandPercentages: { fullFidelity: 50, smooth: 20, detailed: 20, brief: 10 },
        mode: "strict",
      },
      {
        threadStore: context.threadStore,
        threadViewStore: context.threadViewStore,
      },
    );
    const opened = await context.threadViewStore.openThreadView(context.threadId, buildResult.draftThreadViewId);

    assert.equal(opened.ok, true);

    const file = await buildPiThreadViewFile({
      threadId: context.threadId,
      threadViewId: buildResult.draftThreadViewId,
      emittedMessages: opened.value.view.emittedMessages,
      sessionId: "projection-session-001",
      cwd: "/tmp/project",
      parentSessionId: "source-session-001",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(file.entryCount, file.entries.length);
    assert.equal(file.placeholderExplicit, false);
    assert.equal(file.sessionId, "projection-session-001");
    assert.equal(file.parentSessionId, "source-session-001");
    assert.equal(
      buildResult.blockers.some(
        (issue) =>
          issue.code === "CHUNK_STATE_INVALID" &&
          issue.cause === "legacy_placeholder_chunk_state",
      ),
      true,
    );

    const detailed = file.entries.find((entry) => entry.generatedSource === "detailed_chunk_summary");
    const brief = file.entries.find((entry) => entry.generatedSource === "brief_chunk_summary");
    const smooth = file.entries.find((entry) => entry.generatedSource === "smooth_turn");

    assert.equal(detailed, undefined);
    assert.equal(brief, undefined);
    assert.equal(smooth?.metadata?.sourceKind, "smooth_turn");
  });
});

test("semantic lower-band outputs do not mark PI-target output as placeholder explicit", async () => {
  const threadViewId = "thread-view-semantic-lower-band";
  const file = await buildPiThreadViewFile({
    threadId: "thread-semantic-lower-band",
    threadViewId,
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId,
        bandType: "detailed",
        sourceKind: "detailed_chunk_summary",
        sourceReference: "chunk-001",
        content: "Semantic detailed summary",
      }),
      makeThreadViewMessage({
        threadViewId,
        bandType: "brief",
        sourceKind: "brief_chunk_summary",
        sourceReference: "chunk-001",
        content: "Semantic brief summary",
      }),
    ],
    sessionId: "projection-session-semantic-001",
    cwd: "/tmp/project",
    parentSessionId: "source-session-001",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(file.placeholderExplicit, false);
  assert.equal(
    file.entries.some((entry) => entry.generatedSource === "detailed_chunk_summary"),
    true,
  );
  assert.equal(
    file.entries.some((entry) => entry.generatedSource === "brief_chunk_summary"),
    true,
  );
  assert.equal(
    file.entries.some((entry) => entry.metadata?.placeholderExplicit === true),
    false,
  );
});

test("raw tool-result metadata is preserved in PI-target entries", async () => {
  const threadViewId = "thread-view-tool-result";
  const file = await buildPiThreadViewFile({
    threadId: "thread-tool-result",
    threadViewId,
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId,
        bandType: "full_fidelity",
        sourceKind: "raw_turn_message",
        sourceReference: "turn-tool/message-tool-result",
        content: {
          actorType: "tool",
          messageKind: "tool_result",
          parts: [
            {
              partOrder: 1,
              partType: "tool_result",
              content: {
                output: "tool output",
                toolCallId: "call-production-001",
                toolName: "bash",
              },
            },
          ],
          targetMetadata: {
            piRole: "toolResult",
            toolCallId: "call-production-001",
            toolName: "bash",
          },
        },
      }),
    ],
    sessionId: "projection-session-tool-result",
    cwd: "/tmp/project",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(file.entries[0]?.role, "toolResult");
  assert.equal(file.entries[0]?.metadata?.toolCallId, "call-production-001");
  assert.equal(file.entries[0]?.metadata?.toolName, "bash");
});

test("system-origin raw messages are excluded from PI-target entries", async () => {
  const threadViewId = "thread-view-system-role";
  const file = await buildPiThreadViewFile({
    threadId: "thread-system-role",
    threadViewId,
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId,
        bandType: "full_fidelity",
        sourceKind: "raw_turn_message",
        sourceReference: "turn-system/message-system",
        content: {
          actorType: "system",
          messageKind: "runtime_event",
          parts: [
            {
              partOrder: 1,
              partType: "text",
              content: "You are operating under system constraints.",
            },
          ],
          targetMetadata: {
            piRole: "system",
            rawType: "system",
            sessionEntryId: "entry-system-001",
          },
        },
      }),
    ],
    sessionId: "projection-session-system",
    cwd: "/tmp/project",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(file.entryCount, 0);
  assert.deepEqual(file.entries, []);
});

test("raw custom-role metadata is preserved in PI-target entries", async () => {
  const threadViewId = "thread-view-custom-role";
  const file = await buildPiThreadViewFile({
    threadId: "thread-custom-role",
    threadViewId,
    emittedMessages: [
      makeThreadViewMessage({
        threadViewId,
        bandType: "full_fidelity",
        sourceKind: "raw_turn_message",
        sourceReference: "turn-custom/message-custom",
        content: {
          actorType: "runtime",
          messageKind: "unknown",
          parts: [
            {
              partOrder: 1,
              partType: "unknown",
              content: {
                raw: {
                  role: "custom",
                  customType: "context-steward.note",
                  content: "A compact custom note.",
                  display: false,
                  details: {
                    reason: "preserve-raw-message",
                  },
                  timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
                },
              },
            },
          ],
          targetMetadata: {
            piRole: "custom",
            rawType: "custom",
            sessionEntryId: "entry-custom-001",
          },
        },
      }),
    ],
    sessionId: "projection-session-custom",
    cwd: "/tmp/project",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(file.entries[0]?.role, "custom");
  assert.equal(file.entries[0]?.metadata?.piRole, "custom");
  assert.equal(file.entries[0]?.metadata?.rawType, "custom");
});
