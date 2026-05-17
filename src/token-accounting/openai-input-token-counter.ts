import { AuthStorage } from "@earendil-works/pi-coding-agent";

import { formatExternalIntegrationFailure } from "../integration-error.js";
import type { WritePiThreadViewFileInput } from "../thread-view/domain/pi-thread-view-file.js";
import type { ChunkState } from "../thread/async-thread/domain/chunk-state.js";
import type { MessageRecord, TurnRecord } from "../thread/domain/records.js";
import { materializeRawThreadViewMessageContent } from "../thread-view/services/thread-view-materializer.js";
import {
  assertTokenCountRecord,
  type BriefChunkMaterializedTokenCountRecord,
  type ChunkSmoothMaterializedTokenCountRecord,
  type DetailedChunkMaterializedTokenCountRecord,
  type GeneratedSessionTokenCountRecord,
  type RawMessageMaterializedTokenCountRecord,
  type RawTurnMaterializedTokenCountRecord,
  type SmoothTurnMaterializedTokenCountRecord,
  type TokenCountRecord,
} from "./token-count-metadata.js";
import type { MaterializedOrGeneratedTokenCountScope } from "./counter-source-policy.js";
import {
  createMaterializedRepresentationHash,
  serializeMaterializedRepresentation,
} from "./materialized-representation-counter.js";
import {
  convertGeneratedSessionToOpenAIResponsesInput,
  type OpenAIResponsesInputTokenCountRequest,
} from "./openai-generated-session-converter.js";

export const OPENAI_INPUT_TOKEN_COUNTER_PROVIDER = "openai" as const;
export const OPENAI_INPUT_TOKEN_COUNTER_SOURCE = "provider_input_count" as const;
export const OPENAI_INPUT_TOKEN_COUNTER_TRUST_CLASS = "exact" as const;
export const OPENAI_INPUT_TOKEN_COUNTER_PROVENANCE =
  "pi-long-horizon.openai-input-token-counter.v1:responses.input_tokens" as const;

export type OpenAITokenCounterErrorCode =
  | "OPENAI_API_KEY_MISSING"
  | "OPENAI_API_KEY_INVALID"
  | "OPENAI_API_KEY_UNSUPPORTED"
  | "OPENAI_TOKEN_COUNT_AUTH_FAILED"
  | "OPENAI_TOKEN_COUNT_REQUEST_FAILED"
  | "OPENAI_TOKEN_COUNT_FETCH_FAILED"
  | "OPENAI_TOKEN_COUNT_INVALID_RESPONSE";

export class OpenAITokenCounterError extends Error {
  readonly code: OpenAITokenCounterErrorCode;
  readonly status?: number;
  readonly openAIErrorType?: string;
  readonly openAIErrorCode?: string;
  readonly openAIErrorParam?: string;

  constructor(
    code: OpenAITokenCounterErrorCode,
    message: string,
    options: {
      status?: number;
      cause?: unknown;
      openAIErrorType?: string;
      openAIErrorCode?: string;
      openAIErrorParam?: string;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OpenAITokenCounterError";
    this.code = code;
    this.status = options.status;
    this.openAIErrorType = options.openAIErrorType;
    this.openAIErrorCode = options.openAIErrorCode;
    this.openAIErrorParam = options.openAIErrorParam;
  }
}

export interface OpenAIApiKeyResolver {
  resolveApiKey(): Promise<string>;
}

export interface OpenAIInputTokenCountClient {
  countInputTokens(request: OpenAIResponsesInputTokenCountRequest): Promise<number>;
}

export interface FetchOpenAIInputTokenCountClientOptions {
  apiKeyResolver?: OpenAIApiKeyResolver;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface PiAuthStorageOpenAIApiKeyResolverOptions {
  authPath?: string;
  authStorage?: Pick<AuthStorage, "get">;
}

export interface CountOpenAIGeneratedSessionInput {
  input: WritePiThreadViewFileInput;
  model?: string;
  sourceRevision?: number;
  createdAt?: string;
  now?: () => Date;
}

export interface CountOpenAIMaterializedInput {
  scope: Exclude<MaterializedOrGeneratedTokenCountScope, "band_materialized" | "generated_session">;
  representation: unknown;
  model?: string;
  sourceRevision?: number;
  createdAt?: string;
  now?: () => Date;
  provenanceSuffix: string;
  note: string;
}

export interface CountOpenAIRawTurnMaterializedInput {
  turn: TurnRecord;
  messages: readonly MessageRecord[];
  model?: string;
  createdAt?: string;
  now?: () => Date;
}

function summarizeRequestItems(request: OpenAIResponsesInputTokenCountRequest): string {
  const counts = request.input.reduce<Record<string, number>>((totals, item) => {
    totals[item.type] = (totals[item.type] ?? 0) + 1;
    return totals;
  }, {});

  return Object.entries(counts)
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
}

interface SanitizedOpenAIError {
  message: string;
  type?: string;
  code?: string;
  param?: string;
}

function redactSecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-openai-key]");
}

