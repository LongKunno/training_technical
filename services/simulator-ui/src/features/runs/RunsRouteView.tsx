import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import {
  ChartPanel,
  createDistributionBarOption,
  createStackedStatusBarOption,
} from "../../shared/charts";
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
  RunStatus,
  ScenarioCatalogEntry,
} from "../../shared/types";
import {
  Badge,
  Button,
  DataTable,
  DisclosurePanel,
  EmptyState,
  Input,
  PageHeader,
  Panel,
  ProgressBar,
  SearchInput,
  Select,
  SummaryStrip,
} from "../../shared/ui";
import {
  formatDateTime,
  formatInteger,
  formatRunStatus,
  formatSimulationSchedulerMessage,
  getRunStatusTone,
  isActiveRunStatus,
} from "./formatters";
import {
  EXECUTION_PROFILE_PRESETS,
  buildExecutionProfilePreset,
  isExecutionProfilePresetApplied,
  type ExecutionProfilePresetId,
} from "./execution-profile-presets";

const RUN_STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Starting", value: "starting" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
  { label: "Failed", value: "failed" },
];

const RUN_SORT_OPTIONS = [
  { label: "Started (newest)", value: "started_desc" },
  { label: "Started (oldest)", value: "started_asc" },
  { label: "Status", value: "status_asc" },
  { label: "Run ID", value: "run_asc" },
] as const;
const RUN_STATUS_CHART_ORDER: RunStatus[] = [
  "starting",
  "running",
  "completed",
  "stopped",
  "failed",
];
const RUN_STATUS_CHART_COLORS: Record<RunStatus, string> = {
  starting: "#7ecbff",
  running: "#42d9ba",
  completed: "#c6d4e1",
  stopped: "#f4be51",
  failed: "#ff8b7a",
};

type RunSortOrder = (typeof RUN_SORT_OPTIONS)[number]["value"];

interface RunsViewSearchState {
  botId: string;
  q: string;
  scenarioId: string;
  sort: RunSortOrder;
  status: RunFilter["status"];
}

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
    max_position_quantity: input
      ? String(input.risk_controls.max_position_quantity)
      : "",
    max_order_notional: input
      ? String(input.risk_controls.max_order_notional)
      : "",
    max_daily_loss: input ? String(input.risk_controls.max_daily_loss) : "",
    cooldown_seconds: input ? String(input.risk_controls.cooldown_seconds) : "",
    max_open_notional: input
      ? String(input.risk_controls.max_open_notional)
      : "",
  };
}

function parseConfigValue(
  rawValue: string,
  schema: Record<string, unknown> | undefined,
): unknown {
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

function buildEffectiveBotConfigValues(
  values: Record<string, string>,
  version: BotVersion | undefined,
): Record<string, string> {
  const defaults = version?.default_config ?? {};
  const effective: Record<string, string> = {};

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    effective[key] = values[key] ?? toInputValue(defaultValue);
  });

  Object.entries(values).forEach(([key, rawValue]) => {
    effective[key] = rawValue;
  });

  return effective;
}

function buildBotConfigPayload(
  effectiveValues: Record<string, string>,
  version: BotVersion | undefined,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const schema = (version?.config_schema ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  Object.entries(effectiveValues).forEach(([key, rawValue]) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }
    config[key] = parseConfigValue(trimmed, schema[key]);
  });
  return config;
}

function buildExecutionProfilePayload(
  state: ExecutionProfileFormState,
): ExecutionProfileInput {
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

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function formatRunsListError(error: unknown) {
  return formatOperatorErrorMessage(error, "Run queue could not be loaded.");
}

function validateBotConfigValues(
  effectiveValues: Record<string, string>,
  version: BotVersion | undefined,
): string[] {
  const issues: string[] = [];
  const schema = (version?.config_schema ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  Object.entries(effectiveValues).forEach(([key, rawValue]) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      issues.push(`Config ${key} cannot be empty.`);
      return;
    }

    const type =
      typeof schema[key]?.type === "string" ? schema[key]?.type : "string";
    if (type === "integer" && parseNonNegativeInteger(trimmed) === null) {
      issues.push(`Config ${key} must be an integer.`);
    } else if (type === "number" && parseNonNegativeNumber(trimmed) === null) {
      issues.push(`Config ${key} must be a number.`);
    } else if (
      type === "boolean" &&
      trimmed !== "true" &&
      trimmed !== "false"
    ) {
      issues.push(`Config ${key} must be true or false.`);
    }
  });

  return issues;
}

