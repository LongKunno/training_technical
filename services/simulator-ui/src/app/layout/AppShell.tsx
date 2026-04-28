import { useEffect, type ComponentType, type ReactNode } from "react";

import { Link, useLocation } from "react-router-dom";

import {
  resolveServiceAvailability,
  useBotHealthQuery,
  useCoreHealthQuery,
  useDataHealthQuery,
} from "../../shared/query";
import {
  selectSelectedSessionId,
  selectTimelineStreamStatus,
  useOperatorUiStore,
} from "../../shared/state";
import type {
  ServiceHealth,
  TimelineStreamStatus,
  UpstreamAvailability,
} from "../../shared/types";
import {
  Badge,
  Button,
  ContextDrawer,
  DashboardIcon,
  DatabaseIcon,
  LabIcon,
  PulseIcon,
  RunsIcon,
  SessionsIcon,
  ShieldIcon,
  SparklineIcon,
  SummaryStrip,
  WorkspaceNavGroup,
} from "../../shared/ui";

interface AppShellProps {
  children: ReactNode;
}

const navigationGroups = [
  {
    label: "Monitor",
    items: [{ href: "/dashboard", icon: DashboardIcon, label: "Dashboard" }],
  },
  {
    label: "History",
    items: [{ href: "/sessions", icon: SessionsIcon, label: "Sessions" }],
  },
  {
    label: "Simulation",
    items: [
      { href: "/runs", icon: RunsIcon, label: "Runs" },
      { href: "/experiments", icon: RunsIcon, label: "Experiments" },
      { href: "/leaderboard", icon: SparklineIcon, label: "Leaderboard" },
    ],
  },
  {
    label: "Lab",
    items: [{ href: "/lab", icon: LabIcon, label: "Lab" }],
  },
] as const;

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

interface RuntimeStatusCard {
  badgeLabel: string;
  badgeTone: BadgeTone;
  description: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
}

interface RouteContext {
  workspace: string;
  surface: string;
  mode: string;
  entity: string;
}

