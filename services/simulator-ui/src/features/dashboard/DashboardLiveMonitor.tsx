import { Link } from "react-router-dom";

import { ApiClientError } from "../../shared/api/http";
import { ChartPanel } from "../../shared/charts";
import { useCurrentSessionSnapshotQuery, useCurrentTimelineStream } from "../../shared/query";
import { selectTimelineStreamStatus, useOperatorUiStore } from "../../shared/state";
import type {
  CurrentSessionSnapshot,
  PortfolioPositionSummary,
} from "../../shared/types";
import {
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  ClockIcon,
  DatabaseIcon,
  PulseIcon,
  ShieldIcon,
  SparklineIcon,
  cx,
} from "../../shared/ui";
import { createCurrentTimelineOption } from "./dashboard-chart";
import {
  describeTimelineStreamStatus,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatGuardLimit,
  formatNumber,
  formatPercentRatio,
  formatShortTime,
  formatSignedCurrency,
  getSessionStatusBadgeTone,
  getStreamBadgeTone,
} from "./dashboard-formatters";

interface MetricItem {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}

interface EmptyCopy {
  title: string;
  description: string;
}

interface RiskPosture {
  label: string;
  tone: "success" | "warning" | "accent";
  detail: string;
  trend: string;
}

const actionLinkClassName =
  "focus-ring inline-flex h-11 items-center justify-center rounded-[18px] border px-5 text-sm font-medium transition";

function getErrorCopy(error: unknown): EmptyCopy {
  if (error instanceof ApiClientError && error.code === "session_not_found") {
    return {
      title: "No current paper session",
      description:
        "Start or reset a paper session from Lab to populate the live monitor. This route only reads the current session and never hydrates historical state.",
    };
  }

  if (error instanceof Error) {
    return {
      title: "Current session snapshot unavailable",
      description: error.message,
    };
  }

  return {
    title: "Current session snapshot unavailable",
    description: "The dashboard could not load the current-session read model.",
  };
}

function getOpenExposure(positions: PortfolioPositionSummary[]): number {
  return positions.reduce((total, position) => total + Math.abs(Number(position.market_value ?? 0)), 0);
}

function getRiskPosture(snapshot?: CurrentSessionSnapshot): RiskPosture {
  if (!snapshot) {
    return {
      label: "Waiting",
      tone: "accent",
      detail: "Risk posture will resolve once the current snapshot lands.",
      trend: "snapshot pending",
    };
  }

  const openExposure = getOpenExposure(snapshot.positions);
  const maxDailyLoss = Number(snapshot.rules.risk_controls.max_daily_loss ?? 0);
  const maxOpenNotional = Number(snapshot.rules.risk_controls.max_open_notional ?? 0);
  const consumedLoss = Math.max(-Number(snapshot.report.total_pnl ?? 0), 0);
  const lossUtilization = maxDailyLoss > 0 ? consumedLoss / maxDailyLoss : 0;
  const exposureUtilization = maxOpenNotional > 0 ? openExposure / maxOpenNotional : 0;
  const highestUtilization = Math.max(lossUtilization, exposureUtilization);

  if (highestUtilization >= 0.85 || snapshot.report.rejected_signals > 0) {
    return {
      label: "Guarded",
      tone: "warning",
      detail: "One or more controls are nearing their configured thresholds.",
      trend: `${Math.round(highestUtilization * 100)}% guard usage`,
    };
  }

  if (highestUtilization >= 0.55) {
    return {
      label: "Watch",
      tone: "accent",
      detail: "Exposure is healthy but no longer in the low-utilization zone.",
      trend: `${Math.round(highestUtilization * 100)}% guard usage`,
    };
  }

  return {
    label: "Healthy",
    tone: "success",
    detail: "Daily loss and open notional remain well inside configured limits.",
    trend: "buffer available",
  };
}

function renderMetricCard(item: MetricItem) {
  return (
    <div
      key={item.label}
      className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
      <div className={cx("mt-2 text-xl font-medium text-white", item.valueClassName)}>{item.value}</div>
      {item.hint ? <div className="mt-2 text-sm leading-6 text-slate-400">{item.hint}</div> : null}
    </div>
  );
}

