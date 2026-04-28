import { type ReactNode, useId, useState } from "react";

import { cx } from "./cx";
import { ChevronDownIcon } from "./icons";

export interface DisclosurePanelProps {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  buttonClassName?: string;
  contentClassName?: string;
}

export function DisclosurePanel({
  buttonClassName,
  children,
  className,
  contentClassName,
  defaultOpen = false,
  label,
}: DisclosurePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={cx("rounded-[18px] border border-white/8 bg-[var(--bg-panel-muted)]", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className={cx(
          "focus-ring flex w-full items-center justify-between gap-3 rounded-[18px] px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-white/[0.03]",
          buttonClassName,
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDownIcon
          className={cx("size-4 shrink-0 text-slate-400 transition-transform", open ? "rotate-180" : "")}
        />
      </button>

      {open ? (
        <div
          id={contentId}
          className={cx("border-t border-white/6 px-4 py-4 text-sm leading-6 text-slate-300", contentClassName)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
