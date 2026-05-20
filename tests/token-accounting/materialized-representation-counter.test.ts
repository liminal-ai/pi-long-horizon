import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import {
  countBandMaterialized,
  countBriefChunkMaterialized,
  countChunkSmoothMaterialized,
  countDetailedChunkMaterialized,
  countGeneratedSession,
  countRawMessageMaterialized,
  countRawTurnMaterialized,
  countSmoothTurnMaterialized,
  countTurnLowerBandProjectionMaterialized,
  createMaterializedRepresentationHash,
  MATERIALIZED_REPRESENTATION_COUNTER_SOURCE,
  MATERIALIZED_REPRESENTATION_COUNTER_TRUST_CLASS,
} from "../../src/token-accounting/index.js";
import { makeChunkState, makeLegacyPlaceholderChunkState } from "../../src/thread/async-thread/test/fixtures.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeMessageRecord,
  makePartRecord,
  makeTurnRecord,
} from "../../src/context-steward/test/fixtures.js";
import { makePiThreadViewFile, makeThreadViewMessage, withTempFeature3Store } from "../../src/thread-view/test/fixtures.js";
import { materializeRawThreadViewMessageContent } from "../../src/thread-view/services/thread-view-materializer.js";
import {
  serializePiThreadViewFileContent,
  writePiThreadViewFile,
} from "../../src/thread-view/targets/pi/pi-thread-view-writer.js";

const CREATED_AT = "2026-05-12T12:00:00.000Z";

function createPathResolver(context: {
  resolveGeneratedPath(threadId: string, ...segments: string[]): string;
  resolveGeneratedArchivePath(threadId: string, ...segments: string[]): string;
}) {
  return {
    resolveGeneratedFilePath(input: { threadId: string; file: { fileName: string } }) {
      return context.resolveGeneratedPath(input.threadId, input.file.fileName);
    },
    resolveArchiveFilePath(input: {
      threadId: string;
      file: { fileName: string };
      archivedAt: string;
    }) {
      const stamp = input.archivedAt.replace(/[:.]/g, "-");
      return context.resolveGeneratedArchivePath(input.threadId, `${stamp}-${basename(input.file.fileName)}`);
    },
  };
}

test("raw message materialized count hashes the exact Thread View raw content shape", () => {
  const message = makeMessageRecord({
    messageId: "message-tool-result",
    actorType: "tool",
    messageKind: "tool_result",
    sourceRevision: 7,
    parts: [
      makePartRecord({
        partType: "tool_result",
        content: {
          output: "dense tool output ".repeat(40),
          toolCallId: "call-production-001",
          toolName: "bash",
        },
      }),
    ],
    targetMetadata: {
      runtime: "pi",
      piRole: "toolResult",
      toolCallId: "call-production-001",
      toolName: "bash",
    },
  });
  const representation = materializeRawThreadViewMessageContent(message);

  const record = countRawMessageMaterialized(message, { createdAt: CREATED_AT });

  assert.equal(record.scope, "raw_message_materialized");
  assert.equal(record.source, MATERIALIZED_REPRESENTATION_COUNTER_SOURCE);
  assert.equal(record.trustClass, MATERIALIZED_REPRESENTATION_COUNTER_TRUST_CLASS);
  assert.equal(record.sourceRevision, 7);
  assert.equal(record.representationHash, createMaterializedRepresentationHash(representation));
  assert.equal(record.count > 0, true);
  assert.match(record.provenance ?? "", /thread-view\.raw-message-content/);
});

test("raw turn materialized count is a rollup of raw message materialized counts", () => {
  const first = makeMessageRecord({
    messageId: "message-001",
    sourceOrder: 1,
    parts: [makePartRecord({ partId: "part-001", content: "first raw message" })],
  });
  const second = makeMessageRecord({
    messageId: "message-002",
    sourceOrder: 2,
    parts: [makePartRecord({ partId: "part-002", content: "second raw message" })],
  });
  const turn = makeTurnRecord({
    turnId: "turn-raw",
    sourceRevision: 9,
    messageIds: [first.messageId, second.messageId],
  });

  const record = countRawTurnMaterialized({
    turn,
    messages: [second, first],
    createdAt: CREATED_AT,
  });

  assert.equal(record.scope, "raw_turn_materialized");
  assert.equal(record.sourceRevision, 9);
  assert.equal(
    record.count,
    countRawMessageMaterialized(first, { createdAt: CREATED_AT }).count +
      countRawMessageMaterialized(second, { createdAt: CREATED_AT }).count,
  );
  assert.match(record.note ?? "", /Rollup of raw message materialized counts/);
});