function MetricGrid({
  items,
  columns = 2,
}: {
  items: MetricItem[];
  columns?: 1 | 2 | 3;
}) {
  const gridClassName =
    columns === 3 ? "xl:grid-cols-3" : columns === 1 ? "sm:grid-cols-1" : "sm:grid-cols-2";

  return <div className={cx("grid gap-3", gridClassName)}>{items.map((item) => renderMetricCard(item))}</div>;
}

function MetricGridSkeleton({ items = 4 }: { items?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: items }, (_, index) => (
        <div
          key={index}
          className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
        >
          <div className="h-3 w-24 rounded-full bg-white/8" />
          <div className="mt-4 h-7 w-28 rounded-full bg-white/10" />
          <div className="mt-3 h-3 w-40 rounded-full bg-white/6" />
        </div>
      ))}
    </div>
  );
}

function GuardRailMeter({
  helper,
  label,
  limit,
  used,
}: {
  label: string;
  used: number;
  limit: number;
  helper: string;
}) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
  const toneClassName =
    ratio >= 0.85 ? "bg-rose-300" : ratio >= 0.55 ? "bg-amber-300" : "bg-emerald-300";

  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-1 text-sm leading-6 text-slate-400">{helper}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-white">
            {limit > 0 ? `${formatCurrency(used)} / ${formatCurrency(limit)}` : "Disabled"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
            {limit > 0 ? `${Math.round(ratio * 100)}% used` : "no cap"}
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-white/8">
        <div
          className={cx("h-full rounded-full transition-[width]", toneClassName)}
          style={{ width: limit > 0 ? `${Math.max(ratio * 100, 3)}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function DashboardTableState({
  copy,
  eyebrow,
}: {
  eyebrow: string;
  copy: EmptyCopy;
}) {
  return (
    <EmptyState
      eyebrow={eyebrow}
      title={copy.title}
      description={copy.description}
      className="min-h-[320px]"
    />
  );
}

function buildPortfolioMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  const openExposure = getOpenExposure(snapshot.positions);

  return [
    {
      label: "Cash balance",
      value: formatCurrency(snapshot.portfolio.cash_balance),
      hint: "Deployable cash remaining in the paper account.",
    },
    {
      label: "Unrealized PnL",
      value: formatSignedCurrency(snapshot.portfolio.unrealized_pnl),
      hint: `${snapshot.positions.length} open positions in the book.`,
      valueClassName:
        snapshot.portfolio.unrealized_pnl < 0 ? "text-rose-200" : "text-emerald-200",
    },
    {
      label: "Realized PnL",
      value: formatSignedCurrency(snapshot.portfolio.realized_pnl),
      hint: "Closed-trade contribution for the current session.",
      valueClassName:
        snapshot.portfolio.realized_pnl < 0 ? "text-rose-200" : "text-emerald-200",
    },
    {
      label: "Gross exposure",
      value: formatCurrency(openExposure),
      hint: "Absolute market value across open positions.",
    },
  ];
}

function buildReportMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  return [
    {
      label: "Filled orders",
      value: formatNumber(snapshot.report.filled_orders, 0),
      hint: "Executed fills recorded in the session report.",
    },
    {
      label: "Rejected signals",
      value: formatNumber(snapshot.report.rejected_signals, 0),
      hint: "Signals blocked by rules or execution constraints.",
    },
    {
      label: "Fees paid",
      value: formatCurrency(snapshot.report.fees_paid),
      hint: "Cumulative fees from filled paper orders.",
    },
    {
      label: "Slippage cost",
      value: formatCurrency(snapshot.report.slippage_cost),
      hint: "Estimated execution drag versus requested price.",
    },
    {
      label: "Max drawdown",
      value: formatCurrency(snapshot.report.max_drawdown),
      hint: "Peak equity drawdown captured in the report timeline.",
    },
    {
      label: "Session resets",
      value: formatNumber(snapshot.report.reset_count, 0),
      hint: "How many times the current paper session was reset.",
    },
  ];
}

function buildRuleMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  return [
    {
      label: "Fee rate",
      value: formatPercentRatio(snapshot.rules.fee_rate, 3),
      hint: "Applied to every paper fill.",
    },
    {
      label: "Slippage rate",
      value: formatPercentRatio(snapshot.rules.slippage_rate, 3),
      hint: "Synthetic execution slippage per trade.",
    },
    {
      label: "Max order notional",
      value: formatGuardLimit(snapshot.rules.risk_controls.max_order_notional),
      hint: "Per-order notional limit before a signal is rejected.",
    },
    {
      label: "Max position quantity",
      value:
        Number(snapshot.rules.risk_controls.max_position_quantity ?? 0) > 0
          ? formatNumber(snapshot.rules.risk_controls.max_position_quantity)
          : "Disabled",
      hint: "Per-symbol quantity cap enforced by risk controls.",
    },
    {
      label: "Cooldown",
      value: formatDuration(snapshot.rules.risk_controls.cooldown_seconds),
      hint: "Minimum delay between eligible orders.",
    },
    {
      label: "Allowed symbols",
      value: snapshot.rules.risk_controls.allowed_symbols.length
        ? `${snapshot.rules.risk_controls.allowed_symbols.length} scoped`
        : "All symbols",
      hint: "Universe currently permitted for the paper engine.",
    },
  ];
}

function renderSymbolSummary(snapshot: CurrentSessionSnapshot) {
  if (!snapshot.report.symbols.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-slate-400">
        No symbol-level fills yet. Once orders land, this panel surfaces the busiest symbols and their fee load.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {snapshot.report.symbols.slice(0, 4).map((symbol) => (
        <div
          key={symbol.symbol}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4"
        >
          <div>
            <div className="text-sm font-medium text-white">{symbol.symbol}</div>
            <div className="mt-1 text-sm text-slate-400">
              {formatNumber(symbol.filled_orders, 0)} filled orders
            </div>
          </div>
          <Badge tone="info">{formatCurrency(symbol.fees_paid)} fees</Badge>
        </div>
      ))}
    </div>
  );
}

export function DashboardLiveMonitor() {
  const currentSnapshotQuery = useCurrentSessionSnapshotQuery();
  const snapshot = currentSnapshotQuery.data;
  const currentErrorCopy = getErrorCopy(currentSnapshotQuery.error);
  const timelineStreamStatus = useOperatorUiStore(selectTimelineStreamStatus);
  const timelineStream = useCurrentTimelineStream({
    enabled: Boolean(snapshot?.session.id),
  });

  const isInitialLoading = currentSnapshotQuery.isPending && !snapshot;
  const isRefreshing = currentSnapshotQuery.isFetching && !isInitialLoading;
  const timelinePoints = snapshot?.timeline ?? [];
  const latestTimelinePoint = timelineStream.lastPoint ?? timelinePoints[timelinePoints.length - 1];
  const riskPosture = getRiskPosture(snapshot);
  const openExposure = getOpenExposure(snapshot?.positions ?? []);
  const currentLossUsage = Math.max(-Number(snapshot?.report.total_pnl ?? 0), 0);
  const maxDailyLoss = Number(snapshot?.rules.risk_controls.max_daily_loss ?? 0);
  const maxOpenNotional = Number(snapshot?.rules.risk_controls.max_open_notional ?? 0);
  const actionDescription = snapshot
    ? `${snapshot.session.id} is ${snapshot.session.status}. Equity is ${formatCurrency(snapshot.portfolio.total_equity)} with ${snapshot.positions.length} open positions and ${snapshot.orders.length} recent fills.`
    : currentErrorCopy.description;

  const headerAside = (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          tone={getSessionStatusBadgeTone(snapshot?.session.status)}
          leading={<PulseIcon className="size-3" />}
        >
          {snapshot?.session.status ?? (isInitialLoading ? "loading" : "unavailable")}
        </Badge>
        <Badge tone={getStreamBadgeTone(timelineStreamStatus)}>
          SSE {describeTimelineStreamStatus(timelineStreamStatus)}
        </Badge>
        {isRefreshing ? <Badge tone="info">Refreshing snapshot</Badge> : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-400">{actionDescription}</p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-400">
        <span>Last timeline event: {latestTimelinePoint?.event_type ?? "-"}</span>
        <span>At {formatShortTime(latestTimelinePoint?.timestamp)}</span>
        {timelineStream.reconnectCount > 0 ? (
          <span>Reconnects: {timelineStream.reconnectCount}</span>
        ) : null}
      </div>

      {timelineStream.error ? (
        <p className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
          Timeline stream degraded: {timelineStream.error.message}
        </p>
      ) : null}
    </div>
  );

  const pageMeta = [
    { label: "Current session", value: snapshot?.session.id ?? "-" },
    { label: "Last event", value: formatDateTime(snapshot?.session.last_event_at) },
    { label: "Open positions", value: formatNumber(snapshot?.positions.length ?? 0, 0) },
    { label: "Recent orders", value: formatNumber(snapshot?.orders.length ?? 0, 0) },
  ];

  const positions = [...(snapshot?.positions ?? [])].sort(
    (left, right) => Math.abs(Number(right.market_value ?? 0)) - Math.abs(Number(left.market_value ?? 0)),
  );
  const orders = [...(snapshot?.orders ?? [])].sort(
    (left, right) =>
      new Date(right.executed_at).getTime() - new Date(left.executed_at).getTime(),
  );

  return (
    <>
      <PageHeader
        eyebrow="Current Session"
        title="Current-session live monitor"
        description="This route is the only place that subscribes to current-session SSE. It keeps realtime equity, risk, positions, and order flow visible without mutating any selected historical session state."
        actions={
          <>
            <Link
              to="/lab"
              className={cx(
                actionLinkClassName,
                "border-transparent bg-[linear-gradient(135deg,#f4be51_0%,#ffd978_45%,#42d9ba_100%)] text-slate-950 shadow-[0_18px_32px_rgba(244,190,81,0.24)] hover:brightness-105",
              )}
            >
              Open operator lab
            </Link>
            <Link
              to="/sessions"
              className={cx(
                actionLinkClassName,
                "border-white/10 bg-white/[0.05] text-white hover:border-white/16 hover:bg-white/[0.08]",
              )}
            >
              Review session history
            </Link>
          </>
        }
        meta={pageMeta}
        aside={headerAside}
      />

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <div className="glass-card panel-outline surface-noise rounded-[24px] border bg-gradient-to-br from-amber-300/12 to-cyan-300/6 p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Session status
              </p>
              <p className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white">
                {snapshot?.session.status ?? (isInitialLoading ? "Loading" : "Unavailable")}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100">
              <PulseIcon className="size-5" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={getStreamBadgeTone(timelineStreamStatus)}>
              {describeTimelineStreamStatus(timelineStreamStatus)}
            </Badge>
            <p className="text-sm text-slate-400">
              Current-session stream attaches only while this route is mounted.
            </p>
          </div>
        </div>

        <div className="glass-card panel-outline surface-noise rounded-[24px] border bg-gradient-to-br from-emerald-300/14 to-emerald-300/4 p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Total equity
              </p>
              <p className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white">
                {snapshot ? formatCurrency(snapshot.portfolio.total_equity) : "-"}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100">
              <SparklineIcon className="size-5" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={snapshot && snapshot.report.total_pnl < 0 ? "danger" : "success"}>
              {snapshot ? formatSignedCurrency(snapshot.report.total_pnl) : "-"}
            </Badge>
            <p className="text-sm text-slate-400">Portfolio cash plus marked-to-market positions.</p>
          </div>
        </div>

        <div className="glass-card panel-outline surface-noise rounded-[24px] border bg-gradient-to-br from-white/6 to-white/[0.02] p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Filled orders
              </p>
              <p className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white">
                {snapshot ? formatNumber(snapshot.report.filled_orders, 0) : "-"}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100">
              <ClockIcon className="size-5" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="info">{snapshot ? formatCurrency(snapshot.report.fees_paid) : "-"}</Badge>
            <p className="text-sm text-slate-400">Fees and slippage tracked on the live report.</p>
          </div>
        </div>

        <div className="glass-card panel-outline surface-noise rounded-[24px] border bg-gradient-to-br from-rose-300/14 to-amber-300/6 p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Risk posture
              </p>
              <p className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white">
                {riskPosture.label}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100">
              <ShieldIcon className="size-5" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={riskPosture.tone === "warning" ? "warning" : "info"}>
              {riskPosture.trend}
            </Badge>
            <p className="text-sm text-slate-400">{riskPosture.detail}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
        <ChartPanel
          tone="soft"
          eyebrow="Current timeline"
          title="Live equity and drawdown"
          description="Timeline points stream in only for the current session. Historical routes remain immutable and do not subscribe to this event source."
          chart={{
            emptyDescription:
              currentSnapshotQuery.error && !snapshot
                ? currentErrorCopy.description
                : "The paper engine has not written timeline points yet.",
            emptyTitle:
              currentSnapshotQuery.error && !snapshot
                ? currentErrorCopy.title
                : "Current timeline is waiting for points",
            height: 360,
            loading: isInitialLoading,
            option: createCurrentTimelineOption(timelinePoints),
          }}
          footer={
            <>
              <Badge tone={getStreamBadgeTone(timelineStreamStatus)}>
                SSE {describeTimelineStreamStatus(timelineStreamStatus)}
              </Badge>
              <span>Points: {formatNumber(timelinePoints.length, 0)}</span>
              <span>Last equity: {formatCurrency(timelinePoints[timelinePoints.length - 1]?.equity)}</span>
              <span>Max drawdown: {formatCurrency(snapshot?.report.max_drawdown)}</span>
            </>
          }
        />

        <div className="grid gap-6">
          <Panel
            eyebrow="Portfolio"
            title="Current portfolio stats"
            description="Cash, exposure, and PnL stay scoped to the active paper engine."
          >
            {snapshot ? (
              <MetricGrid items={buildPortfolioMetrics(snapshot)} />
            ) : isInitialLoading ? (
              <MetricGridSkeleton />
            ) : (
              <EmptyState
                eyebrow="Current session"
                title={currentErrorCopy.title}
                description={currentErrorCopy.description}
              />
            )}
          </Panel>

          <Panel
            eyebrow="Report"
            title="Session report stats"
            description="The live report tracks fills, drag, drawdown, and symbol-level execution density."
          >
            {snapshot ? (
              <div className="space-y-6">
                <MetricGrid items={buildReportMetrics(snapshot)} columns={3} />
                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Busiest symbols
                  </div>
                  {renderSymbolSummary(snapshot)}
                </div>
              </div>
            ) : isInitialLoading ? (
              <MetricGridSkeleton items={6} />
            ) : (
              <EmptyState
                eyebrow="Current session"
                title={currentErrorCopy.title}
                description={currentErrorCopy.description}
              />
            )}
          </Panel>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Panel
          eyebrow="Rules and risk"
          title="Live guardrails"
          description="Configured limits and their current utilization on the running paper session."
        >
          {snapshot ? (
            <div className="space-y-6">
              <MetricGrid items={buildRuleMetrics(snapshot)} columns={3} />

              <div className="grid gap-3">
                <GuardRailMeter
                  label="Daily loss guard"
                  used={currentLossUsage}
                  limit={maxDailyLoss}
                  helper="Uses live total PnL to show how much of the daily loss budget is already consumed."
                />
                <GuardRailMeter
                  label="Open notional guard"
                  used={openExposure}
                  limit={maxOpenNotional}
                  helper="Tracks absolute marked exposure across current open positions."
                />
              </div>

              <div>
                <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Allowed symbols
                </div>
                <div className="flex flex-wrap gap-2">
                  {snapshot.rules.risk_controls.allowed_symbols.length ? (
                    snapshot.rules.risk_controls.allowed_symbols.map((symbol) => (
                      <Badge key={symbol} tone="info">
                        {symbol}
                      </Badge>
                    ))
                  ) : (
                    <Badge>All symbols</Badge>
                  )}
                </div>
              </div>
            </div>
          ) : isInitialLoading ? (
            <MetricGridSkeleton items={6} />
          ) : (
            <EmptyState
              eyebrow="Current session"
              title={currentErrorCopy.title}
              description={currentErrorCopy.description}
            />
          )}
        </Panel>

        <Panel
          eyebrow="Realtime scope"
          title="Current-session boundaries"
          description="This route owns the current-session live monitor only. Historical detail is isolated elsewhere."
        >
          <div className="grid gap-3">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <DatabaseIcon className="size-5 text-cyan-200" />
                <div className="text-sm font-medium text-white">Current snapshot only</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                The dashboard reads current session, current portfolio, current report, current positions, and current orders from the shared paper snapshot hook.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <PulseIcon className="size-5 text-emerald-200" />
                <div className="text-sm font-medium text-white">SSE isolation</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                `useCurrentTimelineStream` is mounted only here, so selected historical routes never receive live mutations.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <ShieldIcon className="size-5 text-amber-200" />
                <div className="text-sm font-medium text-white">Guardrail visibility</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Rules, daily loss budget, open notional utilization, and rejected signals stay on the live operator surface.
              </p>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Current portfolio"
          title="Open positions"
          description="Positions are sorted by exposure so the largest live risks stay at the top."
        >
          {snapshot ? (
            <DataTable
              caption="Current positions"
              columns={[
                { key: "symbol", header: "Symbol", cell: (row) => row.symbol },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  cell: (row) => formatNumber(row.quantity),
                },
                {
                  key: "average",
                  header: "Avg",
                  align: "right",
                  cell: (row) => formatCurrency(row.average_price),
                },
                {
                  key: "mark",
                  header: "Mark",
                  align: "right",
                  cell: (row) => formatCurrency(row.market_price),
                },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  cell: (row) => formatCurrency(row.market_value),
                },
                {
                  key: "unrealized",
                  header: "UPnL",
                  align: "right",
                  cell: (row) => (
                    <span
                      className={
                        row.unrealized_pnl < 0 ? "text-rose-200" : "text-emerald-200"
                      }
                    >
                      {formatSignedCurrency(row.unrealized_pnl)}
                    </span>
                  ),
                },
              ]}
              rows={positions}
              getRowId={(row) => row.symbol}
              emptyTitle="No open positions"
              emptyDescription="The current paper account does not have any marked positions yet."
            />
          ) : isInitialLoading ? (
            <DashboardTableState
              eyebrow="Current positions"
              copy={{
                title: "Loading positions",
                description: "Fetching the current portfolio read model for the live monitor.",
              }}
            />
          ) : (
            <DashboardTableState eyebrow="Current positions" copy={currentErrorCopy} />
          )}
        </Panel>

        <Panel
          eyebrow="Execution feed"
          title="Recent orders"
          description="Recent current-session orders stay on the dashboard even when historical session routes are open elsewhere."
        >
          {snapshot ? (
            <DataTable
              caption="Current orders"
              columns={[
                {
                  key: "executed_at",
                  header: "Time",
                  cell: (row) => formatDateTime(row.executed_at),
                },
                { key: "symbol", header: "Symbol", cell: (row) => row.symbol },
                {
                  key: "side",
                  header: "Side",
                  cell: (row) => (
                    <Badge tone={row.side === "buy" ? "success" : "danger"}>{row.side}</Badge>
                  ),
                },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  cell: (row) => formatNumber(row.quantity),
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  cell: (row) => formatCurrency(row.price),
                },
                {
                  key: "fee",
                  header: "Fee",
                  align: "right",
                  cell: (row) => formatCurrency(row.fee),
                },
              ]}
              rows={orders}
              getRowId={(row) => row.id}
              emptyTitle="No recent orders"
              emptyDescription="Orders will appear here as the current paper session fills signals."
            />
          ) : isInitialLoading ? (
            <DashboardTableState
              eyebrow="Current orders"
              copy={{
                title: "Loading orders",
                description: "Fetching the current-session order feed for the live monitor.",
              }}
            />
          ) : (
            <DashboardTableState eyebrow="Current orders" copy={currentErrorCopy} />
          )}
        </Panel>
      </section>
    </>
  );
}
