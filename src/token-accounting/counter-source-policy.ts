import {
  requiresRepresentationHash,
  validateTokenCountRecord,
  type TokenCountRecord,
  type TokenCountScope,
  type TokenCountSource,
} from "./token-count-metadata.js";

export const MATERIALIZED_OR_GENERATED_TOKEN_COUNT_SCOPES = [
  "raw_message_materialized",
  "raw_turn_materialized",
  "smooth_turn_materialized",
  "chunk_smooth_materialized",
  "detailed_chunk_materialized",
  "brief_chunk_materialized",
  "band_materialized",
  "generated_session",
] as const;

export const COUNTER_SOURCE_POLICY_MODES = ["strict", "prepare"] as const;

export const COUNT_DECISION_STATUSES = ["usable", "degraded", "blocked"] as const;

export type MaterializedOrGeneratedTokenCountScope =
  (typeof MATERIALIZED_OR_GENERATED_TOKEN_COUNT_SCOPES)[number];
export type CounterSourcePolicyMode = (typeof COUNTER_SOURCE_POLICY_MODES)[number];
export type CountDecisionStatus = (typeof COUNT_DECISION_STATUSES)[number];

export type CountDecisionReasonCode =
  | "COUNT_SOURCE_PROVIDER_INPUT_USABLE"
  | "COUNT_SOURCE_LOCAL_TOKENIZER_USABLE"
  | "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_ALLOWED"
  | "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_BLOCKED"
  | "COUNT_SOURCE_PROVIDER_USAGE_TELEMETRY_ONLY"
  | "COUNT_SOURCE_SCOPE_MISMATCH"
  | "COUNT_SOURCE_REQUEST_SCOPE_UNSUPPORTED"
  | "COUNT_SOURCE_RECORD_INVALID"
  | "COUNT_SOURCE_UNSUPPORTED";

export interface EvaluateTokenCountPolicyInput {
  record: TokenCountRecord;
  requestedScope: MaterializedOrGeneratedTokenCountScope;
  mode?: CounterSourcePolicyMode;
}

export interface TokenCountSourceDecision {
  status: CountDecisionStatus;
  mode: CounterSourcePolicyMode;
  requestedScope: MaterializedOrGeneratedTokenCountScope;
  recordScope: TokenCountScope;
  source: TokenCountSource;
  count: number;
  usableForSmartCompact: boolean;
  precedence: number;
  reasonCode: CountDecisionReasonCode;
  reason: string;
  warning?: string;
}

const SOURCE_PRECEDENCE: Partial<Record<TokenCountSource, number>> = {
  provider_input_count: 100,
  local_tokenizer: 80,
  pi_heuristic: 40,
  provider_usage: 0,
};

function isMaterializedOrGeneratedScope(scope: TokenCountScope): scope is MaterializedOrGeneratedTokenCountScope {
  return (MATERIALIZED_OR_GENERATED_TOKEN_COUNT_SCOPES as readonly string[]).includes(scope);
}

function blockedDecision(
  input: EvaluateTokenCountPolicyInput & { mode: CounterSourcePolicyMode },
  reasonCode: CountDecisionReasonCode,
  reason: string,
): TokenCountSourceDecision {
  return {
    status: "blocked",
    mode: input.mode,
    requestedScope: input.requestedScope,
    recordScope: input.record.scope,
    source: input.record.source,
    count: input.record.count,
    usableForSmartCompact: false,
    precedence: SOURCE_PRECEDENCE[input.record.source] ?? 0,
    reasonCode,
    reason,
  };
}

export function getTokenCountSourcePrecedence(source: TokenCountSource): number {
  return SOURCE_PRECEDENCE[source] ?? 0;
}

