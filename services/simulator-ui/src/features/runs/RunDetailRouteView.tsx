import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import { ChartPanel, createTimelineAreaOption } from "../../shared/charts";
import {
  useCreateSimulationRunMutation,
  usePaperOrdersQuery,
  useSelectedSessionDetailQuery,
  useSimulationRunQuery,
  useStopSimulationRunMutation,
} from "../../shared/query";
import type { PaperOrder } from "../../shared/types";
import {
  Badge,
  Button,
  DataTable,
  DisclosurePanel,
  EmptyState,
  PageHeader,
  Panel,
  SectionTabPanel,
  SectionTabs,
  SummaryStrip,
} from "../../shared/ui";
import {
  formatCurrency,
  formatBps,
  formatDateTime,
  formatInteger,
  formatPercentRatio,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
  isActiveRunStatus,
  toTimelineChartPoints,
} from "./formatters";

interface RunDetailRouteViewProps {
  runId: string;
}

const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

function formatDecimal(value?: number | null) {
  return decimalFormatter.format(value ?? 0);
}

function formatOrderStatusLabel(status?: string) {
  return status?.replace(/_/g, " ") || "unknown";
}

function getOrderStatusTone(status?: string): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "filled":
      return "success";
    case "partially_filled":
    case "stopped":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}

function getOrderRemainingQuantity(order: PaperOrder) {
  if (typeof order.remaining_quantity === "number") {
    return order.remaining_quantity;
  }
  return Math.max(0, (order.requested_quantity ?? order.quantity) - order.quantity);
}

function getOrderFillCount(order: PaperOrder) {
  if (typeof order.fill_count === "number") {
    return order.fill_count;
  }
  return order.quantity > 0 ? 1 : 0;
}

