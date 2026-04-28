import type { InputHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";

export interface SelectionCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  selectionType?: "checkbox" | "radio";
  badge?: ReactNode;
}

export function SelectionCard({
  badge,
  checked,
  className,
  description,
  disabled,
  meta,
  onCheckedChange,
  selectionType = "checkbox",
  title,
  ...props
}: SelectionCardProps) {
  return (
    <label
      className={cx(
        "flex min-h-[120px] gap-3 rounded-[16px] border px-4 py-4 text-sm transition",
        checked
          ? "border-cyan-300/40 bg-cyan-300/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "border-white/10 bg-white/[0.04] hover:border-white/18 hover:bg-white/[0.06]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <input
        type={selectionType}
        className="mt-1 size-4 shrink-0 accent-[var(--brand-sun)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        {...props}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-slate-100">{title}</div>
            {description ? <div className="mt-1 text-sm leading-6 text-slate-400">{description}</div> : null}
          </div>
          {badge ? <div className="shrink-0">{badge}</div> : null}
        </div>
        {meta ? <div className="mt-3 text-xs leading-5 text-slate-500">{meta}</div> : null}
      </div>
    </label>
  );
}