function getAvailabilityBadgeTone(availability: UpstreamAvailability): BadgeTone {
  switch (availability) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

function getAvailabilityLabel(availability: UpstreamAvailability): string {
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

function getCompositeHealthTone(
  coreAvailability: UpstreamAvailability,
  dataAvailability: UpstreamAvailability,
  botAvailability: UpstreamAvailability,
): BadgeTone {
  if (
    coreAvailability === "down" ||
    dataAvailability === "down" ||
    botAvailability === "down"
  ) {
    return "danger";
  }

  if (
    coreAvailability === "degraded" ||
    dataAvailability === "degraded" ||
    botAvailability === "degraded"
  ) {
    return "warning";
  }

  if (
    coreAvailability === "healthy" &&
    dataAvailability === "healthy" &&
    botAvailability === "healthy"
  ) {
    return "success";
  }

  return "neutral";
}

function buildServiceStatusCard(input: {
  availability: UpstreamAvailability;
  fallbackDescription: string;
  health?: ServiceHealth;
  icon: ComponentType<{ className?: string }>;
  title: string;
}): RuntimeStatusCard {
  return {
    badgeLabel: getAvailabilityLabel(input.availability),
    badgeTone: getAvailabilityBadgeTone(input.availability),
    description:
      input.health?.message ||
      (input.availability === "down"
        ? `${input.title} is unreachable from the shell right now.`
        : input.fallbackDescription),
    icon: input.icon,
    title: input.title,
  };
}

function buildTimelineStatusCard(
  pathname: string,
  status: TimelineStreamStatus,
): RuntimeStatusCard {
  if (!pathname.startsWith("/dashboard")) {
    return {
      badgeLabel: "Idle",
      badgeTone: "neutral",
      description:
        "Current-session SSE chỉ gắn trên Dashboard, nên các route historical và simulation detail vẫn bất biến.",
      icon: PulseIcon,
      title: "Current SSE",
    };
  }

  if (status === "open") {
    return {
      badgeLabel: "Live",
      badgeTone: "success",
      description:
        "Current-session timeline đang stream vào Dashboard mà không làm mutation bề mặt lịch sử.",
      icon: PulseIcon,
      title: "Current SSE",
    };
  }

  if (status === "connecting") {
    return {
      badgeLabel: "Connecting",
      badgeTone: "info",
      description:
        "Dashboard đã mount stream và đang chờ current-session feed mở hoàn toàn.",
      icon: PulseIcon,
      title: "Current SSE",
    };
  }

  if (status === "degraded") {
    return {
      badgeLabel: "Degraded",
      badgeTone: "warning",
      description: "Dashboard đang retry kết nối SSE sau một lần stream lỗi.",
      icon: PulseIcon,
      title: "Current SSE",
    };
  }

  return {
    badgeLabel: "Idle",
    badgeTone: "neutral",
    description: "Current-session SSE chưa được mount trên route này.",
    icon: PulseIcon,
    title: "Current SSE",
  };
}

function getRouteContext(
  pathname: string,
  selectedSessionId: string | null,
): RouteContext {
  if (pathname.startsWith("/sessions/")) {
    return {
      workspace: "History",
      surface: "Session detail",
      mode: "Immutable detail",
      entity: pathname.split("/").at(-1) ?? "Missing session",
    };
  }

  if (pathname === "/sessions") {
    return {
      workspace: "History",
      surface: "Sessions",
      mode: "Split review",
      entity: selectedSessionId ?? "No preview locked",
    };
  }

  if (pathname.startsWith("/runs/")) {
    return {
      workspace: "Simulation",
      surface: "Run detail",
      mode: "Immutable detail",
      entity: pathname.split("/").at(-1) ?? "Missing run",
    };
  }

  if (pathname === "/runs") {
    return {
      workspace: "Simulation",
      surface: "Runs",
      mode: "Standalone planner",
      entity: "Queue + preview",
    };
  }

  if (pathname.startsWith("/experiments/")) {
    return {
      workspace: "Simulation",
      surface: "Experiment detail",
      mode: "Batch compare",
      entity: pathname.split("/").at(-1) ?? "Missing experiment",
    };
  }

  if (pathname === "/experiments") {
    return {
      workspace: "Simulation",
      surface: "Experiments",
      mode: "Sequential planner",
      entity: "Matrix workspace",
    };
  }

  if (pathname === "/leaderboard") {
    return {
      workspace: "Simulation",
      surface: "Leaderboard",
      mode: "Single-run compare",
      entity: "Completed standalone",
    };
  }

  if (pathname === "/lab") {
    return {
      workspace: "Lab",
      surface: "Operator console",
      mode: "Mutating controls",
      entity: "Live controls",
    };
  }

  return {
    workspace: "Monitor",
    surface: "Dashboard",
    mode: "Live command center",
    entity: "Current session",
  };
}

function renderRuntimeCard(card: RuntimeStatusCard) {
  const Icon = card.icon;

  return (
    <article
      key={card.title}
      className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.04] text-slate-100">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-white">{card.title}</h2>
            <Badge tone={card.badgeTone}>{card.badgeLabel}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{card.description}</p>
        </div>
      </div>
    </article>
  );
}

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const selectedSessionId = useOperatorUiStore(selectSelectedSessionId);
  const timelineStreamStatus = useOperatorUiStore(selectTimelineStreamStatus);
  const coreHealthQuery = useCoreHealthQuery();
  const dataHealthQuery = useDataHealthQuery();
  const botHealthQuery = useBotHealthQuery();

  const routeContext = getRouteContext(location.pathname, selectedSessionId);
  const coreAvailability = resolveServiceAvailability(coreHealthQuery);
  const dataAvailability = resolveServiceAvailability(dataHealthQuery);
  const botAvailability = resolveServiceAvailability(botHealthQuery);
  const runtimeTone = getCompositeHealthTone(
    coreAvailability,
    dataAvailability,
    botAvailability,
  );
  const runtimeStatusCards = [
    buildServiceStatusCard({
      availability: coreAvailability,
      fallbackDescription: "Paper trading reads và mutations vẫn đi qua /core/*.",
      health: coreHealthQuery.data,
      icon: DatabaseIcon,
      title: "Core API",
    }),
    buildServiceStatusCard({
      availability: dataAvailability,
      fallbackDescription: "Market và strategy catalog vẫn đi qua /data/*.",
      health: dataHealthQuery.data,
      icon: ShieldIcon,
      title: "Data API",
    }),
    buildServiceStatusCard({
      availability: botAvailability,
      fallbackDescription:
        "Simulation child runs vẫn cần bot runner để replay ticks và gửi callback.",
      health: botHealthQuery.data,
      icon: RunsIcon,
      title: "Bot Runner",
    }),
    buildTimelineStatusCard(location.pathname, timelineStreamStatus),
  ];

  useEffect(() => {
    window.scrollTo({ behavior: "auto", left: 0, top: 0 });
  }, [location.pathname]);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <a
        href="#app-main-content"
        className="focus-ring sr-only fixed left-4 top-4 z-50 rounded-[16px] border border-white/14 bg-slate-950/95 px-4 py-3 text-sm font-medium text-white focus:not-sr-only"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex max-w-[1720px] flex-col gap-5 xl:flex-row xl:items-start">
        <aside className="glass-card panel-outline surface-noise overflow-hidden rounded-[26px] border px-4 py-5 xl:sticky xl:top-6 xl:w-[288px] xl:px-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.24em] text-[var(--brand-sun)]">
                Crypto Trading Simulator
              </p>
              <Link to="/dashboard" className="mt-3 block">
                <span className="block text-[1.75rem] font-medium tracking-[-0.05em] text-white">
                  Operator Desktop
                </span>
              </Link>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Desktop workspace cho monitor, review và simulation control.
              </p>
            </div>
            <Badge tone="info">Desktop</Badge>
          </div>

          <div className="mt-8 grid gap-6">
            {navigationGroups.map((group) => (
              <WorkspaceNavGroup
                key={group.label}
                label={group.label}
                items={[...group.items]}
              />
            ))}
          </div>

          <div className="mt-8 rounded-[20px] border border-white/8 bg-[var(--bg-panel-muted)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  Runtime
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                  {routeContext.mode}
                </div>
              </div>
              <ContextDrawer
                trigger={
                  <Button size="sm" tone="ghost">
                    Details
                  </Button>
                }
                title="Runtime detail"
                description="Core, data, bot runner và stream health được gom ở đây để shell chính giữ mật độ gọn."
                contentClassName="grid gap-3"
              >
                {runtimeStatusCards.map(renderRuntimeCard)}
              </ContextDrawer>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={getAvailabilityBadgeTone(coreAvailability)}>
                Core {getAvailabilityLabel(coreAvailability)}
              </Badge>
              <Badge tone={getAvailabilityBadgeTone(dataAvailability)}>
                Data {getAvailabilityLabel(dataAvailability)}
              </Badge>
              <Badge tone={getAvailabilityBadgeTone(botAvailability)}>
                Bot {getAvailabilityLabel(botAvailability)}
              </Badge>
              <Badge tone={runtimeStatusCards[3].badgeTone}>
                SSE {runtimeStatusCards[3].badgeLabel}
              </Badge>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <header className="glass-card panel-outline surface-noise overflow-hidden rounded-[24px] border p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  {routeContext.workspace}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-[1.75rem] font-medium tracking-[-0.04em] text-white">
                    {routeContext.surface}
                  </h2>
                  <Badge tone="info">{routeContext.mode}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={runtimeTone}>
                  Health {getAvailabilityLabel(coreAvailability)} /{" "}
                  {getAvailabilityLabel(dataAvailability)} /{" "}
                  {getAvailabilityLabel(botAvailability)}
                </Badge>
                {routeContext.entity !== "Current session" ? (
                  <Badge tone="neutral">{routeContext.entity}</Badge>
                ) : null}
              </div>
            </div>

            <SummaryStrip
              className="mt-4 2xl:grid-cols-4"
              items={[
                {
                  label: "Workspace",
                  meta: "Nhóm route hiện tại trong shell desktop.",
                  tone: "accent",
                  value: routeContext.workspace,
                },
                {
                  badge: <Badge tone="info">{routeContext.mode}</Badge>,
                  label: "Surface",
                  meta: "Loại surface hiện đang mở.",
                  value: routeContext.surface,
                },
                {
                  label: "Selected",
                  meta: "Entity ngắn gọn cho context route hiện tại.",
                  tone:
                    routeContext.entity === "No preview locked" ? "warning" : "neutral",
                  value: routeContext.entity,
                },
                {
                  badge: <Badge tone={runtimeTone}>{getAvailabilityLabel(coreAvailability)}</Badge>,
                  label: "Platform",
                  meta: `Data ${getAvailabilityLabel(dataAvailability)} · Bot ${getAvailabilityLabel(botAvailability)} · SSE ${runtimeStatusCards[3].badgeLabel}`,
                  tone:
                    runtimeTone === "danger"
                      ? "danger"
                      : runtimeTone === "warning"
                        ? "warning"
                        : "success",
                  value: coreHealthQuery.data?.service ?? "Core + Data + Bot",
                },
              ]}
            />
          </header>

          <main id="app-main-content" tabIndex={-1} className="flex flex-1 flex-col gap-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