export function RunDetailRouteView({ runId }: RunDetailRouteViewProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("report");
  const [stopArmed, setStopArmed] = useState(false);
  const runQuery = useSimulationRunQuery(runId);
  const stopRunMutation = useStopSimulationRunMutation();
  const createRunMutation = useCreateSimulationRunMutation();
  const detailQuery = useSelectedSessionDetailQuery(runQuery.data?.session_id, {
    audit_limit: 50,
    audit_offset: 0,
  });
  const ordersQuery = usePaperOrdersQuery(
    runQuery.data?.session_id
      ? {
          limit: 50,
          offset: 0,
          session_id: runQuery.data.session_id,
        }
      : {},
    { enabled: Boolean(runQuery.data?.session_id) },
  );

  const run = runQuery.data;
  const report = detailQuery.data?.report;
  const metrics =
    run?.metrics_snapshot ??
    (report
      ? {
          fees_paid: report.fees_paid,
          fill_ratio: report.fill_ratio,
          filled_orders: report.filled_orders,
          average_slippage_bps: report.average_slippage_bps,
          max_drawdown: report.max_drawdown,
          realized_pnl: report.realized_pnl,
          rejected_signals: report.rejected_signals,
          slippage_cost: report.slippage_cost,
          stopped_orders: report.stopped_orders,
          cancel_rate: report.cancel_rate,
          total_pnl: report.total_pnl,
          unrealized_pnl: report.unrealized_pnl,
        }
      : undefined);
  const timeline = detailQuery.data?.timeline ?? report?.timeline ?? [];
  const events = detailQuery.data?.events ?? [];
  const orders = ordersQuery.data ?? [];
  const chartOption =
    timeline.length > 0
      ? createTimelineAreaOption(toTimelineChartPoints(timeline))
      : undefined;

  if (!runId) {
    return (
      <EmptyState
        eyebrow="Run detail"
        title="Run ID is missing"
        description="Select a run from the queue first."
      />
    );
  }

  if (runQuery.isLoading) {
    return (
      <EmptyState
        eyebrow="Run detail"
        title="Loading simulation run"
        description="Resolving run metadata and session-scoped detail."
      />
    );
  }

  if (!run) {
    return (
      <EmptyState
        eyebrow="Run detail"
        title="Run not found"
        description={formatOperatorErrorMessage(
          runQuery.error,
          "The requested run could not be loaded.",
        )}
      />
    );
  }

  const headerTone =
    run.status === "failed" || run.status === "stopped"
      ? "warning"
      : run.status === "running" || run.status === "starting"
        ? "accent"
        : "soft";

  async function handleStopRun(resolvedRunId: string) {
    if (!stopArmed) {
      setStopArmed(true);
      return;
    }

    await stopRunMutation.mutateAsync(resolvedRunId);
    setStopArmed(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone={headerTone}
        eyebrow="Simulation run"
        title={run.run_id}
        description="Mỗi run giữ nguyên liên kết với một paper session để report, audit và timeline luôn khớp với snapshot đã lưu."
        actions={
          <>
            {isActiveRunStatus(run.status) ? (
              <>
                <Button
                  tone={stopArmed ? "danger" : "secondary"}
                  onClick={() => {
                    void handleStopRun(run.run_id);
                  }}
                  disabled={stopRunMutation.isPending}
                >
                  {stopRunMutation.isPending
                    ? "Stopping"
                    : stopArmed
                      ? "Confirm stop"
                      : "Stop run"}
                </Button>
                {stopArmed ? (
                  <Button
                    tone="ghost"
                    onClick={() => setStopArmed(false)}
                    disabled={stopRunMutation.isPending}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              tone="primary"
              onClick={async () => {
                try {
                  const nextRun = await createRunMutation.mutateAsync({
                    bot_id: run.bot_id,
                    bot_version: run.bot_version,
                    scenario_id: run.scenario_id,
                    bot_config: run.config_snapshot,
                    execution_profile: run.execution_profile_snapshot,
                  });
                  navigate(`/runs/${nextRun.run_id}`);
                } catch {
                  // Keep the current detail page visible when clone creation fails.
                }
              }}
              disabled={createRunMutation.isPending}
            >
              Clone run
            </Button>
            <Button tone="secondary" onClick={() => navigate("/runs")}>
              Back to runs
            </Button>
            {run.experiment_id ? (
              <Button
                tone="ghost"
                onClick={() =>
                  navigate(
                    `/experiments/${encodeURIComponent(run.experiment_id!)}`,
                  )
                }
              >
                Open experiment
              </Button>
            ) : null}
            <Button
              tone="ghost"
              onClick={() =>
                navigate(`/sessions/${encodeURIComponent(run.session_id)}`)
              }
            >
              Open session detail
            </Button>
          </>
        }
        aside={
          <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getRunStatusTone(run.status)}>
                {formatRunStatus(run.status)}
              </Badge>
              <Badge tone={run.experiment_id ? "warning" : "info"}>
                {run.experiment_id ? "Experiment child" : "Standalone"}
              </Badge>
            </div>
            <div className="mt-4 text-sm text-slate-300">
              {run.experiment_id
                ? `Run này thuộc batch ${run.experiment_id}. Aggregate compare vẫn nằm ở experiment detail, còn report chi tiết của child run nằm tại đây.`
                : "Run này là standalone benchmark. Nếu completed, nó mới đủ điều kiện xuất hiện trên leaderboard chung."}
            </div>
          </div>
        }
        meta={[
          { label: "Bot", value: `${run.bot_name} · ${run.bot_version}` },
          { label: "Scenario", value: run.scenario_id },
          { label: "Session", value: run.session_id },
          { label: "Experiment", value: run.experiment_id || "Standalone" },
        ]}
      />

      <SummaryStrip
        items={[
          {
            badge: <Badge tone={getRunStatusTone(run.status)}>{formatRunStatus(run.status)}</Badge>,
            label: "Status",
            meta: run.error_message || `Updated ${formatDateTime(run.updated_at)}`,
            tone:
              run.status === "failed"
                ? "warning"
                : run.status === "running"
                  ? "success"
                  : "neutral",
            value: formatRunStatus(run.status),
          },
          {
            badge: <Badge tone="info">Execution</Badge>,
            label: "Filled orders",
            meta: `${formatInteger(metrics?.rejected_signals ?? 0)} rejected · ${formatInteger(metrics?.stopped_orders ?? 0)} stopped`,
            tone: "accent",
            value: formatInteger(metrics?.filled_orders ?? 0),
          },
          {
            badge: <Badge tone={(metrics?.total_pnl ?? 0) >= 0 ? "success" : "warning"}>PnL</Badge>,
            label: "Total PnL",
            meta: `Realized ${formatCurrency(metrics?.realized_pnl ?? 0)}`,
            tone: (metrics?.total_pnl ?? 0) >= 0 ? "success" : "warning",
            value: formatSignedCurrency(metrics?.total_pnl ?? 0),
          },
          {
            badge: <Badge tone="neutral">Quality</Badge>,
            label: "Fill quality",
            meta: `Avg slippage ${formatBps(metrics?.average_slippage_bps)} · cancel ${formatPercentRatio(metrics?.cancel_rate)}`,
            tone: "neutral",
            value: formatPercentRatio(metrics?.fill_ratio),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {chartOption ? (
          <ChartPanel
            eyebrow="Equity replay"
            title="Session timeline"
            description="Run detail reuses the session snapshot timeline so charts stay consistent with the core simulator report."
            chart={{
              option: chartOption,
              className: "h-[320px]",
            }}
            footer={
              <>
                <span>{formatInteger(timeline.length)} points</span>
                <span>Current status: {formatRunStatus(run.status)}</span>
              </>
            }
          />
        ) : (
          <Panel
            eyebrow="Equity replay"
            title="Session timeline"
            description="Older or still-initializing runs can render safely before timeline points exist."
          >
            <EmptyState
              title="No timeline stored yet"
              description="The linked paper session has not written any timeline points yet."
            />
          </Panel>
        )}

        <Panel
          eyebrow="Run config"
          title="Run snapshots"
          description="Giữ quick-scan ở trên, còn snapshot chi tiết chỉ mở khi cần đối soát."
        >
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={getRunStatusTone(run.status)}>
                {formatRunStatus(run.status)}
              </Badge>
              <span className="text-sm text-slate-400">
                Updated {formatDateTime(run.updated_at)}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Ownership
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  {run.experiment_id
                    ? `Child of ${run.experiment_id}`
                    : "Standalone"}
                </div>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Execution
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  {formatCurrency(
                    run.execution_profile_snapshot.initial_balance,
                  )}{" "}
                  · fee {run.execution_profile_snapshot.fee_rate}
                </div>
              </div>
            </div>
            <DisclosurePanel
              label="Bot config snapshot"
              contentClassName="space-y-3"
            >
              <dl className="grid gap-3">
                {Object.entries(run.config_snapshot).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3"
                  >
                    <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {key}
                    </dt>
                    <dd className="mt-2 text-sm text-slate-200">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </DisclosurePanel>
            <DisclosurePanel
              label="Execution and market snapshot"
              contentClassName="space-y-3"
            >
              <dl className="grid gap-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Initial balance
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {formatCurrency(
                      run.execution_profile_snapshot.initial_balance,
                    )}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Fee / slippage
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {run.execution_profile_snapshot.fee_rate} /{" "}
                    {run.execution_profile_snapshot.slippage_rate}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Allowed symbols
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {(
                      run.execution_profile_snapshot.risk_controls
                        .allowed_symbols ?? []
                    ).join(", ") || "All symbols"}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Market microstructure
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    latency {run.market_profile_snapshot.signal_latency_ticks}{" "}
                    ticks · spread {run.market_profile_snapshot.spread_bps} bps
                    · cap{" "}
                    {run.market_profile_snapshot.max_fill_notional_per_tick}
                  </dd>
                </div>
              </dl>
            </DisclosurePanel>
            {run.stopped_reason ? (
              <div className="rounded-[20px] border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100">
                Stop reason: {run.stopped_reason}
              </div>
            ) : null}
            {stopArmed ? (
              <div className="rounded-[20px] border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100">
                Confirm stop to halt this run and stop the linked paper session.
              </div>
            ) : null}
            <Link
              to={`/sessions/${encodeURIComponent(run.session_id)}`}
              className="text-sm font-medium text-sky-200 hover:text-sky-100"
            >
              Open the linked session detail
            </Link>
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Review"
        title="Run detail tabs"
        description="Tách report, audit và context để phần dưới chỉ mở đúng thứ anh đang đối soát."
      >
        <SectionTabs
          label="Run detail tabs"
          tabs={[
            { value: "report", label: "Report" },
            { value: "orders", label: "Orders", badge: <Badge tone="neutral">{formatInteger(orders.length)}</Badge> },
            { value: "audit", label: "Audit", badge: <Badge tone="neutral">{formatInteger(events.length)}</Badge> },
            { value: "context", label: "Context" },
          ]}
          value={activeTab}
          onValueChange={setActiveTab}
        />

        <SectionTabPanel activeValue={activeTab} className="mt-5" value="report">
          <DataTable
            caption="Symbol outcomes"
            columns={[
              {
                key: "symbol",
                header: "Symbol",
                cell: (item) => item.symbol,
              },
              {
                key: "orders",
                header: "Filled orders",
                cell: (item) => formatInteger(item.filled_orders),
                align: "right",
              },
              {
                key: "fees",
                header: "Fees paid",
                cell: (item) => formatCurrency(item.fees_paid),
                align: "right",
              },
            ]}
            rows={report?.symbols ?? []}
            getRowId={(item) => item.symbol}
            emptyTitle={
              detailQuery.isLoading ? "Loading symbol report" : "No symbol report yet"
            }
            emptyDescription="Filled orders will appear here once the run has executed signals."
          />
        </SectionTabPanel>

        <SectionTabPanel activeValue={activeTab} className="mt-5" value="orders">
          <DataTable
            caption="Run orders"
            columns={[
              {
                key: "executed_at",
                header: "Time",
                cell: (order) => formatDateTime(order.executed_at),
              },
              {
                key: "symbol",
                header: "Symbol",
                cell: (order) => order.symbol,
              },
              {
                key: "side",
                header: "Side",
                cell: (order) => (
                  <Badge tone={order.side === "buy" ? "success" : "danger"}>
                    {order.side}
                  </Badge>
                ),
              },
              {
                key: "filled",
                header: "Filled",
                cell: (order) => (
                  <span className="inline-flex flex-col gap-1">
                    <span>{formatDecimal(order.quantity)}</span>
                    {(order.requested_quantity ?? 0) > order.quantity ? (
                      <span className="text-xs text-slate-500">
                        of {formatDecimal(order.requested_quantity)}
                      </span>
                    ) : null}
                  </span>
                ),
                align: "right",
              },
              {
                key: "execution",
                header: "Execution",
                className: "min-w-[220px]",
                cell: (order) => {
                  const fillCount = getOrderFillCount(order);
                  return (
                    <span className="inline-flex flex-col items-start gap-1.5">
                      <Badge tone={getOrderStatusTone(order.status)}>
                        {formatOrderStatusLabel(order.status)}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {formatInteger(fillCount)} {fillCount === 1 ? "fill" : "fills"} ·{" "}
                        {formatDecimal(getOrderRemainingQuantity(order))} remaining
                      </span>
                      {order.terminal_reason ? (
                        <span className="text-xs text-slate-400">
                          {formatOrderStatusLabel(order.terminal_reason)}
                        </span>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                key: "price",
                header: "Avg price",
                cell: (order) => formatCurrency(order.price),
                align: "right",
              },
              {
                key: "fee",
                header: "Fee",
                cell: (order) => formatCurrency(order.fee),
                align: "right",
              },
            ]}
            rows={orders}
            getRowId={(order) => `${order.session_id ?? run.session_id}:${order.id}`}
            emptyTitle={ordersQuery.isLoading ? "Loading run orders" : "No orders stored"}
            emptyDescription="Session-scoped orders will appear here after the run fills or partially fills signals."
          />
        </SectionTabPanel>

        <SectionTabPanel activeValue={activeTab} className="mt-5" value="audit">
          <DataTable
            caption="Run audit trail"
            columns={[
              {
                key: "type",
                header: "Type",
                cell: (event) => event.type,
              },
              {
                key: "message",
                header: "Message",
                cell: (event) => event.message,
              },
              {
                key: "symbol",
                header: "Symbol",
                cell: (event) => event.symbol || "-",
              },
              {
                key: "timestamp",
                header: "Timestamp",
                cell: (event) => formatDateTime(event.timestamp),
                align: "right",
              },
            ]}
            rows={events}
            getRowId={(event) => event.id}
            emptyTitle={
              detailQuery.isLoading ? "Loading audit trail" : "No audit events"
            }
            emptyDescription="The linked paper session has not stored audit events yet."
          />
        </SectionTabPanel>

        <SectionTabPanel activeValue={activeTab} className="mt-5" value="context">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Ownership</div>
              <div className="mt-2 text-sm font-medium text-white">
                {run.experiment_id ? `Child of ${run.experiment_id}` : "Standalone"}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {run.experiment_id
                  ? "Aggregate compare vẫn nằm ở experiment detail."
                  : "Completed standalone run mới có thể lên leaderboard."}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Linked session</div>
              <div className="mt-2 text-sm font-medium text-white">{run.session_id}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Report, audit và timeline đều đọc từ session snapshot đã lưu của run này.
              </p>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Stop reason</div>
              <div className="mt-2 text-sm font-medium text-white">{run.stopped_reason || "Not stopped"}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Use the snapshot disclosures above when cần đối chiếu config và market profile.
              </p>
            </div>
          </div>
        </SectionTabPanel>
      </Panel>
    </div>
  );
}
