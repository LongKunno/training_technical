import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import { ApiClientError } from "../../shared/api/http";
import { ChartPanel, createTimelineAreaOption } from "../../shared/charts";
import {
  resolveServiceAvailability,
  useCoreHealthQuery,
  useSelectedSessionDetailQuery,
} from "../../shared/query";
import {
  selectSessionHistoryFilter,
  useOperatorUiStore,
} from "../../shared/state";
import type { UpstreamAvailability } from "../../shared/types";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  SectionTabPanel,
  SectionTabs,
  ShieldIcon,
  SummaryStrip,
} from "../../shared/ui";
import {
  buildSessionsPath,
  formatBps,
  formatDateTimeWithSeconds,
  formatDrawdown,
  formatEventType,
  formatInteger,
  formatPercentRatio,
  formatSignedCurrency,
  formatStatusLabel,
  getAuditTone,
  getReportMetrics,
  getStatusTone,
  parseSelectedSessionIdSearchParam,
  parseSessionHistorySearchParams,
  toTimelineChartPoints,
} from "./formatters";

function linkButtonClassName() {
  return "focus-ring inline-flex h-11 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.05] px-5 text-sm font-medium text-white transition hover:border-white/16 hover:bg-white/[0.08]";
}

function LoadingGrid() {
  return (
    <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-[180px] animate-pulse rounded-[24px] border border-white/8 bg-white/[0.04]"
        />
      ))}
    </section>
  );
}

function getDetailErrorState(error: unknown, coreAvailability: UpstreamAvailability) {
  if (coreAvailability === "down") {
    return {
      description:
        "Historical detail is read-only, but it still depends on /core/health and session-scoped /core/api/paper/* endpoints. The core service is unreachable right now.",
      title: "Core trading API unavailable",
    };
  }

  if (error instanceof ApiClientError && error.code === "session_not_found") {
    return {
      description:
        "The requested historical session does not exist in paper session storage anymore.",
      title: "Session not found",
    };
  }

  return {
    description: formatOperatorErrorMessage(
      error,
      "Historical report, audit, and timeline data could not be loaded.",
    ),
    title: "Historical session detail is unavailable",
  };
}