function matchesRun(
  run: {
    bot_id: string;
    bot_name: string;
    bot_version: string;
    run_id: string;
    scenario_id: string;
    session_id: string;
    status: RunStatus;
  },
  search: string,
  status: RunFilter["status"],
  botId: string,
  scenarioId: string,
) {
  if (status && run.status !== status) {
    return false;
  }
  if (botId && run.bot_id !== botId) {
    return false;
  }
  if (scenarioId && run.scenario_id !== scenarioId) {
    return false;
  }
  if (!search) {
    return true;
  }

  const normalized = search.toLowerCase();
  return (
    run.run_id.toLowerCase().includes(normalized) ||
    run.session_id.toLowerCase().includes(normalized) ||
    run.bot_name.toLowerCase().includes(normalized) ||
    run.bot_id.toLowerCase().includes(normalized) ||
    run.scenario_id.toLowerCase().includes(normalized)
  );
}

function compareRuns(
  left: {
    run_id: string;
    started_at: string;
    status: RunStatus;
  },
  right: {
    run_id: string;
    started_at: string;
    status: RunStatus;
  },
  sortOrder: RunSortOrder,
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

function buildRunStatusChart(
  runs: Array<{ status: RunStatus }>,
): Array<{ color: string; label: string; value: number }> {
  return RUN_STATUS_CHART_ORDER.map((status) => ({
    color: RUN_STATUS_CHART_COLORS[status],
    label: formatRunStatus(status),
    value: runs.filter((run) => run.status === status).length,
  })).filter((point) => point.value > 0);
}

function buildRunOwnershipChart(
  runs: Array<{ experiment_id?: string }>,
): Array<{ label: string; value: number }> {
  const standaloneCount = runs.filter((run) => !run.experiment_id).length;
  const childCount = runs.filter((run) => Boolean(run.experiment_id)).length;

  return [
    { label: "Standalone", value: standaloneCount },
    { label: "Batch child", value: childCount },
  ].filter((point) => point.value > 0);
}

function parseRunSearchParams(params: URLSearchParams): RunsViewSearchState {
  const rawStatus = params.get("status") ?? "";
  const rawSort = params.get("sort") ?? "started_desc";
  const status = RUN_STATUS_OPTIONS.some((option) => option.value === rawStatus)
    ? (rawStatus as RunFilter["status"])
    : "";
  const sort = RUN_SORT_OPTIONS.some((option) => option.value === rawSort)
    ? (rawSort as RunSortOrder)
    : "started_desc";

  return {
    botId: params.get("bot_id")?.trim() ?? "",
    q: params.get("q")?.trim() ?? "",
    scenarioId: params.get("scenario_id")?.trim() ?? "",
    sort,
    status,
  };
}

function buildRunSearchParams(state: RunsViewSearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) {
    params.set("q", state.q);
  }
  if (state.status) {
    params.set("status", state.status);
  }
  if (state.botId) {
    params.set("bot_id", state.botId);
  }
  if (state.scenarioId) {
    params.set("scenario_id", state.scenarioId);
  }
  if (state.sort !== "started_desc") {
    params.set("sort", state.sort);
  }
  return params;
}

