import type { ReactNode } from "react";

import { cx } from "./cx";

export interface PageHeaderMetaItem {
  label: string;
  value: string;
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  meta?: PageHeaderMetaItem[];
  actions?: ReactNode;
  aside?: ReactNode;
  className?: string;
}

export function PageHeader({
  actions,
  aside,
  className,
  description,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <section
      className={cx(
        "glass-card surface-noise panel-outline overflow-hidden rounded-[34px] border p-6 sm:p-8 xl:p-10",
        className,
      )}
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] xl:items-end">
        <div>
          {eyebrow ? (
            <p className="mb-4 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.24em] text-[var(--brand-sun)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="max-w-4xl text-4xl font-medium tracking-[-0.05em] text-white sm:text-5xl xl:text-6xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
            {description}
          </p>
          {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
        </div>

        <div className="space-y-4">
          {aside}
          {meta?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {meta.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {item.label}
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
