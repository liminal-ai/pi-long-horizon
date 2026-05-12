#!/usr/bin/env tsx
import {
  OpenAIInputTokenCounter,
  convertGeneratedSessionToOpenAIResponsesInput,
} from "../src/token-accounting/index.js";
import type { WritePiThreadViewFileInput } from "../src/thread-view/domain/pi-thread-view-file.js";

const model = process.argv[2] ?? "gpt-4.1-mini";
const generatedAt = new Date().toISOString();
const input: WritePiThreadViewFileInput = {
  threadId: "smoke-thread",
  threadViewId: "smoke-thread-view",
  file: {
    threadId: "smoke-thread",
    threadViewId: "smoke-thread-view",
    sessionId: "smoke-session",
    cwd: process.cwd(),
    modelProvider: "openai",
    modelId: model,
    generatedAt,
    placeholderExplicit: false,
    fileName: "smoke-openai-input-token-count.jsonl",
    entries: [
      {
        entryType: "message",
        role: "user",
        content: "Count this generated Thread View input.",
        generatedSource: "raw_turn_message",
      },
      {
        entryType: "message",
        role: "assistant",
        content: "This assistant output is part of prior context.",
        generatedSource: "smooth_turn",
      },
    ],
    entryCount: 2,
  },
};

const conversion = convertGeneratedSessionToOpenAIResponsesInput(input, { model });
const counter = new OpenAIInputTokenCounter();
const record = await counter.countGeneratedSession({
  input,
  model,
  createdAt: generatedAt,
});

console.log(
  JSON.stringify(
    {
      model,
      inputItemCount: conversion.request.input.length,
      count: record.count,
      source: record.source,
      trustClass: record.trustClass,
      provider: record.provider,
      representationHash: record.representationHash,
    },
    null,
    2,
  ),
);
