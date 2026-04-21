import { attachTimelineToReport, normalizeTimeline } from "../lib";
import type {
  ApiRequestOptions,
  CurrentSessionSnapshot,
  CurrentSessionSnapshotQuery,
  ManualSignalRequest,
  PortfolioSummary,
  PaperAccountResponse,
  PaperAuditQuery,
  PaperAuditResponse,
  PaperOrderFilter,
  PaperOrdersResponse,
  PaperPortfolioResponse,
  PaperPositionsResponse,
  PaperReportQuery,
  PaperReportResponse,
  PaperRulesResponse,
  PaperSessionResponse,
  PaperSessionsResponse,
  PaperTimelineQuery,
  PaperTimelineResponse,
  PlacePaperOrderRequest,
  PlacePaperOrderResponse,
  RulesSummary,
  SelectedSessionDetail,
  SelectedSessionDetailQuery,
  ServiceHealth,
  SessionHistoryFilter,
  SessionReport,
  SignalExecutionResponse,
  StartSessionRequest,
} from "../types";
import { createJsonApiClient } from "./http";

const coreClient = createJsonApiClient("/core");

const DEFAULT_CURRENT_ORDERS_LIMIT = 20;
const DEFAULT_CURRENT_ORDERS_OFFSET = 0;
const DEFAULT_SELECTED_AUDIT_LIMIT = 40;
const DEFAULT_SELECTED_AUDIT_OFFSET = 0;

function normalizeArray<T>(items: T[] | null | undefined): T[] {
  return Array.isArray(items) ? items : [];
}

function normalizeRulesSummary(rules: RulesSummary): RulesSummary {
  return {
    ...rules,
    risk_controls: {
      ...rules.risk_controls,
      allowed_symbols: normalizeArray(rules.risk_controls.allowed_symbols),
    },
  };
}

function normalizePortfolioSummary(portfolio: PortfolioSummary): PortfolioSummary {
  return {
    ...portfolio,
    positions: normalizeArray(portfolio.positions),
  };
}

export function normalizeSessionReport(report: SessionReport): SessionReport {
  const timeline = normalizeTimeline(report.timeline ?? []);
  return attachTimelineToReport(
    {
      ...report,
      symbols: normalizeArray(report.symbols),
      timeline,
    },
    timeline,
  );
}

export function normalizeCurrentSessionSnapshot(
  snapshot: CurrentSessionSnapshot,
): CurrentSessionSnapshot {
  const timeline = normalizeTimeline(snapshot.timeline ?? snapshot.report.timeline ?? []);

  return {
    ...snapshot,
    orders: normalizeArray(snapshot.orders),
    portfolio: normalizePortfolioSummary(snapshot.portfolio),
    positions: normalizeArray(snapshot.positions),
    report: attachTimelineToReport(
      {
        ...snapshot.report,
        symbols: normalizeArray(snapshot.report.symbols),
        timeline,
      },
      timeline,
    ),
    rules: normalizeRulesSummary(snapshot.rules),
    timeline,
  };
}

export function getCurrentSessionSnapshotDefaults(
  query: CurrentSessionSnapshotQuery = {},
): Required<CurrentSessionSnapshotQuery> {
  return {
    orders_limit: query.orders_limit ?? DEFAULT_CURRENT_ORDERS_LIMIT,
    orders_offset: query.orders_offset ?? DEFAULT_CURRENT_ORDERS_OFFSET,
  };
}

export function getSelectedSessionDetailDefaults(
  query: SelectedSessionDetailQuery = {},
): Required<SelectedSessionDetailQuery> {
  return {
    audit_limit: query.audit_limit ?? DEFAULT_SELECTED_AUDIT_LIMIT,
    audit_offset: query.audit_offset ?? DEFAULT_SELECTED_AUDIT_OFFSET,
  };
}

export function openCurrentTimelineStream(eventSourceFactory?: (url: string) => EventSource) {
  const createEventSource =
    eventSourceFactory ??
    ((url: string) => {
      return new EventSource(url);
    });

  return createEventSource("/core/api/paper/timeline/stream");
}

