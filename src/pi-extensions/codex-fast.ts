import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ProviderPayload = {
  model?: unknown;
  service_tier?: unknown;
};

const CODEX_MODELS = new Set(["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexPayload(payload: ProviderPayload): boolean {
  return typeof payload.model === "string" && CODEX_MODELS.has(payload.model);
}

export default function registerCodexFastExtension(pi: ExtensionAPI): void {
  let fastMode = false;

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode service tier.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      fastMode = !fastMode;
      const message = fastMode ? "fast mode on" : "fast mode off";
      ctx.ui.setStatus("fast", message);
      ctx.ui.notify(message, "info");
    },
  });

  pi.on("before_provider_request", (event) => {
    if (!isRecord(event.payload) || !isCodexPayload(event.payload)) {
      return;
    }

    if (!fastMode) {
      const { service_tier: _serviceTier, ...payload } = event.payload;
      return payload;
    }

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
