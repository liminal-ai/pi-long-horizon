import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  DEFAULT_LIVE_TOOL_RESULT_RAW_ZONE_TOKEN_THRESHOLD,
  DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT,
  estimateLiveRawZoneTokenCount,
  stringifyPiVisibleContentForLiveEstimate,
  truncateLiveToolResultText,
  type LiveToolResultTruncationOptions,
} from "./live-tool-result-truncation.js";

export interface PromptVisibleToolResultDecision {
  toolCallId: string;
  truncatedCharLimit: number;
  rawZoneTokenThreshold: number;
}

export interface PromptVisibleProjectionUpdate {
  newlyTruncatedToolCallIds: string[];
}

export interface PromptVisibleToolResultProjectionStatus {
  rawZoneTokenThreshold: number;
  truncatedCharLimit: number;
  hydrated: boolean;
  observedCount: number;
  protectedMessageCount: number;
  protectedTokenTotal: number;
  decisionCount: number;
  dirtyCount: number;
}

interface ProtectedPromptMessage {
  tokenEstimate: number;
  message: AgentMessage;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.ceil(value);
}

function isPiTextContent(content: unknown): content is { type: "text"; text: string } {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { type?: unknown }).type === "text" &&
    typeof (content as { text?: unknown }).text === "string"
  );
}

function isPiToolResultMessage(message: AgentMessage): message is AgentMessage & {
  role: "toolResult";
  toolCallId?: string;
  content: unknown[];
} {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "toolResult" &&
    Array.isArray((message as { content?: unknown }).content)
  );
}

function isPiCompactedBoundaryMessage(message: AgentMessage): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "custom" &&
    (message as { customType?: unknown }).customType === "pi-long-horizon.compacted-content"
  );
}

function stringifyPiMessageForLiveEstimate(message: AgentMessage): string {
  if (typeof message !== "object" || message === null) {
    return String(message);
  }

  return stringifyPiVisibleContentForLiveEstimate((message as { content?: unknown }).content, message);
}

function truncatePiToolResultMessage(
  message: AgentMessage,
  charLimit: number,
): AgentMessage {
  if (!isPiToolResultMessage(message)) {
    return message;
  }

  let changed = false;
  const content = message.content.map((part) => {
    if (!isPiTextContent(part)) {
      return part;
    }

    const text = truncateLiveToolResultText(part.text, charLimit);
    if (text === part.text) {
      return part;
    }

    changed = true;
    return {
      ...part,
      text,
    };
  });

  return changed
    ? ({
        ...message,
        content,
      } as AgentMessage)
    : message;
}

export class PromptVisibleToolResultProjection {
  private readonly rawZoneTokenThreshold: number;
  private readonly truncatedCharLimit: number;
  private decisions = new Map<string, PromptVisibleToolResultDecision>();
  private protectedMessages: ProtectedPromptMessage[] = [];
  private protectedMessageHead = 0;
  private protectedTokenTotal = 0;
  private observedCount = 0;
  private hydrated = false;
  private dirtyToolCallIds = new Set<string>();

  constructor(options: LiveToolResultTruncationOptions = {}) {
    this.rawZoneTokenThreshold = normalizePositiveInteger(
      options.rawZoneTokenThreshold,
      DEFAULT_LIVE_TOOL_RESULT_RAW_ZONE_TOKEN_THRESHOLD,
    );
    this.truncatedCharLimit = normalizePositiveInteger(
      options.truncatedCharLimit,
      DEFAULT_LIVE_TOOL_RESULT_TRUNCATED_CHAR_LIMIT,
    );
  }

  reset(): void {
    this.decisions.clear();
    this.protectedMessages = [];
    this.protectedMessageHead = 0;
    this.protectedTokenTotal = 0;
    this.observedCount = 0;
    this.hydrated = false;
    this.dirtyToolCallIds.clear();
  }

  hydrateFromMessages(messages: readonly AgentMessage[]): PromptVisibleProjectionUpdate {
    // Hydration derives policy state from PI-visible history. If the active file
    // already contains truncated tool results, their smaller visible size is the
    // correct frontier input because that is what subsequent model calls see.
    this.reset();
    this.hydrated = true;
    const newlyTruncatedToolCallIds: string[] = [];

    for (const message of messages) {
      const update = this.observeMessage(message);
      newlyTruncatedToolCallIds.push(...update.newlyTruncatedToolCallIds);
    }

    return { newlyTruncatedToolCallIds };
  }

