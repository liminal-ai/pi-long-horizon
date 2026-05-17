import assert from "node:assert/strict";
import test from "node:test";

import {
  FetchOpenAIInputTokenCountClient,
  OpenAIInputTokenCounter,
  OpenAITokenCounterError,
  convertGeneratedSessionToOpenAIResponsesInput,
  createPiAuthStorageOpenAIApiKeyResolver,
} from "../../src/token-accounting/index.js";
import { makePiThreadViewFile } from "../../src/thread-view/test/fixtures.js";

const CREATED_AT = "2026-05-12T12:00:00.000Z";

function makeGeneratedSessionInput() {
  const file = makePiThreadViewFile({
    threadId: "thread-openai-count",
    threadViewId: "thread-view-openai-count",
    modelProvider: "openai",
    modelId: "gpt-5.4-mini",
    entries: [
      {
        entryType: "message",
        role: "user",
        content: "Summarize the build log.",
        generatedSource: "raw_turn_message",
      },
      {
        entryType: "message",
        role: "assistant",
        content: {
          parts: [
            {
              partType: "text",
              content: "I will inspect the log.",
            },
            {
              partType: "tool_call",
              content: {
                toolCallId: "call-production-001",
                toolName: "read_file",
                arguments: { path: "build.log" },
              },
            },
          ],
        },
        generatedSource: "raw_turn_message",
      },
      {
        entryType: "message",
        role: "toolResult",
        content: "build failed at step test",
        generatedSource: "raw_turn_message",
        metadata: {
          toolCallId: "call-production-001",
          toolName: "read_file",
        },
      },
      {
        entryType: "message",
        role: "assistant",
        content: "The tests are failing.",
        generatedSource: "smooth_turn",
      },
      {
        entryType: "message",
        role: "custom",
        content: {
          parts: [
            {
              partType: "text",
              content: {
                text: "Preserved custom note.",
              },
            },
          ],
        },
        generatedSource: "raw_turn_message",
        metadata: {
          customType: "context-steward.note",
        },
      },
    ],
    entryCount: 5,
  });

  return {
    threadId: file.threadId,
    threadViewId: file.threadViewId,
    file,
  };
}

test("converts generated Thread View entries to OpenAI Responses input items", () => {
  const conversion = convertGeneratedSessionToOpenAIResponsesInput(makeGeneratedSessionInput());

  assert.equal(conversion.request.model, "gpt-5.4-mini");
  assert.equal(conversion.request.truncation, "disabled");
  assert.deepEqual(
    conversion.request.input.map((item) => item.type),
    ["message", "message", "function_call", "function_call_output", "message", "message"],
  );
  assert.deepEqual(conversion.excluded, []);
  assert.equal(conversion.representationHash.startsWith("sha256:"), true);

  assert.deepEqual(conversion.request.input[0], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Summarize the build log." }],
  });
  assert.deepEqual(conversion.request.input[1], {
    type: "message",
    id: "msg_generated_2",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "I will inspect the log.", annotations: [] }],
  });
  assert.deepEqual(conversion.request.input[2], {
    type: "function_call",
    id: "fc_generated_2_2",
    call_id: "call-production-001",
    name: "read_file",
    arguments: "{\"path\":\"build.log\"}",
    status: "completed",
  });
  assert.deepEqual(conversion.request.input[3], {
    type: "function_call_output",
    call_id: "call-production-001",
    output: "build failed at step test",
    status: "completed",
  });
  assert.deepEqual(conversion.request.input[4], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "The tests are failing." }],
  });
  assert.deepEqual(conversion.request.input[5], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Preserved custom note." }],
  });
});

test("conversion unwraps raw custom message content for model-visible token counting", () => {
  const file = makePiThreadViewFile({
    threadId: "thread-openai-raw-custom",
    threadViewId: "thread-view-openai-raw-custom",
    modelProvider: "openai",
    modelId: "gpt-5.4-mini",
    entries: [
      {
        entryType: "message",
        role: "custom",
        content: {
          parts: [
            {
              partType: "text",
              content: {
                raw: {
                  role: "custom",
                  customType: "pi-long-horizon.raw-message",
                  content: "Only this custom payload is model-visible.",
                  display: true,
                },
              },
            },
          ],
        },
        generatedSource: "raw_turn_message",
      },
    ],
    entryCount: 1,
  });

  const conversion = convertGeneratedSessionToOpenAIResponsesInput({
    threadId: file.threadId,
    threadViewId: file.threadViewId,
    file,
  });

  assert.deepEqual(conversion.request.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Only this custom payload is model-visible." }],
    },
  ]);
  assert.equal(
    JSON.stringify(conversion.request).includes("pi-long-horizon.raw-message"),
    false,
  );
  assert.equal(conversion.representationHash.startsWith("sha256:"), true);
});

