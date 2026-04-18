import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

type PanelTone = "default" | "accent" | "soft";

const toneMap: Record<PanelTone, string> = {
  default: "bg-[var(--bg-panel)]",
  accent:
    "bg-[linear-gradient(180deg,rgba(244,190,81,0.08),transparent_32%),var(--bg-panel)]",
  soft:
    "bg-[linear-gradient(180deg,rgba(126,203,255,0.08),transparent_30%),var(--bg-panel)]",
};

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
  headerClassName?: string;
  contentClassName?: string;
}

export function Panel({
  actions,
  children,
  className,
  contentClassName,
  description,
  eyebrow,
  headerClassName,
  title,
  tone = "default",
  ...props
}: PanelProps) {
  const hasHeader = eyebrow || title || description || actions;

  return (
    <section
      className={cx(
        "glass-card surface-noise panel-outline overflow-hidden rounded-[28px] border p-6 lg:p-7",
        toneMap[tone],
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <header
          className={cx(
            "mb-6 flex flex-col gap-4 border-b border-white/6 pb-5 lg:flex-row lg:items-start lg:justify-between",
            headerClassName,
          )}
        >
          <div className="max-w-2xl">
            {eyebrow ? (
              <div className="mb-3 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-[var(--brand-sun)]">
                {eyebrow}
              </div>
            ) : null}
            {title ? <h2 className="text-xl font-medium text-white">{title}</h2> : null}
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
        </header>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
