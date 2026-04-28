import type { ReactNode } from "react";

import { Badge } from "./Badge";
import { cx } from "./cx";

export interface SectionTab {
  value: string;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface SectionTabsProps {
  tabs: SectionTab[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  className?: string;
}

export function SectionTabs({
  className,
  label = "Section tabs",
  onValueChange,
  tabs,
  value,
}: SectionTabsProps) {
  return (
    <div
      className={cx(
        "flex flex-wrap gap-2 rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)] p-2",
        className,
      )}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            className={cx(
              "focus-ring inline-flex min-h-[42px] items-center gap-2 rounded-[14px] border px-4 py-2 text-sm font-medium transition",
              isActive
                ? "border-sky-300/24 bg-sky-300/[0.12] text-white"
                : "border-transparent bg-transparent text-slate-300 hover:border-white/8 hover:bg-white/[0.04] hover:text-white",
              tab.disabled ? "cursor-not-allowed opacity-50" : "",
            )}
            onClick={() => onValueChange(tab.value)}
          >
            <span>{tab.label}</span>
            {tab.badge ? <span className="shrink-0">{tab.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SectionTabPanelProps {
  value: string;
  activeValue: string;
  children: ReactNode;
  className?: string;
}

export function SectionTabPanel({
  activeValue,
  children,
  className,
  value,
}: SectionTabPanelProps) {
  const hidden = value !== activeValue;

  return (
    <div
      role="tabpanel"
      aria-hidden={hidden}
      className={cx(hidden ? "hidden" : "block", className)}
    >
      {children}
    </div>
  );
}

export function SectionTabBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
