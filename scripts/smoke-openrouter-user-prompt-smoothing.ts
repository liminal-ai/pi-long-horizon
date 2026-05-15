#!/usr/bin/env tsx
/**
 * Exploratory/POC helper only.
 *
 * This script was used to compare model behavior for user prompt smoothing
 * before the implementation target was settled. The production smoothing lane
 * is PI OAuth-backed `openai-codex/gpt-5.4-mini` with `reasoningEffort:
 * "none"`. OpenRouter remains only historical/evaluation scaffolding and is
 * currently unrelated to the repo's runtime code path.
 */
import { readFile } from "node:fs/promises";
import { stdin as input } from "node:process";
import { AuthStorage } from "@earendil-works/pi-coding-agent";

interface Args {
  model?: string;
  inputText?: string;
  file?: string;
  json: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  reasoningMaxTokens?: number;
  reasoningExclude?: boolean;
  verbosity?: string;
  seed?: number;
  timeoutMs?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model") {
      args.model = argv[++index];
      continue;
    }
    if (token === "--input") {
      args.inputText = argv[++index];
      continue;
    }
    if (token === "--file") {
      args.file = argv[++index];
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--temperature") {
      args.temperature = Number(argv[++index]);
      continue;
    }
    if (token === "--top-p") {
      args.topP = Number(argv[++index]);
      continue;
    }
    if (token === "--max-tokens") {
      args.maxTokens = Number(argv[++index]);
      continue;
    }
    if (token === "--reasoning-effort") {
      args.reasoningEffort = argv[++index];
      continue;
    }
    if (token === "--reasoning-max-tokens") {
      args.reasoningMaxTokens = Number(argv[++index]);
      continue;
    }
    if (token === "--reasoning-exclude") {
      args.reasoningExclude = true;
      continue;
    }
    if (token === "--verbosity") {
      args.verbosity = argv[++index];
      continue;
    }
    if (token === "--seed") {
      args.seed = Number(argv[++index]);
      continue;
    }
    if (token === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index]);
      continue;
    }
    if (!args.model && token && !token.startsWith("--")) {
      args.model = token;
      continue;
    }
    throw new Error(`Unknown argument ${token}.`);
  }
  return args;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      text += chunk;
    });
    input.on("end", () => resolve(text.trim()));
    input.resume();
  });
}

function resolveOpenRouterKey(): string {
  const auth = AuthStorage.create(".pi/agent/auth.json");
  const credential = auth.get("openrouter");
  if (!credential) {
    throw new Error("OpenRouter API key is not configured. Run npm run poc:login:openrouter.");
  }
  if (credential.type !== "api_key" || typeof credential.key !== "string" || credential.key.trim().length === 0) {
    throw new Error("OpenRouter credential must be a stored api_key.");
  }
  return credential.key;
}

