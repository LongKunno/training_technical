import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import {
  ChartPanel,
  createHorizontalBarOption,
  createStackedStatusBarOption,
} from "../../shared/charts";
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
  ExperimentStatus,
  ExperimentSummary,
  RiskControls,
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
  SelectionCard,
  SummaryStrip,
} from "../../shared/ui";
import {
  formatDateTime,
  formatInteger,
  formatRunStatus,
  formatSimulationSchedulerMessage,
  getRunStatusTone,
} from "./formatters";
import {
  EXECUTION_PROFILE_PRESETS,
  buildExecutionProfilePreset,
  isExecutionProfilePresetApplied,
  type ExecutionProfilePresetId,
} from "./execution-profile-presets";

const DEFAULT_EXPERIMENT_NAME = "Baseline matrix";
const DEFAULT_REPETITIONS = "2";
const EXPERIMENT_TEMPLATE_STORAGE_KEY =
  "crypto-simulator.experiment-templates.v1";
const MAX_SAVED_EXPERIMENT_TEMPLATES = 8;

const EXPERIMENT_STATUS_OPTIONS: Array<{
  label: string;
  value: ExperimentStatus | "";
}> = [
  { label: "All statuses", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Starting", value: "starting" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Stopped", value: "stopped" },
  { label: "Failed", value: "failed" },
];

const SORT_OPTIONS = [
  { label: "Updated (newest)", value: "updated_desc" },
  { label: "Planned runs", value: "planned_desc" },
  { label: "Name", value: "name_asc" },
  { label: "Status", value: "status_asc" },
] as const;

const MATRIX_PRESETS = [
  {
    description: "One baseline lane for a fast scheduler smoke check.",
    id: "smoke",
    label: "Smoke",
    name: "Smoke matrix",
    repetitions: "1",
  },
  {
    description: "All known bots crossed with the full scenario catalog.",
    id: "scenario-coverage",
    label: "Scenario coverage",
    name: "Scenario coverage matrix",
    repetitions: "2",
  },
  {
    description: "Stress, crash, volatility, and thin-liquidity lanes.",
    id: "stress-liquidity",
    label: "Stress liquidity",
    name: "Stress liquidity matrix",
    repetitions: "2",
  },
] as const;
const EXPERIMENT_STATUS_CHART_ORDER: ExperimentStatus[] = [
  "queued",
  "starting",
  "running",
  "completed",
  "stopped",
  "failed",
];
const EXPERIMENT_STATUS_CHART_COLORS: Record<ExperimentStatus, string> = {
  queued: "#f4be51",
  starting: "#7ecbff",
  running: "#42d9ba",
  completed: "#c6d4e1",
  stopped: "#dca54c",
  failed: "#ff8b7a",
};

type ExperimentSortOrder = (typeof SORT_OPTIONS)[number]["value"];
type MatrixPresetId = (typeof MATRIX_PRESETS)[number]["id"];

interface ExperimentsViewSearchState {
  q: string;
  sort: ExperimentSortOrder;
  status: ExperimentStatus | "";
}

