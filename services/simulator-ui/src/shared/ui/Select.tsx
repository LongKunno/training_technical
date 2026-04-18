import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";

import { cx } from "./cx";
import { ChevronDownIcon } from "./icons";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options?: SelectOption[];
  placeholder?: string;
  leading?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, hint, label, leading, options, placeholder, children, ...props },
  ref,
) {
  const control = (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          {leading}
        </span>
      ) : null}
      <select
        ref={ref}
        className={cx(
          "focus-ring h-12 w-full appearance-none rounded-[18px] border border-white/10 bg-white/[0.05] px-4 pr-11 text-sm text-white",
          leading ? "pl-11" : "",
          className,
        )}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
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
