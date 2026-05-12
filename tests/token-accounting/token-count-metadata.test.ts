import assert from "node:assert/strict";
import test from "node:test";

import {
  TokenCountValidationError,
  assertTokenCountRecord,
  createBandMaterializedTokenCountRecord,
  createTokenCountRecord,
  requiresRepresentationHash,
} from "../../src/token-accounting/index.js";

const CREATED_AT = "2026-05-12T12:00:00.000Z";

test("creates raw message materialized token count metadata", () => {
  const result = createTokenCountRecord({
    count: 42,
    scope: "raw_message_materialized",
    source: "local_tokenizer",
    trustClass: "tokenizer_estimate",
    tokenizer: "pi-compatible-tokenizer",
    tokenizerVersion: "1.0.0",
    representationHash: "sha256:raw-message",
    sourceRevision: 7,
    createdAt: CREATED_AT,
    provenance: "test.raw-message-materialized",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.count, 42);
  assert.equal(result.value.scope, "raw_message_materialized");
  assert.equal(result.value.representationHash, "sha256:raw-message");
  assert.equal(result.value.provenance, "test.raw-message-materialized");
});

test("requires representation hashes for materialized and generated session counts", () => {
  assert.equal(requiresRepresentationHash("band_materialized"), true);
  assert.equal(requiresRepresentationHash("chunk_smooth_materialized"), true);
  assert.equal(requiresRepresentationHash("generated_session"), true);
  assert.equal(requiresRepresentationHash("provider_usage_telemetry"), false);

  const result = createTokenCountRecord({
    count: 10,
    scope: "smooth_turn_materialized",
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    createdAt: CREATED_AT,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["TOKEN_COUNT_REPRESENTATION_HASH_REQUIRED"],
  );
});

test("accepts generated session counts with provenance", () => {
  const record = assertTokenCountRecord({
    count: 1200,
    scope: "generated_session",
    source: "provider_input_count",
    trustClass: "provider_reported",
    provider: "openai",
    model: "gpt-5.4",
    representationHash: "sha256:generated-session",
    sourceRevision: 12,
    createdAt: CREATED_AT,
  });

  assert.equal(record.scope, "generated_session");
  assert.equal(record.provider, "openai");
  assert.equal(record.model, "gpt-5.4");
});

test("provider usage telemetry requires provider model and provider usage source", () => {
  const result = createTokenCountRecord({
    count: 55,
    scope: "provider_usage_telemetry",
    source: "local_tokenizer",
    trustClass: "provider_reported",
    createdAt: CREATED_AT,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "TOKEN_COUNT_PROVIDER_USAGE_SOURCE_REQUIRED",
      "TOKEN_COUNT_PROVIDER_REQUIRED",
      "TOKEN_COUNT_MODEL_REQUIRED",
      "TOKEN_COUNT_TOKENIZER_REQUIRED",
    ],
  );
});

test("scoped constructors return canonical typed records", () => {
  const result = createBandMaterializedTokenCountRecord({
    count: 250,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    representationHash: "sha256:band",
    createdAt: CREATED_AT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.scope, "band_materialized");
});

test("provider-sourced counts require provider and model metadata", () => {
  const result = createTokenCountRecord({
    count: 100,
    scope: "generated_session",
    source: "provider_input_count",
    trustClass: "provider_reported",
    provider: "openai",
    representationHash: "sha256:generated-session",
    createdAt: CREATED_AT,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["TOKEN_COUNT_MODEL_REQUIRED_FOR_SOURCE"],
  );
});

test("rejects invalid count timestamp and source revision", () => {
  const result = createTokenCountRecord({
    count: -1,
    scope: "brief_chunk_materialized",
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    representationHash: "sha256:brief",
    sourceRevision: 1.5,
    createdAt: "not-a-date",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "TOKEN_COUNT_INVALID_COUNT",
      "TOKEN_COUNT_INVALID_CREATED_AT",
      "TOKEN_COUNT_INVALID_SOURCE_REVISION",
    ],
  );
});

test("asserting constructor throws clear validation errors", () => {
  assert.throws(
    () =>
      assertTokenCountRecord({
        count: 1.25,
        scope: "raw_turn_materialized",
        source: "pi_heuristic",
        trustClass: "heuristic_estimate",
        representationHash: "sha256:turn",
        createdAt: CREATED_AT,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TokenCountValidationError, true);
      assert.deepEqual(
        (error as TokenCountValidationError).issues.map((issue) => issue.code),
        ["TOKEN_COUNT_INVALID_COUNT"],
      );
      return true;
    },
  );
});
