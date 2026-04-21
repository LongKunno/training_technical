import { useDeferredValue, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useCreateSimulationRunMutation,
  useMarketReplayScenarioCatalogQuery,
  usePaperRulesQuery,
  useSimulationBotQuery,
  useSimulationBotsQuery,
  useSimulationRunsQuery,
} from "../../shared/query";
import type {
  BotVersion,
  CreateRunRequest,
  ExecutionProfileInput,
  RiskControls,
  RunFilter,
  ScenarioCatalogEntry,
} from "../../shared/types";
import {
  Badge,
  Button,
  DataTable,
  Input,
  PageHeader,
  Panel,
  RunsIcon,
  SearchInput,
  Select,
  StatCard,
} from "../../shared/ui";
import {
  formatDateTime,
  formatRunStatus,
  formatSimulationSchedulerMessage,
  getRunStatusTone,
} from "./formatters";

const RUN_STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Starting", value: "starting" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
  { label: "Failed", value: "failed" },
];

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

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

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

function parseConfigValue(rawValue: string, schema: Record<string, unknown> | undefined): unknown {
  const type = typeof schema?.type === "string" ? schema.type : "string";
  if (type === "integer") {
    return Number.parseInt(rawValue, 10);
  }
  if (type === "number") {
    return Number.parseFloat(rawValue);
  }
  if (type === "boolean") {
    return rawValue === "true";
  }
  return rawValue;
}

function buildBotConfigPayload(
  values: Record<string, string>,
  version: BotVersion | undefined,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const schema = (version?.config_schema ?? {}) as Record<string, Record<string, unknown>>;
  Object.entries(values).forEach(([key, rawValue]) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }
    config[key] = parseConfigValue(trimmed, schema[key]);
  });
  return config;
}

function buildExecutionProfilePayload(state: ExecutionProfileFormState): ExecutionProfileInput {
  const allowedSymbols = state.allowed_symbols
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    initial_balance: Number.parseFloat(state.initial_balance),
    fee_rate: Number.parseFloat(state.fee_rate),
    slippage_rate: Number.parseFloat(state.slippage_rate),
    risk_controls: {
      allowed_symbols: allowedSymbols,
      max_position_quantity: Number.parseFloat(state.max_position_quantity),
      max_order_notional: Number.parseFloat(state.max_order_notional),
      max_daily_loss: Number.parseFloat(state.max_daily_loss),
      cooldown_seconds: Number.parseInt(state.cooldown_seconds, 10),
      max_open_notional: Number.parseFloat(state.max_open_notional),
    },
  };
}

function findScenario(
  scenarios: ScenarioCatalogEntry[],
  scenarioId: string,
): ScenarioCatalogEntry | undefined {
  return scenarios.find((scenario) => scenario.scenario_id === scenarioId);
}

