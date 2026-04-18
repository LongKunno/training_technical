import type {
  AuditEvent,
  QueryParams,
  SessionHistoryEntry,
  SessionHistoryFilter,
  SessionReport,
  SessionStatus,
  SessionTimelinePoint,
} from "../../shared/types";

export const SESSION_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const SESSION_STATUS_OPTIONS: Array<{ label: string; value: SessionStatus | "" }> = [
  { label: "All statuses", value: "" },
  { label: "Running", value: "running" },
  { label: "Stopped", value: "stopped" },
];

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

const dateTimeWithSecondsFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
});

const timelineFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const signedCurrencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: "exceptZero",
  style: "currency",
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const DEFAULT_SESSION_FILTER: Required<SessionHistoryFilter> = {
  limit: 20,
  offset: 0,
  q: "",
  status: undefined as never,
};

function isSessionStatus(value: string | null): value is SessionStatus {
  return value === "running" || value === "stopped";
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface SessionHistoryViewFilter extends QueryParams {
  limit: number;
  offset: number;
  q: string;
  status: SessionStatus | "";
}

export function parseSessionHistorySearchParams(
  searchParams: URLSearchParams,
): SessionHistoryViewFilter {
  const parsedLimit = parsePositiveInteger(
    searchParams.get("limit"),
    DEFAULT_SESSION_FILTER.limit,
  );
  const limit = SESSION_PAGE_SIZE_OPTIONS.some((value) => value === parsedLimit)
    ? parsedLimit
    : DEFAULT_SESSION_FILTER.limit;

  const rawOffset = parsePositiveInteger(searchParams.get("offset"), DEFAULT_SESSION_FILTER.offset);
  const statusValue = searchParams.get("status");

  return {
    limit,
    offset: Math.floor(rawOffset / limit) * limit,
    q: searchParams.get("q")?.trim() ?? DEFAULT_SESSION_FILTER.q,
    status: isSessionStatus(statusValue) ? statusValue : "",
  };
}

export function buildSessionHistorySearchParams(
  filter: SessionHistoryViewFilter,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filter.q) {
    params.set("q", filter.q);
  }

  if (filter.status) {
    params.set("status", filter.status);
  }

  if (filter.limit !== DEFAULT_SESSION_FILTER.limit) {
    params.set("limit", String(filter.limit));
  }

  if (filter.offset > DEFAULT_SESSION_FILTER.offset) {
    params.set("offset", String(filter.offset));
  }

  return params;
}

export function filtersMatch(
  left: SessionHistoryViewFilter,
  right: SessionHistoryViewFilter,
): boolean {
  return (
    left.limit === right.limit &&
    left.offset === right.offset &&
    left.q === right.q &&
    left.status === right.status
  );
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatSignedCurrency(value: number): string {
  return signedCurrencyFormatter.format(value);
}

export function formatDrawdown(value: number): string {
  return signedCurrencyFormatter.format(-Math.abs(value));
}

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "In progress";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatDateTimeWithSeconds(value?: string): string {
  if (!value) {
    return "In progress";
  }

  return dateTimeWithSecondsFormatter.format(new Date(value));
}

export function formatTimelineLabel(value: string): string {
  return timelineFormatter.format(new Date(value));
}

export function formatStatusLabel(status: SessionStatus | ""): string {
  if (!status) {
    return "All";
  }

  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export function formatEventType(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function getStatusTone(status: SessionStatus | "") {
  return status === "running" ? "success" : "neutral";
}

export function getAuditTone(event: AuditEvent["type"]) {
  if (event === "order_filled" || event === "session_started") {
    return "success";
  }

  if (event === "session_reset") {
    return "warning";
  }

  if (event === "order_rejected") {
    return "danger";
  }

  if (event === "market_tick") {
    return "info";
  }

  return "neutral";
}

export function sortSessionHistory(
  sessions: SessionHistoryEntry[],
): SessionHistoryEntry[] {
  return [...sessions].sort((left, right) => {
    const leftUpdated = new Date(left.last_event_at).getTime();
    const rightUpdated = new Date(right.last_event_at).getTime();

    if (rightUpdated !== leftUpdated) {
      return rightUpdated - leftUpdated;
    }

    return new Date(right.started_at).getTime() - new Date(left.started_at).getTime();
  });
}

export function toTimelineChartPoints(timeline: SessionTimelinePoint[]) {
  return timeline.map((point) => ({
    label: formatTimelineLabel(point.timestamp),
    value: point.equity,
  }));
}

export function buildSessionsPath(filter: SessionHistoryViewFilter): string {
  const queryString = buildSessionHistorySearchParams(filter).toString();
  return queryString ? `/sessions?${queryString}` : "/sessions";
}

export function buildSessionDetailPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

export function getPageNumber(filter: SessionHistoryViewFilter): number {
  return Math.floor(filter.offset / filter.limit) + 1;
}

export function getPageSummary(
  filter: SessionHistoryViewFilter,
  count: number,
): string {
  if (count === 0) {
    return "No sessions on this page";
  }

  const start = filter.offset + 1;
  const end = filter.offset + count;
  return `Showing ${start}-${end}`;
}

export function getFilterSummary(filter: SessionHistoryViewFilter): string {
  const parts = [
    filter.status ? `status:${filter.status}` : "status:all",
    filter.q ? `q:${filter.q}` : "q:any",
    `limit:${filter.limit}`,
  ];

  return parts.join(" • ");
}

export function getReportMetrics(report: SessionReport) {
  return [
    ["Started", formatDateTimeWithSeconds(report.started_at)],
    ["Stopped", formatDateTimeWithSeconds(report.stopped_at)],
    ["Reset count", formatInteger(report.reset_count)],
    ["Rejected signals", formatInteger(report.rejected_signals)],
    ["Fees paid", formatCurrency(report.fees_paid)],
    ["Slippage cost", formatCurrency(report.slippage_cost)],
  ] as const;
}
