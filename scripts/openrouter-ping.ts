#!/usr/bin/env tsx
/**
 * Exploratory/POC helper only.
 *
 * This script was used during pre-implementation model comparison for the
 * Smooth Context Quality stories. The production smoothing lane is PI
 * OAuth-backed `openai-codex/gpt-5.4-mini`; this OpenRouter script is not part
 * of the runtime code path and should not be treated as an application
 * provider.
 */
import { AuthStorage } from "@earendil-works/pi-coding-agent";

interface Args {
  model?: string;
  effort?: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { timeoutMs: 20_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model") {
      args.model = argv[++index];
      continue;
    }
    if (token === "--effort") {
      args.effort = argv[++index];
      continue;
    }
    if (token === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index]);
      continue;
    }
    throw new Error(`Unknown argument ${token}.`);
  }
  if (!args.model) {
    throw new Error("Missing --model.");
  }
  return args;
}

function openRouterApiKey(): string {
  const credential = AuthStorage.create(".pi/agent/auth.json").get("openrouter");
  if (!credential || credential.type !== "api_key" || typeof credential.key !== "string") {
    throw new Error("OpenRouter API key is not configured. Run npm run poc:login:openrouter.");
  }
  return credential.key;
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  signal: AbortSignal.timeout(args.timeoutMs),
  headers: {
    Authorization: `Bearer ${openRouterApiKey()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/pi-long-horizon",
    "X-Title": "PI Long Horizon OpenRouter ping",
  },
  body: JSON.stringify({
    model: args.model,
    ...(args.effort ? { reasoning: { effort: args.effort } } : {}),
    messages: [{ role: "user", content: "Send exactly: ping" }],
  }),
});
const elapsedMs = Date.now() - startedAt;
const body = await response.json().catch(() => undefined);
if (!response.ok) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        model: args.model,
        effort: args.effort ?? "omitted",
        elapsedMs,
        status: response.status,
        error: body,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

const message = (body as { choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }> }).choices?.[0]
  ?.message;
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      model: args.model,
      effort: args.effort ?? "omitted",
      elapsedMs,
      content: message?.content,
      hasReasoning: typeof message?.reasoning === "string" && message.reasoning.length > 0,
      usage: (body as { usage?: unknown }).usage,
    },
    null,
    2,
  )}\n`,
);
