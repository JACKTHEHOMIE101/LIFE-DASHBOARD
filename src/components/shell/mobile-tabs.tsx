"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { MOBILE_TABS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "./command-palette-context";

/**
 * Bottom navigation plus a persistent quick-add button. Every target is at
 * least 44px tall so it stays usable one-handed.
 */
export function MobileTabs() {
  const pathname = usePathname();
  const { openCapture } = useCommandPalette();

  return (
    <>
      <button
        type="button"
        onClick={openCapture}
        aria-label="Quick capture"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-raised transition-transform active:scale-95 lg:hidden"
      >
        <Plus className="size-6" />
      </button>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md pb-safe lg:hidden"
        aria-label="Primary"
      >
        <ul className="flex">
          {MOBILE_TABS.map((tab) => {
            const active = isActivePath(pathname, tab.href);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-[3.75rem] flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                    active ? "text-accent" : "text-ink-subtle",
                  )}
                >
                  <tab.icon className={cn("size-5", active && "stroke-[2.25]")} />
                  <span className={cn(active && "font-medium")}>{tab.short ?? tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
