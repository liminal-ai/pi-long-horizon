export const DEFAULT_LIVE_TOOL_RESULT_RAW_ZONE_TOKEN_THRESHOLD = 32_000;
export const DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT = 500;
export const LIVE_TOOL_RESULT_TRUNCATION_SUFFIX = "...";

export interface LiveToolResultTruncationOptions {
  rawZoneTokenThreshold?: number;
  truncatedCharLimit?: number;
}

export interface LiveToolResultTruncationAdapter<T> {
  isRawZoneBoundary(item: T): boolean;
  estimateText(item: T): string;
  isEligibleToolResult(item: T): boolean;
  truncateToolResult(item: T, truncateText: (text: string) => string): T;
}

export interface LiveToolResultTruncationResult<T> {
  items: T[];
  truncatedCount: number;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.ceil(value);
}

export function estimateLiveRawZoneTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function stringifyPiVisibleContentForLiveEstimate(content: unknown, fallback?: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content ?? fallback);
}

function rawPartContentToPiVisibleContent(part: { partType?: unknown; content?: unknown }): unknown {
  const partContent = part.content;

  if (part.partType === "tool_result" && typeof partContent === "object" && partContent !== null) {
    const output = (partContent as { output?: unknown }).output;
    if (typeof output === "string") {
      return {
        type: "text",
        text: output,
      };
    }
  }

  if (typeof partContent === "string") {
    return {
      type: "text",
      text: partContent,
    };
  }

  if (typeof partContent === "object" && partContent !== null) {
    const text = (partContent as { text?: unknown }).text;
    if (typeof text === "string") {
      return {
        type: "text",
        text,
      };
    }

    if (part.partType === "image_ref") {
      return {
        type: "image",
        data: (partContent as { data?: unknown }).data,
        mimeType: (partContent as { mimeType?: unknown }).mimeType,
      };
    }
  }

  return {
    type: "text",
    text: JSON.stringify(partContent),
  };
}

export function stringifyCanonicalRawMessageForPiVisibleEstimate(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content !== "object" || content === null) {
    return JSON.stringify(content);
  }

  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return stringifyPiVisibleContentForLiveEstimate(content);
  }

  return stringifyPiVisibleContentForLiveEstimate(parts.map(rawPartContentToPiVisibleContent), content);
}

export function truncateLiveToolResultText(
  text: string,
  charLimit = DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT,
): string {
  const limit = normalizePositiveInteger(charLimit, DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT);
  if (text.length <= limit + LIVE_TOOL_RESULT_TRUNCATION_SUFFIX.length) {
    return text;
  }

  return `${text.slice(0, limit)}${LIVE_TOOL_RESULT_TRUNCATION_SUFFIX}`;
}

export function applyLiveToolResultTruncation<T>(
  items: readonly T[],
  adapter: LiveToolResultTruncationAdapter<T>,
  options: LiveToolResultTruncationOptions = {},
): LiveToolResultTruncationResult<T> {
  const threshold = normalizePositiveInteger(
    options.rawZoneTokenThreshold,
    DEFAULT_LIVE_TOOL_RESULT_RAW_ZONE_TOKEN_THRESHOLD,
  );
  const charLimit = normalizePositiveInteger(
    options.truncatedCharLimit,
    DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT,
  );
  const nextItems = [...items];
  let rawZoneTokens = 0;
  let truncatedCount = 0;

  for (let index = nextItems.length - 1; index >= 0; index -= 1) {
    const item = nextItems[index]!;
    if (adapter.isRawZoneBoundary(item)) {
      break;
    }

    rawZoneTokens += estimateLiveRawZoneTokenCount(adapter.estimateText(item));
    if (rawZoneTokens <= threshold || !adapter.isEligibleToolResult(item)) {
      continue;
    }

    const nextItem = adapter.truncateToolResult(item, (text) => truncateLiveToolResultText(text, charLimit));
    if (nextItem !== item) {
      nextItems[index] = nextItem;
      truncatedCount += 1;
    }
  }

  return {
    items: truncatedCount > 0 ? nextItems : [...items],
    truncatedCount,
  };
}
