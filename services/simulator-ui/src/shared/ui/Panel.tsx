import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

type PanelTone = "default" | "accent" | "soft";

const toneMap: Record<PanelTone, string> = {
  default:
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_36%),linear-gradient(0deg,rgba(126,203,255,0.06),transparent_40%),var(--bg-panel)]",
  accent:
    "bg-[linear-gradient(180deg,rgba(244,190,81,0.12),transparent_34%),linear-gradient(0deg,rgba(126,203,255,0.05),transparent_40%),var(--bg-panel)]",
  soft:
    "bg-[linear-gradient(180deg,rgba(126,203,255,0.14),transparent_34%),linear-gradient(0deg,rgba(126,203,255,0.08),transparent_42%),var(--bg-panel-soft)]",
};

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
  density?: "default" | "dense";
  headerClassName?: string;
  contentClassName?: string;
}

export function Panel({
  actions,
  children,
  className,
  contentClassName,
  density = "default",
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
        "glass-card surface-noise panel-outline overflow-hidden rounded-[24px] border",
        toneMap[tone],
        density === "dense" ? "p-4 lg:p-5" : "p-5 lg:p-6",
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <header
          className={cx(
            density === "dense"
              ? "mb-4 flex flex-col gap-3 border-b border-white/6 pb-4 lg:flex-row lg:items-start lg:justify-between"
              : "mb-6 flex flex-col gap-4 border-b border-white/6 pb-5 lg:flex-row lg:items-start lg:justify-between",
            headerClassName,
          )}
        >
          <div className="max-w-2xl">
            {eyebrow ? (
              <div className="mb-3 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-[var(--brand-sun)]">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h2 className={cx("font-medium text-white", density === "dense" ? "text-lg" : "text-xl")}>
                {title}
              </h2>
            ) : null}
            {description ? (
              <p
                className={cx(
                  "max-w-2xl text-sm leading-6 text-slate-400",
                  density === "dense" ? "mt-1.5" : "mt-2",
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
        </header>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
