import type { MessageRecord, TurnRecord } from "../../thread/domain/records.js";
import type { ThreadStore } from "../../thread/store/thread-store.js";
import {
  cloneSearchResultSummary,
  type SearchResultSummary,
  type ThreadViewRecord,
  type WorkbenchSearchInput,
} from "../../thread-view/domain/thread-view-records.js";
import {
  createWorkbenchIssue,
  failWorkbenchResult,
  okWorkbenchResult,
  type WorkbenchResult,
} from "../domain/workbench-errors.js";
import type { ThreadViewStore } from "../../thread-view/store/thread-view-store.js";

const MESSAGE_FILTER_KEYS = new Set([
  "messageKind",
  "actorType",
  "sourceOrderFrom",
  "sourceOrderTo",
  "fromSourceOrder",
  "toSourceOrder",
]);
const TURN_FILTER_KEYS = new Set([
  "lifecycleStatus",
  "turnOrderFrom",
  "turnOrderTo",
  "fromTurnOrder",
  "toTurnOrder",
]);
const THREAD_VIEW_FILTER_KEYS = new Set(["state", "name", "purpose"]);

interface MessageFilters {
  messageKind?: string;
  actorType?: string;
  sourceOrderFrom?: number;
  sourceOrderTo?: number;
}

interface TurnFilters {
  lifecycleStatus?: string;
  turnOrderFrom?: number;
  turnOrderTo?: number;
}

interface ThreadViewFilters {
  state?: string;
  name?: string;
  purpose?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateSummary(value: string, limit = 120): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return normalized.length > 0 ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextFragments(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectTextFragments(entry));
  }

  return [];
}

function getMessageTextFragments(message: MessageRecord): string[] {
  return message.parts.flatMap((part) => collectTextFragments(part.content));
}

function getMessageSearchText(message: MessageRecord): string {
  return getMessageTextFragments(message).join(" ");
}

function getTurnSearchText(turn: TurnRecord, messageById: ReadonlyMap<string, MessageRecord>): string {
  return turn.messageIds
    .map((messageId) => messageById.get(messageId))
    .flatMap((message) => (message ? getMessageTextFragments(message) : []))
    .join(" ");
}

function getThreadViewSearchText(view: ThreadViewRecord): string {
  return [
    view.name,
    view.purpose,
    ...view.emittedMessages.flatMap((message) => collectTextFragments(message.content)),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeWhitespace(value))
    .join(" ");
}

function summarizeLeadingText(fragments: readonly string[], fallback: string): string {
  return truncateSummary(fragments[0] ?? fallback);
}

function computeTextScore(query: string | undefined, haystacks: readonly string[]): number {
  if (!query) {
    return 0;
  }

  const loweredQuery = query.toLowerCase();
  let score = 0;

  for (const haystack of haystacks) {
    const loweredHaystack = haystack.toLowerCase();
    const firstMatchIndex = loweredHaystack.indexOf(loweredQuery);
    if (firstMatchIndex === -1) {
      continue;
    }

    score += 5;
    if (firstMatchIndex === 0) {
      score += 2;
    } else if (firstMatchIndex < 40) {
      score += 1;
    }
  }

  return score;
}

function parseNumberFilter(
  value: string | number | boolean,
  key: string,
  threadId: string,
): WorkbenchResult<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    return okWorkbenchResult(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return okWorkbenchResult(parsed);
    }
  }

  return failWorkbenchResult(
    createWorkbenchIssue({
      code: "WORKBENCH_INVALID_FILTER",
      message: `Filter ${key} must be numeric.`,
      threadId,
    }),
  );
}

