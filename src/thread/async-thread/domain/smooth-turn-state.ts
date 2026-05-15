import { createHash } from "node:crypto";

import type { TurnSmoothComponentRecord, TurnSmoothRecord } from "../../domain/records.js";
import type { TokenCountRecord } from "../../../token-accounting/token-count-metadata.js";

export const SMOOTH_TURN_SCHEMA_VERSION = "component_smooth_turn_v1" as const;
export const SMOOTH_TURN_STATUSES = ["ready", "missing", "pending", "degraded", "stale", "invalid"] as const;
export const SMOOTH_TURN_STRATEGIES = [
  "component_smooth_turn_v1",
] as const;

export type SmoothTurnStatus = (typeof SMOOTH_TURN_STATUSES)[number];
export type SmoothTurnStrategy = (typeof SMOOTH_TURN_STRATEGIES)[number];

export interface SmoothTurnState {
  turnId: string;
  threadId: string;
  schemaVersion?: typeof SMOOTH_TURN_SCHEMA_VERSION;
  status: SmoothTurnStatus;
  text?: string;
  tokenCountMetadata?: TokenCountRecord;
  strategy?: SmoothTurnStrategy;
  generatedAt?: string;
  sourceRevision?: number;
  components?: SmoothTurnComponentState[];
  materialized?: SmoothTurnMaterializedState;
}

export type SmoothTurnComponentState = TurnSmoothComponentRecord;

export interface SmoothTurnMaterializedState {
  sourceFingerprint?: string;
  tokenCountMetadata?: TokenCountRecord;
}

export interface MaterializeSmoothTurnResult {
  turnId: string;
  status: "ready" | "degraded" | "missing" | "pending" | "stale" | "invalid";
  text?: string;
  tokenCountMetadata?: TokenCountRecord;
  tokenCount?: number;
  sourceFingerprint?: string;
  missingComponentIds?: string[];
}

export interface EnsureSmoothTurnInput {
  threadId: string;
  turnId: string;
}

export interface ReadSmoothTurnStateInput {
  threadId: string;
  turnId: string;
}

export interface EnsureSmoothTurnResult {
  turnId: string;
  smoothStatus: SmoothTurnStatus;
  smoothTokenCount?: number;
}

export interface ReadSmoothTurnStateResult extends EnsureSmoothTurnResult {
  smoothText?: string;
  smoothStrategy?: SmoothTurnStrategy;
  generatedAt?: string;
  sourceRevision?: number;
  schemaVersion?: typeof SMOOTH_TURN_SCHEMA_VERSION;
  components?: SmoothTurnComponentState[];
  materialized?: SmoothTurnMaterializedState;
}

export function normalizeDeterministicText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function estimateDeterministicTokenCount(text: string): number {
  const normalized = normalizeDeterministicText(text);
  return normalized.length === 0 ? 0 : normalized.split(" ").length;
}

export function cloneSmoothTurnState(record: SmoothTurnState): SmoothTurnState {
  return {
    ...record,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
    components: record.components?.map((component) => ({
      ...component,
      sourceMessageIds: [...component.sourceMessageIds],
      sourcePartIds: component.sourcePartIds ? [...component.sourcePartIds] : undefined,
      providerMetadata: component.providerMetadata
        ? {
            ...component.providerMetadata,
            usage: component.providerMetadata.usage ? { ...component.providerMetadata.usage } : undefined,
          }
        : undefined,
    })),
    materialized: record.materialized
      ? {
          sourceFingerprint: record.materialized.sourceFingerprint,
          tokenCountMetadata: record.materialized.tokenCountMetadata
            ? { ...record.materialized.tokenCountMetadata }
            : undefined,
        }
      : undefined,
  };
}

export function toTurnSmoothRecord(record: SmoothTurnState): TurnSmoothRecord {
  return {
    schemaVersion: record.schemaVersion,
    status: record.status,
    text: record.text,
    tokenCountMetadata: record.tokenCountMetadata ? { ...record.tokenCountMetadata } : undefined,
    strategy: record.strategy,
    generatedAt: record.generatedAt,
    sourceRevision: record.sourceRevision,
    components: record.components?.map((component) => ({
      ...component,
      sourceMessageIds: [...component.sourceMessageIds],
      sourcePartIds: component.sourcePartIds ? [...component.sourcePartIds] : undefined,
      providerMetadata: component.providerMetadata
        ? {
            ...component.providerMetadata,
            usage: component.providerMetadata.usage ? { ...component.providerMetadata.usage } : undefined,
          }
        : undefined,
    })),
    materialized: record.materialized
      ? {
          sourceFingerprint: record.materialized.sourceFingerprint,
          tokenCountMetadata: record.materialized.tokenCountMetadata
            ? { ...record.materialized.tokenCountMetadata }
            : undefined,
        }
      : undefined,
  };
}

export function createSmoothComponentSourceFingerprint(
  components: readonly SmoothTurnComponentState[],
): string {
  const representation = components.map((component) => ({
    componentId: component.componentId,
    sourceRevision: component.sourceRevision,
    strategy: component.strategy,
    text: component.text ?? "",
  }));
  const digest = createHash("sha256").update(JSON.stringify(representation)).digest("hex");

  return `sha256:${digest}`;
}

export function assembleSmoothTurnTextFromComponents(
  components: readonly SmoothTurnComponentState[] | undefined,
): string | undefined {
  if (!components) {
    return undefined;
  }

  const sections: Array<{ marker: string; content: string }> = [];
  for (const component of components) {
    if (component.status === "omitted") {
      continue;
    }
    if ((component.status !== "ready" && component.status !== "degraded") || !component.text) {
      continue;
    }

    const marker =
      component.kind === "user_prompt"
        ? "user"
        : component.kind === "assistant_message"
          ? component.actorLabel
            ? `assistant:${component.actorLabel}`
            : "assistant"
          : component.kind === "tool_exchange"
            ? "tool"
            : "thinking";
    const previous = sections[sections.length - 1];
    if (previous?.marker === marker) {
      previous.content = `${previous.content}${component.kind === "tool_exchange" ? "\n---\n" : "\n"}${component.text}`;
      continue;
    }

    sections.push({ marker, content: component.text });
  }

  return sections.map((section) => `[${section.marker}]\n${section.content}`).join("\n\n");
}
