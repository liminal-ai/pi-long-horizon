import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { PiThreadViewEntry, PiThreadViewFile } from "../../domain/pi-thread-view-file.js";
import { PromptVisibleToolResultProjection } from "../../services/prompt-visible-tool-result-projection.js";
import {
  truncateLiveToolResultText,
  type LiveToolResultTruncationOptions,
} from "../../services/live-tool-result-truncation.js";
import { serializePiThreadViewFileContent } from "./pi-thread-view-writer.js";

export interface PromptTruncatedPiThreadViewFileResult {
  file: PiThreadViewFile;
  truncatedToolCallIds: string[];
}

function sessionMessagesFromPiFile(file: PiThreadViewFile): AgentMessage[] {
  return serializePiThreadViewFileContent(
    {
      threadId: file.threadId,
      threadViewId: file.threadViewId,
      file,
    },
    file.generatedAt,
  )
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type?: unknown; message?: unknown })
    .filter((entry): entry is { type: "message"; message: AgentMessage } => entry.type === "message")
    .map((entry) => entry.message);
}

function truncateVisiblePartContent(content: unknown, charLimit: number): { content: unknown; changed: boolean } {
  if (typeof content === "string") {
    const truncated = truncateLiveToolResultText(content, charLimit);
    return { content: truncated, changed: truncated !== content };
  }

  if (typeof content !== "object" || content === null) {
    return { content, changed: false };
  }

  const nextContent = { ...(content as Record<string, unknown>) };
  let changed = false;

  for (const key of ["output", "text"]) {
    const value = nextContent[key];
    if (typeof value !== "string") {
      continue;
    }

    const truncated = truncateLiveToolResultText(value, charLimit);
    if (truncated !== value) {
      nextContent[key] = truncated;
      changed = true;
    }
  }

  return changed ? { content: nextContent, changed } : { content, changed: false };
}

function truncateEntryContent(
  content: PiThreadViewEntry["content"],
  charLimit: number,
): { content: PiThreadViewEntry["content"]; changed: boolean } {
  if (typeof content === "string") {
    const truncated = truncateLiveToolResultText(content, charLimit);
    return { content: truncated, changed: truncated !== content };
  }

  const parts = Array.isArray(content.parts) ? content.parts : undefined;
  if (!parts) {
    return { content, changed: false };
  }

  let changed = false;
  const nextParts = parts.map((part) => {
    if (typeof part !== "object" || part === null || !("content" in part)) {
      return part;
    }

    const truncated = truncateVisiblePartContent((part as { content?: unknown }).content, charLimit);
    if (!truncated.changed) {
      return part;
    }

    changed = true;
    return {
      ...part,
      content: truncated.content,
    };
  });

  return changed
    ? {
        content: {
          ...content,
          parts: nextParts,
        },
        changed,
      }
    : { content, changed: false };
}

export function applyPromptVisibleToolResultTruncationToPiThreadViewFile(
  file: PiThreadViewFile,
  options: LiveToolResultTruncationOptions = {},
): PromptTruncatedPiThreadViewFileResult {
  const projection = new PromptVisibleToolResultProjection(options);
  projection.hydrateFromMessages(sessionMessagesFromPiFile(file));
  const decisions = projection.getDecisions();
  if (decisions.length === 0) {
    return {
      file,
      truncatedToolCallIds: [],
    };
  }

  const charLimitByToolCallId = new Map(decisions.map((decision) => [
    decision.toolCallId,
    decision.truncatedCharLimit,
  ]));
  const truncatedToolCallIds: string[] = [];
  const entries = file.entries.map((entry) => {
    if (entry.generatedSource !== "raw_turn_message" || entry.role !== "toolResult") {
      return entry;
    }

    const toolCallId = typeof entry.metadata?.toolCallId === "string" ? entry.metadata.toolCallId : undefined;
    const charLimit = toolCallId ? charLimitByToolCallId.get(toolCallId) : undefined;
    if (!toolCallId || charLimit === undefined) {
      return entry;
    }

    const truncated = truncateEntryContent(entry.content, charLimit);
    if (!truncated.changed) {
      return entry;
    }

    truncatedToolCallIds.push(toolCallId);
    return {
      ...entry,
      content: truncated.content,
    };
  });

  return {
    file: truncatedToolCallIds.length > 0
      ? {
          ...file,
          entries,
          entryCount: entries.length,
        }
      : file,
    truncatedToolCallIds,
  };
}
