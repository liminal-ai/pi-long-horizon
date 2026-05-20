import assert from "node:assert/strict";
import test from "node:test";

import { CHUNK_SCHEMA_VERSION, type ChunkState } from "../../src/thread/async-thread/domain/chunk-state.js";
import {
  LOWER_BAND_DETAIL_PROMPT_VERSION,
  LowerBandCompressionService,
  type LowerBandCompressionProviderInput,
} from "../../src/thread/async-thread/services/lower-band-compression-service.js";
import { PiCodexLowerBandCompressionProvider } from "../../src/thread/async-thread/services/pi-codex-lower-band-compression-provider.js";
import { FileThreadStore } from "../../src/thread/store/file-thread-store.js";
import { withTempThreadStore } from "../../src/thread/async-thread/test/temp-thread-store.js";
import type { StewardResult } from "../../src/thread/domain/errors.js";
import {
  DEFAULT_TEST_TIMESTAMP,
  makeThreadRecord,
  makeThreadTarget,
} from "../../src/context-steward/test/fixtures.js";

function expectOk<T>(result: StewardResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.issues.map((issue) => issue.code).join(", "));
  return result.value;
}

async function createThread(store: FileThreadStore, threadId: string) {
  const target = makeThreadTarget({
    sessionId: `${threadId}-session`,
    sessionFilePath: `/tmp/${threadId}.jsonl`,
  });

  expectOk(
    await store.createThread({
      thread: makeThreadRecord({
        threadId,
        target,
      }),
      targetRef: {
        runtime: "pi",
        sessionId: target.sessionId,
      },
    }),
  );
}

async function seedClosedChunk(
  store: FileThreadStore,
  input: {
    threadId: string;
    chunkId: string;
    transcriptText: string;
  },
): Promise<void> {
  const thread = expectOk(await store.assertCanMutate(input.threadId));
  expectOk(
    await store.writeChunks({
      threadId: input.threadId,
      expectedSourceRevision: thread.sourceRevision,
      expectedMessageHighWatermark: thread.messageHighWatermark,
      expectedTurnsRevision: thread.turnsRevision,
      chunks: [
        {
          chunkId: input.chunkId,
          threadId: input.threadId,
          schemaVersion: CHUNK_SCHEMA_VERSION,
          lifecycleStatus: "closed",
          sourceTurnIds: ["turn-001"],
          smoothText: "Smooth chunk text for provider-backed lower-band generation.",
          openedAt: DEFAULT_TEST_TIMESTAMP,
          closedAt: DEFAULT_TEST_TIMESTAMP,
          closeReason: "hard_max",
          sourceRevision: 1,
          conversationTranscript: {
            status: "ready",
            text: input.transcriptText,
            sourceFingerprint: "sha256:test-provider-backed-transcript",
            sourceRevision: 1,
            updatedAt: DEFAULT_TEST_TIMESTAMP,
          },
        },
      ],
    }),
  );
}

async function readChunk(store: FileThreadStore, threadId: string, chunkId: string): Promise<ChunkState> {
  const chunk = expectOk(await store.readChunks(threadId)).find((candidate) => candidate.chunkId === chunkId);
  assert.ok(chunk);
  return chunk;
}

test("real provider-backed detailed lower-band generation succeeds end to end", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-provider-backed-detailed";
    const chunkId = "chunk-provider-backed-detailed";
    await createThread(store, threadId);
    await seedClosedChunk(store, {
      threadId,
      chunkId,
      transcriptText:
        "> User wants the repo issue root-caused and fixed.\n\n" +
        "● Assistant identified the likely ownership seam, scoped the next edits, and promised targeted verification.",
    });

    const service = new LowerBandCompressionService({
      store,
      provider: new PiCodexLowerBandCompressionProvider({
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      }),
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["detailed"],
      mode: "async_close",
    });

    assert.equal(result.transcriptReady, true);
    assert.equal(result.detailedReady, true);
    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.detailed?.status, "ready");
    assert.equal(typeof persisted.lowerBand?.detailed?.text, "string");
    assert.ok((persisted.lowerBand?.detailed?.text ?? "").trim().length > 0);

    const reopenedStore = new FileThreadStore(storeRootDir);
    const reopenedChunk = await readChunk(reopenedStore, threadId, chunkId);
    assert.equal(reopenedChunk.lowerBand?.detailed?.status, "ready");
    assert.equal(reopenedChunk.lowerBand?.detailed?.text, persisted.lowerBand?.detailed?.text);
  });
});

test("real provider-backed brief lower-band generation succeeds end to end", async () => {
  await withTempThreadStore(async ({ storeRootDir }) => {
    const store = new FileThreadStore(storeRootDir);
    const threadId = "thread-provider-backed-brief";
    const chunkId = "chunk-provider-backed-brief";
    await createThread(store, threadId);
    await seedClosedChunk(store, {
      threadId,
      chunkId,
      transcriptText:
        "> User asks for the shortest durable summary.\n\n" +
        "● Assistant narrows it to decisions, constraints, and unresolved follow-up only.",
    });

    const service = new LowerBandCompressionService({
      store,
      provider: new PiCodexLowerBandCompressionProvider({
        now: () => new Date(DEFAULT_TEST_TIMESTAMP),
      }),
      now: () => new Date(DEFAULT_TEST_TIMESTAMP),
    });

    const result = await service.run({
      threadId,
      chunkId,
      requiredBands: ["brief"],
      mode: "async_close",
    });

    assert.equal(result.transcriptReady, true);
    assert.equal(result.briefReady, true);
    const persisted = await readChunk(store, threadId, chunkId);
    assert.equal(persisted.lowerBand?.brief?.status, "ready");
    assert.equal(typeof persisted.lowerBand?.brief?.text, "string");
    assert.ok((persisted.lowerBand?.brief?.text ?? "").trim().length > 0);
  });
});

test("real provider-backed lower-band compression surfaces broken model wiring explicitly", async () => {
  const provider = new PiCodexLowerBandCompressionProvider({
    now: () => new Date(DEFAULT_TEST_TIMESTAMP),
  });

  await assert.rejects(
    provider.compress({
      threadId: "thread-provider-backed-wiring",
      chunkId: "chunk-provider-backed-wiring",
      band: "detailed",
      transcriptText: "> User asks for a broken model wiring proof.",
      promptVersion: LOWER_BAND_DETAIL_PROMPT_VERSION,
      modelId: "gpt-5.999" as LowerBandCompressionProviderInput["modelId"],
      reasoningEffort: "low",
    }),
    /gpt-5\.999|model/i,
  );
});
