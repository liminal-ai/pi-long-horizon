# Phase B OpenAI Count Client

Phase B adds standalone OpenAI input-token counting for generated Thread View sessions. It does not switch maintenance, allocation, or the existing PI heuristic fallback paths.

## Credential Source

The live client reads the stored PI AuthStorage credential from `.pi/agent/auth.json` using provider `openai`.

Expected stored credential shape:

```json
{
  "openai": {
    "type": "api_key",
    "key": "sk-..."
  }
}
```

The resolver intentionally reads the stored credential only. It does not use environment variables as the primary path and does not include key material in thrown error messages. Tests inject fake credential resolvers or fake clients, so normal `npm run test` never calls the live OpenAI API.

## Converter Scope

`convertGeneratedSessionToOpenAIResponsesInput()` converts generated Thread View entries into the OpenAI Responses input-token-count request shape:

- `user` raw entries become `message` input items with `role: "user"` and `input_text` content.
- `assistant` raw text entries become completed assistant output `message` items with `output_text` content.
- assistant `tool_call` parts become Responses `function_call` items with canonical call IDs and stable JSON argument strings.
- `toolResult` raw entries become `function_call_output` items linked by `metadata.toolCallId`.
- compacted generated entries (`smooth_turn`, `detailed_chunk_summary`, `brief_chunk_summary`) are model-visible context and become user `message` input items containing their text.
- custom raw entries are treated as model-visible text context and become user `message` input items containing their text.

Thread View output metadata, generated JSONL headers, model-change entries, thinking-level entries, and entry `metadata` fields other than tool-call linkage are excluded from the model-input representation. Assistant reasoning parts are excluded because the generated session does not provide OpenAI Responses encrypted reasoning state and raw reasoning text should not be counted as visible model input.

The `representationHash` covers the Responses input-token-count request body, not the PI JSONL bytes.

## Count Record

`OpenAIInputTokenCounter.countGeneratedSession()` returns a generated-session `TokenCountRecord` with:

- `source: "provider_input_count"`
- `trustClass: "exact"`
- `provider: "openai"`
- `model` from the conversion request
- `representationHash` for the Responses input representation
- `provenance: "pi-long-horizon.openai-input-token-counter.v1:responses.input_tokens"`

## Live Smoke Validation

The optional smoke command is:

```bash
npm run smoke:openai-token-count -- gpt-4.1-mini
```

It performs a tiny live call to `POST /v1/responses/input_tokens` using the stored `.pi/agent/auth.json` OpenAI credential and prints non-secret count metadata. Do not run it in normal unit validation or CI.
