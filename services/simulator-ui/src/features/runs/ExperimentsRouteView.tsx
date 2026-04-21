import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useCreateSimulationExperimentMutation,
  useMarketReplayScenarioCatalogQuery,
  usePaperRulesQuery,
  useSimulationBotsQuery,
  useSimulationExperimentsQuery,
} from "../../shared/query";
import type {
  CreateExperimentRequest,
  ExecutionProfileInput,
  RiskControls,
  ScenarioCatalogEntry,
} from "../../shared/types";
import { Badge, Button, DataTable, EmptyState, Input, PageHeader, Panel, StatCard } from "../../shared/ui";
import {
  formatDateTime,
  formatRunStatus,
  formatSimulationSchedulerMessage,
  getRunStatusTone,
} from "./formatters";

type ExecutionProfileFormState = Record<
  | "initial_balance"
  | "fee_rate"
  | "slippage_rate"
  | "allowed_symbols"
  | "max_position_quantity"
  | "max_order_notional"
  | "max_daily_loss"
  | "cooldown_seconds"
  | "max_open_notional",
  string
>;

function toExecutionProfileFormState(input?: {
  initial_balance: number;
  fee_rate: number;
  slippage_rate: number;
  risk_controls: RiskControls;
}): ExecutionProfileFormState {
  return {
    initial_balance: input ? String(input.initial_balance) : "",
    fee_rate: input ? String(input.fee_rate) : "",
    slippage_rate: input ? String(input.slippage_rate) : "",
    allowed_symbols: input?.risk_controls.allowed_symbols.join(", ") ?? "",
    max_position_quantity: input ? String(input.risk_controls.max_position_quantity) : "",
    max_order_notional: input ? String(input.risk_controls.max_order_notional) : "",
    max_daily_loss: input ? String(input.risk_controls.max_daily_loss) : "",
    cooldown_seconds: input ? String(input.risk_controls.cooldown_seconds) : "",
    max_open_notional: input ? String(input.risk_controls.max_open_notional) : "",
  };
}

function buildExecutionProfilePayload(state: ExecutionProfileFormState): ExecutionProfileInput {
  return {
    initial_balance: Number.parseFloat(state.initial_balance),
    fee_rate: Number.parseFloat(state.fee_rate),
    slippage_rate: Number.parseFloat(state.slippage_rate),
    risk_controls: {
      allowed_symbols: state.allowed_symbols.split(",").map((value) => value.trim()).filter(Boolean),
      max_position_quantity: Number.parseFloat(state.max_position_quantity),
      max_order_notional: Number.parseFloat(state.max_order_notional),
      max_daily_loss: Number.parseFloat(state.max_daily_loss),
      cooldown_seconds: Number.parseInt(state.cooldown_seconds, 10),
      max_open_notional: Number.parseFloat(state.max_open_notional),
    },
  };
}

function plannedRuns(selectedBots: string[], selectedScenarios: string[], repetitions: number) {
  return selectedBots.length * selectedScenarios.length * Math.max(0, repetitions);
}

function selectedScenarioDetails(
  scenarios: ScenarioCatalogEntry[],
  selectedScenarioIds: string[],
) {
  return scenarios.filter((scenario) => selectedScenarioIds.includes(scenario.scenario_id));
}

