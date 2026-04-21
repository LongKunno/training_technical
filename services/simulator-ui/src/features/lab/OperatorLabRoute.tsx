import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { UseMutationResult } from "@tanstack/react-query";

import {
  resolveServiceAvailability,
  useCoreHealthQuery,
  useCurrentSessionQuery,
  useDataHealthQuery,
  useMarketReplayScenariosQuery,
  usePublishMarketQuotesMutation,
  usePublishStrategySignalsMutation,
  useReplayMarketQuotesMutation,
  useReplayStrategySignalsMutation,
  useResetSessionMutation,
  useSendManualSignalMutation,
  useStartSessionMutation,
  useStopSessionMutation,
  useStrategySignalScenariosQuery,
  useStrategySignalsQuery,
} from "../../shared/query";
import type {
  PublishQuotesResponse,
  PublishSignalsResponse,
  ReplayQuotesResponse,
  ReplaySignalsResponse,
  SignalExecutionResponse,
  SimulationSession,
  StrategySignal,
  UpstreamAvailability,
} from "../../shared/types";
import {
  ArrowUpRightIcon,
  Badge,
  Button,
  ClockIcon,
  DataTable,
  DatabaseIcon,
  EmptyState,
  Input,
  LabIcon,
  PageHeader,
  Panel,
  PulseIcon,
  Select,
  ShieldIcon,
  StatCard,
  cx,
} from "../../shared/ui";

const DEFAULT_SESSION_ID = "paper-alpha-live";
const DEFAULT_MARKET_TRANSPORT = "both";
const DEFAULT_MARKET_SPEED = "0";
const DEFAULT_STRATEGY_LIMIT = "1";
const DEFAULT_STRATEGY_OFFSET = "0";
const DEFAULT_STRATEGY_REPLAY_SPEED = "0";
const DEFAULT_MANUAL_STRATEGY_ID = "manual-console";
const DEFAULT_MANUAL_SYMBOL = "BTCUSDT";
const DEFAULT_MANUAL_SIDE = "buy";
const DEFAULT_MANUAL_PRICE = "0";
const DEFAULT_MANUAL_QUANTITY = "0";
const DEFAULT_MANUAL_NOTIONAL = "100";
const MAX_ACTIVITY_ITEMS = 8;

const transportOptions = [
  { value: "http", label: "HTTP" },
  { value: "kafka", label: "Kafka" },
  { value: "both", label: "Both" },
];

const sideOptions = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

type ActivityTone = "success" | "danger" | "info";

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tone: ActivityTone;
}

interface ActivityDescription {
  description: string;
  title: string;
  tone?: ActivityTone;
}

interface WorkflowLane {
  title: string;
  summary: string;
  nextAction: string;
  tone: "success" | "warning" | "info";
}

interface StatusCalloutProps {
  action?: ReactNode;
  className?: string;
  description: string;
  title: string;
  tone?: ActivityTone;
}

interface OperationBadgeProps {
  error?: unknown;
  idleLabel: string;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
  pendingLabel: string;
  successLabel: string;
}

interface MutationFeedbackOptions<TData, TVariables = void, TContext = unknown> {
  describeSuccess: (data: TData) => ActivityDescription;
  errorTitle: string;
  mutation: UseMutationResult<TData, Error, TVariables, TContext>;
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>;
}

function buildManualSignalId() {
  return `manual-signal-${Date.now()}`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Waiting";
  }

  return dateTimeFormatter.format(new Date(value));
}

function formatCount(value: number) {
  return numberFormatter.format(value);
}

function formatList(values: string[], emptyLabel: string) {
  if (!values.length) {
    return emptyLabel;
  }

  return values.join(", ");
}

function compactList(values: string[], emptyLabel: string) {
  if (!values.length) {
    return emptyLabel;
  }

  if (values.length <= 3) {
    return values.join(", ");
  }

  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

function describeAvailability(availability: UpstreamAvailability) {
  switch (availability) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    default:
      return "Checking";
  }
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Request failed.";
}

