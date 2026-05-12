import { createStewardIssue, type StewardIssue } from "./errors.js";
import type { TokenCountSourceDecision, TokenCountRecord } from "../../token-accounting/index.js";

export const GENERATED_OUTPUT_STATUSES = [
  "available",
  "blocked",
  "degraded",
  "write_failed",
  "reload_failed",
] as const;

export type GeneratedOutputStatus = (typeof GENERATED_OUTPUT_STATUSES)[number];

export interface GeneratedOutputMetadata {
  threadId: string;
  threadViewId?: string;
  generatedFilePath?: string;
  archivePath?: string;
  generatedAt?: string;
  status: GeneratedOutputStatus;
  generatedSource: "thread_view";
  placeholderExplicit: boolean;
  requestedLowerBound?: number;
  generatedSessionTokenCount?: number;
  generatedSessionTokenCountMetadata?: TokenCountRecord;
  generatedSessionCountPolicy?: TokenCountSourceDecision;
  issues?: StewardIssue[];
}

export function cloneGeneratedOutputMetadata(record: GeneratedOutputMetadata): GeneratedOutputMetadata {
  return {
    ...record,
    generatedSessionTokenCountMetadata: record.generatedSessionTokenCountMetadata
      ? { ...record.generatedSessionTokenCountMetadata }
      : undefined,
    generatedSessionCountPolicy: record.generatedSessionCountPolicy
      ? { ...record.generatedSessionCountPolicy }
      : undefined,
    issues: record.issues?.map((issue) => createStewardIssue(issue)),
  };
}