export const coreApi = {
  getHealth(options?: ApiRequestOptions) {
    return coreClient.get<ServiceHealth>("/health", undefined, options);
  },

  getAccount(options?: ApiRequestOptions) {
    return coreClient
      .get<PaperAccountResponse>("/api/paper/account", undefined, options)
      .then((payload) => payload.account);
  },

  getPortfolio(options?: ApiRequestOptions) {
    return coreClient
      .get<PaperPortfolioResponse>("/api/paper/portfolio", undefined, options)
      .then((payload) => normalizePortfolioSummary(payload.portfolio));
  },

  getPositions(options?: ApiRequestOptions) {
    return coreClient
      .get<PaperPositionsResponse>("/api/paper/positions", undefined, options)
      .then((payload) => normalizeArray(payload.positions));
  },

  getRules(options?: ApiRequestOptions) {
    return coreClient
      .get<PaperRulesResponse>("/api/paper/rules", undefined, options)
      .then((payload) => normalizeRulesSummary(payload.rules));
  },

  getCurrentSession(options?: ApiRequestOptions) {
    return coreClient
      .get<PaperSessionResponse>("/api/paper/session", undefined, options)
      .then((payload) => payload.session);
  },

  listSessions(query: SessionHistoryFilter = {}, options?: ApiRequestOptions) {
    return coreClient
      .get<PaperSessionsResponse>("/api/paper/sessions", query, options)
      .then((payload) => normalizeArray(payload.sessions));
  },

  startSession(body: StartSessionRequest = {}, options?: ApiRequestOptions) {
    return coreClient
      .post<PaperSessionResponse, StartSessionRequest>("/api/paper/session/start", body, options)
      .then((payload) => payload.session);
  },

  resetSession(options?: ApiRequestOptions) {
    return coreClient
      .post<PaperSessionResponse, Record<string, never>>("/api/paper/session/reset", {}, options)
      .then((payload) => payload.session);
  },

  stopSession(options?: ApiRequestOptions) {
    return coreClient
      .post<PaperSessionResponse, Record<string, never>>("/api/paper/session/stop", {}, options)
      .then((payload) => payload.session);
  },

  listAudit(query: PaperAuditQuery = {}, options?: ApiRequestOptions) {
    return coreClient
      .get<PaperAuditResponse>("/api/paper/audit", query, options)
      .then((payload) => normalizeArray(payload.events));
  },

  getReport(query: PaperReportQuery = {}, options?: ApiRequestOptions) {
    return coreClient
      .get<PaperReportResponse>("/api/paper/report", query, options)
      .then((payload) => normalizeSessionReport(payload.report));
  },

  getTimeline(query: PaperTimelineQuery = {}, options?: ApiRequestOptions) {
    return coreClient
      .get<PaperTimelineResponse>("/api/paper/timeline", query, options)
      .then((payload) => normalizeTimeline(payload.timeline ?? []));
  },

  listOrders(filter: PaperOrderFilter = {}, options?: ApiRequestOptions) {
    return coreClient
      .get<PaperOrdersResponse>("/api/paper/orders", filter, options)
      .then((payload) => normalizeArray(payload.orders));
  },

  placeOrder(body: PlacePaperOrderRequest, options?: ApiRequestOptions) {
    return coreClient.post<PlacePaperOrderResponse, PlacePaperOrderRequest>(
      "/api/paper/orders",
      body,
      options,
    );
  },

  sendManualSignal(body: ManualSignalRequest, options?: ApiRequestOptions) {
    return coreClient.post<SignalExecutionResponse, ManualSignalRequest>(
      "/internal/signals",
      body,
      options,
    );
  },

  async getCurrentSessionSnapshot(
    query: CurrentSessionSnapshotQuery = {},
    options?: ApiRequestOptions,
  ): Promise<CurrentSessionSnapshot> {
    const normalizedQuery = getCurrentSessionSnapshotDefaults(query);
    const [session, portfolio, positions, report, rules, orders, timeline] = await Promise.all([
      coreApi.getCurrentSession(options),
      coreApi.getPortfolio(options),
      coreApi.getPositions(options),
      coreApi.getReport({}, options),
      coreApi.getRules(options),
      coreApi.listOrders(
        {
          limit: normalizedQuery.orders_limit,
          offset: normalizedQuery.orders_offset,
        },
        options,
      ),
      coreApi.getTimeline({}, options),
    ]);

    return normalizeCurrentSessionSnapshot({
      session,
      portfolio,
      positions,
      report,
      rules,
      orders,
      timeline,
    });
  },

  async getSelectedSessionDetail(
    sessionId: string,
    query: SelectedSessionDetailQuery = {},
    options?: ApiRequestOptions,
  ): Promise<SelectedSessionDetail> {
    const normalizedQuery = getSelectedSessionDetailDefaults(query);
    const [report, events, timeline] = await Promise.all([
      coreApi.getReport({ session_id: sessionId }, options),
      coreApi.listAudit(
        {
          session_id: sessionId,
          limit: normalizedQuery.audit_limit,
          offset: normalizedQuery.audit_offset,
        },
        options,
      ),
      coreApi.getTimeline({ session_id: sessionId }, options),
    ]);

    return {
      session_id: sessionId,
      report: attachTimelineToReport(normalizeSessionReport(report), timeline),
      events,
      timeline,
    };
  },
};
