import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneMap: Record<BadgeTone, string> = {
  neutral:
    "border-white/10 bg-white/[0.05] text-slate-200",
  success:
    "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warning:
    "border-amber-300/25 bg-amber-300/10 text-amber-100",
  danger:
    "border-rose-300/25 bg-rose-300/10 text-rose-100",
  info:
    "border-sky-300/25 bg-sky-300/10 text-sky-100",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  leading?: ReactNode;
}

export function Badge({
  children,
  className,
  leading,
  tone = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em]",
        toneMap[tone],
        className,
      )}
      {...props}
    >
      {leading ? <span className="size-3 shrink-0">{leading}</span> : null}
      <span>{children}</span>
    </span>
  );
}
