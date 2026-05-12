import type { MessageRecord, PartRecord } from "../../domain/records.js";
import {
  normalizeDeterministicText,
  type SmoothTurnStrategy,
} from "../domain/smooth-turn-state.js";
import { estimateCompactedTextTokenCount } from "../../../thread-view/services/pi-token-estimator.js";

type SmoothSectionMarker = "user" | "assistant" | "tool" | "thinking";

interface SmoothSection {
  marker: SmoothSectionMarker;
  content: string;
}

export interface DeterministicSmoothFormatOptions {
  toolOutputCharLimit: number;
}

export interface DeterministicSmoothFormatResult {
  text: string;
  tokenCount: number;
  strategy: SmoothTurnStrategy;
}

const DEFAULT_FORMAT_OPTIONS: DeterministicSmoothFormatOptions = {
  toolOutputCharLimit: 240,
};

function stableSerialize(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }

  return value;
}

function classifyMarker(message: MessageRecord, part: PartRecord): SmoothSectionMarker {
  if (part.partType === "reasoning") {
    return "thinking";
  }

  if (part.partType === "tool_result" || message.messageKind === "tool_result" || message.actorType === "tool") {
    return "tool";
  }

  if (message.actorType === "human" || message.messageKind === "prompt") {
    return "user";
  }

  return "assistant";
}

function normalizeSectionContent(content: string): string {
  return normalizeDeterministicText(content);
}

function applyToolPolicy(
  content: string,
  options: DeterministicSmoothFormatOptions,
): string {
  if (content.length === 0) {
    return "";
  }

  if (content.length > options.toolOutputCharLimit) {
    return `${content.slice(0, options.toolOutputCharLimit)}...`;
  }

  return content;
}

function buildSections(
  messages: readonly MessageRecord[],
  options: DeterministicSmoothFormatOptions,
): SmoothSection[] {
  const sections: SmoothSection[] = [];

  for (const message of messages) {
    const sortedParts = [...message.parts].sort((left, right) => left.partOrder - right.partOrder);
    for (const part of sortedParts) {
      let content = normalizeSectionContent(stableSerialize(part.content));
      if (content.length === 0) {
        continue;
      }

      const marker = classifyMarker(message, part);
      if (marker === "tool") {
        content = applyToolPolicy(content, options);
        if (content.length === 0) {
          continue;
        }
      }

      const previous = sections[sections.length - 1];
      if (previous && previous.marker === marker) {
        const separator = marker === "tool" ? "\n---\n" : "\n";
        previous.content = `${previous.content}${separator}${content}`;
        continue;
      }

      sections.push({ marker, content });
    }
  }

  return sections;
}

export function buildSmoothTurnText(
  messages: readonly MessageRecord[],
  options: Partial<DeterministicSmoothFormatOptions> = {},
): DeterministicSmoothFormatResult {
  const resolvedOptions: DeterministicSmoothFormatOptions = {
    ...DEFAULT_FORMAT_OPTIONS,
    ...options,
  };
  const sections = buildSections(messages, resolvedOptions);

  const text = sections.map((section) => `[${section.marker}]\n${section.content}`).join("\n\n");

  return {
    text,
    tokenCount: estimateCompactedTextTokenCount(text),
    strategy: "deterministic_marker_sections_v1",
  };
}