function parseMessageFilters(input: WorkbenchSearchInput): WorkbenchResult<MessageFilters> {
  const filters = input.filters ?? {};

  for (const key of Object.keys(filters)) {
    if (!MESSAGE_FILTER_KEYS.has(key)) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_INVALID_FILTER",
          message: `Filter ${key} is not supported for message search.`,
          threadId: input.threadId,
        }),
      );
    }
  }

  const parsed: MessageFilters = {};
  if (typeof filters.messageKind === "string") {
    parsed.messageKind = filters.messageKind;
  }

  if (typeof filters.actorType === "string") {
    parsed.actorType = filters.actorType;
  }

  if (filters.sourceOrderFrom !== undefined || filters.fromSourceOrder !== undefined) {
    const numeric = parseNumberFilter(
      filters.sourceOrderFrom ?? filters.fromSourceOrder!,
      filters.sourceOrderFrom !== undefined ? "sourceOrderFrom" : "fromSourceOrder",
      input.threadId,
    );
    if (!numeric.ok) {
      return numeric;
    }

    parsed.sourceOrderFrom = numeric.value;
  }

  if (filters.sourceOrderTo !== undefined || filters.toSourceOrder !== undefined) {
    const numeric = parseNumberFilter(
      filters.sourceOrderTo ?? filters.toSourceOrder!,
      filters.sourceOrderTo !== undefined ? "sourceOrderTo" : "toSourceOrder",
      input.threadId,
    );
    if (!numeric.ok) {
      return numeric;
    }

    parsed.sourceOrderTo = numeric.value;
  }

  return okWorkbenchResult(parsed);
}

function parseTurnFilters(input: WorkbenchSearchInput): WorkbenchResult<TurnFilters> {
  const filters = input.filters ?? {};

  for (const key of Object.keys(filters)) {
    if (!TURN_FILTER_KEYS.has(key)) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_INVALID_FILTER",
          message: `Filter ${key} is not supported for turn search.`,
          threadId: input.threadId,
        }),
      );
    }
  }

  const parsed: TurnFilters = {};
  if (typeof filters.lifecycleStatus === "string") {
    parsed.lifecycleStatus = filters.lifecycleStatus;
  }

  if (filters.turnOrderFrom !== undefined || filters.fromTurnOrder !== undefined) {
    const numeric = parseNumberFilter(
      filters.turnOrderFrom ?? filters.fromTurnOrder!,
      filters.turnOrderFrom !== undefined ? "turnOrderFrom" : "fromTurnOrder",
      input.threadId,
    );
    if (!numeric.ok) {
      return numeric;
    }

    parsed.turnOrderFrom = numeric.value;
  }

  if (filters.turnOrderTo !== undefined || filters.toTurnOrder !== undefined) {
    const numeric = parseNumberFilter(
      filters.turnOrderTo ?? filters.toTurnOrder!,
      filters.turnOrderTo !== undefined ? "turnOrderTo" : "toTurnOrder",
      input.threadId,
    );
    if (!numeric.ok) {
      return numeric;
    }

    parsed.turnOrderTo = numeric.value;
  }

  return okWorkbenchResult(parsed);
}

function parseThreadViewFilters(input: WorkbenchSearchInput): WorkbenchResult<ThreadViewFilters> {
  const filters = input.filters ?? {};

  for (const key of Object.keys(filters)) {
    if (!THREAD_VIEW_FILTER_KEYS.has(key)) {
      return failWorkbenchResult(
        createWorkbenchIssue({
          code: "WORKBENCH_INVALID_FILTER",
          message: `Filter ${key} is not supported for Thread View search.`,
          threadId: input.threadId,
        }),
      );
    }
  }

  return okWorkbenchResult({
    state: typeof filters.state === "string" ? filters.state : undefined,
    name: typeof filters.name === "string" ? filters.name : undefined,
    purpose: typeof filters.purpose === "string" ? filters.purpose : undefined,
  });
}

function matchesMessageFilters(message: MessageRecord, filters: MessageFilters): boolean {
  return (
    (filters.messageKind === undefined || message.messageKind === filters.messageKind) &&
    (filters.actorType === undefined || message.actorType === filters.actorType) &&
    (filters.sourceOrderFrom === undefined || message.sourceOrder >= filters.sourceOrderFrom) &&
    (filters.sourceOrderTo === undefined || message.sourceOrder <= filters.sourceOrderTo)
  );
}

function matchesTurnFilters(turn: TurnRecord, filters: TurnFilters): boolean {
  return (
    (filters.lifecycleStatus === undefined || turn.lifecycleStatus === filters.lifecycleStatus) &&
    (filters.turnOrderFrom === undefined || turn.turnOrder >= filters.turnOrderFrom) &&
    (filters.turnOrderTo === undefined || turn.turnOrder <= filters.turnOrderTo)
  );
}

function includesCaseInsensitive(value: string | undefined, query: string | undefined): boolean {
  if (query === undefined) {
    return true;
  }

  if (!value) {
    return false;
  }

  return value.toLowerCase().includes(query.toLowerCase());
}

