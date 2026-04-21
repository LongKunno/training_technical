import { Link, useNavigate } from "react-router-dom";

import { ChartPanel, createTimelineAreaOption } from "../../shared/charts";
import {
  useCreateSimulationRunMutation,
  useSelectedSessionDetailQuery,
  useSimulationRunQuery,
  useStopSimulationRunMutation,
} from "../../shared/query";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
} from "../../shared/ui";
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
  isActiveRunStatus,
  toTimelineChartPoints,
} from "./formatters";

interface RunDetailRouteViewProps {
  runId: string;
}

export function RunDetailRouteView({ runId }: RunDetailRouteViewProps) {
  const navigate = useNavigate();
  const runQuery = useSimulationRunQuery(runId);
  const stopRunMutation = useStopSimulationRunMutation();
  const createRunMutation = useCreateSimulationRunMutation();
  const detailQuery = useSelectedSessionDetailQuery(runQuery.data?.session_id, {
    audit_limit: 50,
    audit_offset: 0,
  });

  const run = runQuery.data;
  const report = detailQuery.data?.report;
  const metrics = run?.metrics_snapshot ?? (report
    ? {
        fees_paid: report.fees_paid,
        filled_orders: report.filled_orders,
        max_drawdown: report.max_drawdown,
        realized_pnl: report.realized_pnl,
        rejected_signals: report.rejected_signals,
        slippage_cost: report.slippage_cost,
        total_pnl: report.total_pnl,
        unrealized_pnl: report.unrealized_pnl,
      }
    : undefined);
  const timeline = detailQuery.data?.timeline ?? report?.timeline ?? [];
  const events = detailQuery.data?.events ?? [];
  const chartOption =
    timeline.length > 0 ? createTimelineAreaOption(toTimelineChartPoints(timeline)) : undefined;

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
        description={runQuery.error instanceof Error ? runQuery.error.message : "The requested run could not be loaded."}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Simulation run"
        title={run.run_id}
        description="Run detail stays tied to one paper session so product-level run metadata and simulator-native report/audit/timeline data remain aligned."
        actions={
          <>
            {isActiveRunStatus(run.status) ? (
              <Button
                tone="danger"
                onClick={() => stopRunMutation.mutate(run.run_id)}
                disabled={stopRunMutation.isPending}
              >
                Stop run
              </Button>
            ) : null}
            <Button
              tone="primary"
              onClick={() =>
                createRunMutation
                  .mutateAsync({
                    bot_id: run.bot_id,
                    bot_version: run.bot_version,
                    scenario_id: run.scenario_id,
                    bot_config: run.config_snapshot,
                    execution_profile: run.execution_profile_snapshot,
                  })
                  .then((nextRun) => navigate(`/runs/${nextRun.run_id}`))
              }
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
                onClick={() => navigate(`/experiments/${encodeURIComponent(run.experiment_id!)}`)}
              >
                Open experiment
              </Button>
            ) : null}
            <Button tone="ghost" onClick={() => navigate(`/sessions/${encodeURIComponent(run.session_id)}`)}>
              Open session detail
            </Button>
          </>
        }
        meta={[
          { label: "Bot", value: `${run.bot_name} · ${run.bot_version}` },
          { label: "Scenario", value: run.scenario_id },
          { label: "Session", value: run.session_id },
          { label: "Experiment", value: run.experiment_id || "Standalone" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Status"
          value={formatRunStatus(run.status)}
          detail={run.error_message || `Updated ${formatDateTime(run.updated_at)}`}
          tone={run.status === "failed" ? "warning" : run.status === "running" ? "success" : "neutral"}
        />
        <StatCard
          label="Filled orders"
          value={formatInteger(metrics?.filled_orders ?? 0)}
          detail={`${formatInteger(metrics?.rejected_signals ?? 0)} rejected signals`}
          tone="accent"
        />
        <StatCard
          label="Total PnL"
          value={formatSignedCurrency(metrics?.total_pnl ?? 0)}
          detail={`Realized ${formatCurrency(metrics?.realized_pnl ?? 0)}`}
          tone={(metrics?.total_pnl ?? 0) >= 0 ? "success" : "warning"}
        />
        <StatCard
          label="Timeline points"
          value={formatInteger(timeline.length)}
          detail={`Started ${formatDateTime(run.started_at)}`}
          tone="neutral"
        />
      </div>

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
          title="Experiment snapshots"
          description="Bot config and execution profile are persisted with the run so the experiment can be replayed exactly."
        >
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={getRunStatusTone(run.status)}>{formatRunStatus(run.status)}</Badge>
              <span className="text-sm text-slate-400">Updated {formatDateTime(run.updated_at)}</span>
            </div>
            <div className="grid gap-3">
              <div className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Bot config snapshot
              </div>
              <dl className="grid gap-3">
                {Object.entries(run.config_snapshot).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3"
                  >
                    <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {key}
                    </dt>
                    <dd className="mt-2 text-sm text-slate-200">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="grid gap-3">
              <div className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Execution and market snapshot
              </div>
              <dl className="grid gap-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Initial balance
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {formatCurrency(run.execution_profile_snapshot.initial_balance)}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Fee / slippage
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {run.execution_profile_snapshot.fee_rate} / {run.execution_profile_snapshot.slippage_rate}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Allowed symbols
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    {(run.execution_profile_snapshot.risk_controls.allowed_symbols ?? []).join(", ") || "All symbols"}
                  </dd>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <dt className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Market microstructure
                  </dt>
                  <dd className="mt-2 text-sm text-slate-200">
                    latency {run.market_profile_snapshot.signal_latency_ticks} ticks · spread {run.market_profile_snapshot.spread_bps} bps · cap {run.market_profile_snapshot.max_fill_notional_per_tick}
                  </dd>
                </div>
              </dl>
            </div>
            {run.stopped_reason ? (
              <div className="rounded-[20px] border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100">
                Stop reason: {run.stopped_reason}
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Audit trail"
          title="Session events"
          description="Audit remains session-scoped, so run detail inherits the same immutable event history as the paper engine."
        >
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
            emptyTitle={detailQuery.isLoading ? "Loading audit trail" : "No audit events"}
            emptyDescription="The linked paper session has not stored audit events yet."
          />
        </Panel>

        <Panel
          eyebrow="Report"
          title="Symbol outcomes"
          description="This is the same saved report data used in the historical sessions area."
        >
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
            emptyTitle={detailQuery.isLoading ? "Loading symbol report" : "No symbol report yet"}
            emptyDescription="Filled orders will appear here once the run has executed signals."
          />
        </Panel>
      </div>
    </div>
  );
}
