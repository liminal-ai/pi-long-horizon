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
}

export function cloneGeneratedOutputMetadata(record: GeneratedOutputMetadata): GeneratedOutputMetadata {
  return {
    ...record,
  };
}