function sanitizeOpenAIError(status: number, body: unknown): SanitizedOpenAIError {
  if (typeof body !== "object" || body === null) {
    return { message: `OpenAI input token count request failed with status ${status}.` };
  }

  const error = (body as { error?: { type?: unknown; code?: unknown; param?: unknown; message?: unknown } }).error;
  const type = typeof error?.type === "string" ? error.type : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const param = typeof error?.param === "string" ? error.param : undefined;
  const providerMessage = typeof error?.message === "string" ? redactSecrets(error.message) : undefined;

  const message = [
    `OpenAI input token count request failed with status ${status}.`,
    type ? `type=${type}` : undefined,
    code ? `code=${code}` : undefined,
    param ? `param=${param}` : undefined,
    providerMessage ? `message=${providerMessage}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return { message, type, code, param };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new OpenAITokenCounterError(
      "OPENAI_TOKEN_COUNT_INVALID_RESPONSE",
      "OpenAI input token count response was not valid JSON.",
      { status: response.status, cause: error },
    );
  }
}

export function createPiAuthStorageOpenAIApiKeyResolver(
  options: PiAuthStorageOpenAIApiKeyResolverOptions = {},
): OpenAIApiKeyResolver {
  return {
    async resolveApiKey() {
      const authStorage = options.authStorage ?? AuthStorage.create(options.authPath ?? ".pi/agent/auth.json");
      const credential = authStorage.get("openai");

      if (!credential) {
        throw new OpenAITokenCounterError(
          "OPENAI_API_KEY_MISSING",
          "OpenAI API key is not configured in .pi/agent/auth.json for provider openai.",
        );
      }

      if (credential.type !== "api_key") {
        throw new OpenAITokenCounterError(
          "OPENAI_API_KEY_UNSUPPORTED",
          "OpenAI token counting requires a stored API key credential for provider openai.",
        );
      }

      if (typeof credential.key !== "string" || credential.key.trim().length === 0) {
        throw new OpenAITokenCounterError(
          "OPENAI_API_KEY_MISSING",
          "Stored OpenAI API key credential is empty.",
        );
      }

      if (!credential.key.startsWith("sk-")) {
        throw new OpenAITokenCounterError(
          "OPENAI_API_KEY_INVALID",
          "Stored OpenAI API key credential is not a recognized OpenAI API key format.",
        );
      }

      return credential.key;
    },
  };
}

export class FetchOpenAIInputTokenCountClient implements OpenAIInputTokenCountClient {
  private readonly apiKeyResolver: OpenAIApiKeyResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(options: FetchOpenAIInputTokenCountClientOptions = {}) {
    this.apiKeyResolver = options.apiKeyResolver ?? createPiAuthStorageOpenAIApiKeyResolver();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/responses/input_tokens";
  }

  async countInputTokens(request: OpenAIResponsesInputTokenCountRequest): Promise<number> {
    const apiKey = await this.apiKeyResolver.resolveApiKey();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new OpenAITokenCounterError(
        "OPENAI_TOKEN_COUNT_FETCH_FAILED",
        `OpenAI input token count fetch failed. ${formatExternalIntegrationFailure(
          {
            integration: "openai_token_counting",
            operation: "count_input_tokens",
            provider: "openai",
            model: request.model,
            endpoint: this.endpoint,
          },
          error,
        )}`,
        { cause: error },
      );
    }
    const body = await parseJsonResponse(response);

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "OPENAI_TOKEN_COUNT_AUTH_FAILED"
          : "OPENAI_TOKEN_COUNT_REQUEST_FAILED";
      const sanitized = sanitizeOpenAIError(response.status, body);
      throw new OpenAITokenCounterError(code, sanitized.message, {
        status: response.status,
        openAIErrorType: sanitized.type,
        openAIErrorCode: sanitized.code,
        openAIErrorParam: sanitized.param,
      });
    }

    const inputTokens = (body as { input_tokens?: unknown } | undefined)?.input_tokens;
    if (typeof inputTokens !== "number" || !Number.isInteger(inputTokens) || inputTokens < 0) {
      throw new OpenAITokenCounterError(
        "OPENAI_TOKEN_COUNT_INVALID_RESPONSE",
        "OpenAI input token count response did not include a nonnegative input_tokens integer.",
        { status: response.status },
      );
    }

    return inputTokens;
  }
}

export class OpenAIInputTokenCounter {
  private readonly client: OpenAIInputTokenCountClient;
  private readonly defaultModel: string;

  constructor(client: OpenAIInputTokenCountClient = new FetchOpenAIInputTokenCountClient(), defaultModel = "gpt-4.1") {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  async countMaterialized(input: CountOpenAIMaterializedInput): Promise<TokenCountRecord> {
    const model = input.model ?? this.defaultModel;
    const request: OpenAIResponsesInputTokenCountRequest = {
      model,
      truncation: "disabled",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: serializeMaterializedRepresentation(input.representation) }],
        },
      ],
    };
    const count = await this.client.countInputTokens(request);
    const createdAt = input.createdAt ?? (input.now ?? (() => new Date()))().toISOString();

    return assertTokenCountRecord({
      count,
      scope: input.scope,
      source: OPENAI_INPUT_TOKEN_COUNTER_SOURCE,
      trustClass: OPENAI_INPUT_TOKEN_COUNTER_TRUST_CLASS,
      provider: OPENAI_INPUT_TOKEN_COUNTER_PROVIDER,
      model,
      representationHash: createMaterializedRepresentationHash(input.representation),
      sourceRevision: input.sourceRevision,
      createdAt,
      provenance: `${OPENAI_INPUT_TOKEN_COUNTER_PROVENANCE}:${input.provenanceSuffix}`,
      note: input.note,
    });
  }

  async countRawMessageMaterialized(
    message: MessageRecord,
    options: { model?: string; createdAt?: string; now?: () => Date } = {},
  ): Promise<RawMessageMaterializedTokenCountRecord> {
    return this.countMaterialized({
      scope: "raw_message_materialized",
      representation: materializeRawThreadViewMessageContent(message),
      sourceRevision: message.sourceRevision,
      provenanceSuffix: "thread-view.raw-message-content",
      note: "OpenAI Responses input token count over the raw message materialized Thread View content.",
      ...options,
    }) as Promise<RawMessageMaterializedTokenCountRecord>;
  }

  async countRawTurnMaterialized(
    input: CountOpenAIRawTurnMaterializedInput,
  ): Promise<RawTurnMaterializedTokenCountRecord> {
    const messages = [...input.messages].sort((left, right) => {
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }

      return left.messageId.localeCompare(right.messageId);
    });

    return this.countMaterialized({
      scope: "raw_turn_materialized",
      representation: messages.map(materializeRawThreadViewMessageContent),
      sourceRevision: input.turn.sourceRevision,
      model: input.model,
      createdAt: input.createdAt,
      now: input.now,
      provenanceSuffix: "thread-view.raw-turn-content-array",
      note: "OpenAI Responses input token count over the ordered raw turn Thread View content array.",
    }) as Promise<RawTurnMaterializedTokenCountRecord>;
  }

  async countSmoothTurnMaterialized(
    turn: TurnRecord,
    options: { model?: string; createdAt?: string; now?: () => Date } = {},
  ): Promise<SmoothTurnMaterializedTokenCountRecord> {
    return this.countMaterialized({
      scope: "smooth_turn_materialized",
      representation: turn.smooth?.text ?? "",
      sourceRevision: turn.smooth?.sourceRevision ?? turn.sourceRevision,
      provenanceSuffix: "thread-view.smooth-turn-content",
      note: "OpenAI Responses input token count over the smooth turn materialized Thread View content.",
      ...options,
    }) as Promise<SmoothTurnMaterializedTokenCountRecord>;
  }

  async countChunkSmoothMaterialized(
    chunk: ChunkState,
    options: { model?: string; createdAt?: string; now?: () => Date } = {},
  ): Promise<ChunkSmoothMaterializedTokenCountRecord> {
    return this.countMaterialized({
      scope: "chunk_smooth_materialized",
      representation: chunk.smoothText ?? "",
      sourceRevision: chunk.sourceRevision,
      provenanceSuffix: "thread-view.chunk-smooth-content",
      note: "OpenAI Responses input token count over the chunk smooth materialized Thread View content.",
      ...options,
    }) as Promise<ChunkSmoothMaterializedTokenCountRecord>;
  }

  async countDetailedChunkMaterialized(
    chunk: ChunkState,
    options: { model?: string; createdAt?: string; now?: () => Date } = {},
  ): Promise<DetailedChunkMaterializedTokenCountRecord> {
    return this.countMaterialized({
      scope: "detailed_chunk_materialized",
      representation: chunk.placeholders?.detailed?.text ?? "",
      sourceRevision: chunk.sourceRevision,
      provenanceSuffix: "thread-view.detailed-chunk-content",
      note: "OpenAI Responses input token count over the detailed chunk materialized Thread View content.",
      ...options,
    }) as Promise<DetailedChunkMaterializedTokenCountRecord>;
  }

  async countBriefChunkMaterialized(
    chunk: ChunkState,
    options: { model?: string; createdAt?: string; now?: () => Date } = {},
  ): Promise<BriefChunkMaterializedTokenCountRecord> {
    return this.countMaterialized({
      scope: "brief_chunk_materialized",
      representation: chunk.placeholders?.brief?.text ?? "",
      sourceRevision: chunk.sourceRevision,
      provenanceSuffix: "thread-view.brief-chunk-content",
      note: "OpenAI Responses input token count over the brief chunk materialized Thread View content.",
      ...options,
    }) as Promise<BriefChunkMaterializedTokenCountRecord>;
  }

  async countGeneratedSession(
    input: CountOpenAIGeneratedSessionInput,
  ): Promise<GeneratedSessionTokenCountRecord> {
    const conversion = convertGeneratedSessionToOpenAIResponsesInput(input.input, {
      model: input.model ?? input.input.file.modelId ?? this.defaultModel,
    });
    let count: number;
    try {
      count = await this.client.countInputTokens(conversion.request);
    } catch (error) {
      if (error instanceof OpenAITokenCounterError) {
        throw new OpenAITokenCounterError(
          error.code,
          `OpenAI generated-session input token count failed for model ${conversion.request.model} with ${conversion.request.input.length} input items (${summarizeRequestItems(conversion.request)}). ${error.message}`,
          {
            status: error.status,
            cause: error.cause,
            openAIErrorType: error.openAIErrorType,
            openAIErrorCode: error.openAIErrorCode,
            openAIErrorParam: error.openAIErrorParam,
          },
        );
      }
      throw error;
    }
    const createdAt = input.createdAt ?? (input.now ?? (() => new Date()))().toISOString();

    return assertTokenCountRecord({
      count,
      scope: "generated_session",
      source: OPENAI_INPUT_TOKEN_COUNTER_SOURCE,
      trustClass: OPENAI_INPUT_TOKEN_COUNTER_TRUST_CLASS,
      provider: OPENAI_INPUT_TOKEN_COUNTER_PROVIDER,
      model: conversion.request.model,
      representationHash: conversion.representationHash,
      sourceRevision: input.sourceRevision,
      createdAt,
      provenance: OPENAI_INPUT_TOKEN_COUNTER_PROVENANCE,
      note: "OpenAI Responses input token count over the generated Thread View model-input representation.",
    }) as GeneratedSessionTokenCountRecord;
  }
}
