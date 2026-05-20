import { inspectTokens } from "../core/inspectors.js";
import { formatJson, formatTokensHuman } from "../output/format.js";
import type { InspectInput } from "../types/public.js";

export async function runTokensCommand(input: InspectInput, json: boolean): Promise<string> {
  const result = await inspectTokens(input);
  return json ? formatJson(result) : formatTokensHuman(result);
}
