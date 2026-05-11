export interface ChunkCloseSettings {
  targetMinSmoothTokens: number;
  targetSoftMaxSmoothTokens: number;
  hardMaxSmoothTokens: number;
}

export interface PlaceholderBuildSettings {
  detailedRatio: number;
  briefRatio: number;
  detailedStrategy: "deterministic_truncate_30";
  briefStrategy: "deterministic_truncate_5";
}

export const DEFAULT_CHUNK_CLOSE_SETTINGS: ChunkCloseSettings = {
  targetMinSmoothTokens: 1_200,
  targetSoftMaxSmoothTokens: 1_800,
  hardMaxSmoothTokens: 2_200,
};

export const DEFAULT_PLACEHOLDER_BUILD_SETTINGS: PlaceholderBuildSettings = {
  detailedRatio: 0.3,
  briefRatio: 0.05,
  detailedStrategy: "deterministic_truncate_30",
  briefStrategy: "deterministic_truncate_5",
};

export function cloneChunkCloseSettings(settings: ChunkCloseSettings): ChunkCloseSettings {
  return {
    ...settings,
  };
}

export function validateChunkCloseSettings(settings: ChunkCloseSettings): string[] {
  const issues: string[] = [];

  if (!Number.isFinite(settings.targetMinSmoothTokens) || settings.targetMinSmoothTokens <= 0) {
    issues.push("targetMinSmoothTokens must be greater than 0.");
  }

  if (!Number.isFinite(settings.targetSoftMaxSmoothTokens) || settings.targetSoftMaxSmoothTokens <= 0) {
    issues.push("targetSoftMaxSmoothTokens must be greater than 0.");
  }

  if (!Number.isFinite(settings.hardMaxSmoothTokens) || settings.hardMaxSmoothTokens <= 0) {
    issues.push("hardMaxSmoothTokens must be greater than 0.");
  }

  if (settings.targetSoftMaxSmoothTokens < settings.targetMinSmoothTokens) {
    issues.push("targetSoftMaxSmoothTokens must be greater than or equal to targetMinSmoothTokens.");
  }

  if (settings.hardMaxSmoothTokens < settings.targetSoftMaxSmoothTokens) {
    issues.push("hardMaxSmoothTokens must be greater than or equal to targetSoftMaxSmoothTokens.");
  }

  return issues;
}

export function clonePlaceholderBuildSettings(
  settings: PlaceholderBuildSettings,
): PlaceholderBuildSettings {
  return {
    ...settings,
  };
}
