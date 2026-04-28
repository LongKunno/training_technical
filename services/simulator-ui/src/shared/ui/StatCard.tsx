import type { ReactNode } from "react";

import { Badge } from "./Badge";
import { cx } from "./cx";

type StatTone = "neutral" | "accent" | "success" | "warning" | "danger";

const accentMap: Record<StatTone, string> = {
  neutral: "from-white/14 via-sky-200/[0.08] to-cyan-300/[0.07]",
  accent: "from-amber-300/18 via-cyan-300/[0.1] to-cyan-300/[0.08]",
  success: "from-emerald-300/20 via-cyan-300/[0.09] to-emerald-300/[0.08]",
  warning: "from-rose-300/18 via-amber-300/[0.12] to-amber-300/[0.08]",
  danger: "from-rose-300/22 via-rose-200/[0.12] to-rose-300/[0.1]",
};

const glowMap: Record<StatTone, string> = {
  neutral: "from-sky-200/[0.2] via-cyan-300/[0.08] to-transparent",
  accent: "from-cyan-300/[0.22] via-amber-300/[0.08] to-transparent",
  success: "from-emerald-300/[0.24] via-cyan-300/[0.08] to-transparent",
  warning: "from-amber-300/[0.22] via-rose-300/[0.08] to-transparent",
  danger: "from-rose-300/[0.24] via-rose-200/[0.09] to-transparent",
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  trend?: ReactNode;
  icon?: ReactNode;
  microChart?: ReactNode;
  footnote?: ReactNode;
  tone?: StatTone;
  className?: string;
}

export function StatCard({
  className,
  detail,
  footnote,
  icon,
  label,
  microChart,
  tone = "neutral",
  trend,
  value,
}: StatCardProps) {
  return (
    <div
      className={cx(
        "glass-card panel-outline surface-noise relative min-h-[156px] overflow-hidden rounded-[20px] border bg-gradient-to-br p-4",
        accentMap[tone],
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t opacity-90",
          glowMap[tone],
        )}
      />
      <div className="relative z-[1]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
              {label}
            </p>
            <p className="mt-2.5 text-[1.75rem] font-medium tracking-[-0.03em] text-white">{value}</p>
          </div>
          {icon ? (
            <div className="flex size-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.06] text-slate-100">
              {icon}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {trend ? <Badge tone={tone === "warning" ? "warning" : "info"}>{trend}</Badge> : null}
          {detail ? <p className="text-sm text-slate-400">{detail}</p> : null}
        </div>
        {microChart ? <div className="mt-3 min-h-[52px]">{microChart}</div> : null}
        {footnote ? <div className="mt-3 text-xs leading-5 text-slate-500">{footnote}</div> : null}
      </div>
    </div>
  );
}