interface SavedExperimentTemplate {
  createdAt: string;
  executionProfileOverrides: Partial<ExecutionProfileFormState>;
  experimentName: string;
  id: string;
  name: string;
  repetitions: string;
  selectedBots: string[];
  selectedScenarios: string[];
  updatedAt: string;
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

const EXECUTION_PROFILE_FORM_FIELDS: Array<keyof ExecutionProfileFormState> = [
  "initial_balance",
  "fee_rate",
  "slippage_rate",
  "allowed_symbols",
  "max_position_quantity",
  "max_order_notional",
  "max_daily_loss",
  "cooldown_seconds",
  "max_open_notional",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sanitizeExecutionProfileOverrides(
  value: unknown,
): Partial<ExecutionProfileFormState> {
  if (!isRecord(value)) {
    return {};
  }

  return EXECUTION_PROFILE_FORM_FIELDS.reduce<Partial<ExecutionProfileFormState>>(
    (overrides, field) => {
      if (typeof value[field] === "string") {
        overrides[field] = value[field];
      }
      return overrides;
    },
    {},
  );
}

function getTemplateStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadSavedExperimentTemplates(): SavedExperimentTemplate[] {
  const storage = getTemplateStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(EXPERIMENT_TEMPLATE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const templates: SavedExperimentTemplate[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) {
        continue;
      }

      const id = typeof item.id === "string" ? item.id : "";
      const name = typeof item.name === "string" ? item.name : "";
      const experimentName =
        typeof item.experimentName === "string" ? item.experimentName : name;
      const repetitions =
        typeof item.repetitions === "string" ? item.repetitions : "";
      const selectedBots = isStringArray(item.selectedBots)
        ? item.selectedBots
        : [];
      const selectedScenarios = isStringArray(item.selectedScenarios)
        ? item.selectedScenarios
        : [];

      if (!id || !name || !experimentName || !repetitions) {
        continue;
      }

      const createdAt =
        typeof item.createdAt === "string"
          ? item.createdAt
          : typeof item.updatedAt === "string"
            ? item.updatedAt
            : "";
      const updatedAt =
        typeof item.updatedAt === "string"
          ? item.updatedAt
          : typeof item.createdAt === "string"
            ? item.createdAt
            : "";

      templates.push({
        createdAt,
        executionProfileOverrides: sanitizeExecutionProfileOverrides(
          item.executionProfileOverrides,
        ),
        experimentName,
        id,
        name,
        repetitions,
        selectedBots,
        selectedScenarios,
        updatedAt,
      });
    }

    return templates.slice(0, MAX_SAVED_EXPERIMENT_TEMPLATES);
  } catch {
    return [];
  }
}

function saveSavedExperimentTemplates(templates: SavedExperimentTemplate[]) {
  const storage = getTemplateStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(EXPERIMENT_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // localStorage can be unavailable in private or quota-limited contexts.
  }
}

function createSavedTemplateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `template-${crypto.randomUUID()}`;
  }

  return `template-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

function buildExecutionProfilePayload(
  state: ExecutionProfileFormState,
): ExecutionProfileInput {
  return {
    initial_balance: Number.parseFloat(state.initial_balance),
    fee_rate: Number.parseFloat(state.fee_rate),
    slippage_rate: Number.parseFloat(state.slippage_rate),
    risk_controls: {
      allowed_symbols: state.allowed_symbols
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      max_position_quantity: Number.parseFloat(state.max_position_quantity),
      max_order_notional: Number.parseFloat(state.max_order_notional),
      max_daily_loss: Number.parseFloat(state.max_daily_loss),
      cooldown_seconds: Number.parseInt(state.cooldown_seconds, 10),
      max_open_notional: Number.parseFloat(state.max_open_notional),
    },
  };
}

function plannedRuns(
  selectedBots: string[],
  selectedScenarios: string[],
  repetitions: number,
) {
  return (
    selectedBots.length * selectedScenarios.length * Math.max(0, repetitions)
  );
}

function selectedScenarioDetails(
  scenarios: ScenarioCatalogEntry[],
  selectedScenarioIds: string[],
) {
  return scenarios.filter((scenario) =>
    selectedScenarioIds.includes(scenario.scenario_id),
  );
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
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

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function formatExperimentsListError(error: unknown) {
  return formatOperatorErrorMessage(error, "Experiment queue could not be loaded.");
}

function matchesExperiment(
  experiment: ExperimentSummary,
  search: string,
  status: ExperimentStatus | "",
) {
  if (status && experiment.status !== status) {
    return false;
  }

  if (!search) {
    return true;
  }

  const normalized = search.toLowerCase();
  return (
    experiment.name.toLowerCase().includes(normalized) ||
    experiment.experiment_id.toLowerCase().includes(normalized)
  );
}

function compareExperiments(
  left: ExperimentSummary,
  right: ExperimentSummary,
  sortOrder: ExperimentSortOrder,
) {
  switch (sortOrder) {
    case "planned_desc":
      return (
        right.planned_runs - left.planned_runs ||
        right.updated_at.localeCompare(left.updated_at)
      );
    case "name_asc":
      return (
        left.name.localeCompare(right.name) ||
        right.updated_at.localeCompare(left.updated_at)
      );
    case "status_asc":
      return (
        left.status.localeCompare(right.status) ||
        right.updated_at.localeCompare(left.updated_at)
      );
    case "updated_desc":
    default:
      return right.updated_at.localeCompare(left.updated_at);
  }
}

function toggleSelection(current: string[], value: string, checked: boolean) {
  if (checked) {
    return current.includes(value) ? current : [...current, value];
  }

  return current.filter((item) => item !== value);
}

function scenarioHasAnyTag(scenario: ScenarioCatalogEntry, tags: string[]) {
  return scenario.tags.some((tag) => tags.includes(tag));
}

function getMatrixPresetSelection(
  presetId: MatrixPresetId,
  bots: Array<{ bot_id: string; default_scenario: string }>,
  scenarios: ScenarioCatalogEntry[],
) {
  const botIds = bots.map((bot) => bot.bot_id);
  const scenarioIds = scenarios.map((scenario) => scenario.scenario_id);
  switch (presetId) {
    case "smoke": {
      const baselineScenario =
        scenarioIds.find((scenarioId) => scenarioId === "baseline") ??
        scenarioIds[0];
      const baselineBot =
        bots.find((bot) => bot.default_scenario === baselineScenario)?.bot_id ??
        botIds[0];
      return {
        botIds: baselineBot ? [baselineBot] : [],
        scenarioIds: baselineScenario ? [baselineScenario] : [],
      };
    }
    case "stress-liquidity": {
      const stressScenarios = scenarios
        .filter((scenario) =>
          scenarioHasAnyTag(scenario, [
            "stress",
            "crash",
            "liquidity-thin",
            "volatility-spike",
          ]),
        )
        .map((scenario) => scenario.scenario_id);
      return {
        botIds,
        scenarioIds: stressScenarios.length ? stressScenarios : scenarioIds,
      };
    }
    case "scenario-coverage":
    default:
      return { botIds, scenarioIds };
  }
}

function sameSelection(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function buildExperimentStatusChart(
  experiments: ExperimentSummary[],
): Array<{ color: string; label: string; value: number }> {
  return EXPERIMENT_STATUS_CHART_ORDER.map((status) => ({
    color: EXPERIMENT_STATUS_CHART_COLORS[status],
    label: formatRunStatus(status),
    value: experiments.filter((experiment) => experiment.status === status)
      .length,
  })).filter((point) => point.value > 0);
}

function buildLargestMatrixChart(experiments: ExperimentSummary[]) {
  return [...experiments]
    .sort(
      (left, right) =>
        right.planned_runs - left.planned_runs ||
        right.updated_at.localeCompare(left.updated_at),
    )
    .slice(0, 5)
    .map((experiment) => ({
      label: experiment.name,
      value: experiment.planned_runs,
    }));
}

function parseExperimentSearchParams(
  params: URLSearchParams,
): ExperimentsViewSearchState {
  const rawStatus = params.get("status") ?? "";
  const rawSort = params.get("sort") ?? "updated_desc";
  const status = EXPERIMENT_STATUS_OPTIONS.some(
    (option) => option.value === rawStatus,
  )
    ? (rawStatus as ExperimentStatus | "")
    : "";
  const sort = SORT_OPTIONS.some((option) => option.value === rawSort)
    ? (rawSort as ExperimentSortOrder)
    : "updated_desc";

  return {
    q: params.get("q")?.trim() ?? "",
    sort,
    status,
  };
}

function buildExperimentSearchParams(
  state: ExperimentsViewSearchState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) {
    params.set("q", state.q);
  }
  if (state.status) {
    params.set("status", state.status);
  }
  if (state.sort !== "updated_desc") {
    params.set("sort", state.sort);
  }
  return params;
}

export function ExperimentsRouteView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = useMemo(
    () => parseExperimentSearchParams(searchParams),
    [searchParams],
  );
  const botsQuery = useSimulationBotsQuery();
  const rulesQuery = usePaperRulesQuery();
  const scenariosQuery = useMarketReplayScenarioCatalogQuery();
  const experimentsQuery = useSimulationExperimentsQuery({
    limit: 50,
    offset: 0,
  });
  const createExperimentMutation = useCreateSimulationExperimentMutation();

  const [name, setName] = useState(DEFAULT_EXPERIMENT_NAME);
  const [repetitions, setRepetitions] = useState(DEFAULT_REPETITIONS);
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [executionProfileOverrides, setExecutionProfileOverrides] = useState<
    Partial<ExecutionProfileFormState>
  >({});
  const [savedTemplates, setSavedTemplates] = useState<
    SavedExperimentTemplate[]
  >(loadSavedExperimentTemplates);
  const search = searchState.q;
  const statusFilter = searchState.status;
  const sortOrder = searchState.sort;

  const deferredSearch = useDeferredValue(search.trim());

  const bots = useMemo(() => botsQuery.data ?? [], [botsQuery.data]);
  const scenarios = useMemo(
    () => scenariosQuery.data ?? [],
    [scenariosQuery.data],
  );
  const experiments = useMemo(
    () => experimentsQuery.data ?? [],
    [experimentsQuery.data],
  );
  const experimentsListError = experimentsQuery.isError
    ? formatExperimentsListError(experimentsQuery.error)
    : null;
  const executionDefaults = useMemo(
    () =>
      rulesQuery.data
        ? toExecutionProfileFormState(rulesQuery.data)
        : toExecutionProfileFormState(),
    [rulesQuery.data],
  );
  const executionProfile = useMemo(
    () => ({
      ...executionDefaults,
      ...executionProfileOverrides,
    }),
    [executionDefaults, executionProfileOverrides],
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
  const matrixPresets = useMemo(
    () =>
      MATRIX_PRESETS.map((preset) => {
        const selection = getMatrixPresetSelection(preset.id, bots, scenarios);
        return {
          ...preset,
          active:
            sameSelection(selectedBots, selection.botIds) &&
            sameSelection(selectedScenarios, selection.scenarioIds) &&
            repetitions === preset.repetitions,
        };
      }),
    [bots, repetitions, scenarios, selectedBots, selectedScenarios],
  );

  const repetitionCount = parsePositiveInteger(repetitions);
  const totalPlannedRuns = useMemo(
    () => plannedRuns(selectedBots, selectedScenarios, repetitionCount ?? 0),
    [repetitionCount, selectedBots, selectedScenarios],
  );

  const activeExperiment = experiments.find(
    (experiment) =>
      experiment.status === "running" || experiment.status === "starting",
  );
  const queuedExperiments = experiments.filter(
    (experiment) => experiment.status === "queued",
  );
  const nextQueuedExperiment = queuedExperiments[0];

  const filteredExperiments = useMemo(
    () =>
      experiments
        .filter((experiment) =>
          matchesExperiment(experiment, deferredSearch, statusFilter),
        )
        .sort((left, right) => compareExperiments(left, right, sortOrder)),
    [deferredSearch, experiments, sortOrder, statusFilter],
  );
  const filteredExperimentStatusPoints = useMemo(
    () => buildExperimentStatusChart(filteredExperiments),
    [filteredExperiments],
  );
  const filteredExperimentStatusOption = useMemo(
    () =>
      filteredExperimentStatusPoints.length
        ? createStackedStatusBarOption(filteredExperimentStatusPoints)
        : undefined,
    [filteredExperimentStatusPoints],
  );
  const largestMatrixPoints = useMemo(
    () => buildLargestMatrixChart(filteredExperiments),
    [filteredExperiments],
  );
  const largestMatrixOption = useMemo(
    () =>
      largestMatrixPoints.length
        ? createHorizontalBarOption(largestMatrixPoints)
        : undefined,
    [largestMatrixPoints],
  );

  const highlightedScenarios = selectedScenarioDetails(
    scenarios,
    selectedScenarios,
  );
  const plannedLanePreview = useMemo(
    () =>
      selectedBots.flatMap((botId) =>
        selectedScenarios.map((scenarioId) => {
          const bot = bots.find((candidate) => candidate.bot_id === botId);
          const scenario = scenarios.find(
            (candidate) => candidate.scenario_id === scenarioId,
          );
          return {
            id: `${botId}-${scenarioId}`,
            botId,
            botLabel: bot?.name ?? botId,
            repetitions: repetitionCount ?? 0,
            scenarioId,
            scenarioLabel: scenario?.name ?? scenarioId,
          };
        }),
      ),
    [bots, repetitionCount, scenarios, selectedBots, selectedScenarios],
  );

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    if (!name.trim()) {
      issues.push("Add an experiment name.");
    }
    if (!selectedBots.length) {
      issues.push("Choose at least one bot.");
    }
    if (!selectedScenarios.length) {
      issues.push("Choose at least one scenario.");
    }
    if (!repetitionCount) {
      issues.push("Repetitions must be a positive integer.");
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
    return issues;
  }, [
    executionProfile.fee_rate,
    executionProfile.initial_balance,
    executionProfile.slippage_rate,
    name,
    repetitionCount,
    selectedBots.length,
    selectedScenarios.length,
  ]);

  const readinessChecks = [
    Boolean(name.trim()),
    selectedBots.length > 0,
    selectedScenarios.length > 0,
    repetitionCount !== null,
    validationIssues.length === 0,
  ];
  const readinessPassed = readinessChecks.filter(Boolean).length;
  const canSubmit =
    validationIssues.length === 0 && !createExperimentMutation.isPending;
  const canSaveTemplate = validationIssues.length === 0;
  const plannerBadgeTone = createExperimentMutation.isPending
    ? "info"
    : canSubmit
      ? "success"
      : "warning";
  const plannerBadgeLabel = createExperimentMutation.isPending
    ? "Starting batch"
    : canSubmit
      ? "Ready"
      : "Needs input";
  const readinessBadgeLabel = createExperimentMutation.isPending
    ? "Starting"
    : canSubmit
      ? "Ready"
      : "Pending";
  const currentTemplateName = name.trim();
  const saveTemplateLabel = savedTemplates.some(
    (template) => template.name === currentTemplateName,
  )
    ? "Update template"
    : "Save template";
  const visibleLanePreview = plannedLanePreview.slice(0, 6);
  const hiddenLaneCount = Math.max(
    0,
    plannedLanePreview.length - visibleLanePreview.length,
  );
  const headerTone =
    createExperimentMutation.error instanceof Error
      ? "warning"
      : activeExperiment || nextQueuedExperiment
        ? "accent"
        : "soft";

  function updateSearchState(patch: Partial<ExperimentsViewSearchState>) {
    const nextState = {
      ...searchState,
      ...patch,
    };
    setSearchParams(buildExperimentSearchParams(nextState), { replace: true });
  }

  function applyExecutionPreset(presetId: ExecutionProfilePresetId) {
    if (!rulesQuery.data) {
      return;
    }

    setExecutionProfileOverrides(
      buildExecutionProfilePreset(rulesQuery.data, presetId),
    );
  }

  function persistSavedTemplates(nextTemplates: SavedExperimentTemplate[]) {
    setSavedTemplates(nextTemplates);
    saveSavedExperimentTemplates(nextTemplates);
  }

  function applyMatrixPreset(presetId: MatrixPresetId) {
    const preset = MATRIX_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }

    const selection = getMatrixPresetSelection(presetId, bots, scenarios);
    setName(preset.name);
    setRepetitions(preset.repetitions);
    setSelectedBots(selection.botIds);
    setSelectedScenarios(selection.scenarioIds);
    createExperimentMutation.reset();
  }

  function saveCurrentTemplate() {
    if (!canSaveTemplate || repetitionCount === null || !currentTemplateName) {
      return;
    }

    const now = new Date().toISOString();
    const existingTemplate = savedTemplates.find(
      (template) => template.name === currentTemplateName,
    );
    const template: SavedExperimentTemplate = {
      createdAt: existingTemplate?.createdAt ?? now,
      executionProfileOverrides: { ...executionProfileOverrides },
      experimentName: currentTemplateName,
      id: existingTemplate?.id ?? createSavedTemplateId(),
      name: currentTemplateName,
      repetitions,
      selectedBots: [...selectedBots],
      selectedScenarios: [...selectedScenarios],
      updatedAt: now,
    };
    const nextTemplates = [
      template,
      ...savedTemplates.filter(
        (savedTemplate) =>
          savedTemplate.id !== template.id && savedTemplate.name !== template.name,
      ),
    ].slice(0, MAX_SAVED_EXPERIMENT_TEMPLATES);

    persistSavedTemplates(nextTemplates);
    createExperimentMutation.reset();
  }

  function applySavedTemplate(template: SavedExperimentTemplate) {
    const availableBotIds = new Set(bots.map((bot) => bot.bot_id));
    const availableScenarioIds = new Set(
      scenarios.map((scenario) => scenario.scenario_id),
    );

    setName(template.experimentName);
    setRepetitions(template.repetitions);
    setSelectedBots(
      template.selectedBots.filter((botId) => availableBotIds.has(botId)),
    );
    setSelectedScenarios(
      template.selectedScenarios.filter((scenarioId) =>
        availableScenarioIds.has(scenarioId),
      ),
    );
    setExecutionProfileOverrides(template.executionProfileOverrides);
    createExperimentMutation.reset();
  }

  function deleteSavedTemplate(templateId: string) {
    persistSavedTemplates(
      savedTemplates.filter((template) => template.id !== templateId),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || repetitionCount === null) {
      return;
    }

    const request: CreateExperimentRequest = {
      name: name.trim(),
      bots: selectedBots.map((botId) => ({ bot_id: botId })),
      scenarios: selectedScenarios,
      repetitions: repetitionCount,
      execution_profile: buildExecutionProfilePayload(executionProfile),
    };

    try {
      const experiment = await createExperimentMutation.mutateAsync(request);
      navigate(`/experiments/${experiment.experiment_id}`);
    } catch {
      // Mutation state already renders the scheduler conflict / validation surface.
    }
  }

  function resetPlanner() {
    setName(DEFAULT_EXPERIMENT_NAME);
    setRepetitions(DEFAULT_REPETITIONS);
    setSelectedBots([]);
    setSelectedScenarios([]);
    setExecutionProfileOverrides({});
    createExperimentMutation.reset();
  }

  if (botsQuery.isLoading || scenariosQuery.isLoading) {
    return (
      <EmptyState
        eyebrow="Experiments"
        title="Loading batch workspace"
        description="Đang nạp bot, scenario và execution default cho experiment planner."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone={headerTone}
        eyebrow="Batch workflow"
        title="Plan and launch sequential experiments"
        description="Tạo một ma trận bot × scenario × repetition rồi để scheduler cấp child run đúng lúc cần."
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
        aside={
          <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Sequential only</Badge>
              <Badge tone="neutral">JIT child runs</Badge>
              <Badge tone="warning">No leaderboard aggregate</Badge>
            </div>
            <DisclosurePanel
              className="mt-4"
              label="Workflow notes"
              contentClassName="space-y-2"
            >
              <p>
                Batch chỉ chạy từng child run theo thứ tự. Child run mới chỉ
                được tạo khi engine rảnh và scheduler cấp quyền chạy.
              </p>
              <p>
                Trang leaderboard không phải chỗ xem aggregate của batch.
                Compare matrix vẫn nằm ở experiment detail.
              </p>
            </DisclosurePanel>
          </div>
        }
        meta={[
          {
            label: "Scheduler",
            value:
              activeExperiment?.name ?? nextQueuedExperiment?.name ?? "Idle",
          },
          { label: "Planned runs", value: formatInteger(totalPlannedRuns) },
          {
            label: "Queue depth",
            value: formatInteger(queuedExperiments.length),
          },
          { label: "Recent batches", value: formatInteger(experiments.length) },
        ]}
      />

      <SummaryStrip
        items={[
          {
            badge: <Badge tone={activeExperiment ? "warning" : "success"}>{activeExperiment ? "Busy" : "Idle"}</Badge>,
            label: "Scheduler owner",
            meta: activeExperiment
              ? `${formatRunStatus(activeExperiment.status)} batch is currently owning the engine.`
              : "No active batch is holding the singleton engine.",
            tone: activeExperiment ? "warning" : "success",
            value: activeExperiment?.name ?? "Idle",
          },
          {
            badge: <Badge tone={nextQueuedExperiment ? "warning" : "neutral"}>Queue</Badge>,
            label: "Next queued batch",
            meta: nextQueuedExperiment
              ? `Queue position #${nextQueuedExperiment.queue_position ?? 1}`
              : "No batch is waiting for scheduler ownership.",
            tone: nextQueuedExperiment ? "warning" : "neutral",
            value: nextQueuedExperiment?.name ?? "None",
          },
          {
            badge: <Badge tone={selectedBots.length ? "info" : "neutral"}>Selection</Badge>,
            label: "Selected bots",
            meta: selectedBots.length
              ? `${formatInteger(selectedScenarios.length)} scenarios will be crossed with the current selection.`
              : "Pick the bots you want to benchmark.",
            tone: selectedBots.length ? "accent" : "neutral",
            value: formatInteger(selectedBots.length),
          },
          {
            badge: <Badge tone={deferredSearch || statusFilter ? "info" : "neutral"}>Visible</Badge>,
            label: "Visible batches",
            meta:
              deferredSearch || statusFilter
                ? "Current search and status filters are active."
                : "Showing the latest persisted experiment batches.",
            tone: deferredSearch || statusFilter ? "accent" : "neutral",
            value: formatInteger(filteredExperiments.length),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
        <Panel
          eyebrow="Create experiment"
          title="Batch planner"
          description="Chọn bot, scenario và execution default trước; child run đầu tiên chỉ được tạo khi scheduler cấp quyền chạy."
          actions={
            <Badge tone={plannerBadgeTone}>{plannerBadgeLabel}</Badge>
          }
        >
          <form
            aria-busy={createExperimentMutation.isPending}
            className="grid gap-6"
            onSubmit={handleSubmit}
          >
            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div>
                <h3 className="text-sm font-medium text-slate-100">
                  Batch identity
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Đặt tên cho matrix và quyết định số repetition cho mỗi lane.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                <Input
                  label="Experiment name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  hint={
                    !name.trim()
                      ? "Required before launch."
                      : "Visible on the detail page and recent batch list."
                  }
                />
                <Input
                  label="Repetitions"
                  inputMode="numeric"
                  value={repetitions}
                  onChange={(event) => setRepetitions(event.target.value)}
                  hint={
                    repetitionCount
                      ? `${repetitionCount} run(s) per lane.`
                      : "Use a positive integer."
                  }
                />
              </div>
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-100">
                    Matrix presets
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Apply a common bot × scenario shape, then adjust individual
                    selections if needed.
                  </p>
                </div>
                <Badge tone="info">Planner only</Badge>
              </div>
              <div
                className="grid gap-3 md:grid-cols-3"
                role="group"
                aria-label="Experiment matrix presets"
              >
                {matrixPresets.map((preset) => (
                  <Button
                    key={preset.id}
                    aria-pressed={preset.active}
                    className={
                      preset.active
                        ? "h-auto min-h-20 justify-start border-cyan-300/40 bg-cyan-300/[0.08] px-4 py-3 text-left"
                        : "h-auto min-h-20 justify-start px-4 py-3 text-left"
                    }
                    onClick={() => applyMatrixPreset(preset.id)}
                    tone={preset.active ? "secondary" : "ghost"}
                    type="button"
                  >
                    <span className="grid gap-1">
                      <span>{preset.label}</span>
                      <span className="text-xs font-normal leading-5 text-slate-400">
                        {preset.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-100">
                    Saved templates
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Save the current planner shape locally for repeated
                    benchmark batches.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">
                    {savedTemplates.length}/{MAX_SAVED_EXPERIMENT_TEMPLATES}
                  </Badge>
                  <Button
                    disabled={!canSaveTemplate}
                    onClick={saveCurrentTemplate}
                    size="sm"
                    tone="secondary"
                    type="button"
                  >
                    {saveTemplateLabel}
                  </Button>
                </div>
              </div>
              {savedTemplates.length ? (
                <div
                  className="grid gap-3"
                  role="group"
                  aria-label="Saved experiment templates"
                >
                  {savedTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-100">
                          {template.name}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-400">
                          {formatInteger(template.selectedBots.length)} bot(s) |{" "}
                          {formatInteger(template.selectedScenarios.length)}{" "}
                          scenario(s) | {template.repetitions} repetition(s) |
                          Updated {formatDateTime(template.updatedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          aria-label={`Apply template ${template.name}`}
                          onClick={() => applySavedTemplate(template)}
                          size="sm"
                          tone="secondary"
                          type="button"
                        >
                          Apply
                        </Button>
                        <Button
                          aria-label={`Delete template ${template.name}`}
                          onClick={() => deleteSavedTemplate(template.id)}
                          size="sm"
                          tone="ghost"
                          type="button"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[16px] border border-dashed border-white/10 px-4 py-3 text-sm text-slate-400">
                  No saved experiment templates yet.
                </div>
              )}
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-100">Bots</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Chọn các strategy sẽ dùng chung market replay matrix này.
                  </p>
                </div>
                <Badge tone={selectedBots.length ? "success" : "warning"}>
                  {formatInteger(selectedBots.length)} selected
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {bots.map((bot) => (
                  <SelectionCard
                    key={bot.bot_id}
                    checked={selectedBots.includes(bot.bot_id)}
                    onCheckedChange={(checked) =>
                      setSelectedBots((current) =>
                        toggleSelection(current, bot.bot_id, checked),
                      )
                    }
                    title={bot.name}
                    description={bot.description}
                    badge={<Badge tone="neutral">{bot.current_version}</Badge>}
                    meta={
                      <>
                        Default scenario {bot.default_scenario}
                        <span className="mx-2 text-slate-600">|</span>
                        Runtime {bot.runtime}
                      </>
                    }
                  />
                ))}
              </div>
              {!selectedBots.length ? (
                <div className="text-sm text-amber-200">
                  Hãy chọn ít nhất một bot để tạo matrix.
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-100">
                    Scenarios
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Các replay scenario này định nghĩa market context sẽ được
                    chụp lại trên từng child run.
                  </p>
                </div>
                <Badge tone={selectedScenarios.length ? "success" : "warning"}>
                  {formatInteger(selectedScenarios.length)} selected
                </Badge>
              </div>
              <div className="grid gap-3">
                {scenarios.map((scenario) => (
                  <SelectionCard
                    key={scenario.scenario_id}
                    checked={selectedScenarios.includes(scenario.scenario_id)}
                    onCheckedChange={(checked) =>
                      setSelectedScenarios((current) =>
                        toggleSelection(current, scenario.scenario_id, checked),
                      )
                    }
                    title={scenario.name}
                    description={scenario.description}
                    badge={<Badge tone="neutral">{scenario.scenario_id}</Badge>}
                    meta={
                      <>
                        Latency{" "}
                        {scenario.microstructure_profile.signal_latency_ticks}{" "}
                        ticks
                        <span className="mx-2 text-slate-600">|</span>
                        Spread {scenario.microstructure_profile.spread_bps} bps
                        <span className="mx-2 text-slate-600">|</span>
                        Fill cap{" "}
                        {
                          scenario.microstructure_profile
                            .max_fill_notional_per_tick
                        }
                      </>
                    }
                  />
                ))}
              </div>
              {!selectedScenarios.length ? (
                <div className="text-sm text-amber-200">
                  Hãy chọn ít nhất một scenario để xem trước các lane sẽ tạo.
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 border-b border-white/6 pb-6">
              <DisclosurePanel
                label={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>Execution defaults</span>
                    <Badge tone="neutral">Snapshot on child runs</Badge>
                  </div>
                }
                contentClassName="space-y-4"
              >
                <p className="text-sm leading-6 text-slate-400">
                  Các giá trị này sẽ được snapshot vào từng child run khi batch
                  bắt đầu.
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
                    value={executionProfile.initial_balance}
                    onChange={(event) =>
                      setExecutionProfileOverrides((current) => ({
                        ...current,
                        initial_balance: event.target.value,
                      }))
                    }
                    hint="Must be greater than zero."
                  />
                  <Input
                    label="Fee rate"
                    value={executionProfile.fee_rate}
                    onChange={(event) =>
                      setExecutionProfileOverrides((current) => ({
                        ...current,
                        fee_rate: event.target.value,
                      }))
                    }
                    hint="Zero or greater."
                  />
                  <Input
                    label="Slippage rate"
                    value={executionProfile.slippage_rate}
                    onChange={(event) =>
                      setExecutionProfileOverrides((current) => ({
                        ...current,
                        slippage_rate: event.target.value,
                      }))
                    }
                    hint="Zero or greater."
                  />
                </div>
                <div className="grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    Max daily loss {executionProfile.max_daily_loss || "0"} |
                    Max open notional{" "}
                    {executionProfile.max_open_notional || "0"}
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    Symbols {executionProfile.allowed_symbols || "All"} |
                    Cooldown {executionProfile.cooldown_seconds || "0"}s
                  </div>
                </div>
              </DisclosurePanel>
            </section>

            <section className="grid gap-4">
              <div>
                <h3 className="text-sm font-medium text-slate-100">
                  Review and launch
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Kiểm tra kích thước matrix và trạng thái scheduler trước khi
                  start batch.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Planned runs
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {formatInteger(totalPlannedRuns)}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Selected lanes
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {formatInteger(plannedLanePreview.length)}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Readiness
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {readinessPassed}/5 checks
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

              {createExperimentMutation.error instanceof Error ? (
                <div className="rounded-[18px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-4 text-sm text-rose-100">
                  {formatSimulationSchedulerMessage(
                    createExperimentMutation.error,
                    "experiment",
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button tone="primary" type="submit" disabled={!canSubmit}>
                  {createExperimentMutation.isPending
                    ? "Starting experiment..."
                    : "Start experiment"}
                </Button>
                <Button
                  tone="ghost"
                  type="button"
                  onClick={resetPlanner}
                  disabled={createExperimentMutation.isPending}
                >
                  Reset planner
                </Button>
              </div>
            </section>
          </form>
        </Panel>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Panel
            eyebrow="Launch preview"
            title="Planner readiness"
            description="Dùng panel này để xác nhận matrix, trạng thái scheduler và benchmark context trước khi chạy."
            tone="soft"
          >
            <div className="grid gap-5">
              <div className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">
                      {name.trim() || "Unnamed batch"}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {formatInteger(totalPlannedRuns)} planned run(s) across{" "}
                      {formatInteger(plannedLanePreview.length)} lane(s)
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
                  createExperimentMutation.error instanceof Error
                    ? "border-rose-300/20 bg-rose-300/[0.08] text-rose-100"
                    : activeExperiment
                      ? "border-sky-300/18 bg-sky-300/[0.08] text-sky-100"
                      : nextQueuedExperiment
                        ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"
                        : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
                }`}
              >
                <div className="text-sm font-medium">
                  {createExperimentMutation.error instanceof Error
                    ? "Scheduler conflict"
                    : activeExperiment
                      ? "Scheduler busy"
                      : nextQueuedExperiment
                        ? "Queue is already forming"
                        : "Scheduler is free"}
                </div>
                <p className="mt-2 text-sm leading-6 opacity-90">
                  {createExperimentMutation.error instanceof Error
                    ? formatSimulationSchedulerMessage(
                        createExperimentMutation.error,
                        "experiment",
                      )
                    : activeExperiment
                      ? `${activeExperiment.name} is holding the engine. New batches will wait until that child run becomes terminal.`
                      : nextQueuedExperiment
                        ? `${nextQueuedExperiment.name} is first in line at position #${nextQueuedExperiment.queue_position ?? 1}.`
                        : "No batch currently owns the singleton engine, so a valid planner can start immediately."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Bots
                  </div>
                  <div className="mt-2 text-sm text-slate-200">
                    {selectedBots.length
                      ? selectedBots
                          .map(
                            (botId) =>
                              bots.find((bot) => bot.bot_id === botId)?.name ??
                              botId,
                          )
                          .join(", ")
                      : "No bots selected yet."}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Scenarios
                  </div>
                  <div className="mt-2 text-sm text-slate-200">
                    {selectedScenarios.length
                      ? selectedScenarios
                          .map(
                            (scenarioId) =>
                              scenarios.find(
                                (scenario) =>
                                  scenario.scenario_id === scenarioId,
                              )?.name ?? scenarioId,
                          )
                          .join(", ")
                      : "No scenarios selected yet."}
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-100">
                    Lane preview
                  </div>
                  <Badge tone="info">
                    {formatInteger(plannedLanePreview.length)} lanes
                  </Badge>
                </div>
                {visibleLanePreview.length ? (
                  <div className="grid gap-3">
                    {visibleLanePreview.map((lane) => (
                      <div
                        key={lane.id}
                        className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-100">
                              {lane.botLabel}
                            </div>
                            <div className="mt-1 text-sm text-slate-400">
                              {lane.scenarioLabel}
                            </div>
                          </div>
                          <Badge tone="neutral">x{lane.repetitions}</Badge>
                        </div>
                        <div className="mt-3 text-xs text-slate-500">
                          {lane.botId} | {lane.scenarioId}
                        </div>
                      </div>
                    ))}
                    {hiddenLaneCount ? (
                      <div className="text-sm text-slate-500">
                        +{formatInteger(hiddenLaneCount)} more lane(s) will be
                        created from the same selection.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState
                    className="min-h-[180px]"
                    eyebrow="Lane preview"
                    title="Choose bots and scenarios first"
                    description="Khi planner có ít nhất một bot và một scenario, matrix preview sẽ hiện ở đây."
                  />
                )}
              </div>

              {highlightedScenarios.length ? (
                <DisclosurePanel
                  label={
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>Market context snapshot</span>
                      <Badge tone="info">
                        {formatInteger(highlightedScenarios.length)} scenario(s)
                      </Badge>
                    </div>
                  }
                  contentClassName="space-y-3"
                >
                  {highlightedScenarios.map((scenario) => (
                    <div
                      key={scenario.scenario_id}
                      className="rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="text-sm font-medium text-slate-100">
                        {scenario.name}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-400">
                        {scenario.description}
                      </div>
                      <div className="mt-3 text-xs text-slate-500">
                        Latency{" "}
                        {scenario.microstructure_profile.signal_latency_ticks}{" "}
                        ticks | Spread{" "}
                        {scenario.microstructure_profile.spread_bps} bps | Fill
                        cap{" "}
                        {
                          scenario.microstructure_profile
                            .max_fill_notional_per_tick
                        }
                      </div>
                    </div>
                  ))}
                </DisclosurePanel>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        eyebrow="Recent batches"
        title="Persisted experiments"
        description="Tìm kiếm, lọc và sắp xếp các batch mới nhất mà không trộn chúng vào standalone leaderboard."
      >
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <ChartPanel
            tone="soft"
            eyebrow="Batch mix"
            title="Status distribution"
            description="Biểu đồ này bám theo list batch hiện đang hiển thị, giúp đọc nhanh queue đang thiên về queued, running hay terminal state."
            chart={{
              emptyTitle: "No visible batch status",
              emptyDescription:
                "Khi list có batch hiển thị, phân bố trạng thái sẽ xuất hiện ở đây.",
              height: 180,
              option: filteredExperimentStatusOption,
            }}
            footer={
              <>
                <span>
                  {formatInteger(filteredExperiments.length)} visible batch(es)
                </span>
                <span>
                  {formatInteger(
                    filteredExperiments.filter(
                      (experiment) =>
                        experiment.status === "queued" ||
                        experiment.status === "running" ||
                        experiment.status === "starting",
                    ).length,
                  )}{" "}
                  still active
                </span>
              </>
            }
          />
          <ChartPanel
            tone="soft"
            eyebrow="Batch size"
            title="Largest matrices"
            description="Cho anh scan nhanh batch nào đang có ma trận lớn nhất trong tập nhìn thấy hiện tại, thay vì phải đọc từng row progress."
            chart={{
              emptyTitle: "No visible matrices",
              emptyDescription:
                "Khi có batch trong list hiện tại, các matrix lớn nhất sẽ hiện ở đây.",
              height: 180,
              option: largestMatrixOption,
            }}
            footer={
              <>
                <span>
                  {formatInteger(
                    filteredExperiments.reduce(
                      (total, experiment) => total + experiment.planned_runs,
                      0,
                    ),
                  )}{" "}
                  planned run(s)
                </span>
                <span>
                  {formatInteger(
                    filteredExperiments.filter(
                      (experiment) => experiment.status === "queued",
                    ).length,
                  )}{" "}
                  queued batch(es)
                </span>
              </>
            }
          />
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
          <SearchInput
            label="Search batches"
            value={search}
            onChange={(event) => updateSearchState({ q: event.target.value.trim() })}
            placeholder="Search by name or experiment ID"
          />
          <Select
            label="Status"
            value={statusFilter}
            options={EXPERIMENT_STATUS_OPTIONS}
            onChange={(event) =>
              updateSearchState({
                status: event.target.value as ExperimentStatus | "",
              })
            }
          />
          <Select
            label="Sort"
            value={sortOrder}
            options={SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(event) =>
              updateSearchState({
                sort: event.target.value as ExperimentSortOrder,
              })
            }
          />
        </div>

        {experimentsListError ? (
          <div className="mb-5 rounded-[18px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-4 text-sm text-rose-100">
            <div className="font-medium">Experiment queue unavailable</div>
            <p className="mt-2 leading-6 text-rose-50/85">
              {experimentsListError}
            </p>
          </div>
        ) : null}

        <DataTable
          caption="Simulation experiments"
          columns={[
            {
              key: "name",
              header: "Experiment",
              cell: (experiment) => (
                <div className="grid gap-1">
                  <Link
                    className="text-sm font-medium text-cyan-300"
                    to={`/experiments/${experiment.experiment_id}`}
                  >
                    {experiment.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">
                      {experiment.experiment_id}
                    </span>
                    {experiment.status === "queued" ? (
                      <Badge tone="warning">
                        Queue #{experiment.queue_position ?? 1}
                      </Badge>
                    ) : null}
                    {experiment.active_run_id ? (
                      <Badge tone="info">Child active</Badge>
                    ) : null}
                  </div>
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
              key: "scheduler",
              header: "Scheduler",
              cell: (experiment) =>
                experiment.status === "queued"
                  ? `Queued #${experiment.queue_position ?? 1}`
                  : experiment.active_run_id
                    ? "Owning engine"
                    : "Idle",
            },
            {
              key: "progress",
              header: "Progress",
              cell: (experiment) => {
                const finishedRuns =
                  experiment.completed_runs +
                  experiment.failed_runs +
                  experiment.stopped_runs;
                return (
                  <div className="min-w-[180px]">
                    <ProgressBar
                      value={finishedRuns}
                      max={experiment.planned_runs}
                      label={`${finishedRuns}/${experiment.planned_runs} complete`}
                      valueLabel={`${Math.round((finishedRuns / Math.max(experiment.planned_runs, 1)) * 100)}%`}
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
                  </div>
                );
              },
            },
            {
              key: "updated_at",
              header: "Updated",
              cell: (experiment) => formatDateTime(experiment.updated_at),
            },
          ]}
          rows={filteredExperiments}
          getRowId={(experiment) => experiment.experiment_id}
          getRowClassName={(experiment) =>
            experiment.status === "running" || experiment.status === "starting"
              ? "[&>td]:bg-sky-300/[0.05] [&>td]:text-slate-100"
              : experiment.status === "queued"
                ? "[&>td]:bg-amber-300/[0.05]"
                : undefined
          }
          emptyTitle={
            experimentsListError
              ? "Experiment queue unavailable"
              : experimentsQuery.isLoading
                ? "Loading experiments"
                : "No matching experiments"
          }
          emptyDescription={
            experimentsListError ??
            (deferredSearch || statusFilter
              ? "Try a different search term or clear the status filter."
              : "Create a batch experiment to persist the first matrix run.")
          }
        />
      </Panel>
    </div>
  );
}
