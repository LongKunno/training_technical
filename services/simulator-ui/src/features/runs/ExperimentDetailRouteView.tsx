import { Link, useNavigate } from "react-router-dom";

import {
  useSimulationExperimentQuery,
  useSimulationExperimentSummaryQuery,
  useStopSimulationExperimentMutation,
} from "../../shared/query";
import { Badge, Button, DataTable, EmptyState, PageHeader, Panel, StatCard } from "../../shared/ui";
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
} from "./formatters";

interface ExperimentDetailRouteViewProps {
  experimentId: string;
}

export function ExperimentDetailRouteView({ experimentId }: ExperimentDetailRouteViewProps) {
  const navigate = useNavigate();
  const experimentQuery = useSimulationExperimentQuery(experimentId);
  const summaryQuery = useSimulationExperimentSummaryQuery(experimentId);
  const stopMutation = useStopSimulationExperimentMutation();

  const experiment = experimentQuery.data;
  const rows = summaryQuery.data ?? [];

  if (!experimentId) {
    return (
      <EmptyState
        eyebrow="Experiment detail"
        title="Experiment ID is missing"
        description="Open a batch experiment from the experiments workspace first."
      />
    );
  }

  if (experimentQuery.isLoading) {
    return (
      <EmptyState
        eyebrow="Experiment detail"
        title="Loading experiment"
        description="Resolving progress, child runs, and aggregate summary."
      />
    );
  }

  if (!experiment) {
    return (
      <EmptyState
        eyebrow="Experiment detail"
        title="Experiment not found"
        description={experimentQuery.error instanceof Error ? experimentQuery.error.message : "The requested experiment could not be loaded."}
      />
    );
  }

  const finishedRuns = experiment.completed_runs + experiment.failed_runs + experiment.stopped_runs;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Experiment detail"
        title={experiment.name}
        description="Batch evaluation stays sequential and stateful: one child run at a time, each with its own persisted run detail, then aggregate comparison on top."
        actions={
          <>
            {(experiment.status === "queued" || experiment.status === "running" || experiment.status === "starting") ? (
              <Button
                tone="danger"
                onClick={() => stopMutation.mutate(experiment.experiment_id)}
                disabled={stopMutation.isPending}
              >
                Stop experiment
              </Button>
            ) : null}
            <Button tone="secondary" onClick={() => navigate("/experiments")}>
              Back to experiments
            </Button>
          </>
        }
        meta={[
          { label: "Experiment ID", value: experiment.experiment_id },
          {
            label: experiment.status === "queued" ? "Queue position" : "Active run",
            value: experiment.status === "queued" ? `#${experiment.queue_position ?? 1}` : experiment.active_run_id || "None",
          },
          { label: "Updated", value: formatDateTime(experiment.updated_at) },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Status"
          value={formatRunStatus(experiment.status)}
          detail={
            experiment.error_message
              || (
                experiment.status === "queued"
                  ? `Waiting at queue position #${experiment.queue_position ?? 1}`
                  : `Started ${experiment.started_at ? formatDateTime(experiment.started_at) : "not yet"}`
              )
          }
          tone={experiment.status === "failed" ? "warning" : experiment.status === "running" || experiment.status === "queued" ? "accent" : "neutral"}
        />
        <StatCard
          label="Progress"
          value={`${finishedRuns}/${experiment.planned_runs}`}
          detail={
            experiment.status === "queued"
              ? "Scheduler has not started the first child run yet."
              : `${formatInteger(experiment.current_index)} slots advanced`
          }
          tone="accent"
        />
        <StatCard
          label="Completed"
          value={formatInteger(experiment.completed_runs)}
          detail={`${formatInteger(experiment.failed_runs)} failed · ${formatInteger(experiment.stopped_runs)} stopped`}
          tone="neutral"
        />
        <StatCard
          label="Execution profile"
          value={formatCurrency(experiment.execution_profile_snapshot.initial_balance)}
          detail={`fee ${experiment.execution_profile_snapshot.fee_rate} · slippage ${experiment.execution_profile_snapshot.slippage_rate}`}
          tone="neutral"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="Aggregate compare"
          title="Summary by bot, version, and scenario"
          description="The experiment summary groups child runs by execution lane so deterministic matrices can be compared without polluting the global leaderboard."
        >
          <DataTable
            caption="Experiment summary"
            columns={[
              {
                key: "lane",
                header: "Lane",
                cell: (row) => (
                  <div className="grid gap-1">
                    <span className="font-medium text-slate-100">{row.bot_id}</span>
                    <span className="text-xs text-slate-500">{row.bot_version} · {row.scenario_id}</span>
                  </div>
                ),
              },
              {
                key: "scheduled",
                header: "Scheduled",
                cell: (row) => formatInteger(row.scheduled_runs),
                align: "right",
              },
              {
                key: "completed",
                header: "Completed",
                cell: (row) => formatInteger(row.completed_runs),
                align: "right",
              },
              {
                key: "failed",
                header: "Failed",
                cell: (row) => formatInteger(row.failed_runs),
                align: "right",
              },
              {
                key: "stopped",
                header: "Stopped",
                cell: (row) => formatInteger(row.stopped_runs),
                align: "right",
              },
              {
                key: "avg_total_pnl",
                header: "Avg PnL",
                cell: (row) => formatSignedCurrency(row.avg_total_pnl),
                align: "right",
              },
              {
                key: "best_total_pnl",
                header: "Best",
                cell: (row) => formatSignedCurrency(row.best_total_pnl),
                align: "right",
              },
              {
                key: "worst_total_pnl",
                header: "Worst",
                cell: (row) => formatSignedCurrency(row.worst_total_pnl),
                align: "right",
              },
              {
                key: "avg_max_drawdown",
                header: "Avg DD",
                cell: (row) => formatCurrency(row.avg_max_drawdown),
                align: "right",
              },
            ]}
            rows={rows}
            getRowId={(row) => `${row.bot_id}-${row.bot_version}-${row.scenario_id}`}
            emptyTitle={summaryQuery.isLoading ? "Loading summary" : "No summary yet"}
            emptyDescription="Aggregate rows appear after the experiment has at least one planned lane."
          />
        </Panel>

        <Panel
          eyebrow="Active lane"
          title="Current child run"
          description="Each experiment only owns one child run at a time because the underlying paper engine remains singleton and stateful."
        >
          {experiment.status === "queued" ? (
            <div className="grid gap-3">
              <Badge tone="info">Queued #{experiment.queue_position ?? 1}</Badge>
              <div className="text-sm text-slate-400">
                This batch is waiting for the singleton engine to free up before the first child run is created.
              </div>
            </div>
          ) : experiment.active_run_id ? (
            <div className="grid gap-3">
              <Badge tone="info">Running</Badge>
              <Link className="text-sm font-medium text-cyan-300" to={`/runs/${experiment.active_run_id}`}>
                Open active run
              </Link>
            </div>
          ) : (
            <EmptyState
              eyebrow="Current child"
              title="No active child run"
              description="The experiment is either waiting to start, already terminal, or between child runs."
            />
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="Child runs"
        title="Completed and active children"
        description="Each child run still owns its immutable run/session detail, including the market microstructure snapshot captured at launch."
      >
        <DataTable
          caption="Experiment child runs"
          columns={[
            {
              key: "run_id",
              header: "Run",
              cell: (run) => (
                <div className="grid gap-1">
                  <Link className="font-medium text-cyan-300" to={`/runs/${run.run_id}`}>
                    {run.run_id}
                  </Link>
                  <span className="text-xs text-slate-500">{run.bot_name} · {run.bot_version}</span>
                </div>
              ),
            },
            {
              key: "scenario",
              header: "Scenario",
              cell: (run) => run.scenario_id,
            },
            {
              key: "status",
              header: "Status",
              cell: (run) => (
                <Badge tone={getRunStatusTone(run.status)}>
                  {formatRunStatus(run.status)}
                </Badge>
              ),
            },
            {
              key: "started_at",
              header: "Started",
              cell: (run) => formatDateTime(run.started_at),
            },
          ]}
          rows={experiment.runs ?? []}
          getRowId={(run) => run.run_id}
          emptyTitle={experiment.status === "queued" ? "No child runs started yet" : "No child runs yet"}
          emptyDescription={
            experiment.status === "queued"
              ? "This batch is queued, so the first child run will appear only after scheduler ownership is granted."
              : "Child runs are created just in time as the experiment advances."
          }
        />
      </Panel>
    </div>
  );
}