export function evaluateTokenCountRecordForScope(
  input: EvaluateTokenCountPolicyInput,
): TokenCountSourceDecision {
  const mode = input.mode ?? "strict";
  const normalizedInput = { ...input, mode };
  const validation = validateTokenCountRecord(input.record);

  if (!isMaterializedOrGeneratedScope(input.requestedScope)) {
    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_REQUEST_SCOPE_UNSUPPORTED",
      "Counter source policy only evaluates materialized or generated-session count requests.",
    );
  }

  if (!validation.ok) {
    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_RECORD_INVALID",
      "Token count record is invalid and cannot be trusted for smart compact decisions.",
    );
  }

  if (input.record.source === "provider_usage" || input.record.scope === "provider_usage_telemetry") {
    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_PROVIDER_USAGE_TELEMETRY_ONLY",
      "Provider usage telemetry is retained for telemetry only and is not a materialized token count.",
    );
  }

  if (input.record.scope !== input.requestedScope) {
    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_SCOPE_MISMATCH",
      `Token count scope ${input.record.scope} does not match requested scope ${input.requestedScope}.`,
    );
  }

  if (requiresRepresentationHash(input.record.scope) && input.record.representationHash === undefined) {
    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_RECORD_INVALID",
      "Materialized and generated-session token counts require a representation hash.",
    );
  }

  if (input.record.source === "provider_input_count") {
    return {
      status: "usable",
      mode,
      requestedScope: input.requestedScope,
      recordScope: input.record.scope,
      source: input.record.source,
      count: input.record.count,
      usableForSmartCompact: true,
      precedence: getTokenCountSourcePrecedence(input.record.source),
      reasonCode: "COUNT_SOURCE_PROVIDER_INPUT_USABLE",
      reason:
        "Provider input count or provider-reported generated-session count is the highest-trust available materialized count.",
    };
  }

  if (input.record.source === "local_tokenizer") {
    return {
      status: "usable",
      mode,
      requestedScope: input.requestedScope,
      recordScope: input.record.scope,
      source: input.record.source,
      count: input.record.count,
      usableForSmartCompact: true,
      precedence: getTokenCountSourcePrecedence(input.record.source),
      reasonCode: "COUNT_SOURCE_LOCAL_TOKENIZER_USABLE",
      reason:
        "Local tokenizer count is usable for materialized allocation when an exact provider count is unavailable.",
    };
  }

  if (input.record.source === "pi_heuristic") {
    if (mode === "prepare") {
      return {
        status: "degraded",
        mode,
        requestedScope: input.requestedScope,
        recordScope: input.record.scope,
        source: input.record.source,
        count: input.record.count,
        usableForSmartCompact: true,
        precedence: getTokenCountSourcePrecedence(input.record.source),
        reasonCode: "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_ALLOWED",
        reason:
          "PI heuristic count is a degraded fallback. Prepare mode may use it while surfacing a warning.",
        warning:
          "Smart compact should prefer provider input counts or local tokenizer counts before relying on PI heuristic counts.",
      };
    }

    return blockedDecision(
      normalizedInput,
      "COUNT_SOURCE_PI_HEURISTIC_DEGRADED_BLOCKED",
      "PI heuristic count is degraded and strict mode blocks it for successful smart compact decisions.",
    );
  }

  return blockedDecision(
    normalizedInput,
    "COUNT_SOURCE_UNSUPPORTED",
    "Token count source is not trusted by the counter source policy.",
  );
}

export interface SelectTokenCountRecordInput {
  records: readonly TokenCountRecord[];
  requestedScope: MaterializedOrGeneratedTokenCountScope;
  mode?: CounterSourcePolicyMode;
}

export interface SelectTokenCountRecordResult {
  selected?: TokenCountRecord;
  decision?: TokenCountSourceDecision;
  decisions: TokenCountSourceDecision[];
}

function decisionRank(decision: TokenCountSourceDecision): number {
  if (decision.status === "usable") {
    return 3;
  }

  if (decision.status === "degraded" && decision.usableForSmartCompact) {
    return 2;
  }

  return 1;
}

export function selectTokenCountRecordForScope(input: SelectTokenCountRecordInput): SelectTokenCountRecordResult {
  const decisions = input.records.map((record) =>
    evaluateTokenCountRecordForScope({
      record,
      requestedScope: input.requestedScope,
      mode: input.mode,
    }),
  );
  const selectedDecision = decisions
    .filter((decision) => decision.usableForSmartCompact)
    .sort((left, right) => {
      const rankDelta = decisionRank(right) - decisionRank(left);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      return right.precedence - left.precedence;
    })[0];
  const selected = selectedDecision
    ? input.records[decisions.indexOf(selectedDecision)]
    : undefined;

  return { selected, decision: selectedDecision, decisions };
}