test("conversion shortens overlong tool call ids consistently for OpenAI counting", () => {
  const longToolCallId = "call_" + "x".repeat(90);
  const file = makePiThreadViewFile({
    threadId: "thread-openai-long-call-id",
    threadViewId: "thread-view-openai-long-call-id",
    modelProvider: "openai",
    modelId: "gpt-5.4-mini",
    entries: [
      {
        entryType: "message",
        role: "assistant",
        content: {
          parts: [
            {
              partType: "tool_call",
              content: {
                toolCallId: longToolCallId,
                toolName: "read_file",
                arguments: { path: "build.log" },
              },
            },
          ],
        },
        generatedSource: "raw_turn_message",
      },
      {
        entryType: "message",
        role: "toolResult",
        content: "build failed at step test",
        generatedSource: "raw_turn_message",
        metadata: {
          toolCallId: longToolCallId,
          toolName: "read_file",
        },
      },
    ],
    entryCount: 2,
  });

  const conversion = convertGeneratedSessionToOpenAIResponsesInput({
    threadId: file.threadId,
    threadViewId: file.threadViewId,
    file,
  });

  assert.equal(conversion.request.input[0]?.type, "function_call");
  assert.equal(conversion.request.input[1]?.type, "function_call_output");
  const mappedCallId = conversion.request.input[0]?.type === "function_call"
    ? conversion.request.input[0].call_id
    : undefined;
  assert.ok(mappedCallId);
  assert.ok(mappedCallId.length <= 64);
  assert.notEqual(mappedCallId, longToolCallId);
  assert.equal(
    conversion.request.input[1]?.type === "function_call_output"
      ? conversion.request.input[1].call_id
      : undefined,
    mappedCallId,
  );
});

test("conversion uses PI writer JSON.stringify fallback for structured visible text", () => {
  const structuredContent = {
    parts: [
      {
        partType: "text",
        content: {
          z: 1,
          a: 2,
        },
      },
    ],
  };
  const file = makePiThreadViewFile({
    threadId: "thread-openai-json-fallback",
    threadViewId: "thread-view-openai-json-fallback",
    modelProvider: "openai",
    modelId: "gpt-5.4-mini",
    entries: [
      {
        entryType: "message",
        role: "user",
        content: structuredContent,
        generatedSource: "raw_turn_message",
      },
    ],
    entryCount: 1,
  });

  const conversion = convertGeneratedSessionToOpenAIResponsesInput({
    threadId: file.threadId,
    threadViewId: file.threadViewId,
    file,
  });

  assert.deepEqual(conversion.request.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "{\"z\":1,\"a\":2}" }],
    },
  ]);
  assert.notEqual(conversion.request.input[0]?.type === "message" ? conversion.request.input[0].content[0]?.text : "", "{\"a\":2,\"z\":1}");
  assert.equal(conversion.representationHash.startsWith("sha256:"), true);
});

test("mocked OpenAI count response becomes an exact provider input TokenCountRecord", async () => {
  const input = makeGeneratedSessionInput();
  let capturedModel: string | undefined;
  const counter = new OpenAIInputTokenCounter({
    async countInputTokens(request) {
      capturedModel = request.model;
      assert.equal(request.input.length, 6);
      return 1234;
    },
  });

  const record = await counter.countGeneratedSession({
    input,
    sourceRevision: 42,
    createdAt: CREATED_AT,
  });

  assert.equal(capturedModel, "gpt-5.4-mini");
  assert.equal(record.count, 1234);
  assert.equal(record.scope, "generated_session");
  assert.equal(record.source, "provider_input_count");
  assert.equal(record.trustClass, "exact");
  assert.equal(record.provider, "openai");
  assert.equal(record.model, "gpt-5.4-mini");
  assert.equal(record.sourceRevision, 42);
  assert.equal(record.createdAt, CREATED_AT);
  assert.equal(record.representationHash?.startsWith("sha256:"), true);
  assert.match(record.provenance ?? "", /responses\.input_tokens/);
});

test("PI AuthStorage credential resolver uses stored openai key without leaking it", async () => {
  const secret = "sk-test-secret-value";
  const resolver = createPiAuthStorageOpenAIApiKeyResolver({
    authStorage: {
      get(provider: string) {
        assert.equal(provider, "openai");
        return { type: "api_key", key: secret };
      },
    },
  });

  assert.equal(await resolver.resolveApiKey(), secret);

  const missingResolver = createPiAuthStorageOpenAIApiKeyResolver({
    authStorage: {
      get() {
        return undefined;
      },
    },
  });

  await assert.rejects(
    () => missingResolver.resolveApiKey(),
    (error: unknown) => {
      assert.equal(error instanceof OpenAITokenCounterError, true);
      assert.equal((error as OpenAITokenCounterError).code, "OPENAI_API_KEY_MISSING");
      assert.equal((error as Error).message.includes(secret), false);
      return true;
    },
  );
});

