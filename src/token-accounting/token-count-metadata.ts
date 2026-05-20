export const TOKEN_COUNT_SCOPES = [
  "raw_message_materialized",
  "raw_turn_materialized",
  "smooth_turn_materialized",
  "turn_lower_band_projection_materialized",
  "chunk_smooth_materialized",
  "detailed_chunk_materialized",
  "brief_chunk_materialized",
  "band_materialized",
  "generated_session",
  "provider_usage_telemetry",
] as const;

export const TOKEN_COUNT_SOURCES = [
  "provider_usage",
  "provider_input_count",
  "local_tokenizer",
  "pi_heuristic",
] as const;

export const TOKEN_COUNT_TRUST_CLASSES = [
  "provider_reported",
  "exact",
  "tokenizer_estimate",
  "heuristic_estimate",
  "unknown",
] as const;

export type TokenCountScope = (typeof TOKEN_COUNT_SCOPES)[number];
export type TokenCountSource = (typeof TOKEN_COUNT_SOURCES)[number];
export type TokenCountTrustClass = (typeof TOKEN_COUNT_TRUST_CLASSES)[number];

export interface TokenizerMetadata {
  tokenizer: string;
  tokenizerVersion?: string;
}

export interface ProviderModelMetadata {
  provider: string;
  model: string;
}

export interface TokenCountRecord {
  count: number;
  scope: TokenCountScope;
  source: TokenCountSource;
  trustClass: TokenCountTrustClass;
  provider?: string;
  model?: string;
  tokenizer?: string;
  tokenizerVersion?: string;
  representationHash?: string;
  sourceRevision?: number;
  createdAt: string;
  provenance?: string;
  note?: string;
}

export type TokenCountRecordForScope<TScope extends TokenCountScope> = TokenCountRecord & { scope: TScope };

export type RawMessageMaterializedTokenCountRecord = TokenCountRecordForScope<"raw_message_materialized">;
export type RawTurnMaterializedTokenCountRecord = TokenCountRecordForScope<"raw_turn_materialized">;
export type SmoothTurnMaterializedTokenCountRecord = TokenCountRecordForScope<"smooth_turn_materialized">;
export type TurnLowerBandProjectionMaterializedTokenCountRecord =
  TokenCountRecordForScope<"turn_lower_band_projection_materialized">;
export type ChunkSmoothMaterializedTokenCountRecord = TokenCountRecordForScope<"chunk_smooth_materialized">;
export type DetailedChunkMaterializedTokenCountRecord = TokenCountRecordForScope<"detailed_chunk_materialized">;
export type BriefChunkMaterializedTokenCountRecord = TokenCountRecordForScope<"brief_chunk_materialized">;
export type BandMaterializedTokenCountRecord = TokenCountRecordForScope<"band_materialized">;
export type GeneratedSessionTokenCountRecord = TokenCountRecordForScope<"generated_session">;
export type ProviderUsageTelemetryTokenCountRecord = TokenCountRecordForScope<"provider_usage_telemetry">;

export type CanonicalTokenCountRecord =
  | RawMessageMaterializedTokenCountRecord
  | RawTurnMaterializedTokenCountRecord
  | SmoothTurnMaterializedTokenCountRecord
  | TurnLowerBandProjectionMaterializedTokenCountRecord
  | ChunkSmoothMaterializedTokenCountRecord
  | DetailedChunkMaterializedTokenCountRecord
  | BriefChunkMaterializedTokenCountRecord
  | BandMaterializedTokenCountRecord
  | GeneratedSessionTokenCountRecord
  | ProviderUsageTelemetryTokenCountRecord;

export interface TokenCountValidationIssue {
  field: keyof TokenCountRecord | "record";
  code: string;
  message: string;
}

export type TokenCountValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: TokenCountValidationIssue[] };