const SYSTEM_PROMPT = `
You rewrite user prompts for a long-horizon coding agent's smooth context layer.

Your task is to preserve the prompt as-is as much as possible, almost word-for-word, while fixing defects that make the text harder or more distracting for a future agent to read.

Rewrite the user prompt with only these allowed changes:
- Fix typos and misspellings.
- Fix grammar when the original wording is clearly defective.
- Normalize capitalization.
- Normalize awkward whitespace and line breaks.
- Soften profanity, anger, repeated urgency spikes, and hostile intensity.
- Lightly remove repeated words or repeated commands only when they are clearly attention-spiking repetition, not distinct requirements.

Preserve:
- The user's intent, meaning, constraints, sequence, uncertainty, and emphasis.
- Technical details, file paths, commands, numbers, thresholds, model names, and exact terminology.
- Directness and priority.
- Sentence fragments when they communicate the user's meaning clearly.
- Hedging or uncertainty such as "I think," "maybe," "not sure," or "probably."
- User-chosen labels and names when they may refer to project artifacts, story names, phases, commands, skills, models, files, exact-output text, or repo-specific terminology.
- Exact-output instructions such as "say exactly"; preserve the requested output string exactly.

Do not:
- Do not summarize.
- Do not paraphrase for style.
- Do not add explanation.
- Do not add politeness, apologies, or corporate tone.
- Do not remove distinct requirements.
- Do not turn uncertainty into certainty.
- Do not invent missing details.
- Do not comment on the user's tone.
- Do not title-case, rename, spell out numbers, or formalize labels unless the user already did or the original is clearly a typo.

<examples>
  <example>
    <original>
answer the thing i asked and dont wander into other stuff i didnt ask about
    </original>
    <good>
Answer the thing I asked, and don't wander into other stuff I didn't ask about.
    </good>
    <why_good>
Fixes typos, capitalization, punctuation, and grammar. Preserves the direct instruction exactly.
    </why_good>
    <bad>
Please be concise and focus only on relevant information.
    </bad>
    <why_bad>
Summarizes and changes the request. Loses the explicit "answer what I asked / don't wander" structure.
    </why_bad>
  </example>

  <example>
    <original>
you said you were going to keep working and then you stopped. that is a big fucking problem. KEEP GOING KEEP GOING KEEP FUCKING GOING
    </original>
    <good>
You said you were going to keep working, and then you stopped. That is a serious problem. Keep going.
    </good>
    <why_good>
Preserves the correction and urgency, fixes typo/capitalization, and softens profanity and repeated attention spikes.
    </why_good>
    <bad>
Please continue with the task when you are ready.
    </bad>
    <why_bad>
Removes the fact that the assistant failed a prior instruction and weakens the priority too much.
    </why_bad>
  </example>

  <example>
    <original>
I'm less worried about whether you can open the files again. I'm more worried that the loaded context is making you miss the current request, over-focus on older problems, or generally follow the current request worse. I don't know if the compact step should reload the session or just prepare the next session. I want to think through that.
    </original>
    <good>
I'm less worried about whether you can open the files again. I'm more worried that the loaded context is making you miss the current request, over-focus on older problems, or generally follow the current request worse. I don't know if the compact step should reload the session or just prepare the next session. I want to think through that.
    </good>
    <why_good>
Fixes typos and lightly normalizes phrasing while preserving every distinct concern and the user's uncertainty.
    </why_good>
    <bad>
I'm concerned that the current context may affect your ability to follow my request, and I want to discuss whether smart compact should reload the session.
    </bad>
    <why_bad>
Over-summarizes. It drops multiple distinct concerns: missing the current ask, over-indexing on prior issues, becoming worse at following the request, and uncertainty about next-session behavior.
    </why_bad>
  </example>

  <example>
    <original>
ok here is what i want. I want you to go through the migration plan and think about whether this handoff process is actually going to work for how we are building these features. I don't want you to jsut say "yes this is good." I want you to look for ways the process might break down, places where one agent won't know enough context, places where the next agent is going to be confused, places where we are asking too much from one step, and whether the verifier has enough information to actually verify the work. Don't implement anything. I want the analysis.
    </original>
    <good>
Okay, here is what I want. I want you to go through the migration plan and think about whether this handoff process is actually going to work for how we are building these features. I don't want you to just say, "Yes, this is good." I want you to look for ways the process might break down, places where one agent won't know enough context, places where the next agent is going to be confused, places where we are asking too much from one step, and whether the verifier has enough information to actually verify the work. Don't implement anything. I want the analysis.
    </good>
    <why_good>
Fixes capitalization, typo, punctuation, and quote formatting. Preserves the full checklist, the negative instruction, and the requested mode of work.
    </why_good>
    <bad>
Please review the story process and identify risks or gaps. Do not implement anything.
    </bad>
    <why_bad>
Too compressed. It loses the specific failure modes the user wants checked and the instruction not to give a shallow approval.
    </why_bad>
  </example>

  <example>
    <original>
Am i too dependent on gpt 5.x tendency to be very pedantic in the build and verify?
    </original>
    <good>
Am I too dependent on gpt 5.x tendency to be very pedantic in the build and verify?
    </good>
    <why_good>
Fixes capitalization only. Preserves the exact model/version identifier.
    </why_good>
    <bad>
Am I too dependent on GPT 4.x/5.x tendencies to be very pedantic in the build and verify?
    </bad>
    <why_bad>
Invents a model/version detail. The original said gpt 5.x, so rewriting it as GPT 4.x/5.x changes the technical meaning.
    </why_bad>
  </example>
</examples>

Return only the rewritten user prompt.
`.trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = args.model ?? "openai/gpt-4.1-mini";
  const original =
    args.inputText ??
    (args.file ? await readFile(args.file, "utf8") : await readStdin());
  if (!original.trim()) {
    throw new Error("Provide input with --input, --file, or stdin.");
  }

  const apiKey = resolveOpenRouterKey();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    ...(args.timeoutMs !== undefined ? { signal: AbortSignal.timeout(args.timeoutMs) } : {}),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/pi-long-horizon",
      "X-Title": "PI Long Horizon user prompt smoothing smoke",
    },
    body: JSON.stringify({
      model,
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.topP !== undefined ? { top_p: args.topP } : {}),
      ...(args.maxTokens !== undefined ? { max_tokens: args.maxTokens } : {}),
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
      ...(args.verbosity !== undefined ? { verbosity: args.verbosity } : {}),
      ...(args.reasoningEffort !== undefined || args.reasoningMaxTokens !== undefined || args.reasoningExclude
        ? {
            reasoning: {
              ...(args.reasoningEffort !== undefined ? { effort: args.reasoningEffort } : {}),
              ...(args.reasoningMaxTokens !== undefined ? { max_tokens: args.reasoningMaxTokens } : {}),
              ...(args.reasoningExclude !== undefined ? { exclude: args.reasoningExclude } : {}),
            },
          }
        : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `<user_prompt_to_smooth>\n${original.trim()}\n</user_prompt_to_smooth>`,
        },
      ],
    }),
  });

  const rawBody = await response.text();
  const body = rawBody.trim().length > 0 ? JSON.parse(rawBody) : undefined;
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `status=${response.status}; body=${rawBody.slice(0, 1200)}`;
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const completion = body as { choices?: Array<{ message?: { content?: unknown } }> } | undefined;
  const smoothed = completion?.choices?.[0]?.message?.content;
  if (typeof smoothed !== "string") {
    throw new Error(
      `OpenRouter response did not contain a text message. Response preview: ${JSON.stringify(body).slice(0, 1200)}`,
    );
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          model,
          request: {
            temperature: args.temperature,
            topP: args.topP,
            maxTokens: args.maxTokens,
            reasoningEffort: args.reasoningEffort,
            reasoningMaxTokens: args.reasoningMaxTokens,
            reasoningExclude: args.reasoningExclude,
            verbosity: args.verbosity,
            seed: args.seed,
            timeoutMs: args.timeoutMs,
          },
          original,
          smoothed,
          usage: (body as { usage?: unknown }).usage,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`Model: ${model}\n\n`);
  process.stdout.write("Original:\n");
  process.stdout.write(`${original.trim()}\n\n`);
  process.stdout.write("Smoothed:\n");
  process.stdout.write(`${smoothed.trim()}\n`);
}

await main();
