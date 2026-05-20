import { complete, getModel, type Usage } from "@earendil-works/pi-ai";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import {
  LOWER_BAND_BRIEF_PROMPT_VERSION,
  LOWER_BAND_DETAIL_PROMPT_VERSION,
  type LowerBandCompressionProvider,
  type LowerBandCompressionProviderInput,
  type LowerBandCompressionProviderOutput,
} from "./lower-band-compression-service.js";

const DETAILED_SYSTEM_PROMPT = `You compress closed coding-session conversation chunks into a detailed lower-band summary.

Preserve important decisions, constraints, architectural direction, risks, failures, open questions, and promised next actions.
Keep the output concise, readable, and semantically faithful to the transcript.
Use prose or short bullets when useful.
Do not echo every detail or preserve source markers like > or ● unless naturally needed.
Return only the detailed compressed text.`;

const BRIEF_SYSTEM_PROMPT = `You compress closed coding-session conversation chunks into a brief lower-band summary.

Preserve only durable decisions, constraints, unresolved work, and critical context needed to continue later.
Aggressively drop local detail, repetition, and incidental phrasing.
Use prose or short bullets when useful.
Do not echo every detail or preserve source markers like > or ● unless naturally needed.
Return only the brief compressed text.`;

function usageToRecord(usage: Usage | undefined): Record<string, unknown> | undefined {
  return usage ? { ...usage } : undefined;
}

function defaultAuthPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return agentDir ? join(agentDir, "auth.json") : ".pi/agent/auth.json";
}

function systemPromptForVersion(version: LowerBandCompressionProviderInput["promptVersion"]): string {
  return version === LOWER_BAND_DETAIL_PROMPT_VERSION ? DETAILED_SYSTEM_PROMPT : BRIEF_SYSTEM_PROMPT;
}

function buildUserPrompt(input: LowerBandCompressionProviderInput): string {
  const lines = [
    input.band === "detailed"
      ? "Generate the detailed lower-band compression for this closed chunk."
      : "Generate the brief lower-band compression for this closed chunk.",
    "",
    `Thread ID: ${input.threadId}`,
    `Chunk ID: ${input.chunkId}`,
    `Band: ${input.band}`,
  ];

  if (input.retryContext) {
    lines.push(
      `Previous attempt: ${input.retryContext.previousAttempt}`,
      `Retry attempt: ${input.retryContext.attempt} of ${input.retryContext.maxAttempts}`,
    );

    if (input.retryContext.acceptedRange) {
      lines.push(
        `Target estimated token range: ${input.retryContext.acceptedRange.min}-${input.retryContext.acceptedRange.max}`,
      );
    }

    if (
      typeof input.retryContext.previousEstimatedTokens === "number" &&
      input.retryContext.rangeDisposition
    ) {
      lines.push(
        `Previous output landed ${input.retryContext.rangeDisposition.replace("_", " ")} at ${input.retryContext.previousEstimatedTokens} estimated tokens.`,
      );
    }

    if (input.retryContext.previousErrorMessage) {
      lines.push(`Previous failure: ${input.retryContext.previousErrorMessage}`);
    }

    if (input.retryContext.previousOutputText) {
      lines.push("Previous output text:", input.retryContext.previousOutputText);
    }
  }

  lines.push("", "Conversation-only chunk transcript:", input.transcriptText);
  return lines.join("\n");
}

export interface PiCodexLowerBandCompressionProviderOptions {
  authStorage?: Pick<AuthStorage, "getApiKey">;
  authPath?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export class PiCodexLowerBandCompressionProvider implements LowerBandCompressionProvider {
  constructor(private readonly options: PiCodexLowerBandCompressionProviderOptions = {}) {}

  async compress(input: LowerBandCompressionProviderInput): Promise<LowerBandCompressionProviderOutput> {
    const startedAt = Date.now();
    const authStorage = this.options.authStorage ?? AuthStorage.create(this.options.authPath ?? defaultAuthPath());
    const apiKey = await authStorage.getApiKey("openai-codex");
    if (!apiKey) {
      throw new Error("OpenAI Codex OAuth credential is not configured for provider openai-codex.");
    }

    const model = getModel("openai-codex", input.modelId);
    if (!model) {
      throw new Error(`OpenAI Codex lower-band compression model is not configured: ${input.modelId}.`);
    }
    const response = await complete(
      model,
      {
        systemPrompt: systemPromptForVersion(input.promptVersion),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: buildUserPrompt(input) }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        reasoningEffort: input.reasoningEffort,
        textVerbosity: "low",
        transport: "sse",
        timeoutMs: this.options.timeoutMs ?? 60_000,
        metadata: {
          threadId: input.threadId,
          chunkId: input.chunkId,
          band: input.band,
          promptVersion: input.promptVersion,
        },
      },
    );

    if (response.stopReason !== "stop") {
      const details = [
        `Lower-band compression stopped with reason ${response.stopReason}.`,
        response.errorMessage ? `Error: ${response.errorMessage}` : undefined,
        response.diagnostics?.length ? `Diagnostics: ${JSON.stringify(response.diagnostics)}` : undefined,
      ].filter(Boolean);
      throw new Error(details.join(" "));
    }

    const text = response.content
      .filter((content): content is { type: "text"; text: string } => content.type === "text")
      .map((content) => content.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Lower-band compression returned empty text.");
    }

    return {
      text,
      providerId: "openai-codex",
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      promptVersion: input.promptVersion,
      usage: usageToRecord(response.usage),
      elapsedMs: Date.now() - startedAt,
      generatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
  }
}