test("smooth turn and chunk materialized counters produce scoped records with source revisions", () => {
  const turn = makeTurnRecord({
    sourceRevision: 3,
    smooth: {
      schemaVersion: "component_smooth_turn_v1",
      status: "ready",
      tokenCountMetadata: { count: 3, scope: "smooth_turn_materialized", source: "pi_heuristic", trustClass: "heuristic_estimate", representationHash: "sha256:test-smooth-3", createdAt: CREATED_AT },
      strategy: "component_smooth_turn_v1",
      generatedAt: DEFAULT_TEST_TIMESTAMP,
      sourceRevision: 4,
      components: [
        {
          componentId: "turn-001:user_prompt:message-001:part-001",
          kind: "user_prompt",
          status: "ready",
          text: "smooth turn text",
          quality: "deterministic_preserved",
          sourceMessageIds: ["message-001"],
          sourcePartIds: ["part-001"],
          sourceRevision: 4,
          generatedAt: DEFAULT_TEST_TIMESTAMP,
          strategy: "deterministic_user_prompt_preserved_v1",
        },
      ],
    },
  });
  const chunk = makeChunkState({
    chunkId: "chunk-counted",
    sourceRevision: 5,
  });

  const smooth = countSmoothTurnMaterialized(turn, { createdAt: CREATED_AT });
  const chunkSmooth = countChunkSmoothMaterialized(chunk, { createdAt: CREATED_AT });
  const detailed = countDetailedChunkMaterialized(chunk, { createdAt: CREATED_AT });
  const brief = countBriefChunkMaterialized(chunk, { createdAt: CREATED_AT });

  assert.equal(smooth.scope, "smooth_turn_materialized");
  assert.equal(smooth.sourceRevision, 4);
  assert.equal(chunkSmooth.scope, "chunk_smooth_materialized");
  assert.equal(chunkSmooth.sourceRevision, 5);
  assert.equal(detailed.scope, "detailed_chunk_materialized");
  assert.equal(detailed.sourceRevision, 5);
  assert.equal(brief.scope, "brief_chunk_materialized");
  assert.equal(brief.sourceRevision, 5);
  assert.equal(Boolean(smooth.representationHash), true);
  assert.equal(Boolean(chunkSmooth.representationHash), true);
  assert.equal(Boolean(detailed.representationHash), true);
  assert.equal(Boolean(brief.representationHash), true);
});

test("turn lower-band projection materialized counter hashes the conversation-only projection text", () => {
  const record = countTurnLowerBandProjectionMaterialized({
    text: "> Prompt text\n\n● Assistant text",
    sourceRevision: 14,
    createdAt: CREATED_AT,
  });

  assert.equal(record.scope, "turn_lower_band_projection_materialized");
  assert.equal(record.sourceRevision, 14);
  assert.equal(
    record.representationHash,
    createMaterializedRepresentationHash("> Prompt text\n\n● Assistant text"),
  );
  assert.match(record.provenance ?? "", /turn-lower-band-projection-content/);
});

test("semantic lower-band counters prefer persisted semantic artifact text over placeholder text", () => {
  const chunk = {
    ...makeChunkState({
      chunkId: "chunk-semantic-preferred",
      sourceRevision: 6,
      lowerBand: {
        detailed: {
          band: "detailed",
          status: "ready",
          text: "semantic detailed artifact",
          updatedAt: DEFAULT_TEST_TIMESTAMP,
        },
        brief: {
          band: "brief",
          status: "ready",
          text: "semantic brief artifact",
          updatedAt: DEFAULT_TEST_TIMESTAMP,
        },
      },
    }),
    placeholders: {
      chunkId: "chunk-semantic-preferred",
      threadId: "thread-001",
      detailed: {
        kind: "detailed",
        status: "ready",
        text: "placeholder detailed artifact",
        smoothSourceFingerprint: "sha256:placeholder-detailed",
        smoothSourceRevision: 6,
        smoothSourceTokenCount: 22,
        tokenCountMetadata: undefined,
        strategy: "deterministic_truncate_30",
        generatedAt: DEFAULT_TEST_TIMESTAMP,
        generatedFromComponentSmooth: true,
      },
      brief: {
        kind: "brief",
        status: "ready",
        text: "placeholder brief artifact",
        smoothSourceFingerprint: "sha256:placeholder-brief",
        smoothSourceRevision: 6,
        smoothSourceTokenCount: 11,
        tokenCountMetadata: undefined,
        strategy: "deterministic_truncate_5",
        generatedAt: DEFAULT_TEST_TIMESTAMP,
        generatedFromComponentSmooth: true,
      },
    },
  } as Parameters<typeof countDetailedChunkMaterialized>[0];

  const detailed = countDetailedChunkMaterialized(chunk, { createdAt: CREATED_AT });
  const brief = countBriefChunkMaterialized(chunk, { createdAt: CREATED_AT });

  assert.equal(detailed.representationHash, createMaterializedRepresentationHash("semantic detailed artifact"));
  assert.equal(brief.representationHash, createMaterializedRepresentationHash("semantic brief artifact"));
  assert.notEqual(detailed.representationHash, createMaterializedRepresentationHash("placeholder detailed artifact"));
  assert.notEqual(brief.representationHash, createMaterializedRepresentationHash("placeholder brief artifact"));
});

