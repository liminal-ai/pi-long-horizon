import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTokenCountRecordForScope,
  getTokenCountSourcePrecedence,
  selectTokenCountRecordForScope,
  type TokenCountRecord,
} from "../../src/token-accounting/index.js";

const CREATED_AT = "2026-05-12T12:00:00.000Z";

function record(overrides: Partial<TokenCountRecord> = {}): TokenCountRecord {
  return {
    count: 100,
    scope: "band_materialized",
    source: "local_tokenizer",
    trustClass: "tokenizer_estimate",
    tokenizer: "pi-compatible-tokenizer",
    representationHash: "sha256:band",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

test("provider input counts are usable highest-trust counts for requested materialized scope", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "generated_session",
    record: record({
      count: 1200,
      scope: "generated_session",
      source: "provider_input_count",
      trustClass: "provider_reported",
      provider: "openai",
      model: "gpt-5.4",
      tokenizer: undefined,
      representationHash: "sha256:generated-session",
    }),
  });

  assert.equal(decision.status, "usable");
  assert.equal(decision.usableForSmartCompact, true);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_PROVIDER_INPUT_USABLE");
  assert.equal(decision.precedence, getTokenCountSourcePrecedence("provider_input_count"));
});

test("local tokenizer counts are normal usable materialized counts", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "band_materialized",
    record: record(),
  });

  assert.equal(decision.status, "usable");
  assert.equal(decision.usableForSmartCompact, true);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_LOCAL_TOKENIZER_USABLE");
});

test("strict mode blocks degraded PI heuristic counts", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "band_materialized",
    mode: "strict",
    record: record({
      source: "pi_heuristic",
      trustClass: "heuristic_estimate",
      tokenizer: undefined,
    }),
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.usableForSmartCompact, false);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_BLOCKED");
});

test("prepare mode allows degraded PI heuristic counts with warning", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "band_materialized",
    mode: "prepare",
    record: record({
      source: "pi_heuristic",
      trustClass: "heuristic_estimate",
      tokenizer: undefined,
    }),
  });

  assert.equal(decision.status, "degraded");
  assert.equal(decision.usableForSmartCompact, true);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_ALLOWED");
  assert.match(decision.warning ?? "", /prefer provider input counts or local tokenizer counts/);
});

test("provider usage telemetry is blocked as telemetry only", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "band_materialized",
    mode: "prepare",
    record: record({
      source: "provider_usage",
      trustClass: "provider_reported",
      provider: "openai",
      model: "gpt-5.4",
      tokenizer: undefined,
    }),
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.usableForSmartCompact, false);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_PROVIDER_USAGE_TELEMETRY_ONLY");
});

test("scope mismatch blocks otherwise usable counts", () => {
  const decision = evaluateTokenCountRecordForScope({
    requestedScope: "generated_session",
    record: record(),
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.usableForSmartCompact, false);
  assert.equal(decision.reasonCode, "COUNT_SOURCE_SCOPE_MISMATCH");
});

test("selection prefers provider counts over local tokenizer and degraded fallback", () => {
  const providerRecord = record({
    count: 90,
    source: "provider_input_count",
    trustClass: "provider_reported",
    provider: "openai",
    model: "gpt-5.4",
    tokenizer: undefined,
  });
  const localTokenizerRecord = record({ count: 100 });
  const heuristicRecord = record({
    count: 80,
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    tokenizer: undefined,
  });

  const result = selectTokenCountRecordForScope({
    requestedScope: "band_materialized",
    mode: "prepare",
    records: [heuristicRecord, localTokenizerRecord, providerRecord],
  });

  assert.equal(result.selected, providerRecord);
  assert.equal(result.decision?.reasonCode, "COUNT_SOURCE_PROVIDER_INPUT_USABLE");
  assert.equal(result.decisions.length, 3);
});

test("selection in strict mode ignores degraded heuristic fallback", () => {
  const heuristicRecord = record({
    source: "pi_heuristic",
    trustClass: "heuristic_estimate",
    tokenizer: undefined,
  });
  const result = selectTokenCountRecordForScope({
    requestedScope: "band_materialized",
    mode: "strict",
    records: [heuristicRecord],
  });

  assert.equal(result.selected, undefined);
  assert.equal(result.decision, undefined);
  assert.deepEqual(
    result.decisions.map((decision) => decision.reasonCode),
    ["COUNT_SOURCE_PI_HEURISTIC_DEGRADED_BLOCKED"],
  );
});
