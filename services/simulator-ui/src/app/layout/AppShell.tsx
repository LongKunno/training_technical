import type { ReactNode } from "react";

import { Link, NavLink, useLocation } from "react-router-dom";

import {
  ArrowUpRightIcon,
  Badge,
  ClockIcon,
  DashboardIcon,
  DatabaseIcon,
  LabIcon,
  PulseIcon,
  SessionsIcon,
  ShieldIcon,
  cx,
} from "../../shared/ui";

interface AppShellProps {
  children: ReactNode;
}

const navigation = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Current-session live monitor",
    icon: DashboardIcon,
  },
  {
    href: "/sessions",
    label: "Sessions",
    description: "Historical review and audit",
    icon: SessionsIcon,
  },
  {
    href: "/lab",
    label: "Lab",
    description: "Operator controls and replay",
    icon: LabIcon,
  },
];

const statusCards = [
  {
    title: "Baseline contract frozen",
    description: "Current rebuild preserves /core/* and /data/* integration paths.",
    icon: DatabaseIcon,
  },
  {
    title: "Realtime stays isolated",
    description: "Current-session stream updates dashboard only, never historical views.",
    icon: PulseIcon,
  },
  {
    title: "Risk posture surfaced",
    description: "Shell is prepared for report, rules, and guardrail modules.",
    icon: ShieldIcon,
  },
];

function getSectionLabel(pathname: string) {
  if (pathname.startsWith("/sessions/")) {
    return "Session Detail";
  }

  const match = navigation.find((item) => pathname === item.href);
  return match?.label ?? "Operator Platform";
}

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const sectionLabel = getSectionLabel(location.pathname);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="relative px-4 py-4 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 xl:flex-row xl:items-start">
        <aside className="glass-card panel-outline surface-noise relative overflow-hidden rounded-[34px] border px-5 py-6 xl:sticky xl:top-8 xl:w-[320px] xl:px-6 xl:py-7">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.24em] text-[var(--brand-sun)]">
                Crypto Trading Simulator
              </p>
              <Link to="/dashboard" className="mt-3 block">
                <span className="text-gradient-brand block text-3xl font-medium tracking-[-0.05em]">
                  Operator Platform
                </span>
              </Link>
            </div>
            <Badge tone="success">WIP</Badge>
          </div>

          <nav className="grid gap-3">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cx(
                      "group rounded-[24px] border px-4 py-4 transition duration-200",
                      isActive
                        ? "border-white/14 bg-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
                        : "border-white/6 bg-white/[0.03] hover:border-white/12 hover:bg-white/[0.05]",
                    )
                  }
                >
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-white/8 bg-white/[0.04] text-slate-100 transition group-hover:scale-[1.03]">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">{item.label}</span>
                        <ArrowUpRightIcon className="size-4 text-slate-500 transition group-hover:text-slate-300" />
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{item.description}</p>
                    </div>
                  </div>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-8 space-y-3">
            {statusCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-medium text-white">{card.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{card.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="glass-card panel-outline surface-noise overflow-hidden rounded-[30px] border px-5 py-5 sm:px-6 xl:px-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  {sectionLabel}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-medium tracking-[-0.04em] text-white sm:text-3xl">
                    Product-first operator UX
                  </h2>
                  <Badge tone="info" leading={<PulseIcon className="size-3" />}>
                    Current-only SSE
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ClockIcon className="size-4 text-slate-400" />
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Build date
                      </div>
                      <div className="text-sm font-medium text-white">{dateLabel}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Runtime mode
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">
                    React shell over Node proxy
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="flex flex-1 flex-col gap-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
