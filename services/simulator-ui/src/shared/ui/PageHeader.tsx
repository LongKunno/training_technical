import type { ReactNode } from "react";

import { cx } from "./cx";

type PageHeaderTone = "default" | "soft" | "accent" | "warning";

const toneMap: Record<PageHeaderTone, string> = {
  default: "",
  soft:
    "bg-[linear-gradient(180deg,rgba(126,203,255,0.14),transparent_34%),linear-gradient(0deg,rgba(126,203,255,0.08),transparent_42%),var(--bg-panel-soft)]",
  accent:
    "bg-[linear-gradient(180deg,rgba(244,190,81,0.14),transparent_32%),linear-gradient(120deg,rgba(126,203,255,0.1),transparent_46%),var(--bg-panel)]",
  warning:
    "bg-[linear-gradient(180deg,rgba(255,139,122,0.14),transparent_30%),linear-gradient(0deg,rgba(244,190,81,0.08),transparent_42%),var(--bg-panel)]",
};

export interface PageHeaderMetaItem {
  label: string;
  value: string;
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: PageHeaderMetaItem[];
  actions?: ReactNode;
  aside?: ReactNode;
  className?: string;
  variant?: "default" | "compact";
  tone?: PageHeaderTone;
}

export function PageHeader({
  actions,
  aside,
  className,
  description,
  eyebrow,
  meta,
  title,
  tone = "default",
  variant = "default",
}: PageHeaderProps) {
  const compact = variant === "compact";

  return (
    <section
      className={cx(
        "glass-card surface-noise panel-outline overflow-hidden border",
        toneMap[tone],
        compact ? "rounded-[24px] p-5 sm:p-6 xl:p-7" : "rounded-[28px] p-6 sm:p-7 xl:p-8",
        className,
      )}
    >
      <div
        className={cx(
          "grid xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] xl:items-end",
          compact ? "gap-6" : "gap-8",
        )}
      >
        <div>
          {eyebrow ? (
            <p
              className={cx(
                "font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.24em] text-[var(--brand-sun)]",
                compact ? "mb-3" : "mb-4",
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <h1
            className={cx(
              "max-w-4xl font-medium tracking-[-0.05em] text-white",
              compact ? "text-3xl sm:text-[2.6rem] xl:text-[3.1rem]" : "text-4xl sm:text-5xl xl:text-6xl",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cx(
                "max-w-3xl text-slate-300",
                compact
                  ? "mt-3 text-sm leading-6 sm:text-[15px]"
                  : "mt-4 text-base leading-7 sm:text-lg",
              )}
            >
              {description}
            </p>
          ) : null}
          {actions ? (
            <div className={cx("flex flex-wrap gap-3", compact ? "mt-5" : "mt-8")}>{actions}</div>
          ) : null}
        </div>

        <div className="space-y-4">
          {aside}
          {meta?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {meta.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] px-4 py-3"
                >
                  <div
                    className={cx(
                      "uppercase tracking-[0.18em] text-slate-500",
                      compact ? "text-[11px]" : "text-xs",
                    )}
                  >
                    {item.label}
                  </div>
                  <div
                    className={cx(
                      "font-medium text-white",
                      compact ? "mt-1.5 text-[15px]" : "mt-2 text-lg",
                    )}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
