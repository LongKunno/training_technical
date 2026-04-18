import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { SearchIcon } from "./icons";
import { cx } from "./cx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, hint, label, leading, ...props },
  ref,
) {
  const control = (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cx(
          "focus-ring h-12 w-full rounded-[18px] border border-white/10 bg-white/[0.05] px-4 text-sm text-white placeholder:text-slate-500",
          leading ? "pl-11" : "",
          className,
        )}
        {...props}
      />
    </div>
  );

  if (!label && !hint) {
    return control;
  }

  return (
    <label className="grid gap-2 text-sm text-slate-300">
      {label ? <span className="font-medium text-slate-200">{label}</span> : null}
      {control}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
});

export function SearchInput(props: Omit<InputProps, "leading">) {
  return <Input leading={<SearchIcon className="size-4" />} {...props} />;
}
