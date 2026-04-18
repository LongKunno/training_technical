import type { ReactNode } from "react";

import { Badge } from "./Badge";
import { cx } from "./cx";

type StatTone = "neutral" | "accent" | "success" | "warning";

const accentMap: Record<StatTone, string> = {
  neutral: "from-white/6 to-white/[0.02]",
  accent: "from-amber-300/12 to-cyan-300/6",
  success: "from-emerald-300/14 to-emerald-300/4",
  warning: "from-rose-300/14 to-amber-300/6",
};

export interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  trend?: string;
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}

export function StatCard({
  className,
  detail,
  icon,
  label,
  tone = "neutral",
  trend,
  value,
}: StatCardProps) {
  return (
    <div
      className={cx(
        "glass-card panel-outline surface-noise rounded-[24px] border bg-gradient-to-br p-5",
        accentMap[tone],
        className,
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-400">
            {label}
          </p>
          <p className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white">{value}</p>
        </div>
        {icon ? (
          <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {trend ? <Badge tone={tone === "warning" ? "warning" : "info"}>{trend}</Badge> : null}
        {detail ? <p className="text-sm text-slate-400">{detail}</p> : null}
      </div>
    </div>
  );
}