test("credential resolver maps unsupported and invalid stored keys without exposing values", async () => {
  const invalidKey = "not-an-openai-key";
  const unsupportedResolver = createPiAuthStorageOpenAIApiKeyResolver({
    authStorage: {
      get() {
        return {
          type: "oauth",
          access: "oauth-secret",
          refresh: "refresh-secret",
          expires: Date.now() + 60_000,
        };
      },
    },
  });
  const invalidResolver = createPiAuthStorageOpenAIApiKeyResolver({
    authStorage: {
      get() {
        return { type: "api_key", key: invalidKey };
      },
    },
  });

  await assert.rejects(
    () => unsupportedResolver.resolveApiKey(),
    (error: unknown) => {
      assert.equal(error instanceof OpenAITokenCounterError, true);
      assert.equal((error as OpenAITokenCounterError).code, "OPENAI_API_KEY_UNSUPPORTED");
      assert.equal((error as Error).message.includes("oauth-secret"), false);
      return true;
    },
  );
  await assert.rejects(
    () => invalidResolver.resolveApiKey(),
    (error: unknown) => {
      assert.equal(error instanceof OpenAITokenCounterError, true);
      assert.equal((error as OpenAITokenCounterError).code, "OPENAI_API_KEY_INVALID");
      assert.equal((error as Error).message.includes(invalidKey), false);
      return true;
    },
  );
});

test("fetch client sends the Responses input token request and maps response/error shapes", async () => {
  const request = convertGeneratedSessionToOpenAIResponsesInput(makeGeneratedSessionInput()).request;
  const client = new FetchOpenAIInputTokenCountClient({
    apiKeyResolver: {
      async resolveApiKey() {
        return "sk-test-secret-value";
      },
    },
    async fetchImpl(url, init) {
      assert.equal(url, "https://api.openai.com/v1/responses/input_tokens");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer sk-test-secret-value");
      assert.deepEqual(JSON.parse(init?.body as string), request);

      return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 987 }), {
        status: 200,
      });
    },
  });

  assert.equal(await client.countInputTokens(request), 987);

  const failingClient = new FetchOpenAIInputTokenCountClient({
    apiKeyResolver: {
      async resolveApiKey() {
        return "sk-test-secret-value";
      },
    },
    async fetchImpl() {
      return new Response(
        JSON.stringify({
          error: {
            message: "Incorrect API key provided: sk-test-secret-value",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
        { status: 401 },
      );
    },
  });

  await assert.rejects(
    () => failingClient.countInputTokens(request),
    (error: unknown) => {
      assert.equal(error instanceof OpenAITokenCounterError, true);
      assert.equal((error as OpenAITokenCounterError).code, "OPENAI_TOKEN_COUNT_AUTH_FAILED");
      assert.equal((error as OpenAITokenCounterError).status, 401);
      assert.equal((error as Error).message.includes("sk-test-secret-value"), false);
      assert.match((error as Error).message, /invalid_api_key/);
      return true;
    },
  );
});

test("fetch client wraps thrown fetch failures with integration context and cause", async () => {
  const request = convertGeneratedSessionToOpenAIResponsesInput(makeGeneratedSessionInput()).request;
  const socketError = Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" });
  const fetchError = new TypeError("fetch failed", { cause: socketError });
  const client = new FetchOpenAIInputTokenCountClient({
    endpoint: "https://api.openai.com/v1/responses/input_tokens",
    apiKeyResolver: {
      async resolveApiKey() {
        return "sk-test-secret-value";
      },
    },
    async fetchImpl() {
      throw fetchError;
    },
  });

  await assert.rejects(
    () => client.countInputTokens(request),
    (error: unknown) => {
      assert.equal(error instanceof OpenAITokenCounterError, true);
      assert.equal((error as OpenAITokenCounterError).code, "OPENAI_TOKEN_COUNT_FETCH_FAILED");
      assert.equal((error as Error).cause, fetchError);
      assert.match((error as Error).message, /operation=count_input_tokens/);
      assert.match((error as Error).message, /endpoint=https:\/\/api\.openai\.com\/v1\/responses\/input_tokens/);
      assert.match((error as Error).message, /TypeError: fetch failed/);
      assert.match((error as Error).message, /UND_ERR_SOCKET/);
      assert.equal((error as Error).message.includes("sk-test-secret-value"), false);
      return true;
    },
  );
});
