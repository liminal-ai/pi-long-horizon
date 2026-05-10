import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { SourceRange } from "./records.js";

export interface ThreadTargetRef {
  runtime: "pi";
  sessionId?: string;
  sessionFilePath?: string;
}

export type TargetSessionKey = string;

export interface TargetSessionKeySet {
  canonicalKey: TargetSessionKey;
  aliasKeys: TargetSessionKey[];
}

export interface DeriveTargetSessionKeysOptions {
  normalizeSessionFilePath?: (sessionFilePath: string) => string;
}

function normalizeForStableValue(value: unknown): unknown {
  if (value === undefined) {
    return "__undefined__";
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `__number__:${String(value)}`;
  }

  if (typeof value === "bigint") {
    return `__bigint__:${value.toString()}`;
  }

  if (value instanceof Date) {
    return `__date__:${value.toISOString()}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableValue(item));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [entryKey, normalizeForStableValue(entryValue)]),
    );
  }

  return `__${typeof value}__:${String(value)}`;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableValue(value));
}

function createDigest(namespace: string, value: unknown): string {
  return createHash("sha256").update(namespace).update(":").update(stableSerialize(value)).digest("hex");
}

function normalizeSessionFilePath(sessionFilePath: string): string {
  return realpathSync(resolve(sessionFilePath));
}

function toKeySegment(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function createStableId(prefix: string, value: unknown): string {
  return `${prefix}_${createDigest(prefix, value).slice(0, 20)}`;
}

export function createGeneratedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function createThreadId(): string {
  return createGeneratedId("thread");
}

export function createActorId(): string {
  return createGeneratedId("actor");
}

export function createMessageId(): string {
  return createGeneratedId("message");
}

export function createPartId(): string {
  return createGeneratedId("part");
}

export function createTurnId(): string {
  return createGeneratedId("turn");
}

export function createImportId(): string {
  return createGeneratedId("import");
}

export function createProjectionRevisionId(): string {
  return createGeneratedId("projection");
}

export function createFixtureId(): string {
  return createGeneratedId("fixture");
}

export function createContentFingerprint(value: unknown): string {
  return createDigest("content", value);
}

export function createSourceRange(fromSourceOrder: number, toSourceOrder = fromSourceOrder): SourceRange {
  if (!Number.isSafeInteger(fromSourceOrder) || !Number.isSafeInteger(toSourceOrder)) {
    throw new RangeError("Source ranges require safe integer boundaries.");
  }

  if (fromSourceOrder < 1 || toSourceOrder < 1) {
    throw new RangeError("Source ranges require positive source orders.");
  }

  return {
    fromSourceOrder: Math.min(fromSourceOrder, toSourceOrder),
    toSourceOrder: Math.max(fromSourceOrder, toSourceOrder),
  };
}

export function compareSourceRanges(left: SourceRange, right: SourceRange): number {
  if (left.fromSourceOrder !== right.fromSourceOrder) {
    return left.fromSourceOrder - right.fromSourceOrder;
  }

  return left.toSourceOrder - right.toSourceOrder;
}

export function sortSourceRanges(ranges: readonly SourceRange[]): SourceRange[] {
  return [...ranges].sort(compareSourceRanges);
}

export function mergeSourceRanges(ranges: readonly SourceRange[]): SourceRange | undefined {
  if (ranges.length === 0) {
    return undefined;
  }

  const sorted = sortSourceRanges(ranges);

  return {
    fromSourceOrder: sorted[0].fromSourceOrder,
    toSourceOrder: sorted[sorted.length - 1].toSourceOrder,
  };
}

export function sourceRangeContains(range: SourceRange, sourceOrder: number): boolean {
  return range.fromSourceOrder <= sourceOrder && sourceOrder <= range.toSourceOrder;
}

export function deriveTargetSessionKeys(
  target: ThreadTargetRef,
  options: DeriveTargetSessionKeysOptions = {},
): TargetSessionKeySet {
  const normalizePath = options.normalizeSessionFilePath ?? normalizeSessionFilePath;
  const canonicalSessionId = toKeySegment(target.sessionId);
  const canonicalSessionFilePath = toKeySegment(target.sessionFilePath);

  if (!canonicalSessionId && !canonicalSessionFilePath) {
    throw new Error("A target session key requires a sessionId or sessionFilePath.");
  }

  const fileKey = canonicalSessionFilePath
    ? `${target.runtime}:session-file:${normalizePath(canonicalSessionFilePath)}`
    : undefined;

  if (canonicalSessionId) {
    const canonicalKey = `${target.runtime}:session-id:${canonicalSessionId}`;

    return {
      canonicalKey,
      aliasKeys: fileKey ? [fileKey] : [],
    };
  }

  return {
    canonicalKey: fileKey!,
    aliasKeys: [],
  };
}