export interface CreateTokenCountRecordInput {
  count: number;
  scope: TokenCountScope;
  source: TokenCountSource;
  trustClass: TokenCountTrustClass;
  provider?: string;
  model?: string;
  tokenizer?: string;
  tokenizerVersion?: string;
  representationHash?: string;
  sourceRevision?: number;
  createdAt?: string;
  provenance?: string;
  note?: string;
}

export type CreateScopedTokenCountRecordInput = Omit<CreateTokenCountRecordInput, "scope">;

export class TokenCountValidationError extends Error {
  readonly issues: TokenCountValidationIssue[];

  constructor(issues: readonly TokenCountValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "TokenCountValidationError";
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

const MATERIALIZED_TOKEN_COUNT_SCOPES = new Set<TokenCountScope>([
  "raw_message_materialized",
  "raw_turn_materialized",
  "smooth_turn_materialized",
  "turn_lower_band_projection_materialized",
  "chunk_smooth_materialized",
  "detailed_chunk_materialized",
  "brief_chunk_materialized",
  "band_materialized",
]);

function isNonEmptyString(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function addIssue(
  issues: TokenCountValidationIssue[],
  field: TokenCountValidationIssue["field"],
  code: string,
  message: string,
): void {
  issues.push({ field, code, message });
}

export function requiresRepresentationHash(scope: TokenCountScope): boolean {
  return MATERIALIZED_TOKEN_COUNT_SCOPES.has(scope) || scope === "generated_session";
}

export function validateTokenCountRecord(record: TokenCountRecord): TokenCountValidationResult<TokenCountRecord> {
  const issues: TokenCountValidationIssue[] = [];

  if (!Number.isInteger(record.count) || record.count < 0) {
    addIssue(issues, "count", "TOKEN_COUNT_INVALID_COUNT", "Token count must be a nonnegative integer.");
  }

  if (!isMember(TOKEN_COUNT_SCOPES, record.scope)) {
    addIssue(issues, "scope", "TOKEN_COUNT_INVALID_SCOPE", "Token count scope is not recognized.");
  }

  if (!isMember(TOKEN_COUNT_SOURCES, record.source)) {
    addIssue(issues, "source", "TOKEN_COUNT_INVALID_SOURCE", "Token count source is not recognized.");
  }

  if (!isMember(TOKEN_COUNT_TRUST_CLASSES, record.trustClass)) {
    addIssue(issues, "trustClass", "TOKEN_COUNT_INVALID_TRUST_CLASS", "Token count trust class is not recognized.");
  }

  if (!isNonEmptyString(record.createdAt) || Number.isNaN(Date.parse(record.createdAt))) {
    addIssue(issues, "createdAt", "TOKEN_COUNT_INVALID_CREATED_AT", "Token count createdAt must be an ISO timestamp.");
  }

  if (record.sourceRevision !== undefined && (!Number.isInteger(record.sourceRevision) || record.sourceRevision < 0)) {
    addIssue(
      issues,
      "sourceRevision",
      "TOKEN_COUNT_INVALID_SOURCE_REVISION",
      "Token count sourceRevision must be a nonnegative integer when present.",
    );
  }

  if (requiresRepresentationHash(record.scope) && !isNonEmptyString(record.representationHash)) {
    addIssue(
      issues,
      "representationHash",
      "TOKEN_COUNT_REPRESENTATION_HASH_REQUIRED",
      "Materialized and generated-session token counts require a representation hash.",
    );
  }

  if (record.scope === "provider_usage_telemetry") {
    if (record.source !== "provider_usage") {
      addIssue(
        issues,
        "source",
        "TOKEN_COUNT_PROVIDER_USAGE_SOURCE_REQUIRED",
        "Provider usage telemetry must use provider_usage as its source.",
      );
    }

    if (!isNonEmptyString(record.provider)) {
      addIssue(
        issues,
        "provider",
        "TOKEN_COUNT_PROVIDER_REQUIRED",
        "Provider usage telemetry requires a provider.",
      );
    }

    if (!isNonEmptyString(record.model)) {
      addIssue(issues, "model", "TOKEN_COUNT_MODEL_REQUIRED", "Provider usage telemetry requires a model.");
    }
  }

  if (
    record.scope !== "provider_usage_telemetry" &&
    (record.source === "provider_usage" || record.source === "provider_input_count") &&
    !isNonEmptyString(record.provider)
  ) {
    addIssue(
      issues,
      "provider",
      "TOKEN_COUNT_PROVIDER_REQUIRED_FOR_SOURCE",
      "Provider-sourced token counts require a provider.",
    );
  }

  if (
    record.scope !== "provider_usage_telemetry" &&
    (record.source === "provider_usage" || record.source === "provider_input_count") &&
    !isNonEmptyString(record.model)
  ) {
    addIssue(
      issues,
      "model",
      "TOKEN_COUNT_MODEL_REQUIRED_FOR_SOURCE",
      "Provider-sourced token counts require a model.",
    );
  }

  if (record.source === "local_tokenizer" && !isNonEmptyString(record.tokenizer)) {
    addIssue(
      issues,
      "tokenizer",
      "TOKEN_COUNT_TOKENIZER_REQUIRED",
      "Local tokenizer token counts require tokenizer metadata.",
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: cloneTokenCountRecord(record) };
}

export function createTokenCountRecord(
  input: CreateTokenCountRecordInput,
): TokenCountValidationResult<TokenCountRecord> {
  const record: TokenCountRecord = {
    count: input.count,
    scope: input.scope,
    source: input.source,
    trustClass: input.trustClass,
    provider: input.provider,
    model: input.model,
    tokenizer: input.tokenizer,
    tokenizerVersion: input.tokenizerVersion,
    representationHash: input.representationHash,
    sourceRevision: input.sourceRevision,
    createdAt: input.createdAt ?? new Date().toISOString(),
    provenance: input.provenance,
    note: input.note,
  };

  return validateTokenCountRecord(record);
}

export function createRawMessageMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<RawMessageMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("raw_message_materialized", input);
}

export function createRawTurnMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<RawTurnMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("raw_turn_materialized", input);
}

export function createSmoothTurnMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<SmoothTurnMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("smooth_turn_materialized", input);
}

export function createTurnLowerBandProjectionMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<TurnLowerBandProjectionMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("turn_lower_band_projection_materialized", input);
}

