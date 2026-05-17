import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ProviderPayload = {
  model?: unknown;
  tools?: unknown;
};

type HostedWebSearchTool = {
  type: "web_search";
  external_web_access: boolean;
  search_context_size?: "low" | "medium" | "high";
  search_content_types?: ("text" | "image")[];
};

const CODEX_MODELS = new Set(["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]);

const WEB_SEARCH_TOOL: HostedWebSearchTool = {
  type: "web_search",
  external_web_access: true,
  search_context_size: "high",
};

const WEB_SEARCH_FLAG = "codex-web-search";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexPayload(payload: ProviderPayload): boolean {
  return typeof payload.model === "string" && CODEX_MODELS.has(payload.model);
}

function hasWebSearchTool(tools: unknown[]): boolean {
  return tools.some((tool) => isRecord(tool) && tool.type === "web_search");
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag(WEB_SEARCH_FLAG, {
    description: "Enable hosted Codex web_search for openai-codex GPT models.",
    type: "boolean",
    default: false,
  });

  pi.on("before_provider_request", (event) => {
    if (pi.getFlag(WEB_SEARCH_FLAG) !== true) {
      return;
    }

    if (!isRecord(event.payload) || !isCodexPayload(event.payload)) {
      return;
    }

    const tools = Array.isArray(event.payload.tools) ? event.payload.tools : [];
    if (hasWebSearchTool(tools)) {
      return;
    }

    return {
      ...event.payload,
      tools: [...tools, WEB_SEARCH_TOOL],
      tool_choice: "auto",
    };
  });
}