export function ExperimentsRouteView() {
  const navigate = useNavigate();
  const botsQuery = useSimulationBotsQuery();
  const rulesQuery = usePaperRulesQuery();
  const scenariosQuery = useMarketReplayScenarioCatalogQuery();
  const experimentsQuery = useSimulationExperimentsQuery({ limit: 20, offset: 0 });
  const createExperimentMutation = useCreateSimulationExperimentMutation();

  const [name, setName] = useState("Baseline matrix");
  const [repetitions, setRepetitions] = useState("2");
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [executionProfileOverrides, setExecutionProfileOverrides] = useState<
    Partial<ExecutionProfileFormState>
  >({});

  const bots = useMemo(() => botsQuery.data ?? [], [botsQuery.data]);
  const scenarios = useMemo(() => scenariosQuery.data ?? [], [scenariosQuery.data]);
  const experiments = experimentsQuery.data ?? [];
  const executionDefaults = rulesQuery.data
    ? toExecutionProfileFormState(rulesQuery.data)
    : toExecutionProfileFormState();
  const executionProfile = {
    ...executionDefaults,
    ...executionProfileOverrides,
  };

  const totalPlannedRuns = useMemo(
    () => plannedRuns(selectedBots, selectedScenarios, Number.parseInt(repetitions, 10)),
    [repetitions, selectedBots, selectedScenarios],
  );
  const activeExperiment = experiments.find((experiment) => experiment.status === "running" || experiment.status === "starting");
  const queuedExperiments = experiments.filter((experiment) => experiment.status === "queued");
  const nextQueuedExperiment = queuedExperiments[0];
  const highlightedScenarios = selectedScenarioDetails(scenarios, selectedScenarios);
  const plannedLanePreview = useMemo(
    () =>
      selectedBots.flatMap((botId) =>
        selectedScenarios.map((scenarioId) => {
          const bot = bots.find((candidate) => candidate.bot_id === botId);
          const scenario = scenarios.find((candidate) => candidate.scenario_id === scenarioId);
          return {
            id: `${botId}-${scenarioId}`,
            botLabel: bot?.name ?? botId,
            repetitions: Number.parseInt(repetitions, 10) || 0,
            scenarioLabel: scenario?.name ?? scenarioId,
          };
        }),
      ),
    [bots, repetitions, scenarios, selectedBots, selectedScenarios],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request: CreateExperimentRequest = {
      name: name.trim(),
      bots: selectedBots.map((botId) => ({ bot_id: botId })),
      scenarios: selectedScenarios,
      repetitions: Number.parseInt(repetitions, 10),
      execution_profile: buildExecutionProfilePayload(executionProfile),
    };

    const experiment = await createExperimentMutation.mutateAsync(request);
    navigate(`/experiments/${experiment.experiment_id}`);
  }

  if (botsQuery.isLoading || scenariosQuery.isLoading) {
    return (
      <EmptyState
        eyebrow="Experiments"
        title="Loading batch workspace"
        description="Resolving bots, scenarios, and execution defaults for the experiment planner."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Batch evaluation"
        title="Sequential experiments keep the singleton paper engine benchmarkable."
        description="Plan a bot × scenario × repetition matrix, then let the coordinator launch one child run at a time while preserving exact execution-profile snapshots."
        actions={
          <>
            <Button tone="secondary" onClick={() => navigate("/runs")}>
              Open single runs
            </Button>
            <Button tone="ghost" onClick={() => navigate("/leaderboard")}>
              Open leaderboard
            </Button>
          </>
        }
        meta={[
          { label: "Bots selected", value: String(selectedBots.length) },
          { label: "Scenarios selected", value: String(selectedScenarios.length) },
          { label: "Planned runs", value: String(totalPlannedRuns) },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Scheduler owner"
          value={activeExperiment?.name ?? nextQueuedExperiment?.name ?? "Idle"}
          detail={
            activeExperiment
              ? `${formatRunStatus(activeExperiment.status)} child run is owning the engine`
              : nextQueuedExperiment
                ? `Next queued batch at position #${nextQueuedExperiment.queue_position ?? 1}`
                : "No single-run or batch workflow is currently waiting on the engine."
          }
          tone={activeExperiment || nextQueuedExperiment ? "accent" : "neutral"}
        />
        <StatCard
          label="Recent experiments"
          value={String(experiments.length)}
          detail="Persisted experiment batches in the current account."
          tone="neutral"
        />
        <StatCard
          label="Queue depth"
          value={String(queuedExperiments.length)}
          detail={
            queuedExperiments.length
              ? `${queuedExperiments[0].name} is first in line`
              : "No batch is waiting for scheduler ownership."
          }
          tone={queuedExperiments.length ? "accent" : "neutral"}
        />
        <StatCard
          label="Scenarios loaded"
          value={String(scenarios.length)}
          detail="Catalog includes microstructure assumptions used by each child run."
          tone="neutral"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="Create experiment"
          title="Launch a sequential batch"
          description="The coordinator creates child runs just in time, so the stateful paper engine never runs two bot sessions at once."
          actions={<Badge tone="info">{createExperimentMutation.isPending ? "Starting batch" : "Ready"}</Badge>}
        >
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <Input label="Experiment name" value={name} onChange={(event) => setName(event.target.value)} />
            <Input
              label="Repetitions"
              inputMode="numeric"
              value={repetitions}
              onChange={(event) => setRepetitions(event.target.value)}
            />

            <div className="grid gap-3">
              <div className="text-sm font-medium text-slate-200">Bots</div>
              <div className="grid gap-3 md:grid-cols-2">
                {bots.map((bot) => {
                  const checked = selectedBots.includes(bot.bot_id);
                  return (
                    <label
                      key={bot.bot_id}
                      className="flex items-start gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setSelectedBots((current) =>
                            event.target.checked
                              ? [...current, bot.bot_id]
                              : current.filter((value) => value !== bot.bot_id),
                          )
                        }
                      />
                      <span className="grid gap-1">
                        <span>{bot.name}</span>
                        <span className="text-xs text-slate-500">{bot.current_version}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="text-sm font-medium text-slate-200">Scenarios</div>
              <div className="grid gap-3">
                {scenarios.map((scenario) => {
                  const checked = selectedScenarios.includes(scenario.scenario_id);
                  return (
                    <label
                      key={scenario.scenario_id}
                      className="flex items-start gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setSelectedScenarios((current) =>
                            event.target.checked
                              ? [...current, scenario.scenario_id]
                              : current.filter((value) => value !== scenario.scenario_id),
                          )
                        }
                      />
                      <span className="grid gap-1">
                        <span>{scenario.name}</span>
                        <span className="text-xs text-slate-500">
                          latency {scenario.microstructure_profile.signal_latency_ticks} ticks · spread {scenario.microstructure_profile.spread_bps} bps
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label="Initial balance"
                value={executionProfile.initial_balance}
                onChange={(event) =>
                  setExecutionProfileOverrides((current) => ({ ...current, initial_balance: event.target.value }))
                }
              />
              <Input
                label="Fee rate"
                value={executionProfile.fee_rate}
                onChange={(event) =>
                  setExecutionProfileOverrides((current) => ({ ...current, fee_rate: event.target.value }))
                }
              />
              <Input
                label="Slippage rate"
                value={executionProfile.slippage_rate}
                onChange={(event) =>
                  setExecutionProfileOverrides((current) => ({ ...current, slippage_rate: event.target.value }))
                }
              />
            </div>

            <Button
              tone="primary"
              type="submit"
              disabled={createExperimentMutation.isPending || totalPlannedRuns <= 0}
            >
              Start experiment
            </Button>
            {createExperimentMutation.error instanceof Error ? (
              <div className="rounded-[20px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-3 text-sm text-rose-100">
                {formatSimulationSchedulerMessage(createExperimentMutation.error, "experiment")}
              </div>
            ) : null}
          </form>
        </Panel>

        <Panel
          eyebrow="Benchmark context"
          title="Planned lanes and scenario profiles"
          description="Preview the exact bot × scenario lanes before launch, then read each result against the persisted market metadata captured for that lane."
        >
          {plannedLanePreview.length ? (
            <div className="grid gap-5">
              <div className="grid gap-3">
                {plannedLanePreview.map((lane) => (
                  <div
                    key={lane.id}
                    className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="text-sm font-medium text-slate-100">{lane.botLabel}</div>
                    <div className="mt-1 text-sm text-slate-400">{lane.scenarioLabel}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {lane.repetitions} repetitions scheduled for this lane
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
              {highlightedScenarios.map((scenario) => (
                <div
                  key={scenario.scenario_id}
                  className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3"
                >
                  <div className="text-sm font-medium text-slate-100">{scenario.name}</div>
                  <div className="mt-2 text-sm text-slate-400">{scenario.description}</div>
                  <div className="mt-3 text-xs text-slate-500">
                    latency {scenario.microstructure_profile.signal_latency_ticks} ticks · spread {scenario.microstructure_profile.spread_bps} bps · cap {scenario.microstructure_profile.max_fill_notional_per_tick} per tick
                  </div>
                </div>
              ))}
              </div>
            </div>
          ) : (
            <EmptyState
              eyebrow="Lane preview"
              title="Choose bots and scenarios first"
              description="The batch planner will preview each lane and its deterministic market assumptions here before launch."
            />
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="Recent batches"
        title="Persisted experiments"
        description="Recent experiments stay separate from the single-run queue and keep their own aggregate comparison surface."
      >
        <DataTable
          caption="Simulation experiments"
          columns={[
            {
              key: "name",
              header: "Experiment",
              cell: (experiment) => (
                <div className="grid gap-1">
                  <Link className="text-sm font-medium text-cyan-300" to={`/experiments/${experiment.experiment_id}`}>
                    {experiment.name}
                  </Link>
                  <span className="text-xs text-slate-500">{experiment.experiment_id}</span>
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (experiment) => (
                <Badge tone={getRunStatusTone(experiment.status)}>
                  {formatRunStatus(experiment.status)}
                </Badge>
              ),
            },
            {
              key: "queue",
              header: "Queue",
              cell: (experiment) =>
                experiment.status === "queued"
                  ? `#${experiment.queue_position ?? 1}`
                  : experiment.active_run_id
                    ? "Owning engine"
                    : "-",
            },
            {
              key: "progress",
              header: "Progress",
              cell: (experiment) =>
                `${experiment.completed_runs + experiment.failed_runs + experiment.stopped_runs}/${experiment.planned_runs}`,
            },
            {
              key: "updated_at",
              header: "Updated",
              cell: (experiment) => formatDateTime(experiment.updated_at),
            },
          ]}
          rows={experiments}
          getRowId={(experiment) => experiment.experiment_id}
          emptyTitle={experimentsQuery.isLoading ? "Loading experiments" : "No experiments yet"}
          emptyDescription="Create a batch experiment to persist the first matrix run."
        />
      </Panel>
    </div>
  );
}