export function SessionDetailRouteView() {
  const { sessionId = "" } = useParams();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("report");
  const sessionHistoryFilter = useOperatorUiStore(selectSessionHistoryFilter);
  const setSelectedSessionId = useOperatorUiStore((state) => state.setSelectedSessionId);
  const coreHealthQuery = useCoreHealthQuery();
  const coreAvailability = resolveServiceAvailability(coreHealthQuery);
  const detailQuery = useSelectedSessionDetailQuery(sessionId, {
    audit_limit: 40,
    audit_offset: 0,
  });

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    setSelectedSessionId(sessionId);
  }, [sessionId, setSelectedSessionId]);

  const report = detailQuery.data?.report;
  const timeline = detailQuery.data?.timeline ?? report?.timeline ?? [];
  const events = detailQuery.data?.events ?? [];
  const chartOption =
    timeline.length > 0 ? createTimelineAreaOption(toTimelineChartPoints(timeline)) : undefined;
  const detailError = detailQuery.isError
    ? getDetailErrorState(detailQuery.error, coreAvailability)
    : null;
  const routeSearchParams = new URLSearchParams(location.search);
  const routeFilter = parseSessionHistorySearchParams(routeSearchParams);
  const routeSelectedSessionId = parseSelectedSessionIdSearchParam(routeSearchParams);
  const backToSessionsPath = location.search
    ? buildSessionsPath(routeFilter, routeSelectedSessionId ?? sessionId)
    : buildSessionsPath(sessionHistoryFilter, sessionId);

  return (
    <>
      <PageHeader
        eyebrow="Selected Session"
        title={sessionId ? `Historical detail for ${sessionId}` : "Historical detail"}
        description="This route is a dedicated immutable surface for report, audit, and timeline data scoped to one saved session. It does not mount current-session SSE or current positions/orders."
        actions={
          <>
            <Link to={backToSessionsPath} className={linkButtonClassName()}>
              Back to sessions
            </Link>
            <Button
              tone="secondary"
              onClick={() => {
                void detailQuery.refetch();
              }}
              disabled={detailQuery.isFetching}
            >
              {detailQuery.isFetching ? "Refreshing..." : "Refresh detail"}
            </Button>
          </>
        }
        meta={[
          { label: "Session ID", value: sessionId || "Missing route parameter" },
          { label: "Status", value: report ? formatStatusLabel(report.status) : "Loading" },
          { label: "Timeline points", value: report ? formatInteger(timeline.length) : "..." },
          { label: "Audit entries loaded", value: report ? formatInteger(events.length) : "..." },
        ]}
        aside={
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="neutral">Immutable view</Badge>
              <Badge tone="warning">No SSE</Badge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Historical detail is intentionally isolated from current-session streaming. Refresh is
              manual and scoped to this selected session only.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Back link preserves the sessions workspace filters and selected preview.
            </p>
          </div>
        }
      />

      {detailQuery.isLoading && !report ? <LoadingGrid /> : null}

      {detailError ? (
        <Panel tone="accent">
          <EmptyState
            eyebrow="Selected session"
            title={detailError.title}
            description={detailError.description}
            icon={<ShieldIcon className="size-5" />}
          />
        </Panel>
      ) : null}

      {report ? (
        <>
          <SummaryStrip
            items={[
              {
                badge: <Badge tone={report.total_pnl >= 0 ? "success" : "warning"}>PnL</Badge>,
                label: "Total PnL",
                meta: `Realized ${formatSignedCurrency(report.realized_pnl)}`,
                tone: report.total_pnl >= 0 ? "success" : "warning",
                value: formatSignedCurrency(report.total_pnl),
              },
              {
                badge: <Badge tone={getStatusTone(report.status)}>{formatStatusLabel(report.status)}</Badge>,
                label: "Filled orders",
                meta: `${formatInteger(report.rejected_signals)} rejected signals`,
                tone: "accent",
                value: formatInteger(report.filled_orders),
              },
              {
                badge: <Badge tone="info">Execution</Badge>,
                label: "Fill quality",
                meta: `Avg slippage ${formatBps(report.average_slippage_bps)} · ${formatInteger(report.stopped_orders ?? 0)} stopped`,
                tone: "neutral",
                value: formatPercentRatio(report.fill_ratio),
              },
              {
                badge: <Badge tone="warning">Drawdown</Badge>,
                label: "Max drawdown",
                meta:
                  timeline.length > 0
                    ? `${formatInteger(timeline.length)} timeline points`
                    : "Legacy snapshots without timeline still render safely.",
                tone: "warning",
                value: formatDrawdown(report.max_drawdown),
              },
            ]}
          />

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.82fr)]">
            <ChartPanel
              tone="soft"
              eyebrow="Timeline"
              title="Historical equity curve"
              description="Timeline is loaded from the selected session snapshot and stays read-only on this route."
              chart={{
                emptyDescription:
                  "This older session snapshot does not include timeline points yet. Report and audit details stay available.",
                emptyTitle: "No timeline stored for this session",
                height: 360,
                loading: detailQuery.isFetching && timeline.length === 0,
                option: chartOption,
              }}
              footer={
                <>
                  <Badge tone={getStatusTone(report.status)}>{formatStatusLabel(report.status)}</Badge>
                  <span>{formatInteger(timeline.length)} timeline points</span>
                  <span>Started {formatDateTimeWithSeconds(report.started_at)}</span>
                </>
              }
            />

            <Panel
              density="dense"
              eyebrow="Review"
              title="Session detail tabs"
              description="Chuyển nhanh giữa report, audit và context mà không phải cuộn qua nhiều khối phụ."
            >
              <SectionTabs
                label="Session detail tabs"
                tabs={[
                  { value: "report", label: "Report" },
                  { value: "audit", label: "Audit", badge: <Badge tone="neutral">{formatInteger(events.length)}</Badge> },
                  { value: "context", label: "Context" },
                ]}
                value={activeTab}
                onValueChange={setActiveTab}
              />

              <SectionTabPanel activeValue={activeTab} className="mt-4" value="report">
                <dl className="grid gap-3">
                  {getReportMetrics(report).map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] px-4 py-3 text-sm"
                    >
                      <dt className="text-slate-400">{label}</dt>
                      <dd className="font-medium text-white">{value}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] px-4 py-3 text-sm">
                    <dt className="text-slate-400">Symbols traded</dt>
                    <dd className="font-medium text-white">{formatInteger(report.symbols.length)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] px-4 py-3 text-sm">
                    <dt className="text-slate-400">Unrealized PnL</dt>
                    <dd className="font-medium text-white">
                      {formatSignedCurrency(report.unrealized_pnl)}
                    </dd>
                  </div>
                </dl>
              </SectionTabPanel>

              <SectionTabPanel activeValue={activeTab} className="mt-4" value="audit">
                {events.length === 0 ? (
                  <EmptyState
                    eyebrow="Audit"
                    title="No audit events returned"
                    description="This session currently has no stored audit rows for the requested page."
                    icon={<ShieldIcon className="size-5" />}
                  />
                ) : (
                  <div className="feed-scroll grid max-h-[420px] gap-3 overflow-auto pr-1">
                    {events.map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Badge tone={getAuditTone(entry.type)}>
                            {formatEventType(entry.type)}
                          </Badge>
                          <span className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            {formatDateTimeWithSeconds(entry.timestamp)}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-300">{entry.message}</p>
                      </article>
                    ))}
                  </div>
                )}
              </SectionTabPanel>

              <SectionTabPanel activeValue={activeTab} className="mt-4" value="context">
                <div className="grid gap-3">
                  <div className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">Immutable detail</Badge>
                      <Badge tone="warning">No SSE</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      Historical detail stays isolated from current-session streaming. Refresh là thao tác thủ công và chỉ áp dụng cho session đang mở.
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
                    <div className="text-sm font-medium text-white">Current-only panels stay on Dashboard</div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Positions và live order grids không được dựng lại ở đây để historical và realtime context không bị trộn.
                    </p>
                  </div>
                </div>
              </SectionTabPanel>
            </Panel>
          </section>
        </>
      ) : null}
    </>
  );
}
