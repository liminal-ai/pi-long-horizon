import { getModel, type Api, type Model } from "@earendil-works/pi-ai";

export const CHATGPT_CODEX_PROVIDER = "openai-codex" as const;

export const BASELINE_MODEL_IDS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"] as const;

export type BaselineModelId = (typeof BASELINE_MODEL_IDS)[number];

export const DEFAULT_BASELINE_MODEL_ID: BaselineModelId = "gpt-5.4-mini";
export const DEFAULT_BASELINE_THINKING_LEVEL = "medium" as const;

export function getBaselineModels(): Model<Api>[] {
  return BASELINE_MODEL_IDS.map((modelId) => {
    const model = getModel(CHATGPT_CODEX_PROVIDER, modelId);
    if (!model) {
      throw new Error(`PI model not found: ${CHATGPT_CODEX_PROVIDER}/${modelId}`);
    }
    return model as Model<Api>;
  });
}

export function getDefaultBaselineModel(): Model<Api> {
  const [model] = getBaselineModels().filter((candidate) => candidate.id === DEFAULT_BASELINE_MODEL_ID);
  if (!model) {
    throw new Error(`Default baseline model not found: openai-codex/${DEFAULT_BASELINE_MODEL_ID}`);
  }
  return model;
}