export function createChunkSmoothMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<ChunkSmoothMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("chunk_smooth_materialized", input);
}

export function createDetailedChunkMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<DetailedChunkMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("detailed_chunk_materialized", input);
}

export function createBriefChunkMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<BriefChunkMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("brief_chunk_materialized", input);
}

export function createBandMaterializedTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<BandMaterializedTokenCountRecord> {
  return createScopedTokenCountRecord("band_materialized", input);
}

export function createGeneratedSessionTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<GeneratedSessionTokenCountRecord> {
  return createScopedTokenCountRecord("generated_session", input);
}

export function createProviderUsageTelemetryTokenCountRecord(
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<ProviderUsageTelemetryTokenCountRecord> {
  return createScopedTokenCountRecord("provider_usage_telemetry", input);
}

export function assertTokenCountRecord(input: CreateTokenCountRecordInput): TokenCountRecord {
  const result = createTokenCountRecord(input);

  if (!result.ok) {
    throw new TokenCountValidationError(result.issues);
  }

  return result.value;
}

export function cloneTokenCountRecord(record: TokenCountRecord): TokenCountRecord {
  return { ...record };
}

function createScopedTokenCountRecord<TScope extends TokenCountScope>(
  scope: TScope,
  input: CreateScopedTokenCountRecordInput,
): TokenCountValidationResult<TokenCountRecordForScope<TScope>> {
  const result = createTokenCountRecord({ ...input, scope });

  if (!result.ok) {
    return result;
  }

  return { ok: true, value: result.value as TokenCountRecordForScope<TScope> };
}
