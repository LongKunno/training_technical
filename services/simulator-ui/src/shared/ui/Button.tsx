import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./cx";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const toneMap: Record<ButtonTone, string> = {
  primary:
    "border-transparent bg-[linear-gradient(135deg,#f4be51_0%,#ffd978_45%,#42d9ba_100%)] text-slate-950 shadow-[0_18px_32px_rgba(244,190,81,0.24)] hover:brightness-105",
  secondary:
    "border-white/12 bg-white/[0.06] text-white hover:border-white/20 hover:bg-white/[0.1]",
  ghost:
    "border-white/8 bg-white/[0.02] text-slate-200 hover:border-white/14 hover:bg-white/[0.06]",
  danger:
    "border-transparent bg-[linear-gradient(135deg,#ff8578_0%,#ff5f7a_100%)] text-white shadow-[0_18px_32px_rgba(255,95,122,0.2)] hover:brightness-105",
};

const sizeMap: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    leading,
    size = "md",
    tone = "secondary",
    trailing,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "focus-ring inline-flex items-center justify-center gap-2 rounded-[18px] border font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        toneMap[tone],
        sizeMap[size],
        className,
      )}
      {...props}
    >
      {leading ? <span className="size-4 shrink-0">{leading}</span> : null}
      <span>{children}</span>
      {trailing ? <span className="size-4 shrink-0">{trailing}</span> : null}
    </button>
  );
});
