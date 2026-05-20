import { inspectBands } from "../core/inspectors.js";
import { formatBandsHuman, formatJson } from "../output/format.js";
import type { InspectInput } from "../types/public.js";

export async function runBandsCommand(input: InspectInput, json: boolean): Promise<string> {
  const result = await inspectBands(input);
  return json ? formatJson(result) : formatBandsHuman(result);
}
