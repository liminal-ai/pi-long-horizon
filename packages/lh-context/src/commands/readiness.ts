import { inspectReadiness } from "../core/inspectors.js";
import { formatJson, formatReadinessHuman } from "../output/format.js";
import type { InspectInput } from "../types/public.js";

export async function runReadinessCommand(input: InspectInput, json: boolean): Promise<string> {
  const result = await inspectReadiness(input);
  return json ? formatJson(result) : formatReadinessHuman(result);
}