export function RunsRouteView() {
  const navigate = useNavigate();
  const botsQuery = useSimulationBotsQuery();
  const rulesQuery = usePaperRulesQuery();
  const scenariosQuery = useMarketReplayScenarioCatalogQuery();
  const createRunMutation = useCreateSimulationRunMutation();

  const [selectedBotId, setSelectedBotId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("");
  const [botConfigValues, setBotConfigValues] = useState<Record<string, string>>({});
  const [executionProfileOverrides, setExecutionProfileOverrides] = useState<
    Partial<ExecutionProfileFormState>
  >({});

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RunFilter["status"]>("");
  const [filterBotId, setFilterBotId] = useState("");
  const [filterScenarioId, setFilterScenarioId] = useState("");

  const deferredSearch = useDeferredValue(search.trim());
  const availableBots = botsQuery.data ?? [];
  const availableScenarios = scenariosQuery.data ?? [];
  const activeBotId = selectedBotId || availableBots[0]?.bot_id || "";
  const botDetailQuery = useSimulationBotQuery(activeBotId);
  const selectedBot = botDetailQuery.data;
  const selectedVersionDetail =
    selectedBot?.versions.find((version) => version.version === selectedVersion) ??
    selectedBot?.versions.find((version) => version.version === selectedBot.current_version);
  const resolvedVersion = selectedVersionDetail?.version ?? "";
  const resolvedScenario = selectedScenario || selectedBot?.default_scenario || availableScenarios[0]?.scenario_id || "";
  const selectedScenarioDetail = findScenario(availableScenarios, resolvedScenario);
  const botConfigKeys = Object.keys(selectedVersionDetail?.default_config ?? {});
  const executionProfileDefaults = rulesQuery.data
    ? toExecutionProfileFormState(rulesQuery.data)
    : toExecutionProfileFormState();
  const executionProfile: ExecutionProfileFormState = {
    ...executionProfileDefaults,
    ...executionProfileOverrides,
  };

  const runsQuery = useSimulationRunsQuery({
    limit: 20,
    offset: 0,
    q: deferredSearch,
    status,
    bot_id: filterBotId,
    scenario_id: filterScenarioId,
  });

  async function handleCreateRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeBotId || !resolvedVersion || !resolvedScenario) {
      return;
    }

    const request: CreateRunRequest = {
      bot_id: activeBotId,
      bot_version: resolvedVersion,
      scenario_id: resolvedScenario,
      bot_config: buildBotConfigPayload(botConfigValues, selectedVersionDetail),
      execution_profile: buildExecutionProfilePayload(executionProfile),
    };

    const run = await createRunMutation.mutateAsync(request);
    navigate(`/runs/${run.run_id}`);
  }

  const runs = runsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Simulation Platform"
        title="Single runs turn the paper engine into a reproducible benchmark surface."
        description="Launch one standalone run with a fixed bot config and execution profile snapshot, then review the single-run queue without mutating the current live dashboard."
        actions={
          <>
            <Button tone="secondary" onClick={() => navigate("/experiments")}>
              Open batch experiments
            </Button>
            <Button tone="secondary" onClick={() => navigate("/leaderboard")}>
              Open leaderboard
            </Button>
            <Button tone="ghost" onClick={() => navigate("/sessions")}>
              Review saved sessions
            </Button>
          </>
        }
        meta={[
          { label: "Bots", value: String(availableBots.length) },
          { label: "Runs loaded", value: String(runs.length) },
          { label: "Scenarios", value: String(availableScenarios.length) },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <Panel
            eyebrow="Create run"
            title="Launch a standalone benchmark run"
            description="This workflow owns exactly one reproducible run at a time. Batch matrices live in the experiments workspace."
            actions={
              <Badge tone="info">
                {createRunMutation.isPending ? "Starting run" : "Ready to launch"}
              </Badge>
            }
          >
            <form className="grid gap-5" onSubmit={handleCreateRun}>
              <div className="grid gap-4 md:grid-cols-3">
                <Select
                  label="Bot"
                  value={activeBotId}
                  options={availableBots.map((bot) => ({ label: bot.name, value: bot.bot_id }))}
                  onChange={(event) => {
                    setSelectedBotId(event.target.value);
                    setSelectedVersion("");
                    setSelectedScenario("");
                    setBotConfigValues({});
                    setExecutionProfileOverrides({});
                  }}
                />
                <Select
                  label="Version"
                  value={resolvedVersion}
                  options={(selectedBot?.versions ?? []).map((version) => ({
                    label: `${version.version} · ${version.title}`,
                    value: version.version,
                  }))}
                  onChange={(event) => {
                    setSelectedVersion(event.target.value);
                    setBotConfigValues({});
                  }}
                />
                <Select
                  label="Scenario"
                  value={resolvedScenario}
                  options={availableScenarios.map((scenario) => ({
                    label: `${scenario.name} · ${scenario.scenario_id}`,
                    value: scenario.scenario_id,
                  }))}
                  onChange={(event) => setSelectedScenario(event.target.value)}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel
                  eyebrow="Bot config"
                  title="Version defaults"
                  description="Schema-driven controls come from the selected bot version."
                  tone="soft"
                >
                  <div className="grid gap-3">
                    {botConfigKeys.length ? (
                      botConfigKeys.map((key) => (
                        <Input
                          key={key}
                          label={key}
                          value={botConfigValues[key] ?? toInputValue(selectedVersionDetail?.default_config[key])}
                          onChange={(event) =>
                            setBotConfigValues((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-400">
                        Selected bot version has no configurable fields.
                      </div>
                    )}
                  </div>
                </Panel>

                <Panel
                  eyebrow="Execution profile"
                  title="Simulator realism inputs"
                  description="These values are persisted with the run and applied to the paper engine before replay starts."
                  tone="soft"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Initial balance"
                      type="number"
                      step="0.01"
                      value={executionProfile.initial_balance}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          initial_balance: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Fee rate"
                      type="number"
                      step="0.0001"
                      value={executionProfile.fee_rate}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          fee_rate: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Slippage rate"
                      type="number"
                      step="0.0001"
                      value={executionProfile.slippage_rate}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          slippage_rate: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Cooldown seconds"
                      type="number"
                      step="1"
                      value={executionProfile.cooldown_seconds}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          cooldown_seconds: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Max position quantity"
                      type="number"
                      step="0.01"
                      value={executionProfile.max_position_quantity}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          max_position_quantity: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Max order notional"
                      type="number"
                      step="0.01"
                      value={executionProfile.max_order_notional}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          max_order_notional: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Max daily loss"
                      type="number"
                      step="0.01"
                      value={executionProfile.max_daily_loss}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          max_daily_loss: event.target.value,
                        }))
                      }
                    />
                    <Input
                      label="Max open notional"
                      type="number"
                      step="0.01"
                      value={executionProfile.max_open_notional}
                      onChange={(event) =>
                        setExecutionProfileOverrides((current) => ({
                          ...current,
                          max_open_notional: event.target.value,
                        }))
                      }
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Allowed symbols"
                        value={executionProfile.allowed_symbols}
                        onChange={(event) =>
                          setExecutionProfileOverrides((current) => ({
                            ...current,
                            allowed_symbols: event.target.value,
                          }))
                        }
                        hint="Comma-separated. Leave empty to allow all symbols."
                      />
                    </div>
                  </div>
                </Panel>
              </div>

              {selectedScenarioDetail ? (
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone="neutral">{selectedScenarioDetail.scenario_id}</Badge>
                    <span>{selectedScenarioDetail.name}</span>
                    <span className="text-slate-500">{selectedScenarioDetail.tick_count} ticks</span>
                  </div>
                  <p className="mt-3 leading-6 text-slate-400">{selectedScenarioDetail.description}</p>
                </div>
              ) : null}

              {createRunMutation.error instanceof Error ? (
                <div className="rounded-[20px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-3 text-sm text-rose-100">
                  {formatSimulationSchedulerMessage(createRunMutation.error, "run")}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  tone="primary"
                  type="submit"
                  disabled={
                    createRunMutation.isPending ||
                    !activeBotId ||
                    !resolvedVersion ||
                    !resolvedScenario ||
                    !rulesQuery.data
                  }
                >
                  Start run
                </Button>
                <Button tone="ghost" onClick={() => navigate("/experiments")}>
                  Switch to batch experiments
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            eyebrow="Selected bot"
            title={selectedBot?.name ?? "Loading bot catalog"}
            description={
              selectedBot?.description ??
              "Choose a bot to inspect version history and default config."
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Current version"
                value={selectedBot?.current_version ?? "-"}
                detail={selectedBot?.runtime ? `${selectedBot.runtime} runtime` : "Waiting for bot detail"}
                icon={<RunsIcon className="size-5" />}
                tone="accent"
              />
              <StatCard
                label="Default scenario"
                value={selectedBot?.default_scenario ?? "-"}
                detail={`${selectedBot?.versions.length ?? 0} published versions`}
                tone="neutral"
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            eyebrow="Run queue"
            title="Recent simulation runs"
            description="Search by run or session ID, and filter the queue by status, bot, or scenario."
          >
            <div className="mb-5 grid gap-4 xl:grid-cols-4">
              <SearchInput
                label="Search"
                placeholder="sim-run-..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                label="Status"
                value={status}
                options={RUN_STATUS_OPTIONS}
                onChange={(event) => setStatus(event.target.value as RunFilter["status"])}
              />
              <Select
                label="Bot"
                value={filterBotId}
                options={[
                  { label: "All bots", value: "" },
                  ...availableBots.map((bot) => ({ label: bot.name, value: bot.bot_id })),
                ]}
                onChange={(event) => setFilterBotId(event.target.value)}
              />
              <Select
                label="Scenario"
                value={filterScenarioId}
                options={[
                  { label: "All scenarios", value: "" },
                  ...availableScenarios.map((scenario) => ({
                    label: scenario.name,
                    value: scenario.scenario_id,
                  })),
                ]}
                onChange={(event) => setFilterScenarioId(event.target.value)}
              />
            </div>

            <DataTable
              caption="Simulation runs"
              columns={[
                {
                  key: "status",
                  header: "Status",
                  cell: (run) => (
                    <Badge tone={getRunStatusTone(run.status)}>{formatRunStatus(run.status)}</Badge>
                  ),
                },
                {
                  key: "run",
                  header: "Run",
                  cell: (run) => (
                    <div className="space-y-1">
                      <div className="font-medium text-white">{run.run_id}</div>
                      <div className="text-xs text-slate-500">{run.session_id}</div>
                    </div>
                  ),
                },
                {
                  key: "bot",
                  header: "Bot",
                  cell: (run) => (
                    <div className="space-y-1">
                      <div>{run.bot_name}</div>
                      <div className="text-xs text-slate-500">
                        {run.bot_id} · {run.bot_version}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "scenario",
                  header: "Scenario",
                  cell: (run) => run.scenario_id,
                },
                {
                  key: "started",
                  header: "Started",
                  cell: (run) => formatDateTime(run.started_at),
                },
                {
                  key: "outcome",
                  header: "Outcome",
                  cell: (run) => run.error_message || "-",
                },
                {
                  key: "actions",
                  header: "Actions",
                  cell: (run) => (
                    <Link
                      to={`/runs/${encodeURIComponent(run.run_id)}`}
                      className="text-sm font-medium text-sky-200 hover:text-sky-100"
                    >
                      Open detail
                    </Link>
                  ),
                  align: "right",
                },
              ]}
              rows={runs}
              getRowId={(run) => run.run_id}
              emptyTitle={runsQuery.isLoading ? "Loading run queue" : "No runs yet"}
              emptyDescription="Start a simulation run to create the first reproducible experiment."
            />
          </Panel>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Running"
              value={String(runs.filter((run) => run.status === "running").length)}
              detail="Runs currently streaming replay ticks into the paper engine."
              tone="success"
            />
            <StatCard
              label="Completed"
              value={String(runs.filter((run) => run.status === "completed").length)}
              detail="Completed runs can move straight into the leaderboard."
              tone="neutral"
            />
            <StatCard
              label="Scenario"
              value={selectedScenarioDetail?.name ?? "-"}
              detail={
                selectedScenarioDetail
                  ? `${selectedScenarioDetail.symbols.join(", ")} · ${selectedScenarioDetail.tick_count} ticks`
                  : "Choose a scenario to inspect its metadata."
              }
              tone="accent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