function toOptions(values: string[]) {
  return values.map((value) => ({ label: value, value }));
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNonNegative(value: string) {
  return Math.max(0, parseNumber(value, 0));
}

function appendActivity(
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>,
  item: Omit<ActivityItem, "id" | "timestamp">,
) {
  setActivity((current) => [
    {
      ...item,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
    },
    ...current,
  ].slice(0, MAX_ACTIVITY_ITEMS));
}

function useMutationFeedback<TData, TVariables, TContext>({
  describeSuccess,
  errorTitle,
  mutation,
  setActivity,
}: MutationFeedbackOptions<TData, TVariables, TContext>) {
  const lastSuccessData = useRef<TData | undefined>(undefined);
  const lastError = useRef<Error | null>(null);

  useEffect(() => {
    if (!mutation.isSuccess || mutation.data === undefined || mutation.data === lastSuccessData.current) {
      return;
    }

    lastSuccessData.current = mutation.data;
    const description = describeSuccess(mutation.data);
    appendActivity(setActivity, {
      description: description.description,
      title: description.title,
      tone: description.tone ?? "success",
    });
  }, [describeSuccess, mutation.data, mutation.isSuccess, setActivity]);

  useEffect(() => {
    if (!mutation.isError || !(mutation.error instanceof Error) || mutation.error === lastError.current) {
      return;
    }

    lastError.current = mutation.error;
    appendActivity(setActivity, {
      description: formatErrorMessage(mutation.error),
      title: errorTitle,
      tone: "danger",
    });
  }, [errorTitle, mutation.error, mutation.isError, setActivity]);
}

function StatusCallout({
  action,
  className,
  description,
  title,
  tone = "info",
}: StatusCalloutProps) {
  const toneMap: Record<ActivityTone, string> = {
    danger: "border-rose-300/18 bg-rose-300/[0.08] text-rose-100",
    info: "border-sky-300/18 bg-sky-300/[0.08] text-sky-100",
    success: "border-emerald-300/18 bg-emerald-300/[0.08] text-emerald-100",
  };

  return (
    <div
      className={cx(
        "rounded-[22px] border p-4",
        toneMap[tone],
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <p className="mt-2 text-sm leading-6 opacity-80">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

function OperationBadge({
  error,
  idleLabel,
  isError,
  isPending,
  isSuccess,
  pendingLabel,
  successLabel,
}: OperationBadgeProps) {
  if (isPending) {
    return <Badge tone="info">{pendingLabel}</Badge>;
  }

  if (isError) {
    return (
      <Badge title={formatErrorMessage(error)} tone="danger">
        Failed
      </Badge>
    );
  }

  if (isSuccess) {
    return <Badge tone="success">{successLabel}</Badge>;
  }

  return <Badge tone="neutral">{idleLabel}</Badge>;
}

function describeStartSessionSuccess(session: SimulationSession): ActivityDescription {
  return {
    description: `Current session is ${session.id} and is now ${session.status}.`,
    title: "Session started",
  };
}

function describeResetSessionSuccess(session: SimulationSession): ActivityDescription {
  return {
    description: `${session.id} reset count is now ${formatCount(session.reset_count)}.`,
    title: "Session reset",
  };
}

function describeStopSessionSuccess(session: SimulationSession): ActivityDescription {
  return {
    description: `${session.id} stopped at ${formatDateTime(session.stopped_at)}.`,
    title: "Session stopped",
  };
}

function describePublishMarketSuccess(payload: PublishQuotesResponse): ActivityDescription {
  return {
    description: `${formatCount(payload.published_count)} quotes published from ${payload.scenario} via ${payload.transport}.`,
    title: "Market publish completed",
  };
}

function describeReplayMarketSuccess(payload: ReplayQuotesResponse): ActivityDescription {
  return {
    description: `${formatCount(payload.published_count)} quotes replayed from ${payload.scenario} at ${payload.speed_multiplier}x.`,
    title: "Market replay completed",
  };
}

function describePublishSignalsSuccess(payload: PublishSignalsResponse): ActivityDescription {
  return {
    description: `${formatCount(payload.published_count)} signals published from ${payload.scenario} for ${compactList(payload.strategy_ids, "all strategies")}.`,
    title: "Strategy publish completed",
  };
}

function describeReplaySignalsSuccess(payload: ReplaySignalsResponse): ActivityDescription {
  return {
    description: `${formatCount(payload.published_count)} signals replayed from ${payload.scenario} at ${payload.speed_multiplier}x.`,
    title: "Strategy replay completed",
  };
}

function describeManualSignalSuccess(payload: SignalExecutionResponse): ActivityDescription {
  return {
    description: `${payload.execution.signal_id} from ${payload.execution.strategy_id} is ${payload.execution.status}.`,
    title: "Manual signal sent",
  };
}

function getWorkflowLanes(input: {
  currentSession: SimulationSession | undefined;
  marketCatalogReady: number;
  previewCount: number;
  strategyCatalogReady: number;
  strategySignalsLoading: boolean;
}): WorkflowLane[] {
  const { currentSession, marketCatalogReady, previewCount, strategyCatalogReady, strategySignalsLoading } =
    input;

  return [
    currentSession?.status === "running"
      ? {
          title: "1. Session lifecycle",
          summary: `${currentSession.id} is live and can be reset or stopped from this route.`,
          nextAction: "Use Start only when you want to mint or switch the live paper session.",
          tone: "success",
        }
      : {
          title: "1. Session lifecycle",
          summary: "No running paper session is currently visible in the lab.",
          nextAction: "Start a session before expecting market or signal actions to show up on the dashboard.",
          tone: "warning",
        },
    marketCatalogReady > 0
      ? {
          title: "2. Market replay",
          summary: `${formatCount(marketCatalogReady)} market scenarios are ready for publish or replay.`,
          nextAction: "Publish latest for a fast spot-check, or replay a full scenario when you want a longer live stream.",
          tone: "success",
        }
      : {
          title: "2. Market replay",
          summary: "Market replay catalogs have not loaded yet.",
          nextAction: "Refresh catalogs before trying to publish quote scenarios.",
          tone: "warning",
        },
    strategyCatalogReady > 0
      ? {
          title: "3. Strategy replay",
          summary: strategySignalsLoading
            ? "Scenario and signal catalogs are loading for the selected strategy context."
            : `${formatCount(previewCount)} preview signals are visible for the current slice.`,
          nextAction: "Use publish for a bounded slice, or replay all when you want the whole scenario to flow through the simulator.",
          tone: strategySignalsLoading ? "info" : "success",
        }
      : {
          title: "3. Strategy replay",
          summary: "Strategy scenarios are not ready yet.",
          nextAction: "Refresh catalogs before relying on signal replay or slice publishing.",
          tone: "warning",
        },
    {
      title: "4. Manual override",
      summary: "Manual signal dispatch stays available as the fastest override path.",
      nextAction: "Use this only when you need to inject one explicit signal without replaying a whole scenario.",
      tone: "info",
    },
  ];
}

export function OperatorLabRoute() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessionIdDraft, setSessionIdDraft] = useState<string | null>(null);
  const [marketScenario, setMarketScenario] = useState("");
  const [marketTransport, setMarketTransport] = useState(DEFAULT_MARKET_TRANSPORT);
  const [marketSpeed, setMarketSpeed] = useState(DEFAULT_MARKET_SPEED);
  const [strategyScenario, setStrategyScenario] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [strategyLimit, setStrategyLimit] = useState(DEFAULT_STRATEGY_LIMIT);
  const [strategyOffset, setStrategyOffset] = useState(DEFAULT_STRATEGY_OFFSET);
  const [strategyReplaySpeed, setStrategyReplaySpeed] = useState(DEFAULT_STRATEGY_REPLAY_SPEED);
  const [manualStrategyId, setManualStrategyId] = useState(DEFAULT_MANUAL_STRATEGY_ID);
  const [manualSignalId, setManualSignalId] = useState(buildManualSignalId);
  const [manualSymbol, setManualSymbol] = useState(DEFAULT_MANUAL_SYMBOL);
  const [manualSide, setManualSide] = useState(DEFAULT_MANUAL_SIDE);
  const [manualPrice, setManualPrice] = useState(DEFAULT_MANUAL_PRICE);
  const [manualQuantity, setManualQuantity] = useState(DEFAULT_MANUAL_QUANTITY);
  const [manualNotional, setManualNotional] = useState(DEFAULT_MANUAL_NOTIONAL);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);

  const coreHealthQuery = useCoreHealthQuery();
  const dataHealthQuery = useDataHealthQuery();
  const currentSessionQuery = useCurrentSessionQuery();
  const marketScenariosQuery = useMarketReplayScenariosQuery();
  const strategyScenariosQuery = useStrategySignalScenariosQuery();
  const coreAvailability = resolveServiceAvailability(coreHealthQuery);
  const dataAvailability = resolveServiceAvailability(dataHealthQuery);
  const coreUnavailable = coreAvailability === "down";
  const dataUnavailable = dataAvailability === "down";
  const upstreamUnavailable = coreUnavailable || dataUnavailable;
  const resolvedSessionIdDraft =
    sessionIdDraft ?? currentSessionQuery.data?.id ?? DEFAULT_SESSION_ID;
  const resolvedMarketScenario =
    marketScenario && marketScenariosQuery.data?.includes(marketScenario)
      ? marketScenario
      : marketScenariosQuery.data?.[0] ?? marketScenario;
  const resolvedStrategyScenario =
    strategyScenario && strategyScenariosQuery.data?.includes(strategyScenario)
      ? strategyScenario
      : strategyScenariosQuery.data?.[0] ?? strategyScenario;
  const strategySignalsQuery = useStrategySignalsQuery(
    { scenario: resolvedStrategyScenario || undefined },
    { enabled: Boolean(resolvedStrategyScenario) },
  );

  const startSessionMutation = useStartSessionMutation();
  const resetSessionMutation = useResetSessionMutation();
  const stopSessionMutation = useStopSessionMutation();
  const publishMarketMutation = usePublishMarketQuotesMutation();
  const replayMarketMutation = useReplayMarketQuotesMutation();
  const publishSignalsMutation = usePublishStrategySignalsMutation();
  const replaySignalsMutation = useReplayStrategySignalsMutation();
  const manualSignalMutation = useSendManualSignalMutation();

  useMutationFeedback({
    describeSuccess: describeStartSessionSuccess,
    errorTitle: "Session start failed",
    mutation: startSessionMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describeResetSessionSuccess,
    errorTitle: "Session reset failed",
    mutation: resetSessionMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describeStopSessionSuccess,
    errorTitle: "Session stop failed",
    mutation: stopSessionMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describePublishMarketSuccess,
    errorTitle: "Market publish failed",
    mutation: publishMarketMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describeReplayMarketSuccess,
    errorTitle: "Market replay failed",
    mutation: replayMarketMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describePublishSignalsSuccess,
    errorTitle: "Strategy publish failed",
    mutation: publishSignalsMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describeReplaySignalsSuccess,
    errorTitle: "Strategy replay failed",
    mutation: replaySignalsMutation,
    setActivity,
  });
  useMutationFeedback({
    describeSuccess: describeManualSignalSuccess,
    errorTitle: "Manual signal failed",
    mutation: manualSignalMutation,
    setActivity,
  });

  const strategyIds = Array.from(
    new Set((strategySignalsQuery.data ?? []).map((signal) => signal.strategy_id)),
  ).sort((left, right) => left.localeCompare(right));
  const resolvedStrategyId =
    strategyId && strategyIds.includes(strategyId) ? strategyId : "";
  const filteredSignals = (strategySignalsQuery.data ?? []).filter((signal) =>
    resolvedStrategyId ? signal.strategy_id === resolvedStrategyId : true,
  );
  const previewOffset = parseNonNegative(strategyOffset);
  const previewLimit = parseNumber(strategyLimit, 0);
  const previewSignals = filteredSignals.slice(
    previewOffset,
    previewLimit > 0 ? previewOffset + previewLimit : undefined,
  );
  const anyMutationPending =
    startSessionMutation.isPending ||
    resetSessionMutation.isPending ||
    stopSessionMutation.isPending ||
    publishMarketMutation.isPending ||
    replayMarketMutation.isPending ||
    publishSignalsMutation.isPending ||
    replaySignalsMutation.isPending ||
    manualSignalMutation.isPending;

  async function handleRefreshReferenceData() {
    setCatalogRefreshing(true);

    try {
      await Promise.all([
        coreHealthQuery.refetch(),
        dataHealthQuery.refetch(),
        currentSessionQuery.refetch(),
        marketScenariosQuery.refetch(),
        strategyScenariosQuery.refetch(),
        strategySignalsQuery.refetch(),
      ]);
      appendActivity(setActivity, {
        description: "Reference scenarios and current session state were refreshed.",
        title: "Lab catalogs refreshed",
        tone: "info",
      });
    } catch (error) {
      appendActivity(setActivity, {
        description: formatErrorMessage(error),
        title: "Lab refresh failed",
        tone: "danger",
      });
    } finally {
      setCatalogRefreshing(false);
    }
  }

  function handleResetDrafts() {
    setSessionIdDraft(null);
    setMarketScenario(marketScenariosQuery.data?.[0] ?? "");
    setMarketTransport(DEFAULT_MARKET_TRANSPORT);
    setMarketSpeed(DEFAULT_MARKET_SPEED);
    setStrategyScenario(strategyScenariosQuery.data?.[0] ?? "");
    setStrategyId("");
    setStrategyLimit(DEFAULT_STRATEGY_LIMIT);
    setStrategyOffset(DEFAULT_STRATEGY_OFFSET);
    setStrategyReplaySpeed(DEFAULT_STRATEGY_REPLAY_SPEED);
    setManualStrategyId(DEFAULT_MANUAL_STRATEGY_ID);
    setManualSignalId(buildManualSignalId());
    setManualSymbol(DEFAULT_MANUAL_SYMBOL);
    setManualSide(DEFAULT_MANUAL_SIDE);
    setManualPrice(DEFAULT_MANUAL_PRICE);
    setManualQuantity(DEFAULT_MANUAL_QUANTITY);
    setManualNotional(DEFAULT_MANUAL_NOTIONAL);
    appendActivity(setActivity, {
      description: "Session, replay, and manual signal drafts were restored to defaults.",
      title: "Drafts reset",
      tone: "info",
    });
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
      await startSessionMutation.mutateAsync(
      resolvedSessionIdDraft.trim() ? { session_id: resolvedSessionIdDraft.trim() } : {},
    );
  }

  async function handleResetSession() {
    await resetSessionMutation.mutateAsync();
  }

  async function handleStopSession() {
    await stopSessionMutation.mutateAsync();
  }

  async function handlePublishMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await publishMarketMutation.mutateAsync({
      scenario: resolvedMarketScenario || undefined,
      transport: marketTransport,
    });
  }

  async function handleReplayMarket() {
    await replayMarketMutation.mutateAsync({
      scenario: resolvedMarketScenario || undefined,
      speed_multiplier: parseNumber(marketSpeed, 0),
      transport: marketTransport,
    });
  }

  async function handlePublishSignals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await publishSignalsMutation.mutateAsync({
      limit: parseNumber(strategyLimit, 0),
      offset: parseNonNegative(strategyOffset),
      scenario: resolvedStrategyScenario || undefined,
      strategy_id: resolvedStrategyId || null,
    });
  }

  async function handleReplaySignals() {
    await replaySignalsMutation.mutateAsync({
      scenario: resolvedStrategyScenario || undefined,
      speed_multiplier: parseNumber(strategyReplaySpeed, 0),
      strategy_id: resolvedStrategyId || null,
    });
  }

  async function handleSendManualSignal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await manualSignalMutation.mutateAsync({
      notional: parseNumber(manualNotional, 0),
      price_hint: parseNumber(manualPrice, 0),
      quantity: parseNumber(manualQuantity, 0),
      side: manualSide as "buy" | "sell",
      signal_id: manualSignalId.trim(),
      strategy_id: manualStrategyId.trim(),
      symbol: manualSymbol.trim(),
      timestamp: new Date().toISOString(),
    });

    setManualSignalId(buildManualSignalId());
  }

  const currentSessionTone =
    coreUnavailable
      ? "danger"
      : currentSessionQuery.data?.status === "running"
        ? "success"
        : "warning";
  const marketCatalogReady = marketScenariosQuery.data?.length ?? 0;
  const strategyCatalogReady = strategyScenariosQuery.data?.length ?? 0;
  const previewCount = previewSignals.length;
  const workflowLanes = getWorkflowLanes({
    currentSession: currentSessionQuery.data,
    marketCatalogReady,
    previewCount,
    strategyCatalogReady,
    strategySignalsLoading: strategySignalsQuery.isLoading,
  });

  return (
    <>
      <PageHeader
        eyebrow="Operator Lab"
        title="Mutating controls now live in a dedicated operator workspace."
        description="Session lifecycle actions, market replay, strategy replay, and manual signal dispatch are isolated from the dashboard so operators can act without polluting historical review."
        actions={
          <>
            <Button
              leading={<ArrowUpRightIcon className="size-4" />}
              onClick={() => {
                void handleRefreshReferenceData();
              }}
              tone="primary"
              disabled={catalogRefreshing}
            >
              {catalogRefreshing ? "Refreshing..." : "Refresh catalogs"}
            </Button>
            <Button onClick={handleResetDrafts} tone="ghost" disabled={anyMutationPending}>
              Reset drafts
            </Button>
          </>
        }
        meta={[
          {
            label: "Current session",
            value: currentSessionQuery.data?.id ?? "Not loaded",
          },
          {
            label: "Market scenarios",
            value: String(marketCatalogReady),
          },
          {
            label: "Strategy scenarios",
            value: String(strategyCatalogReady),
          },
          {
            label: "Preview signals",
            value: String(previewCount),
          },
        ]}
        aside={
          <div className="grid gap-3">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Badge leading={<LabIcon className="size-3" />} tone={currentSessionTone}>
                  {coreUnavailable
                    ? "Core down"
                    : currentSessionQuery.isLoading
                    ? "Loading session"
                    : currentSessionQuery.data?.status ?? "Session unavailable"}
                </Badge>
                <Badge
                  leading={<DatabaseIcon className="size-3" />}
                  tone={dataUnavailable ? "danger" : "info"}
                >
                  Data {describeAvailability(dataAvailability)}
                </Badge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                This route only uses the shared API/query layer. Current-session actions stay
                live here while historical review remains read-only elsewhere.
              </p>
            </div>
            {upstreamUnavailable ? (
              <StatusCallout
                description={
                  coreUnavailable && dataUnavailable
                    ? "Both core and data upstreams are unavailable. Session controls and replay actions are temporarily locked."
                    : coreUnavailable
                      ? "Core trading is unavailable. Session lifecycle and manual signal actions are locked until /core/health recovers."
                      : "Data pipeline is unavailable. Market and strategy replay actions are locked until /data/health recovers."
                }
                title="Upstream availability degraded"
                tone="danger"
              />
            ) : null}
            {anyMutationPending ? (
              <StatusCallout
                description="An operator mutation is in flight. Current-session queries will be invalidated after it completes."
                title="Operator action running"
                tone="info"
              />
            ) : null}
          </div>
        }
      />

      <section className="grid gap-5 xl:grid-cols-4">
        <StatCard
          detail={
            coreUnavailable
              ? "Core health checks are failing."
              : currentSessionQuery.data
              ? `Last event ${formatDateTime(currentSessionQuery.data.last_event_at)}`
              : "Waiting for the current session query."
          }
          icon={<PulseIcon className="size-5" />}
          label="Current session"
          tone={coreUnavailable ? "warning" : currentSessionQuery.data?.status === "running" ? "success" : "neutral"}
          value={coreUnavailable ? "down" : currentSessionQuery.data?.status ?? "loading"}
        />
        <StatCard
          detail={
            dataUnavailable
              ? "Data health checks are failing."
              : formatList(marketScenariosQuery.data ?? [], "No market scenarios yet")
          }
          icon={<DatabaseIcon className="size-5" />}
          label="Market catalogs"
          tone={dataUnavailable ? "warning" : marketCatalogReady ? "accent" : "neutral"}
          value={dataUnavailable ? "down" : String(marketCatalogReady)}
        />
        <StatCard
          detail={formatList(strategyIds, "No strategy IDs loaded")}
          icon={<ShieldIcon className="size-5" />}
          label="Strategy IDs"
          tone={strategyIds.length ? "accent" : "neutral"}
          value={String(strategyIds.length)}
        />
        <StatCard
          detail={
            activity[0]
              ? `${activity[0].title} at ${formatDateTime(activity[0].timestamp)}`
              : "No operator actions recorded yet."
          }
          icon={<ClockIcon className="size-5" />}
          label="Recent actions"
          tone={activity.length ? "warning" : "neutral"}
          value={String(activity.length)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <Panel
          eyebrow="Runbook"
          title="Recommended operator sequence"
          description="The lab keeps mutating controls separated by workflow so operators can move from session setup to replay to manual override without guessing what comes next."
          tone="soft"
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {workflowLanes.map((lane) => (
              <div
                key={lane.title}
                className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={lane.tone}>{lane.title}</Badge>
                </div>
                <div className="mt-3 text-sm font-medium text-white">{lane.summary}</div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{lane.nextAction}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Mutation posture"
          title="What is safe to do next"
          description="This side panel makes the current control posture explicit before you fire a mutation."
          tone="accent"
        >
          <div className="grid gap-3">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  tone={
                    coreUnavailable
                      ? "danger"
                      : currentSessionQuery.data?.status === "running"
                        ? "success"
                        : "warning"
                  }
                >
                  {coreUnavailable
                    ? "Core unavailable"
                    : currentSessionQuery.data?.status === "running"
                      ? "Live session ready"
                      : "Session action needed"}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {coreUnavailable
                  ? "Session lifecycle and manual signal actions are locked until the paper engine becomes reachable again."
                  : currentSessionQuery.data?.status === "running"
                  ? "Market and strategy mutations will feed the current live paper session immediately."
                  : "Start a paper session first so replay and publish actions have an active target."}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={anyMutationPending ? "warning" : "info"}>
                  {anyMutationPending ? "Mutation in flight" : "No mutation in flight"}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {anyMutationPending
                  ? "Wait for the current action to settle before queuing another sensitive lifecycle change."
                  : "This is a good time to run the next publish, replay, or lifecycle action."}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="danger">Reset and stop are destructive</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Reset restarts the current session state. Stop closes the active paper session and should usually be the last lifecycle action in a run.
              </p>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            eyebrow="Session lifecycle"
            title="Current session control"
            description="Start, reset, and stop the live paper session without leaving the operator route."
            actions={
              <div className="flex flex-wrap gap-2">
                <OperationBadge
                  error={startSessionMutation.error}
                  idleLabel="Start ready"
                  isError={startSessionMutation.isError}
                  isPending={startSessionMutation.isPending}
                  isSuccess={startSessionMutation.isSuccess}
                  pendingLabel="Starting"
                  successLabel="Started"
                />
                <OperationBadge
                  error={resetSessionMutation.error}
                  idleLabel="Reset ready"
                  isError={resetSessionMutation.isError}
                  isPending={resetSessionMutation.isPending}
                  isSuccess={resetSessionMutation.isSuccess}
                  pendingLabel="Resetting"
                  successLabel="Reset"
                />
                <OperationBadge
                  error={stopSessionMutation.error}
                  idleLabel="Stop ready"
                  isError={stopSessionMutation.isError}
                  isPending={stopSessionMutation.isPending}
                  isSuccess={stopSessionMutation.isSuccess}
                  pendingLabel="Stopping"
                  successLabel="Stopped"
                />
              </div>
            }
          >
            <form className="grid gap-4" onSubmit={(event) => void handleStartSession(event)}>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="info">Recommended order</Badge>
                  <Badge tone="warning">Start → Reset → Stop</Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Start is for minting or switching the live session. Reset is for replaying the same lane from a clean slate. Stop should usually be the final lifecycle action after monitoring the run.
                </p>
              </div>
              <Input
                hint="Leave blank only if the backend should mint a session ID."
                label="Session ID"
                onChange={(event) => {
                  setSessionIdDraft(event.target.value);
                }}
                placeholder={DEFAULT_SESSION_ID}
                value={resolvedSessionIdDraft}
              />
              {currentSessionQuery.isError ? (
                <StatusCallout
                  action={
                    <Button
                      onClick={() => {
                        void currentSessionQuery.refetch();
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Retry
                    </Button>
                  }
                  description={formatErrorMessage(currentSessionQuery.error)}
                  title="Current session query failed"
                  tone="danger"
                />
              ) : currentSessionQuery.isLoading ? (
                <StatusCallout
                  description="Loading current session status before the next operator action."
                  title="Loading session"
                  tone="info"
                />
              ) : (
                <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={currentSessionQuery.data?.status === "running" ? "success" : "warning"}>
                      {currentSessionQuery.data?.status ?? "unknown"}
                    </Badge>
                    <span className="text-sm text-slate-300">
                      {currentSessionQuery.data?.id ?? "No current session"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    Last event {formatDateTime(currentSessionQuery.data?.last_event_at)}.
                  </p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Button
                  tone="primary"
                  type="submit"
                  disabled={coreUnavailable || startSessionMutation.isPending}
                >
                  {startSessionMutation.isPending ? "Starting..." : "Start"}
                </Button>
                <Button
                  onClick={() => {
                    void handleResetSession();
                  }}
                  tone="secondary"
                  disabled={coreUnavailable || resetSessionMutation.isPending}
                >
                  {resetSessionMutation.isPending ? "Resetting..." : "Reset"}
                </Button>
                <Button
                  onClick={() => {
                    void handleStopSession();
                  }}
                  tone="danger"
                  disabled={coreUnavailable || stopSessionMutation.isPending}
                >
                  {stopSessionMutation.isPending ? "Stopping..." : "Stop"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            eyebrow="Market replay"
            title="Quote publishing"
            description="Publish the latest scenario tick or replay an entire market scenario through the existing transport contract."
            actions={
              <div className="flex flex-wrap gap-2">
                <OperationBadge
                  error={publishMarketMutation.error}
                  idleLabel="Publish ready"
                  isError={publishMarketMutation.isError}
                  isPending={publishMarketMutation.isPending}
                  isSuccess={publishMarketMutation.isSuccess}
                  pendingLabel="Publishing"
                  successLabel="Published"
                />
                <OperationBadge
                  error={replayMarketMutation.error}
                  idleLabel="Replay ready"
                  isError={replayMarketMutation.isError}
                  isPending={replayMarketMutation.isPending}
                  isSuccess={replayMarketMutation.isSuccess}
                  pendingLabel="Replaying"
                  successLabel="Replayed"
                />
              </div>
            }
          >
            <form className="grid gap-4" onSubmit={(event) => void handlePublishMarket(event)}>
              <Select
                hint="Pulled from /data/api/data/market/quotes/replay/scenarios."
                label="Scenario"
                onChange={(event) => setMarketScenario(event.target.value)}
                options={toOptions(marketScenariosQuery.data ?? [])}
                placeholder={
                  marketScenariosQuery.isLoading ? "Loading scenarios..." : "No scenarios available"
                }
                value={resolvedMarketScenario}
              />
              <Select
                label="Transport"
                onChange={(event) => setMarketTransport(event.target.value)}
                options={transportOptions}
                value={marketTransport}
              />
              <Input
                hint="Used for full scenario replay only."
                label="Speed multiplier"
                min="0"
                onChange={(event) => setMarketSpeed(event.target.value)}
                step="0.1"
                type="number"
                value={marketSpeed}
              />
              {marketScenariosQuery.isError ? (
                <StatusCallout
                  action={
                    <Button
                      onClick={() => {
                        void marketScenariosQuery.refetch();
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Retry
                    </Button>
                  }
                  description={formatErrorMessage(marketScenariosQuery.error)}
                  title="Market scenarios could not be loaded"
                  tone="danger"
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  tone="primary"
                  type="submit"
                  disabled={
                    upstreamUnavailable ||
                    !resolvedMarketScenario ||
                    publishMarketMutation.isPending
                  }
                >
                  {publishMarketMutation.isPending ? "Publishing..." : "Publish latest"}
                </Button>
                <Button
                  onClick={() => {
                    void handleReplayMarket();
                  }}
                  tone="secondary"
                  disabled={
                    upstreamUnavailable ||
                    !resolvedMarketScenario ||
                    replayMarketMutation.isPending
                  }
                >
                  {replayMarketMutation.isPending ? "Replaying..." : "Replay scenario"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            eyebrow="Strategy replay"
            title="Scenario publishing"
            description="Use live scenario catalogs to preview available signals, then publish or replay the selected slice."
            actions={
              <div className="flex flex-wrap gap-2">
                <OperationBadge
                  error={publishSignalsMutation.error}
                  idleLabel="Publish ready"
                  isError={publishSignalsMutation.isError}
                  isPending={publishSignalsMutation.isPending}
                  isSuccess={publishSignalsMutation.isSuccess}
                  pendingLabel="Publishing"
                  successLabel="Published"
                />
                <OperationBadge
                  error={replaySignalsMutation.error}
                  idleLabel="Replay ready"
                  isError={replaySignalsMutation.isError}
                  isPending={replaySignalsMutation.isPending}
                  isSuccess={replaySignalsMutation.isSuccess}
                  pendingLabel="Replaying"
                  successLabel="Replayed"
                />
              </div>
            }
          >
            <form className="grid gap-4" onSubmit={(event) => void handlePublishSignals(event)}>
              <Select
                hint="Pulled from /data/api/data/strategy/signals/scenarios."
                label="Scenario"
                onChange={(event) => setStrategyScenario(event.target.value)}
                options={toOptions(strategyScenariosQuery.data ?? [])}
                placeholder={
                  strategyScenariosQuery.isLoading ? "Loading scenarios..." : "No scenarios available"
                }
                value={resolvedStrategyScenario}
              />
              <Select
                hint="Derived from the selected scenario's signal catalog."
                label="Strategy ID"
                onChange={(event) => setStrategyId(event.target.value)}
                options={toOptions(strategyIds)}
                placeholder="All strategies"
                value={resolvedStrategyId}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Limit"
                  min="0"
                  onChange={(event) => setStrategyLimit(event.target.value)}
                  type="number"
                  value={strategyLimit}
                />
                <Input
                  label="Offset"
                  min="0"
                  onChange={(event) => setStrategyOffset(event.target.value)}
                  type="number"
                  value={strategyOffset}
                />
              </div>
              <Input
                hint="Defaults to 0x to match the existing operator flow."
                label="Replay speed"
                min="0"
                onChange={(event) => setStrategyReplaySpeed(event.target.value)}
                step="0.1"
                type="number"
                value={strategyReplaySpeed}
              />
              {strategyScenariosQuery.isError ? (
                <StatusCallout
                  action={
                    <Button
                      onClick={() => {
                        void strategyScenariosQuery.refetch();
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Retry
                    </Button>
                  }
                  description={formatErrorMessage(strategyScenariosQuery.error)}
                  title="Strategy scenarios could not be loaded"
                  tone="danger"
                />
              ) : null}
              {strategySignalsQuery.isError ? (
                <StatusCallout
                  action={
                    <Button
                      onClick={() => {
                        void strategySignalsQuery.refetch();
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Retry
                    </Button>
                  }
                  description={formatErrorMessage(strategySignalsQuery.error)}
                  title="Signal catalog preview failed"
                  tone="danger"
                />
              ) : strategySignalsQuery.isLoading ? (
                <StatusCallout
                  description="Fetching the scenario signal catalog so strategy IDs and previews stay in sync."
                  title="Loading signal catalog"
                  tone="info"
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  tone="primary"
                  type="submit"
                  disabled={
                    upstreamUnavailable ||
                    !resolvedStrategyScenario ||
                    publishSignalsMutation.isPending
                  }
                >
                  {publishSignalsMutation.isPending ? "Publishing..." : "Publish slice"}
                </Button>
                <Button
                  onClick={() => {
                    void handleReplaySignals();
                  }}
                  tone="secondary"
                  disabled={
                    upstreamUnavailable ||
                    !resolvedStrategyScenario ||
                    replaySignalsMutation.isPending
                  }
                >
                  {replaySignalsMutation.isPending ? "Replaying..." : "Replay all"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            eyebrow="Manual signal"
            title="Signal composer"
            description="Dispatch a single signal through `/core/internal/signals` without bypassing the typed mutation layer."
            actions={
              <OperationBadge
                error={manualSignalMutation.error}
                idleLabel="Ready"
                isError={manualSignalMutation.isError}
                isPending={manualSignalMutation.isPending}
                isSuccess={manualSignalMutation.isSuccess}
                pendingLabel="Sending"
                successLabel="Sent"
              />
            }
          >
            <form className="grid gap-4" onSubmit={(event) => void handleSendManualSignal(event)}>
              <Input
                label="Strategy ID"
                onChange={(event) => setManualStrategyId(event.target.value)}
                required
                value={manualStrategyId}
              />
              <Input
                label="Signal ID"
                onChange={(event) => setManualSignalId(event.target.value)}
                required
                value={manualSignalId}
              />
              <Input
                label="Symbol"
                onChange={(event) => setManualSymbol(event.target.value.toUpperCase())}
                required
                value={manualSymbol}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Side"
                  onChange={(event) => setManualSide(event.target.value)}
                  options={sideOptions}
                  value={manualSide}
                />
                <Input
                  label="Price hint"
                  min="0"
                  onChange={(event) => setManualPrice(event.target.value)}
                  step="0.0001"
                  type="number"
                  value={manualPrice}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Quantity"
                  min="0"
                  onChange={(event) => setManualQuantity(event.target.value)}
                  step="0.0001"
                  type="number"
                  value={manualQuantity}
                />
                <Input
                  hint="Set 0 when quantity drives the order."
                  label="Notional"
                  min="0"
                  onChange={(event) => setManualNotional(event.target.value)}
                  step="0.01"
                  type="number"
                  value={manualNotional}
                />
              </div>
              <Button
                tone="primary"
                type="submit"
                disabled={
                  coreUnavailable ||
                  manualSignalMutation.isPending ||
                  !manualStrategyId.trim() ||
                  !manualSignalId.trim() ||
                  !manualSymbol.trim()
                }
              >
                {manualSignalMutation.isPending ? "Sending..." : "Send signal"}
              </Button>
            </form>
          </Panel>

          <Panel
            eyebrow="Signal preview"
            title="Scenario slice preview"
            description="Preview the selected scenario and strategy slice before mutating the live session."
            className="xl:col-span-2"
          >
            <DataTable<StrategySignal>
              caption="Signal preview"
              columns={[
                {
                  cell: (signal) => formatDateTime(signal.timestamp),
                  header: "Timestamp",
                  key: "timestamp",
                },
                {
                  cell: (signal) => signal.strategy_id,
                  header: "Strategy",
                  key: "strategy",
                },
                {
                  cell: (signal) => signal.signal_id,
                  header: "Signal",
                  key: "signal",
                },
                {
                  cell: (signal) => signal.symbol,
                  header: "Symbol",
                  key: "symbol",
                },
                {
                  cell: (signal) => (
                    <Badge tone={signal.side === "buy" ? "success" : "danger"}>
                      {signal.side}
                    </Badge>
                  ),
                  header: "Side",
                  key: "side",
                },
              ]}
              emptyDescription="Choose a strategy scenario or adjust limit and offset until the slice contains rows."
              emptyTitle="No signals match this preview slice"
              getRowId={(signal) => `${signal.strategy_id}:${signal.signal_id}`}
              rows={previewSignals}
            />
          </Panel>
        </div>

        <div className="grid gap-6">
          <Panel
            eyebrow="Recent activity"
            title="Operator activity feed"
            description="Every mutation success and failure is recorded locally so operators have immediate feedback without checking the browser console."
          >
            {activity.length ? (
              <div className="feed-scroll grid max-h-[560px] gap-3 overflow-auto pr-2">
                {activity.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Badge tone={item.tone}>{item.title}</Badge>
                      <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        {formatDateTime(item.timestamp)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{item.description}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                eyebrow="Activity"
                title="No operator actions recorded yet"
                description="Run a session action, publish a scenario, or send a manual signal to populate the local activity feed."
                icon={<ClockIcon className="size-5" />}
              />
            )}
          </Panel>

          <Panel
            eyebrow="Reference state"
            title="Data and session health"
            description="The operator route depends on shared queries for current-session state and scenario catalogs."
          >
            <div className="grid gap-3">
              <StatusCallout
                description={
                  coreUnavailable
                    ? "Core health checks are failing, so current-session state cannot be trusted yet."
                    : currentSessionQuery.isError
                    ? formatErrorMessage(currentSessionQuery.error)
                    : currentSessionQuery.data
                      ? `${currentSessionQuery.data.id} last changed at ${formatDateTime(currentSessionQuery.data.last_event_at)}.`
                      : "Session query has not resolved yet."
                }
                title="Paper session"
                tone={coreUnavailable || currentSessionQuery.isError ? "danger" : "success"}
              />
              <StatusCallout
                description={
                  dataUnavailable
                    ? "Data health checks are failing, so market replay catalogs are temporarily unavailable."
                    : marketScenariosQuery.isError
                    ? formatErrorMessage(marketScenariosQuery.error)
                    : `${marketCatalogReady} market scenarios available.`
                }
                title="Market scenario catalog"
                tone={dataUnavailable || marketScenariosQuery.isError ? "danger" : "success"}
              />
              <StatusCallout
                description={
                  dataUnavailable
                    ? "Data health checks are failing, so strategy preview data is temporarily unavailable."
                    : strategySignalsQuery.isError
                    ? formatErrorMessage(strategySignalsQuery.error)
                    : `${strategySignalsQuery.data?.length ?? 0} source signals loaded for preview.`
                }
                title="Strategy signal catalog"
                tone={dataUnavailable || strategySignalsQuery.isError ? "danger" : "success"}
              />
            </div>
          </Panel>
        </div>
      </section>
    </>
  );
}
