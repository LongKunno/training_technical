import { useDeferredValue, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import {
  useSimulationExperimentQuery,
  useSimulationExperimentSummaryQuery,
  useStopSimulationExperimentMutation,
} from "../../shared/query";
import type {
  ExperimentSummaryRow,
  RunStatus,
  RunSummary,
} from "../../shared/types";
import {
  Badge,
  Button,
  DataTable,
  DisclosurePanel,
  DownloadIcon,
  EmptyState,
  PageHeader,
  Panel,
  ProgressBar,
  SearchInput,
  Select,
  StatCard,
} from "../../shared/ui";
import {
  formatBps,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercentRatio,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
} from "./formatters";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const SUMMARY_SORT_OPTIONS = [
  { label: "Avg PnL", value: "avg_pnl_desc" },
  { label: "Confidence", value: "confidence_asc" },
  { label: "Coverage", value: "coverage_desc" },
  { label: "Fill ratio", value: "fill_ratio_desc" },
  { label: "Failure rate", value: "failure_rate_asc" },
  { label: "Avg drawdown", value: "drawdown_asc" },
  { label: "Lane", value: "lane_asc" },
] as const;

const CHILD_RUN_SORT_OPTIONS = [
  { label: "Started (newest)", value: "started_desc" },
  { label: "Started (oldest)", value: "started_asc" },
  { label: "Status", value: "status_asc" },
  { label: "Run ID", value: "run_asc" },
] as const;

const CHILD_RUN_STATUS_OPTIONS: Array<{
  label: string;
  value: RunStatus | "";
}> = [
  { label: "All statuses", value: "" },
  { label: "Starting", value: "starting" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
  { label: "Failed", value: "failed" },
];

type SummarySortOrder = (typeof SUMMARY_SORT_OPTIONS)[number]["value"];
type ChildRunSortOrder = (typeof CHILD_RUN_SORT_OPTIONS)[number]["value"];

const SUMMARY_EXPORT_COLUMNS: Array<{
  header: string;
  value: (row: ExperimentSummaryRow) => number | string | undefined;
}> = [
  { header: "bot_id", value: (row) => row.bot_id },
  { header: "bot_version", value: (row) => row.bot_version },
  { header: "scenario_id", value: (row) => row.scenario_id },
  { header: "scheduled_runs", value: (row) => row.scheduled_runs },
  { header: "completed_runs", value: (row) => row.completed_runs },
  { header: "failed_runs", value: (row) => row.failed_runs },
  { header: "stopped_runs", value: (row) => row.stopped_runs },
  { header: "failure_rate", value: (row) => row.failure_rate ?? 0 },
  { header: "avg_total_pnl", value: (row) => row.avg_total_pnl },
  { header: "best_total_pnl", value: (row) => row.best_total_pnl },
  { header: "worst_total_pnl", value: (row) => row.worst_total_pnl },
  { header: "stddev_total_pnl", value: (row) => row.stddev_total_pnl ?? 0 },
  {
    header: "confidence_interval_95_total_pnl",
    value: (row) => row.confidence_interval_95_total_pnl ?? 0,
  },
  { header: "avg_max_drawdown", value: (row) => row.avg_max_drawdown },
  { header: "avg_fill_ratio", value: (row) => row.avg_fill_ratio ?? 0 },
  { header: "avg_slippage_bps", value: (row) => row.avg_slippage_bps ?? 0 },
  { header: "avg_cancel_rate", value: (row) => row.avg_cancel_rate ?? 0 },
];

interface ExperimentDetailRouteViewProps {
  experimentId: string;
}

function escapeCsvValue(value: number | string | undefined) {
  const rawValue = value ?? "";
  const serialized = String(rawValue);
  return /[",\n\r]/.test(serialized)
    ? `"${serialized.replace(/"/g, '""')}"`
    : serialized;
}

function toExperimentSummaryCsv(rows: ExperimentSummaryRow[]) {
  return [
    SUMMARY_EXPORT_COLUMNS.map((column) => column.header).join(","),
    ...rows.map((row) =>
      SUMMARY_EXPORT_COLUMNS.map((column) =>
        escapeCsvValue(column.value(row)),
      ).join(","),
    ),
  ].join("\n");
}

function toSafeFilePart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "experiment";
}

function saveTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getFinishedRuns(run: {
  completed_runs: number;
  failed_runs: number;
  stopped_runs: number;
}) {
  return run.completed_runs + run.failed_runs + run.stopped_runs;
}

function getCoverageRatio(row: ExperimentSummaryRow) {
  const terminalRuns = row.completed_runs + row.failed_runs + row.stopped_runs;
  return row.scheduled_runs > 0 ? terminalRuns / row.scheduled_runs : 0;
}

function getLaneHealth(row: ExperimentSummaryRow): {
  label: string;
  tone: BadgeTone;
} {
  const terminalRuns = row.completed_runs + row.failed_runs + row.stopped_runs;

  if (terminalRuns === 0) {
    return { label: "Waiting", tone: "info" };
  }

  if (row.failed_runs === row.scheduled_runs) {
    return { label: "Failed", tone: "danger" };
  }

  if (row.stopped_runs === row.scheduled_runs) {
    return { label: "Stopped", tone: "warning" };
  }

  if (
    row.completed_runs === row.scheduled_runs &&
    row.failed_runs === 0 &&
    row.stopped_runs === 0
  ) {
    return { label: "Complete", tone: "success" };
  }

  if (terminalRuns < row.scheduled_runs) {
    return { label: "In progress", tone: "info" };
  }

  if (row.failed_runs > 0 || row.stopped_runs > 0) {
    return { label: "Mixed", tone: "warning" };
  }

  return { label: "Partial", tone: "neutral" };
}

function compareSummaryRows(
  left: ExperimentSummaryRow,
  right: ExperimentSummaryRow,
  sortOrder: SummarySortOrder,
) {
  switch (sortOrder) {
    case "coverage_desc":
      return (
        getCoverageRatio(right) - getCoverageRatio(left) ||
        right.completed_runs - left.completed_runs
      );
    case "drawdown_asc":
      return left.avg_max_drawdown - right.avg_max_drawdown;
    case "fill_ratio_desc":
      return (right.avg_fill_ratio ?? 0) - (left.avg_fill_ratio ?? 0);
    case "failure_rate_asc":
      return (left.failure_rate ?? 0) - (right.failure_rate ?? 0);
    case "confidence_asc":
      return (
        (left.confidence_interval_95_total_pnl ?? 0) -
          (right.confidence_interval_95_total_pnl ?? 0) ||
        right.avg_total_pnl - left.avg_total_pnl
      );
    case "lane_asc":
      return `${left.bot_id}-${left.bot_version}-${left.scenario_id}`.localeCompare(
        `${right.bot_id}-${right.bot_version}-${right.scenario_id}`,
      );
    case "avg_pnl_desc":
    default:
      return right.avg_total_pnl - left.avg_total_pnl;
  }
}

function matchesSummaryRow(row: ExperimentSummaryRow, search: string) {
  if (!search) {
    return true;
  }

  const normalized = search.toLowerCase();
  return (
    row.bot_id.toLowerCase().includes(normalized) ||
    row.bot_version.toLowerCase().includes(normalized) ||
    row.scenario_id.toLowerCase().includes(normalized)
  );
}

function matchesChildRun(
  run: RunSummary,
  search: string,
  status: RunStatus | "",
) {
  if (status && run.status !== status) {
    return false;
  }

  if (!search) {
    return true;
  }

  const normalized = search.toLowerCase();
  return (
    run.run_id.toLowerCase().includes(normalized) ||
    run.bot_name.toLowerCase().includes(normalized) ||
    run.bot_version.toLowerCase().includes(normalized) ||
    run.scenario_id.toLowerCase().includes(normalized)
  );
}

function compareChildRuns(
  left: RunSummary,
  right: RunSummary,
  sortOrder: ChildRunSortOrder,
) {
  switch (sortOrder) {
    case "started_asc":
      return left.started_at.localeCompare(right.started_at);
    case "status_asc":
      return (
        left.status.localeCompare(right.status) ||
        right.started_at.localeCompare(left.started_at)
      );
    case "run_asc":
      return left.run_id.localeCompare(right.run_id);
    case "started_desc":
    default:
      return right.started_at.localeCompare(left.started_at);
  }
}

export function ExperimentDetailRouteView({
  experimentId,
}: ExperimentDetailRouteViewProps) {
  const navigate = useNavigate();
  const experimentQuery = useSimulationExperimentQuery(experimentId);
  const summaryQuery = useSimulationExperimentSummaryQuery(experimentId);
  const stopMutation = useStopSimulationExperimentMutation();

  const [summarySearch, setSummarySearch] = useState("");
  const [summarySortOrder, setSummarySortOrder] =
    useState<SummarySortOrder>("avg_pnl_desc");
  const [runSearch, setRunSearch] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatus | "">("");
  const [runSortOrder, setRunSortOrder] =
    useState<ChildRunSortOrder>("started_desc");
  const [stopArmed, setStopArmed] = useState(false);

  const deferredSummarySearch = useDeferredValue(summarySearch.trim());
  const deferredRunSearch = useDeferredValue(runSearch.trim());

  const experiment = experimentQuery.data;
  const rows = useMemo(() => summaryQuery.data ?? [], [summaryQuery.data]);
  const runs = useMemo(() => experiment?.runs ?? [], [experiment?.runs]);
  const filteredSummaryRows = useMemo(
    () =>
      rows
        .filter((row) => matchesSummaryRow(row, deferredSummarySearch))
        .sort((left, right) =>
          compareSummaryRows(left, right, summarySortOrder),
        ),
    [deferredSummarySearch, rows, summarySortOrder],
  );
  const filteredRuns = useMemo(
    () =>
      runs
        .filter((run) =>
          matchesChildRun(run, deferredRunSearch, runStatusFilter),
        )
        .sort((left, right) => compareChildRuns(left, right, runSortOrder)),
    [deferredRunSearch, runSortOrder, runStatusFilter, runs],
  );
  const exportBaseName = `experiment-${toSafeFilePart(experimentId)}-summary`;

  const exportSummaryCsv = () => {
    saveTextFile(
      `${exportBaseName}.csv`,
      "text/csv;charset=utf-8",
      `${toExperimentSummaryCsv(filteredSummaryRows)}\n`,
    );
  };

  const exportSummaryJson = () => {
    saveTextFile(
      `${exportBaseName}.json`,
      "application/json;charset=utf-8",
      `${JSON.stringify(
        {
          experiment_id: experimentId,
          exported_at: new Date().toISOString(),
          filters: {
            search: deferredSummarySearch,
            sort: summarySortOrder,
          },
          rows: filteredSummaryRows,
        },
        null,
        2,
      )}\n`,
    );
  };

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
        description={formatOperatorErrorMessage(
          experimentQuery.error,
          "The requested experiment could not be loaded.",
        )}
      />
    );
  }

  const finishedRuns = getFinishedRuns(experiment);
  const progressPercent = Math.round(
    (finishedRuns / Math.max(experiment.planned_runs, 1)) * 100,
  );
  const isActive =
    experiment.status === "queued" ||
    experiment.status === "running" ||
    experiment.status === "starting";
  const activeRun = runs.find((run) => run.run_id === experiment.active_run_id);
  const activeLaneLabel = activeRun
    ? `${activeRun.bot_name} · ${activeRun.scenario_id}`
    : experiment.status === "queued"
      ? `Queued #${experiment.queue_position ?? 1}`
      : "No active child";
  const headerTone =
    experiment.status === "failed" || experiment.status === "stopped"
      ? "warning"
      : experiment.status === "running" ||
          experiment.status === "starting" ||
          experiment.status === "queued"
        ? "accent"
        : "soft";
  const terminalRuns = rows.reduce(
    (total, row) =>
      total + row.completed_runs + row.failed_runs + row.stopped_runs,
    0,
  );
  async function handleStop(resolvedExperimentId: string) {
    if (!stopArmed) {
      setStopArmed(true);
      return;
    }

    await stopMutation.mutateAsync(resolvedExperimentId);
    setStopArmed(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone={headerTone}
        eyebrow="Experiment detail"
        title={experiment.name}
        description="Một child run tại một thời điểm, còn aggregate compare của cả matrix được giữ tập trung tại trang này."
        actions={
          <>
            {isActive ? (
              <>
                <Button
                  tone={stopArmed ? "danger" : "secondary"}
                  onClick={() => handleStop(experiment.experiment_id)}
                  disabled={stopMutation.isPending}
                >
                  {stopMutation.isPending
                    ? "Stopping"
                    : stopArmed
                      ? "Confirm stop"
                      : "Stop experiment"}
                </Button>
                {stopArmed ? (
                  <Button
                    tone="ghost"
                    onClick={() => setStopArmed(false)}
                    disabled={stopMutation.isPending}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button tone="secondary" onClick={() => navigate("/experiments")}>
              Back to experiments
            </Button>
          </>
        }
        aside={
          <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getRunStatusTone(experiment.status)}>
                {formatRunStatus(experiment.status)}
              </Badge>
              <Badge tone="info">Sequential only</Badge>
              {experiment.stop_requested ? (
                <Badge tone="warning">Stop requested</Badge>
              ) : null}
              {experiment.active_run_id ? (
                <Badge tone="info">Child active</Badge>
              ) : null}
            </div>
            <div className="mt-4 text-sm text-slate-300">
              {experiment.error_message
                ? experiment.error_message
                : experiment.status === "queued"
                  ? `Waiting at queue position #${experiment.queue_position ?? 1}.`
                  : experiment.active_run_id
                    ? `${activeLaneLabel} is currently holding the engine.`
                    : "No child run is active right now."}
            </div>
            <ProgressBar
              className="mt-4"
              value={finishedRuns}
              max={experiment.planned_runs}
              label="Batch progress"
              valueLabel={`${finishedRuns}/${experiment.planned_runs}`}
              tone={
                experiment.status === "failed"
                  ? "danger"
                  : experiment.status === "stopped"
                    ? "warning"
                    : experiment.status === "completed"
                      ? "success"
                      : "info"
              }
            />
            <DisclosurePanel
              className="mt-4"
              label="Batch rules"
              contentClassName="space-y-2"
            >
              <p>
                Aggregate compare của batch chỉ nằm ở experiment detail này.
                Leaderboard toàn cục không nhận row tổng hợp từ experiment.
              </p>
              <p>
                Child run được tạo just-in-time và chạy tuần tự, nên child list
                ở dưới là nguồn đọc tiến độ batch theo thời gian.
              </p>
            </DisclosurePanel>
          </div>
        }
        meta={[
          { label: "Experiment ID", value: experiment.experiment_id },
          {
            label: experiment.status === "queued" ? "Queue" : "Active lane",
            value: activeLaneLabel,
          },
          { label: "Progress", value: `${progressPercent}%` },
          { label: "Updated", value: formatDateTime(experiment.updated_at) },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Panel
          eyebrow="Current child"
          title="Batch control room"
          description="Track the current child run, slot advancement, and queue state before drilling into aggregate or per-run detail."
          tone="soft"
        >
          <div className="grid gap-5">
            <div className="grid gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-100">
                    {experiment.status === "queued"
                      ? "Waiting for engine ownership"
                      : experiment.active_run_id
                        ? activeLaneLabel
                        : "No active child run"}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-400">
                    {experiment.status === "queued"
                      ? "The first child run will be created only after the singleton engine becomes free."
                      : experiment.active_run_id
                        ? `Open ${experiment.active_run_id} to inspect immutable report, audit, and timeline data.`
                        : "This batch is either terminal or between child runs."}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={getRunStatusTone(experiment.status)}>
                    {formatRunStatus(experiment.status)}
                  </Badge>
                  {experiment.active_run_id ? (
                    <Badge tone="info">{experiment.active_run_id}</Badge>
                  ) : null}
                </div>
              </div>
              <ProgressBar
                value={finishedRuns}
                max={experiment.planned_runs}
                label="Completed slots"
                valueLabel={`${finishedRuns}/${experiment.planned_runs}`}
                tone={
                  experiment.status === "failed"
                    ? "danger"
                    : experiment.status === "stopped"
                      ? "warning"
                      : experiment.status === "completed"
                        ? "success"
                        : "info"
                }
              />
              <div className="flex flex-wrap gap-3">
                {experiment.active_run_id ? (
                  <Button
                    tone="secondary"
                    onClick={() =>
                      navigate(`/runs/${experiment.active_run_id}`)
                    }
                  >
                    Open active run
                  </Button>
                ) : null}
                <Button tone="ghost" onClick={() => navigate("/experiments")}>
                  Back to batch list
                </Button>
              </div>
              {stopArmed ? (
                <div className="rounded-[16px] border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-sm text-amber-100">
                  Confirm stop to halt this batch. If a child run is active, it
                  will be stopped first.
                </div>
              ) : null}
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <StatCard
            label="Status"
            value={formatRunStatus(experiment.status)}
            detail={
              experiment.error_message ||
              (experiment.status === "queued"
                ? `Queue position #${experiment.queue_position ?? 1}`
                : `Started ${experiment.started_at ? formatDateTime(experiment.started_at) : "not yet"}`)
            }
            tone={
              experiment.status === "failed"
                ? "danger"
                : experiment.status === "stopped"
                  ? "warning"
                  : experiment.status === "running" ||
                      experiment.status === "queued"
                    ? "accent"
                    : "neutral"
            }
          />
          <StatCard
            label="Slots advanced"
            value={`${formatInteger(experiment.current_index)}/${formatInteger(experiment.planned_runs)}`}
            detail={`${formatInteger(finishedRuns)} terminal child run(s) so far.`}
            tone="accent"
          />
          <StatCard
            label="Terminal outcomes"
            value={formatInteger(experiment.completed_runs)}
            detail={`${formatInteger(experiment.failed_runs)} failed · ${formatInteger(experiment.stopped_runs)} stopped`}
            tone={
              experiment.failed_runs > 0
                ? "danger"
                : experiment.stopped_runs > 0
                  ? "warning"
                  : "neutral"
            }
          />
          <StatCard
            label="Execution profile"
            value={formatCurrency(
              experiment.execution_profile_snapshot.initial_balance,
            )}
            detail={`fee ${experiment.execution_profile_snapshot.fee_rate} · slippage ${experiment.execution_profile_snapshot.slippage_rate}`}
            tone="neutral"
          />
        </div>
      </div>

      <Panel
        eyebrow="Aggregate compare"
        title="Summary by bot, version, and scenario"
        description="Filter and sort lane-level aggregates without polluting the global leaderboard."
        actions={
          <>
            <Button
              disabled={filteredSummaryRows.length === 0}
              leading={<DownloadIcon className="size-4" />}
              onClick={exportSummaryCsv}
              size="sm"
              tone="ghost"
            >
              Export CSV
            </Button>
            <Button
              disabled={filteredSummaryRows.length === 0}
              leading={<DownloadIcon className="size-4" />}
              onClick={exportSummaryJson}
              size="sm"
              tone="ghost"
            >
              Export JSON
            </Button>
          </>
        }
      >
        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <SearchInput
            label="Search lanes"
            value={summarySearch}
            onChange={(event) => setSummarySearch(event.target.value)}
            placeholder="Filter by bot, version, or scenario"
          />
          <Select
            label="Sort"
            value={summarySortOrder}
            options={SUMMARY_SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(event) =>
              setSummarySortOrder(event.target.value as SummarySortOrder)
            }
          />
        </div>

        <DataTable
          caption="Experiment summary"
          columns={[
            {
              key: "lane",
              header: "Lane",
              cell: (row) => {
                const laneHealth = getLaneHealth(row);
                return (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">
                        {row.bot_id}
                      </span>
                      <Badge tone={laneHealth.tone}>{laneHealth.label}</Badge>
                    </div>
                    <span className="text-xs text-slate-500">
                      {row.bot_version} · {row.scenario_id}
                    </span>
                  </div>
                );
              },
            },
            {
              key: "coverage",
              header: "Coverage",
              cell: (row) => {
                const terminalRuns =
                  row.completed_runs + row.failed_runs + row.stopped_runs;
                return (
                  <div className="min-w-[160px]">
                    <ProgressBar
                      value={terminalRuns}
                      max={row.scheduled_runs}
                      label={`${terminalRuns}/${row.scheduled_runs} terminal`}
                      valueLabel={`${Math.round(getCoverageRatio(row) * 100)}%`}
                      tone={
                        row.failed_runs > 0
                          ? "danger"
                          : row.stopped_runs > 0
                            ? "warning"
                            : row.completed_runs === row.scheduled_runs
                              ? "success"
                              : "info"
                      }
                    />
                  </div>
                );
              },
            },
            {
              key: "completed",
              header: "Completed",
              cell: (row) => formatInteger(row.completed_runs),
              align: "right",
            },
            {
              key: "failed",
              header: "Failures",
              cell: (row) => (
                <div className="text-right">
                  <div>{formatInteger(row.failed_runs)}</div>
                  <div className="text-xs text-slate-500">
                    {formatPercentRatio(row.failure_rate)}
                  </div>
                </div>
              ),
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
              key: "confidence_interval_95_total_pnl",
              header: "PnL CI",
              cell: (row) => (
                <div className="text-right">
                  <div>
                    +/-{" "}
                    {formatCurrency(
                      row.confidence_interval_95_total_pnl ?? 0,
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    stddev {formatCurrency(row.stddev_total_pnl ?? 0)}
                  </div>
                </div>
              ),
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
            {
              key: "avg_fill_ratio",
              header: "Fill ratio",
              cell: (row) => formatPercentRatio(row.avg_fill_ratio),
              align: "right",
            },
            {
              key: "avg_slippage_bps",
              header: "Slippage",
              cell: (row) => formatBps(row.avg_slippage_bps),
              align: "right",
            },
            {
              key: "avg_cancel_rate",
              header: "Cancel",
              cell: (row) => formatPercentRatio(row.avg_cancel_rate),
              align: "right",
            },
          ]}
          rows={filteredSummaryRows}
          getRowId={(row) =>
            `${row.bot_id}-${row.bot_version}-${row.scenario_id}`
          }
          emptyTitle={
            summaryQuery.isLoading
              ? "Loading summary"
              : "No matching summary rows"
          }
          emptyDescription={
            deferredSummarySearch
              ? "Try a different filter for bot, version, or scenario."
              : "Aggregate rows appear after the experiment has at least one planned lane."
          }
        />

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatCard
            label="Visible lanes"
            value={formatInteger(filteredSummaryRows.length)}
            detail={`${formatInteger(rows.length)} total lane(s) in this experiment.`}
            tone="neutral"
          />
          <StatCard
            label="Terminal lane runs"
            value={formatInteger(terminalRuns)}
            detail="Completed, failed, and stopped runs combined across visible lanes."
            tone="accent"
          />
          <StatCard
            label="Summary state"
            value={summaryQuery.isLoading ? "Loading" : "Ready"}
            detail={
              deferredSummarySearch
                ? `Filter active: ${deferredSummarySearch}`
                : "No lane-level filter is active."
            }
            tone={deferredSummarySearch ? "accent" : "neutral"}
          />
        </div>
      </Panel>

      <Panel
        eyebrow="Child runs"
        title="Completed and active children"
        description="Filter the run list, highlight the active child, and jump into immutable run detail when needed."
      >
        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
          <SearchInput
            label="Search child runs"
            value={runSearch}
            onChange={(event) => setRunSearch(event.target.value)}
            placeholder="Filter by run, bot, or scenario"
          />
          <Select
            label="Status"
            value={runStatusFilter}
            options={CHILD_RUN_STATUS_OPTIONS}
            onChange={(event) =>
              setRunStatusFilter(event.target.value as RunStatus | "")
            }
          />
          <Select
            label="Sort"
            value={runSortOrder}
            options={CHILD_RUN_SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(event) =>
              setRunSortOrder(event.target.value as ChildRunSortOrder)
            }
          />
        </div>

        <DataTable
          caption="Experiment child runs"
          columns={[
            {
              key: "run_id",
              header: "Run",
              cell: (run) => (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-medium text-cyan-300"
                      to={`/runs/${run.run_id}`}
                    >
                      {run.run_id}
                    </Link>
                    {run.run_id === experiment.active_run_id ? (
                      <Badge tone="info">Active</Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-slate-500">
                    {run.bot_name} · {run.bot_version}
                  </span>
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
            {
              key: "updated_at",
              header: "Updated",
              cell: (run) => formatDateTime(run.updated_at),
            },
          ]}
          rows={filteredRuns}
          getRowId={(run) => run.run_id}
          getRowClassName={(run) =>
            run.run_id === experiment.active_run_id
              ? "[&>td]:bg-sky-300/[0.05] [&>td]:text-slate-100"
              : undefined
          }
          emptyTitle={
            experiment.status === "queued"
              ? "No child runs started yet"
              : "No matching child runs"
          }
          emptyDescription={
            experiment.status === "queued"
              ? "This batch is queued, so the first child run will appear only after scheduler ownership is granted."
              : deferredRunSearch || runStatusFilter
                ? "Try a different child-run filter."
                : "Child runs are created just in time as the experiment advances."
          }
        />
      </Panel>
    </div>
  );
}
