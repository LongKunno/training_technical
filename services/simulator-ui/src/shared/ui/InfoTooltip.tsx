import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { cx } from "./cx";
import { InfoIcon } from "./icons";

export interface InfoTooltipProps {
  content: ReactNode;
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
  panelClassName?: string;
}

const alignMap: Record<NonNullable<InfoTooltipProps["align"]>, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

export function InfoTooltip({
  align = "end",
  className,
  content,
  label = "Open help",
  panelClassName,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={containerRef} className={cx("relative inline-flex", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={label}
        className="focus-ring inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
        onClick={() => setOpen((current) => !current)}
      >
        <InfoIcon className="size-4" />
      </button>

      {open ? (
        <span
          id={contentId}
          role="tooltip"
          className={cx(
            "absolute top-full z-30 mt-2 w-72 rounded-[18px] border border-white/10 bg-slate-950/96 px-4 py-3 text-left text-sm leading-6 text-slate-200 shadow-[0_22px_44px_rgba(3,8,15,0.42)]",
            alignMap[align],
            panelClassName,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
