import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { cx } from "./cx";
import { CloseIcon } from "./icons";

export interface ContextDrawerProps {
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function ContextDrawer({
  children,
  className,
  contentClassName,
  description,
  footer,
  title,
  trigger,
}: ContextDrawerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/72 backdrop-blur-sm" />
        <Dialog.Content
          className={cx(
            "fixed right-0 top-0 z-50 flex h-screen w-full max-w-[520px] flex-col border-l border-white/10 bg-[var(--bg-canvas-elevated)] shadow-[0_24px_60px_rgba(0,0,0,0.42)]",
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-medium text-white">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-2 text-sm leading-6 text-slate-400">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close context panel"
                className="h-10 w-10 px-0"
                tone="ghost"
              >
                <CloseIcon className="size-4" />
              </Button>
            </Dialog.Close>
          </header>
          <div className={cx("flex-1 overflow-auto px-6 py-5", contentClassName)}>
            {children}
          </div>
          {footer ? (
            <footer className="border-t border-white/8 px-6 py-4">{footer}</footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