function matchesThreadViewFilters(view: ThreadViewRecord, filters: ThreadViewFilters): boolean {
  return (
    includesCaseInsensitive(view.state, filters.state) &&
    includesCaseInsensitive(view.name, filters.name) &&
    includesCaseInsensitive(view.purpose, filters.purpose)
  );
}

function findOwningTurn(turns: readonly TurnRecord[], messageId: string): TurnRecord | undefined {
  return turns.find((turn) => turn.messageIds.includes(messageId));
}

function buildTurnPlacementHints(turnId: string, threadViews: readonly ThreadViewRecord[]): string[] {
  return threadViews.flatMap((view) => {
    const placements = [
      { bandType: "full_fidelity", selectedIds: view.fullFidelityBand.selectedIds, sourceUnitType: view.fullFidelityBand.sourceUnitType },
      { bandType: "smooth", selectedIds: view.smoothBand.selectedIds, sourceUnitType: view.smoothBand.sourceUnitType },
      { bandType: "detailed", selectedIds: view.detailedBand.selectedIds, sourceUnitType: view.detailedBand.sourceUnitType },
      { bandType: "brief", selectedIds: view.briefBand.selectedIds, sourceUnitType: view.briefBand.sourceUnitType },
    ];

    return placements.flatMap((placement) =>
      placement.sourceUnitType === "turn" && placement.selectedIds.includes(turnId)
        ? [`${view.state} view ${view.name ?? view.threadViewId} • ${placement.bandType}`]
        : [],
    );
  });
}