export function RunsRouteView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = useMemo(
    () => parseRunSearchParams(searchParams),
    [searchParams],
  );
  const botsQuery = useSimulationBotsQuery();
  const rulesQuery = usePaperRulesQuery();
  const scenariosQuery = useMarketReplayScenarioCatalogQuery();
  const createRunMutation = useCreateSimulationRunMutation();

  const [selectedBotId, setSelectedBotId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("");
  const [botConfigValues, setBotConfigValues] = useState<
    Record<string, string>
  >({});
  const [executionProfileOverrides, setExecutionProfileOverrides] = useState<
    Partial<ExecutionProfileFormState>
  >({});

  const search = searchState.q;
  const status = searchState.status;
  const filterBotId = searchState.botId;
  const filterScenarioId = searchState.scenarioId;
  const sortOrder = searchState.sort;

  const deferredSearch = useDeferredValue(search.trim());
  const availableBots = useMemo(() => botsQuery.data ?? [], [botsQuery.data]);
  const availableScenarios = useMemo(
    () => scenariosQuery.data ?? [],
    [scenariosQuery.data],
  );
  const activeBotId = selectedBotId || availableBots[0]?.bot_id || "";
  const botDetailQuery = useSimulationBotQuery(activeBotId);
  const selectedBot = botDetailQuery.data;
  const selectedVersionDetail =
    selectedBot?.versions.find(
      (version) => version.version === selectedVersion,
    ) ??
    selectedBot?.versions.find(
      (version) => version.version === selectedBot.current_version,
    );
  const resolvedVersion = selectedVersionDetail?.version ?? "";
  const resolvedScenario =
    selectedScenario ||
    selectedBot?.default_scenario ||
    availableScenarios[0]?.scenario_id ||
    "";
  const selectedScenarioDetail = findScenario(
    availableScenarios,
    resolvedScenario,
  );
  const executionProfileDefaults = useMemo(
    () =>
      rulesQuery.data
        ? toExecutionProfileFormState(rulesQuery.data)
        : toExecutionProfileFormState(),
    [rulesQuery.data],
  );
  const executionProfile: ExecutionProfileFormState = useMemo(
    () => ({
      ...executionProfileDefaults,
      ...executionProfileOverrides,
    }),
    [executionProfileDefaults, executionProfileOverrides],
  );
  const executionProfilePresets = useMemo(() => {
    if (!rulesQuery.data) {
      return [];
    }

    return EXECUTION_PROFILE_PRESETS.map((preset) => {
      const values = buildExecutionProfilePreset(rulesQuery.data, preset.id);
      return {
        ...preset,
        active: isExecutionProfilePresetApplied(executionProfile, values),
      };
    });
  }, [executionProfile, rulesQuery.data]);
  const effectiveBotConfigValues = useMemo(
    () => buildEffectiveBotConfigValues(botConfigValues, selectedVersionDetail),
    [botConfigValues, selectedVersionDetail],
  );
  const botConfigKeys = Object.keys(effectiveBotConfigValues);
  const botConfigPayload = useMemo(
    () =>
      buildBotConfigPayload(effectiveBotConfigValues, selectedVersionDetail),
    [effectiveBotConfigValues, selectedVersionDetail],
  );

  const runsQuery = useSimulationRunsQuery({
    limit: 50,
    offset: 0,
    q: deferredSearch,
    status,
    bot_id: filterBotId,
    scenario_id: filterScenarioId,
  });
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  const filteredRuns = useMemo(
    () =>
      runs
        .filter((run) =>
          matchesRun(
            run,
            deferredSearch,
            status,
            filterBotId,
            filterScenarioId,
          ),
        )
        .sort((left, right) => compareRuns(left, right, sortOrder)),
    [deferredSearch, filterBotId, filterScenarioId, runs, sortOrder, status],
  );
  const filteredRunStatusPoints = useMemo(
    () => buildRunStatusChart(filteredRuns),
    [filteredRuns],
  );
  const filteredRunOwnershipPoints = useMemo(
    () => buildRunOwnershipChart(filteredRuns),
    [filteredRuns],
  );
  const filteredRunStatusOption = useMemo(
    () =>
      filteredRunStatusPoints.length
        ? createStackedStatusBarOption(filteredRunStatusPoints)
        : undefined,
    [filteredRunStatusPoints],
  );
  const filteredRunOwnershipOption = useMemo(
    () =>
      filteredRunOwnershipPoints.length
        ? createDistributionBarOption(filteredRunOwnershipPoints)
        : undefined,
    [filteredRunOwnershipPoints],
  );

  const activeRun = useMemo(
    () => runs.find((run) => isActiveRunStatus(run.status)),
    [runs],
  );
  const runsListError = runsQuery.isError
    ? formatRunsListError(runsQuery.error)
    : null;

  const validationIssues = useMemo(() => {
    const issues: string[] = [];

    if (!activeBotId) {
      issues.push("Choose a bot.");
    }
    if (!resolvedVersion) {
      issues.push("Choose a bot version.");
    }
    if (!resolvedScenario) {
      issues.push("Choose a replay scenario.");
    }
    if (!rulesQuery.data) {
      issues.push("Execution defaults are still loading.");
    }
    if (parsePositiveNumber(executionProfile.initial_balance) === null) {
      issues.push("Initial balance must be greater than zero.");
    }
    if (parseNonNegativeNumber(executionProfile.fee_rate) === null) {
      issues.push("Fee rate must be zero or greater.");
    }
    if (parseNonNegativeNumber(executionProfile.slippage_rate) === null) {
      issues.push("Slippage rate must be zero or greater.");
    }
    if (parseNonNegativeInteger(executionProfile.cooldown_seconds) === null) {
      issues.push("Cooldown seconds must be a non-negative integer.");
    }
    if (
      parseNonNegativeNumber(executionProfile.max_position_quantity) === null
    ) {
      issues.push("Max position quantity must be zero or greater.");
    }
    if (parseNonNegativeNumber(executionProfile.max_order_notional) === null) {
      issues.push("Max order notional must be zero or greater.");
    }
    if (parseNonNegativeNumber(executionProfile.max_daily_loss) === null) {
      issues.push("Max daily loss must be zero or greater.");
    }
    if (parseNonNegativeNumber(executionProfile.max_open_notional) === null) {
      issues.push("Max open notional must be zero or greater.");
    }

    return [
      ...issues,
      ...validateBotConfigValues(
        effectiveBotConfigValues,
        selectedVersionDetail,
      ),
    ];
  }, [
    activeBotId,
    effectiveBotConfigValues,
    executionProfile.cooldown_seconds,
    executionProfile.fee_rate,
    executionProfile.initial_balance,
    executionProfile.max_daily_loss,
    executionProfile.max_open_notional,
    executionProfile.max_order_notional,
    executionProfile.max_position_quantity,
    executionProfile.slippage_rate,
    resolvedScenario,
    resolvedVersion,
    rulesQuery.data,
    selectedVersionDetail,
  ]);

  const readinessChecks = [
    Boolean(activeBotId),
    Boolean(resolvedVersion),
    Boolean(resolvedScenario),
    Boolean(rulesQuery.data),
    validationIssues.length === 0,
  ];
  const readinessPassed = readinessChecks.filter(Boolean).length;
  const canSubmit =
    validationIssues.length === 0 && !createRunMutation.isPending;
  const plannerBadgeTone = createRunMutation.isPending
    ? "info"
    : canSubmit
      ? "success"
      : "warning";
  const plannerBadgeLabel = createRunMutation.isPending
    ? "Starting run"
    : canSubmit
      ? "Ready"
      : "Needs input";
  const readinessBadgeLabel = createRunMutation.isPending
    ? "Starting"
    : canSubmit
      ? "Ready"
      : "Pending";
  const headerTone =
    createRunMutation.error instanceof Error
      ? "warning"
      : activeRun
        ? "accent"
        : "soft";

  function updateSearchState(patch: Partial<RunsViewSearchState>) {
    const nextState = {
      ...searchState,
      ...patch,
    };
    setSearchParams(buildRunSearchParams(nextState), { replace: true });
  }

  function applyExecutionPreset(presetId: ExecutionProfilePresetId) {
    if (!rulesQuery.data) {
      return;
    }

    setExecutionProfileOverrides(
      buildExecutionProfilePreset(rulesQuery.data, presetId),
    );
  }

  async function handleCreateRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeBotId || !resolvedVersion || !resolvedScenario || !canSubmit) {
      return;
    }

    const request: CreateRunRequest = {
      bot_id: activeBotId,
      bot_version: resolvedVersion,
      scenario_id: resolvedScenario,
      bot_config: botConfigPayload,
      execution_profile: buildExecutionProfilePayload(executionProfile),
    };

    try {
      const run = await createRunMutation.mutateAsync(request);
      navigate(`/runs/${run.run_id}`);
    } catch {
      // Mutation state already drives the inline scheduler conflict banner.
    }
  }

  function resetPlanner() {
    setSelectedBotId("");
    setSelectedVersion("");
    setSelectedScenario("");
    setBotConfigValues({});
    setExecutionProfileOverrides({});
    createRunMutation.reset();
  }

  if (botsQuery.isLoading || scenariosQuery.isLoading || rulesQuery.isLoading) {
    return (
      <EmptyState
        eyebrow="Runs"
        title="Loading single-run workspace"
        description="Đang nạp bot, replay scenario và execution default cho run planner."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone={headerTone}
        eyebrow="Single-run workflow"
        title="Plan and launch one standalone run"
        description="Trang này chỉ launch standalone run. Batch matrix và aggregate compare vẫn nằm ở workflow `/experiments`."
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
        aside={
          <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Standalone only</Badge>
              <Badge tone={activeRun ? "warning" : "success"}>
                {activeRun ? "Engine busy" : "Engine free"}
              </Badge>
              <Badge tone="neutral">No batch aggregate</Badge>
            </div>
            <DisclosurePanel
              className="mt-4"
              label="Workflow notes"
              contentClassName="space-y-2"
            >
              <p>
                Planner này chỉ tạo single run. Nếu scheduler đang bị batch hoặc
                child run giữ, request mới sẽ trả `simulation_busy` thay vì lỗi
                mơ hồ.
              </p>
              <p>
                Leaderboard chỉ đọc completed standalone run. Aggregate compare
                cho batch vẫn nằm ở experiment detail.
              </p>
            </DisclosurePanel>
          </div>
        }
        meta={[
          { label: "Scheduler", value: activeRun?.run_id ?? "Idle" },
          { label: "Selected bot", value: selectedBot?.name ?? "Choose bot" },
          {
            label: "Scenario",
            value: selectedScenarioDetail?.name ?? "Choose scenario",
          },
          { label: "Visible runs", value: formatInteger(filteredRuns.length) },
        ]}
      />

      <SummaryStrip
        items={[
          {
            badge: <Badge tone={activeRun ? "warning" : "success"}>{activeRun ? "Busy" : "Idle"}</Badge>,
            label: "Scheduler owner",
            meta: activeRun
              ? activeRun.experiment_id
                ? `${formatRunStatus(activeRun.status)} · child of ${activeRun.experiment_id}`
                : `${formatRunStatus(activeRun.status)} · standalone ${activeRun.bot_name}`
              : "Không có run nào đang giữ singleton engine.",
            tone: activeRun ? "warning" : "success",
            value: activeRun?.run_id ?? "Idle",
          },
          {
            badge: <Badge tone={resolvedVersion ? "info" : "neutral"}>Version</Badge>,
            label: "Selected version",
            meta: selectedVersionDetail?.title ?? "Pick a bot to resolve version defaults.",
            tone: resolvedVersion ? "accent" : "neutral",
            value: resolvedVersion || "-",
          },
          {
            badge: <Badge tone="neutral">Queue</Badge>,
            label: "Recent queue",
            meta: `${formatInteger(runs.filter((run) => run.status === "completed").length)} completed run(s).`,
            tone: "neutral",
            value: formatInteger(runs.length),
          },
          {
            badge: <Badge tone={selectedScenarioDetail ? "info" : "neutral"}>Scenarios</Badge>,
            label: "Scenarios loaded",
            meta: selectedScenarioDetail
              ? `${selectedScenarioDetail.symbols.join(", ")} · ${selectedScenarioDetail.tick_count} ticks`
              : "Pick a scenario to inspect replay metadata.",
            tone: selectedScenarioDetail ? "accent" : "neutral",
            value: formatInteger(availableScenarios.length),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
        <Panel
          eyebrow="Create run"
          title="Single-run planner"
          description="Chọn bot mục tiêu, xem config mặc định và chốt execution snapshot trước khi chạy."
          actions={
            <Badge tone={plannerBadgeTone}>{plannerBadgeLabel}</Badge>
          }
        >
          <form
            aria-busy={createRunMutation.isPending}
            className="grid gap-6"
            onSubmit={handleCreateRun}
          >
            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div>
                <h3 className="text-sm font-medium text-slate-100">
                  Run target
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Chốt bot, version và scenario cho benchmark standalone này.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Select
                  label="Bot"
                  value={activeBotId}
                  options={availableBots.map((bot) => ({
                    label: bot.name,
                    value: bot.bot_id,
                  }))}
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
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Bot config</span>
                    <Badge tone="neutral">
                      {formatInteger(botConfigKeys.length)} field(s)
                    </Badge>
                  </div>
                }
                contentClassName="space-y-4"
              >
                <p className="text-sm leading-6 text-slate-400">
                  Chỉ mở phần này khi anh cần override config của version đang
                  chọn.
                </p>
                {botDetailQuery.isLoading ? (
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                    Đang tải config mặc định của bot version.
                  </div>
                ) : botConfigKeys.length ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {botConfigKeys.map((key) => (
                      <Input
                        key={key}
                        label={key}
                        value={effectiveBotConfigValues[key] ?? ""}
                        onChange={(event) =>
                          setBotConfigValues((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                    Bot version đã chọn không có field cấu hình nào cần chỉnh.
                  </div>
                )}
              </DisclosurePanel>
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Execution defaults</span>
                    <Badge tone="neutral">Snapshot on launch</Badge>
                  </div>
                }
                contentClassName="space-y-4"
              >
                <p className="text-sm leading-6 text-slate-400">
                  Các giá trị này sẽ được lưu cùng run và áp dụng trước khi
                  replay bắt đầu.
                </p>
                <div
                  className="grid gap-2 sm:grid-cols-3"
                  role="group"
                  aria-label="Execution profile presets"
                >
                  {executionProfilePresets.map((preset) => (
                    <Button
                      key={preset.id}
                      aria-pressed={preset.active}
                      className={
                        preset.active
                          ? "border-cyan-300/40 bg-cyan-300/[0.08]"
                          : undefined
                      }
                      onClick={() => applyExecutionPreset(preset.id)}
                      size="sm"
                      tone={preset.active ? "secondary" : "ghost"}
                      type="button"
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
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
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                </div>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
                  <Input
                    label="Allowed symbols"
                    value={executionProfile.allowed_symbols}
                    onChange={(event) =>
                      setExecutionProfileOverrides((current) => ({
                        ...current,
                        allowed_symbols: event.target.value,
                      }))
                    }
                    hint="Ngăn cách bằng dấu phẩy. Để trống nếu muốn cho phép mọi symbol."
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
                </div>
              </DisclosurePanel>
            </section>

            <section className="grid gap-4">
              <div>
                <h3 className="text-sm font-medium text-slate-100">
                  Review and launch
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Kiểm tra snapshot bên dưới trước khi start standalone run.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Bot
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {selectedBot?.name ?? "-"}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Version
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {resolvedVersion || "-"}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Scenario
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {selectedScenarioDetail?.name ?? "-"}
                  </div>
                </div>
              </div>

              {validationIssues.length ? (
                <div className="rounded-[18px] border border-amber-300/20 bg-amber-300/[0.08] px-4 py-4">
                  <div className="text-sm font-medium text-amber-100">
                    Finish the planner before launch
                  </div>
                  <ul className="mt-3 grid gap-2 text-sm text-amber-50/90">
                    {validationIssues.map((issue) => (
                      <li key={issue}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {createRunMutation.error instanceof Error ? (
                <div className="rounded-[18px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-4 text-sm text-rose-100">
                  {formatSimulationSchedulerMessage(
                    createRunMutation.error,
                    "run",
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button tone="primary" type="submit" disabled={!canSubmit}>
                  {createRunMutation.isPending ? "Starting run..." : "Start run"}
                </Button>
                <Button
                  tone="ghost"
                  type="button"
                  onClick={resetPlanner}
                  disabled={createRunMutation.isPending}
                >
                  Reset planner
                </Button>
                <Button
                  tone="ghost"
                  type="button"
                  onClick={() => navigate("/experiments")}
                  disabled={createRunMutation.isPending}
                >
                  Switch to batch experiments
                </Button>
              </div>
            </section>
          </form>
        </Panel>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Panel
            eyebrow="Launch preview"
            title="Run readiness"
            description="Giữ mục tiêu chạy, trạng thái scheduler và execution snapshot trong tầm nhìn khi chỉnh planner."
            tone="soft"
          >
            <div className="grid gap-5">
              <div className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">
                      {selectedBot?.name ?? "Choose bot"}{" "}
                      {resolvedVersion ? `· ${resolvedVersion}` : ""}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {selectedScenarioDetail?.name ?? "Choose a scenario"}{" "}
                      {resolvedScenario ? `· ${resolvedScenario}` : ""}
                    </div>
                  </div>
                  <Badge tone={plannerBadgeTone}>
                    {readinessBadgeLabel}
                  </Badge>
                </div>
                <ProgressBar
                  value={readinessPassed}
                  max={readinessChecks.length}
                  label="Planner checks"
                  valueLabel={`${readinessPassed}/${readinessChecks.length}`}
                  tone={canSubmit ? "success" : "warning"}
                />
              </div>

              <div
                className={`rounded-[18px] border px-4 py-4 ${
                  createRunMutation.error instanceof Error
                    ? "border-rose-300/20 bg-rose-300/[0.08] text-rose-100"
                    : activeRun
                      ? "border-sky-300/18 bg-sky-300/[0.08] text-sky-100"
                      : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
                }`}
              >
                <div className="text-sm font-medium">
                  {createRunMutation.error instanceof Error
                    ? "Scheduler conflict"
                    : activeRun
                      ? "Engine currently in use"
                      : "Scheduler is free"}
                </div>
                <p className="mt-2 text-sm leading-6 opacity-90">
                  {createRunMutation.error instanceof Error
                    ? formatSimulationSchedulerMessage(
                        createRunMutation.error,
                        "run",
                      )
                    : activeRun
                      ? activeRun.experiment_id
                        ? `${activeRun.run_id} is a batch child run. Open experiments to inspect the owning batch before starting another standalone run.`
                        : `${activeRun.run_id} is already active. A second standalone run will stay blocked until it becomes terminal.`
                      : "No active run is holding the paper engine, so a valid single-run planner can start immediately."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Bot
                  </div>
                  <div className="mt-2 text-sm text-slate-200">
                    {selectedBot?.name ?? "Choose bot"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedVersionDetail?.description ??
                      "Version detail will appear here."}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Scenario
                  </div>
                  <div className="mt-2 text-sm text-slate-200">
                    {selectedScenarioDetail?.name ?? "Choose scenario"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedScenarioDetail
                      ? `${selectedScenarioDetail.symbols.join(", ")} · ${selectedScenarioDetail.tick_count} ticks`
                      : "Replay metadata will appear here."}
                  </div>
                </div>
              </div>

              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Bot config snapshot</span>
                    <Badge tone="info">
                      {formatInteger(botConfigKeys.length)} field(s)
                    </Badge>
                  </div>
                }
                contentClassName="space-y-3"
              >
                {botConfigKeys.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {botConfigKeys.map((key) => (
                      <div
                        key={key}
                        className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-3"
                      >
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          {key}
                        </div>
                        <div className="mt-2 text-sm text-slate-200">
                          {toInputValue(
                            botConfigPayload[key] ??
                              effectiveBotConfigValues[key],
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                    This version has no configurable fields.
                  </div>
                )}
              </DisclosurePanel>

              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Market context snapshot</span>
                    <Badge tone={selectedScenarioDetail ? "info" : "neutral"}>
                      {selectedScenarioDetail ? "Replay ready" : "No scenario"}
                    </Badge>
                  </div>
                }
                contentClassName="space-y-3"
              >
                {selectedScenarioDetail ? (
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-sm font-medium text-slate-100">
                      {selectedScenarioDetail.name}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {selectedScenarioDetail.description}
                    </p>
                    {"microstructure_profile" in selectedScenarioDetail &&
                    selectedScenarioDetail.microstructure_profile ? (
                      <div className="mt-3 text-xs text-slate-500">
                        Latency{" "}
                        {
                          selectedScenarioDetail.microstructure_profile
                            .signal_latency_ticks
                        }{" "}
                        ticks | Spread{" "}
                        {
                          selectedScenarioDetail.microstructure_profile
                            .spread_bps
                        }{" "}
                        bps | Fill cap{" "}
                        {
                          selectedScenarioDetail.microstructure_profile
                            .max_fill_notional_per_tick
                        }
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                    Chọn scenario để xem market context snapshot.
                  </div>
                )}
              </DisclosurePanel>

              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Execution snapshot</span>
                    <Badge tone="neutral">
                      {executionProfile.initial_balance || "0"} balance
                    </Badge>
                  </div>
                }
                contentClassName="space-y-3"
              >
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="text-sm text-slate-300">
                      Initial balance{" "}
                      <span className="text-slate-100">
                        {executionProfile.initial_balance}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Fee rate{" "}
                      <span className="text-slate-100">
                        {executionProfile.fee_rate}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Slippage{" "}
                      <span className="text-slate-100">
                        {executionProfile.slippage_rate}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Cooldown{" "}
                      <span className="text-slate-100">
                        {executionProfile.cooldown_seconds}s
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Max daily loss{" "}
                      <span className="text-slate-100">
                        {executionProfile.max_daily_loss}
                      </span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Max open notional{" "}
                      <span className="text-slate-100">
                        {executionProfile.max_open_notional}
                      </span>
                    </div>
                  </div>
                </div>
              </DisclosurePanel>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        eyebrow="Run queue"
        title="Recent simulation runs"
        description="Tìm kiếm, lọc và sắp xếp các run mới nhất ngay trong workflow standalone."
      >
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <ChartPanel
            tone="soft"
            eyebrow="Queue mix"
            title="Status distribution"
            description="Biểu đồ này bám theo tập run đang hiển thị sau filter, để anh đọc nhanh queue đang nghiêng về running, completed hay blocked."
            chart={{
              emptyTitle: "No visible run status",
              emptyDescription:
                "Khi có row trong queue hiện tại, phân bố trạng thái sẽ hiện ở đây.",
              height: 180,
              option: filteredRunStatusOption,
            }}
            footer={
              <>
                <span>{formatInteger(filteredRuns.length)} visible run(s)</span>
                <span>
                  {formatInteger(
                    filteredRuns.filter((run) => isActiveRunStatus(run.status))
                      .length,
                  )}{" "}
                  active
                </span>
              </>
            }
          />
          <ChartPanel
            tone="soft"
            eyebrow="Ownership mix"
            title="Standalone vs batch child"
            description="Giúp phân biệt nhanh queue hiện tại đang là không gian của standalone workflow hay đang bị child run từ experiment chiếm ưu thế."
            chart={{
              emptyTitle: "No ownership mix",
              emptyDescription:
                "Khi có run hiện trên bảng, tỷ lệ standalone và batch child sẽ hiện ở đây.",
              height: 180,
              option: filteredRunOwnershipOption,
            }}
            footer={
              <>
                <span>
                  {formatInteger(
                    filteredRuns.filter((run) => !run.experiment_id).length,
                  )}{" "}
                  standalone
                </span>
                <span>
                  {formatInteger(
                    filteredRuns.filter((run) => Boolean(run.experiment_id))
                      .length,
                  )}{" "}
                  child run
                </span>
              </>
            }
          />
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px_220px_220px_220px]">
          <SearchInput
            label="Search"
            placeholder="run, session, bot, scenario"
            value={search}
            onChange={(event) => updateSearchState({ q: event.target.value.trim() })}
          />
          <Select
            label="Status"
            value={status}
            options={RUN_STATUS_OPTIONS}
            onChange={(event) =>
              updateSearchState({
                status: event.target.value as RunFilter["status"],
              })
            }
          />
          <Select
            label="Bot"
            value={filterBotId}
            options={[
              { label: "All bots", value: "" },
              ...availableBots.map((bot) => ({
                label: bot.name,
                value: bot.bot_id,
              })),
            ]}
            onChange={(event) => updateSearchState({ botId: event.target.value })}
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
            onChange={(event) =>
              updateSearchState({ scenarioId: event.target.value })
            }
          />
          <Select
            label="Sort"
            value={sortOrder}
            options={RUN_SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(event) =>
              updateSearchState({ sort: event.target.value as RunSortOrder })
            }
          />
        </div>

        {runsListError ? (
          <div className="mb-5 rounded-[18px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-4 text-sm text-rose-100">
            <div className="font-medium">Run queue unavailable</div>
            <p className="mt-2 leading-6 text-rose-50/85">
              {runsListError}
            </p>
          </div>
        ) : null}

        <DataTable
          caption="Simulation runs"
          columns={[
            {
              key: "run",
              header: "Run",
              cell: (run) => (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{run.run_id}</span>
                    {isActiveRunStatus(run.status) ? (
                      <Badge tone="info">Active</Badge>
                    ) : null}
                    <Badge tone={run.experiment_id ? "warning" : "neutral"}>
                      {run.experiment_id ? "Batch child" : "Standalone"}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-500">{run.session_id}</div>
                  {run.experiment_id ? (
                    <div className="text-xs text-amber-200">
                      Owned by {run.experiment_id}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Standalone workspace row
                    </div>
                  )}
                </div>
              ),
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
          rows={filteredRuns}
          getRowId={(run) => run.run_id}
          getRowClassName={(run) =>
            isActiveRunStatus(run.status)
              ? "[&>td]:bg-sky-300/[0.05] [&>td]:text-slate-100"
              : undefined
          }
          emptyTitle={
            runsListError
              ? "Run queue unavailable"
              : runsQuery.isLoading
                ? "Loading run queue"
                : "No matching runs"
          }
          emptyDescription={
            runsListError ??
            (deferredSearch || status || filterBotId || filterScenarioId
              ? "Try a different search term or clear the run filters."
              : "Start a simulation run to create the first reproducible benchmark.")
          }
        />
      </Panel>
    </div>
  );
}
