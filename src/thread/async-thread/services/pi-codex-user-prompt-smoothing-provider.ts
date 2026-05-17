import { complete, getModel, type Usage } from "@earendil-works/pi-ai";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import {
  USER_PROMPT_SMOOTHING_PROMPT_VERSION,
  type UserPromptSmoothingProvider,
  type UserPromptSmoothingProviderInput,
  type UserPromptSmoothingProviderOutput,
} from "./user-prompt-smoothing-service.js";

const SYSTEM_PROMPT = `You smooth user prompts for long-horizon coding context.

Preserve the user's intent, uncertainty, explicit constraints, file paths, commands, identifiers, numbers, thresholds, and priorities.
When protected literals are provided, copy each one exactly; do not normalize, shorten, spell-correct, or regenerate those strings.
Fix typos, grammar, capitalization, and whitespace.
Reduce repetition, anger, profanity, and attention-spiking phrasing without moralizing, apologizing, or adding therapeutic framing.
Return only the smoothed prompt text.`;

const MODEL = getModel("openai-codex", "gpt-5.4-mini");

function usageToRecord(usage: Usage | undefined): Record<string, unknown> | undefined {
  return usage ? { ...usage } : undefined;
}

function defaultAuthPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return agentDir ? join(agentDir, "auth.json") : ".pi/agent/auth.json";
}

export interface PiCodexUserPromptSmoothingProviderOptions {
  authStorage?: Pick<AuthStorage, "getApiKey">;
  authPath?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export class PiCodexUserPromptSmoothingProvider implements UserPromptSmoothingProvider {
  constructor(private readonly options: PiCodexUserPromptSmoothingProviderOptions = {}) {}

  async smoothUserPrompt(input: UserPromptSmoothingProviderInput): Promise<UserPromptSmoothingProviderOutput> {
    const startedAt = Date.now();
    const authStorage = this.options.authStorage ?? AuthStorage.create(this.options.authPath ?? defaultAuthPath());
    const apiKey = await authStorage.getApiKey("openai-codex");
    if (!apiKey) {
      throw new Error("OpenAI Codex OAuth credential is not configured for provider openai-codex.");
    }

    const response = await complete(
      MODEL,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: input.protectedLiterals.length > 0
                  ? [
                      "Protected literals that must appear exactly in the output:",
                      ...input.protectedLiterals.map((literal) => `- ${literal}`),
                      "",
                      "Prompt to smooth:",
                      input.rawText,
                    ].join("\n")
                  : input.rawText,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        reasoningEffort: "none",
        textVerbosity: "low",
        transport: "sse",
        timeoutMs: this.options.timeoutMs ?? 30_000,
        metadata: {
          threadId: input.threadId,
          turnId: input.turnId,
          messageId: input.messageId,
          promptVersion: input.promptVersion,
        },
      },
    );

    if (response.stopReason !== "stop") {
      const details = [
        `User prompt smoothing stopped with reason ${response.stopReason}.`,
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
      throw new Error("User prompt smoothing returned empty text.");
    }

    return {
      text,
      providerId: "openai-codex",
      modelId: "gpt-5.4-mini",
      reasoningEffort: "none",
      promptVersion: USER_PROMPT_SMOOTHING_PROMPT_VERSION,
      usage: usageToRecord(response.usage),
      elapsedMs: Date.now() - startedAt,
      generatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
  }
}
