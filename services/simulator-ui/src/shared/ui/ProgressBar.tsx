import { cx } from "./cx";

type ProgressTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneMap: Record<ProgressTone, string> = {
  neutral: "bg-white/30",
  info: "bg-sky-300/80",
  success: "bg-emerald-300/80",
  warning: "bg-amber-300/80",
  danger: "bg-rose-300/80",
};

export interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  valueLabel?: string;
  tone?: ProgressTone;
  className?: string;
}

export function ProgressBar({
  className,
  label,
  max,
  tone = "info",
  value,
  valueLabel,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const progress = Math.min(Math.max(value / safeMax, 0), 1);

  return (
    <div className={cx("grid gap-2", className)}>
      {label || valueLabel ? (
        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>{label}</span>
          {valueLabel ? <span>{valueLabel}</span> : null}
        </div>
      ) : null}
      <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={cx("h-full rounded-full transition-[width]", toneMap[tone])}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