  ensureHydrated(messages: readonly AgentMessage[]): void {
    if (!this.hydrated) {
      this.hydrateFromMessages(messages);
    }
  }

  observeMessage(message: AgentMessage): PromptVisibleProjectionUpdate {
    this.observedCount += 1;

    if (isPiCompactedBoundaryMessage(message)) {
      this.protectedMessages = [];
      this.protectedMessageHead = 0;
      this.protectedTokenTotal = 0;
      return { newlyTruncatedToolCallIds: [] };
    }

    const tokenEstimate = estimateLiveRawZoneTokenCount(stringifyPiMessageForLiveEstimate(message));
    this.protectedMessages.push({
      tokenEstimate,
      message,
    });
    this.protectedTokenTotal += tokenEstimate;

    const newlyTruncatedToolCallIds: string[] = [];
    while (this.protectedTokenTotal > this.rawZoneTokenThreshold && this.protectedMessageHead < this.protectedMessages.length) {
      const crossed = this.protectedMessages[this.protectedMessageHead]!;
      this.protectedMessageHead += 1;
      this.protectedTokenTotal -= crossed.tokenEstimate;

      if (!isPiToolResultMessage(crossed.message) || !crossed.message.toolCallId) {
        continue;
      }

      if (this.decisions.has(crossed.message.toolCallId)) {
        continue;
      }

      this.decisions.set(crossed.message.toolCallId, {
        toolCallId: crossed.message.toolCallId,
        truncatedCharLimit: this.truncatedCharLimit,
        rawZoneTokenThreshold: this.rawZoneTokenThreshold,
      });
      this.dirtyToolCallIds.add(crossed.message.toolCallId);
      newlyTruncatedToolCallIds.push(crossed.message.toolCallId);
    }

    if (this.protectedMessageHead > 256 && this.protectedMessageHead * 2 > this.protectedMessages.length) {
      this.protectedMessages = this.protectedMessages.slice(this.protectedMessageHead);
      this.protectedMessageHead = 0;
    }

    return { newlyTruncatedToolCallIds };
  }

  applyToMessages(messages: readonly AgentMessage[]): AgentMessage[] {
    this.ensureHydrated(messages);
    if (this.decisions.size === 0) {
      return [...messages];
    }

    const lastBoundaryIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (isPiCompactedBoundaryMessage(messages[index]!)) {
          return index;
        }
      }
      return -1;
    })();

    let changed = false;
    const nextMessages = messages.map((message, index) => {
      if (index <= lastBoundaryIndex || !isPiToolResultMessage(message) || !message.toolCallId) {
        return message;
      }

      const decision = this.decisions.get(message.toolCallId);
      if (!decision) {
        return message;
      }

      const truncated = truncatePiToolResultMessage(message, decision.truncatedCharLimit);
      if (truncated !== message) {
        changed = true;
      }
      return truncated;
    });

    return changed ? nextMessages : [...messages];
  }

  getDirtyToolCallIds(): string[] {
    return [...this.dirtyToolCallIds];
  }

  markClean(toolCallIds?: readonly string[]): void {
    if (toolCallIds === undefined) {
      this.dirtyToolCallIds.clear();
      return;
    }

    for (const toolCallId of toolCallIds) {
      this.dirtyToolCallIds.delete(toolCallId);
    }
  }

  getDecision(toolCallId: string): PromptVisibleToolResultDecision | undefined {
    return this.decisions.get(toolCallId);
  }

  getDecisions(): PromptVisibleToolResultDecision[] {
    return [...this.decisions.values()];
  }

  getStatus(): PromptVisibleToolResultProjectionStatus {
    return {
      rawZoneTokenThreshold: this.rawZoneTokenThreshold,
      truncatedCharLimit: this.truncatedCharLimit,
      hydrated: this.hydrated,
      observedCount: this.observedCount,
      protectedMessageCount: this.protectedMessages.length - this.protectedMessageHead,
      protectedTokenTotal: this.protectedTokenTotal,
      decisionCount: this.decisions.size,
      dirtyCount: this.dirtyToolCallIds.size,
    };
  }
}
