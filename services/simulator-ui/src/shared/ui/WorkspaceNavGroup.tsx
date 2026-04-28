import type { ComponentType } from "react";

import { NavLink } from "react-router-dom";

import { cx } from "./cx";

interface WorkspaceNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface WorkspaceNavGroupProps {
  label: string;
  items: WorkspaceNavItem[];
  className?: string;
}

export function WorkspaceNavGroup({
  className,
  items,
  label,
}: WorkspaceNavGroupProps) {
  return (
    <section className={cx("grid gap-2", className)}>
      <div className="px-1 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cx(
                  "group flex min-h-[48px] items-center gap-3 rounded-[16px] border px-3.5 py-3 text-sm transition",
                  isActive
                    ? "border-sky-300/28 bg-sky-300/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-transparent bg-transparent text-slate-300 hover:border-white/8 hover:bg-white/[0.04] hover:text-white",
                )
              }
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] border border-white/8 bg-white/[0.04] text-slate-100">
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0 truncate font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </section>
  );
}