export class WorkbenchSearchService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly threadViewStore: ThreadViewStore,
  ) {}

  async search(input: WorkbenchSearchInput): Promise<WorkbenchResult<SearchResultSummary[]>> {
    if (input.scope === "message") {
      return this.searchMessages(input);
    }

    if (input.scope === "turn") {
      return this.searchTurns(input);
    }

    if (input.scope === "thread_view") {
      return this.searchThreadViews(input);
    }

    return failWorkbenchResult(
      createWorkbenchIssue({
        code: "WORKBENCH_SEARCH_UNSUPPORTED_SCOPE",
        message: `Search scope ${String(input.scope)} is not supported.`,
        threadId: input.threadId,
      }),
    );
  }

  private async searchMessages(input: WorkbenchSearchInput): Promise<WorkbenchResult<SearchResultSummary[]>> {
    const parsedFilters = parseMessageFilters(input);
    if (!parsedFilters.ok) {
      return parsedFilters;
    }

    const [messagesResult, turnsResult] = await Promise.all([
      this.threadStore.readMessages(input.threadId),
      this.threadStore.readTurns(input.threadId),
    ]);
    if (!messagesResult.ok) {
      return failWorkbenchResult(...messagesResult.issues);
    }

    if (!turnsResult.ok) {
      return failWorkbenchResult(...turnsResult.issues);
    }

    const query = input.query ? normalizeWhitespace(input.query) : undefined;
    const summaries = messagesResult.value
      .map((message) => {
        const fragments = getMessageTextFragments(message);
        const searchText = getMessageSearchText(message);
        const owningTurn = findOwningTurn(turnsResult.value, message.messageId);
        const score = computeTextScore(query, [searchText, message.messageKind, message.actorType, message.messageId]);

        return {
          message,
          owningTurn,
          score,
          summary: {
            resultType: "message" as const,
            resultId: message.messageId,
            title: `Message ${message.sourceOrder} • ${message.messageKind}`,
            summaryText: summarizeLeadingText(
              fragments,
              `${message.parts.length} part${message.parts.length === 1 ? "" : "s"}`,
            ),
            status: message.messageKind,
            relationshipHints: [
              owningTurn ? `Turn ${owningTurn.turnOrder} (${owningTurn.turnId})` : "No owning turn",
              `Actor ${message.actorType}`,
              `Source #${message.sourceOrder}`,
            ],
          },
        };
      })
      .filter(({ message, score }) => {
        if (!matchesMessageFilters(message, parsedFilters.value)) {
          return false;
        }

        return query ? score > 0 : true;
      })
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return left.message.sourceOrder - right.message.sourceOrder;
      })
      .map(({ summary }) => cloneSearchResultSummary(summary));

    return okWorkbenchResult(summaries);
  }

  private async searchTurns(input: WorkbenchSearchInput): Promise<WorkbenchResult<SearchResultSummary[]>> {
    const parsedFilters = parseTurnFilters(input);
    if (!parsedFilters.ok) {
      return parsedFilters;
    }

    const [turnsResult, messagesResult, threadViewsResult] = await Promise.all([
      this.threadStore.readTurns(input.threadId),
      this.threadStore.readMessages(input.threadId),
      this.threadViewStore.listThreadViews(input.threadId),
    ]);
    if (!turnsResult.ok) {
      return failWorkbenchResult(...turnsResult.issues);
    }

    if (!messagesResult.ok) {
      return failWorkbenchResult(...messagesResult.issues);
    }

    if (!threadViewsResult.ok) {
      return failWorkbenchResult(...threadViewsResult.issues);
    }

    const messageById = new Map(messagesResult.value.map((message) => [message.messageId, message] as const));
    const query = input.query ? normalizeWhitespace(input.query) : undefined;
    const summaries = turnsResult.value
      .map((turn) => {
        const searchText = getTurnSearchText(turn, messageById);
        const leadingText = summarizeLeadingText(
          searchText.length > 0 ? [searchText] : [],
          `${turn.messageIds.length} message${turn.messageIds.length === 1 ? "" : "s"}`,
        );
        const score = computeTextScore(query, [searchText, turn.turnId, turn.lifecycleStatus]);

        return {
          turn,
          score,
          summary: {
            resultType: "turn" as const,
            resultId: turn.turnId,
            title: `Turn ${turn.turnOrder} • ${turn.lifecycleStatus}`,
            summaryText: `${turn.messageIds.length} message${turn.messageIds.length === 1 ? "" : "s"} • ${leadingText}`,
            status: turn.lifecycleStatus,
            relationshipHints: buildTurnPlacementHints(turn.turnId, threadViewsResult.value),
          },
        };
      })
      .filter(({ turn, score }) => {
        if (!matchesTurnFilters(turn, parsedFilters.value)) {
          return false;
        }

        return query ? score > 0 : true;
      })
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return left.turn.turnOrder - right.turn.turnOrder;
      })
      .map(({ summary }) => cloneSearchResultSummary(summary));

    return okWorkbenchResult(summaries, threadViewsResult.issues);
  }

  private async searchThreadViews(input: WorkbenchSearchInput): Promise<WorkbenchResult<SearchResultSummary[]>> {
    const parsedFilters = parseThreadViewFilters(input);
    if (!parsedFilters.ok) {
      return parsedFilters;
    }

    const threadViewsResult = await this.threadViewStore.listThreadViews(input.threadId);
    if (!threadViewsResult.ok) {
      return failWorkbenchResult(...threadViewsResult.issues);
    }

    const query = input.query ? normalizeWhitespace(input.query) : undefined;
    const summaries = threadViewsResult.value
      .map((view, index) => {
        const searchText = getThreadViewSearchText(view);
        const score = computeTextScore(query, [searchText, view.name ?? "", view.purpose ?? "", view.threadViewId]);
        const selectedUnitCount =
          view.fullFidelityBand.selectedIds.length +
          view.smoothBand.selectedIds.length +
          view.detailedBand.selectedIds.length +
          view.briefBand.selectedIds.length;

        return {
          view,
          index,
          score,
          summary: {
            resultType: "thread_view" as const,
            resultId: view.threadViewId,
            title: view.name ?? view.threadViewId,
            summaryText: summarizeLeadingText(
              [
                view.purpose ? `Purpose: ${normalizeWhitespace(view.purpose)}` : "",
                ...collectTextFragments(searchText),
              ],
              "No purpose provided.",
            ),
            status: view.state,
            relationshipHints: [
              `${selectedUnitCount} selected source units`,
              `${view.emittedMessages.length} emitted messages`,
            ],
          },
        };
      })
      .filter(({ view, score }) => {
        if (!matchesThreadViewFilters(view, parsedFilters.value)) {
          return false;
        }

        return query ? score > 0 : true;
      })
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return left.index - right.index;
      })
      .map(({ summary }) => cloneSearchResultSummary(summary));

    return okWorkbenchResult(summaries, threadViewsResult.issues);
  }
}
