"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * One overlay used for the command palette, quick capture and every dialog.
 * On phones it presents as a bottom sheet; on wider screens it centres near
 * the top, which is where the eye already is when a shortcut fires.
 */
export function Overlay({
  open,
  onClose,
  children,
  labelledBy,
  className,
  align = "top",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  className?: string;
  align?: "top" | "center";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Keep focus inside the panel while it is open.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKey, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center p-0 sm:p-4",
        align === "top" ? "items-end sm:items-start sm:pt-[12vh]" : "items-end sm:items-center",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        style={{ animation: "overlay-in 160ms ease-out both" }}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        className={cn(
          "relative w-full max-w-xl overflow-hidden border border-border bg-surface shadow-overlay",
          "rounded-t-2xl sm:rounded-card pb-safe",
          className,
        )}
        style={{ animation: "sheet-up 200ms var(--ease-out-soft) both" }}
      >
        {/* Grab handle reads as a sheet on touch devices. */}
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-border-strong sm:hidden" />
        {children}
      </div>
    </div>
  );
}
