import type { ReactNode } from "react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { cx } from "./cx";

export interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  actionLabel?: string;
  actionHint?: string;
  className?: string;
}

export function EmptyState({
  actionHint,
  actionLabel,
  className,
  description,
  eyebrow,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex min-h-[220px] flex-col items-start justify-center gap-4 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-8",
        className,
      )}
    >
      {eyebrow ? <Badge tone="info">{eyebrow}</Badge> : null}
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-200">
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-lg font-medium text-white">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {actionLabel ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="secondary" disabled>
            {actionLabel}
          </Button>
          {actionHint ? <span className="text-xs text-slate-500">{actionHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
