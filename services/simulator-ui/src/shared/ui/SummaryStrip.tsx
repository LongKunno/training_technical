import type { ReactNode } from "react";

import { Badge } from "./Badge";
import { cx } from "./cx";

type SummaryTone = "neutral" | "accent" | "success" | "warning" | "danger";

const toneMap: Record<SummaryTone, string> = {
  neutral: "border-white/8 bg-white/[0.03]",
  accent: "border-sky-300/18 bg-sky-300/[0.06]",
  success: "border-emerald-300/18 bg-emerald-300/[0.06]",
  warning: "border-amber-300/18 bg-amber-300/[0.06]",
  danger: "border-rose-300/18 bg-rose-300/[0.06]",
};

export interface SummaryStripItem {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  tone?: SummaryTone;
}

export interface SummaryStripProps {
  items: SummaryStripItem[];
  className?: string;
}

export function SummaryStrip({ className, items }: SummaryStripProps) {
  return (
    <section
      className={cx(
        "grid gap-3 rounded-[20px] border border-white/8 bg-[var(--bg-panel-muted)] p-3 lg:grid-cols-2 2xl:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <article
          key={`${String(item.label)}-${String(item.value)}`}
          className={cx(
            "min-w-0 rounded-[16px] border p-4",
            toneMap[item.tone ?? "neutral"],
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {item.label}
              </div>
              <div className="mt-2 truncate text-lg font-medium text-white">
                {item.value}
              </div>
            </div>
            {item.badge ? <div className="shrink-0">{item.badge}</div> : null}
          </div>
          {item.meta ? (
            <div className="mt-2 text-sm leading-6 text-slate-400">{item.meta}</div>
          ) : (
            <div className="mt-2 text-sm text-transparent">.</div>
          )}
        </article>
      ))}
    </section>
  );
}

export function SummaryStripBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
