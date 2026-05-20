import { inspectSummary } from "../core/inspectors.js";
import { formatJson, formatSummaryHuman } from "../output/format.js";
import type { InspectInput } from "../types/public.js";

export async function runSummaryCommand(input: InspectInput, json: boolean): Promise<string> {
  const result = await inspectSummary(input);
  return json ? formatJson(result) : formatSummaryHuman(result);
}