test("semantic lower-band counters do not count placeholder-only lower-band state", () => {
  const chunk = makeLegacyPlaceholderChunkState({
    chunkId: "chunk-placeholder-only-counter",
    sourceRevision: 9,
  });

  const detailed = countDetailedChunkMaterialized(chunk, { createdAt: CREATED_AT });
  const brief = countBriefChunkMaterialized(chunk, { createdAt: CREATED_AT });

  assert.equal(detailed.representationHash, createMaterializedRepresentationHash(""));
  assert.equal(brief.representationHash, createMaterializedRepresentationHash(""));
  assert.notEqual(detailed.representationHash, createMaterializedRepresentationHash("placeholder-only detailed artifact"));
  assert.notEqual(brief.representationHash, createMaterializedRepresentationHash("placeholder-only brief artifact"));
});

test("band materialized count hashes the ordered emitted Thread View message array", () => {
  const messages = [
    makeThreadViewMessage({
      threadViewId: "thread-view-band",
      bandType: "smooth",
      messageOrder: 2,
      content: "smooth content",
    }),
    makeThreadViewMessage({
      threadViewId: "thread-view-band",
      bandType: "full_fidelity",
      messageOrder: 1,
      content: "raw content",
    }),
  ];

  const record = countBandMaterialized({
    messages,
    sourceRevision: 11,
    createdAt: CREATED_AT,
  });

  assert.equal(record.scope, "band_materialized");
  assert.equal(record.sourceRevision, 11);
  assert.equal(record.count > 0, true);
  assert.match(record.provenance ?? "", /thread-view\.band-message-array/);
});

test("generated session count hashes the same JSONL content the PI writer emits for tool results", async () => {
  await withTempFeature3Store(async (context) => {
    const file = makePiThreadViewFile({
      threadId: "thread-generated-session-count",
      threadViewId: "thread-view-generated-session-count",
      entries: [
        {
          entryType: "message",
          role: "toolResult",
          content: {
            parts: [
              {
                partType: "tool_result",
                content: {
                  output: "tool output",
                  toolCallId: "call-production-001",
                  toolName: "bash",
                },
              },
            ],
          },
          generatedSource: "raw_turn_message",
          metadata: {
            toolCallId: "call-production-001",
            toolName: "bash",
          },
        },
      ],
      entryCount: 1,
    });
    const input = {
      threadId: file.threadId,
      threadViewId: file.threadViewId,
      file,
    };
    const timestamp = "2026-01-01T00:00:00.000Z";
    const expectedContent = serializePiThreadViewFileContent(input, timestamp);

    const record = countGeneratedSession({
      input,
      timestamp,
      sourceRevision: 12,
      createdAt: CREATED_AT,
    });
    const result = await writePiThreadViewFile(input, {
      pathResolver: createPathResolver(context),
      now: () => new Date(timestamp),
    });

    assert.equal(await readFile(result.generatedFilePath, "utf8"), expectedContent);
    assert.equal(record.scope, "generated_session");
    assert.equal(record.sourceRevision, 12);
    assert.equal(record.representationHash, createMaterializedRepresentationHash(expectedContent));
    assert.equal(record.count > 0, true);

    const sessionLines = expectedContent
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const messageEntry = sessionLines[2] as {
      message: {
        role: string;
        toolCallId: string;
        toolName: string;
        content: Array<{ type: string; text: string }>;
      };
    };

    assert.equal(messageEntry.message.role, "toolResult");
    assert.equal(messageEntry.message.toolCallId, "call-production-001");
    assert.equal(messageEntry.message.toolName, "bash");
    assert.deepEqual(messageEntry.message.content, [
      {
        type: "text",
        text: "{\"output\":\"tool output\",\"toolCallId\":\"call-production-001\",\"toolName\":\"bash\"}",
      },
    ]);
  });
});
