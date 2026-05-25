import { inspectPostCompactReport } from "../core/reports.js";
import { formatJson, formatPostCompactReportHuman } from "../output/format.js";
import type { InspectInput } from "../types/public.js";

export async function runPostCompactReportCommand(input: InspectInput, json: boolean): Promise<string> {
  const result = await inspectPostCompactReport(input);
  return json ? formatJson(result) : formatPostCompactReportHuman(result);
}
