import type {
  CurrentSessionSnapshotQuery,
  LatestQuoteQuery,
  PaperAuditQuery,
  PaperOrderFilter,
  PaperReportQuery,
  PaperTimelineQuery,
  SelectedSessionDetailQuery,
  SessionHistoryFilter,
  StrategySignalsQuery,
} from "../types";

const CURRENT_SESSION_SCOPE = "current";
const DEFAULT_SESSION_HISTORY_LIMIT = 20;
const DEFAULT_SESSION_HISTORY_OFFSET = 0;
const DEFAULT_ORDERS_LIMIT = 50;
const DEFAULT_ORDERS_OFFSET = 0;
const DEFAULT_AUDIT_LIMIT = 100;
const DEFAULT_AUDIT_OFFSET = 0;
const DEFAULT_CURRENT_ORDERS_LIMIT = 20;
const DEFAULT_CURRENT_ORDERS_OFFSET = 0;
const DEFAULT_SELECTED_AUDIT_LIMIT = 40;
const DEFAULT_SELECTED_AUDIT_OFFSET = 0;
const DEFAULT_MARKET_SCENARIO = "baseline";
const DEFAULT_STRATEGY_SCENARIO = "baseline";

function normalizeSessionScope(sessionId?: string | null): string {
  const value = sessionId?.trim();
  return value ? value : CURRENT_SESSION_SCOPE;
}

export function normalizeSessionHistoryFilter(filter: SessionHistoryFilter = {}) {
  return {
    limit: filter.limit ?? DEFAULT_SESSION_HISTORY_LIMIT,
    offset: filter.offset ?? DEFAULT_SESSION_HISTORY_OFFSET,
    q: filter.q?.trim() ?? "",
    status: filter.status ?? "",
  };
}

export function normalizePaperOrderFilter(filter: PaperOrderFilter = {}) {
  return {
    limit: filter.limit ?? DEFAULT_ORDERS_LIMIT,
    offset: filter.offset ?? DEFAULT_ORDERS_OFFSET,
    side: filter.side ?? "",
    symbol: filter.symbol?.trim() ?? "",
  };
}

export function normalizePaperAuditQuery(query: PaperAuditQuery = {}) {
  return {
    limit: query.limit ?? DEFAULT_AUDIT_LIMIT,
    offset: query.offset ?? DEFAULT_AUDIT_OFFSET,
    session_id: normalizeSessionScope(query.session_id),
  };
}

export function normalizePaperReportQuery(query: PaperReportQuery = {}) {
  return {
    session_id: normalizeSessionScope(query.session_id),
  };
}

export function normalizePaperTimelineQuery(query: PaperTimelineQuery = {}) {
  return {
    session_id: normalizeSessionScope(query.session_id),
  };
}

export function normalizeCurrentSessionSnapshotQuery(query: CurrentSessionSnapshotQuery = {}) {
  return {
    orders_limit: query.orders_limit ?? DEFAULT_CURRENT_ORDERS_LIMIT,
    orders_offset: query.orders_offset ?? DEFAULT_CURRENT_ORDERS_OFFSET,
  };
}

export function normalizeSelectedSessionDetailQuery(query: SelectedSessionDetailQuery = {}) {
  return {
    audit_limit: query.audit_limit ?? DEFAULT_SELECTED_AUDIT_LIMIT,
    audit_offset: query.audit_offset ?? DEFAULT_SELECTED_AUDIT_OFFSET,
  };
}

export function normalizeLatestQuoteQuery(query: LatestQuoteQuery) {
  return {
    scenario: query.scenario?.trim() || DEFAULT_MARKET_SCENARIO,
    symbol: query.symbol.trim(),
  };
}

export function normalizeStrategySignalsQuery(query: StrategySignalsQuery = {}) {
  return {
    limit: query.limit ?? 0,
    offset: query.offset ?? 0,
    scenario: query.scenario?.trim() || DEFAULT_STRATEGY_SCENARIO,
    strategy_id: query.strategy_id?.trim() ?? "",
  };
}

export const paperQueryKeys = {
  all: () => ["paper"] as const,
  account: () => ["paper", "account"] as const,
  portfolio: () => ["paper", "portfolio"] as const,
  positions: () => ["paper", "positions"] as const,
  rules: () => ["paper", "rules"] as const,
  session: () => ["paper", "session"] as const,
  sessions: () => ["paper", "sessions"] as const,
  sessionHistory: (filter: SessionHistoryFilter = {}) =>
    ["paper", "sessions", "list", normalizeSessionHistoryFilter(filter)] as const,
  report: (query: PaperReportQuery = {}) =>
    ["paper", "report", normalizePaperReportQuery(query)] as const,
  auditRoot: (sessionId?: string | null) =>
    ["paper", "audit", normalizeSessionScope(sessionId)] as const,
  audit: (query: PaperAuditQuery = {}) =>
    [...paperQueryKeys.auditRoot(query.session_id), normalizePaperAuditQuery(query)] as const,
  timeline: (query: PaperTimelineQuery = {}) =>
    ["paper", "timeline", normalizePaperTimelineQuery(query)] as const,
  ordersRoot: () => ["paper", "orders"] as const,
  orders: (filter: PaperOrderFilter = {}) =>
    ["paper", "orders", normalizePaperOrderFilter(filter)] as const,
  currentSnapshots: () => ["paper", "current-snapshot"] as const,
  currentSnapshot: (query: CurrentSessionSnapshotQuery = {}) =>
    [...paperQueryKeys.currentSnapshots(), normalizeCurrentSessionSnapshotQuery(query)] as const,
  sessionDetails: () => ["paper", "selected-session-detail"] as const,
  sessionDetail: (sessionId: string, query: SelectedSessionDetailQuery = {}) =>
    [
      ...paperQueryKeys.sessionDetails(),
      sessionId,
      normalizeSelectedSessionDetailQuery(query),
    ] as const,
};

export const dataQueryKeys = {
  all: () => ["data"] as const,
  marketScenarios: () => ["data", "market", "scenarios"] as const,
  latestQuote: (query: LatestQuoteQuery) =>
    ["data", "market", "latest-quote", normalizeLatestQuoteQuery(query)] as const,
  strategyScenarios: () => ["data", "strategy", "scenarios"] as const,
  strategySignals: (query: StrategySignalsQuery = {}) =>
    ["data", "strategy", "signals", normalizeStrategySignalsQuery(query)] as const,
};
