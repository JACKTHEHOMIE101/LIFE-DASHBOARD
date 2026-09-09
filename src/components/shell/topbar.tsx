"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Plus, Search } from "lucide-react";
import { ALL_NAV_ITEMS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "./command-palette-context";

export function TopBar({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();
  const { openPalette, openCapture } = useCommandPalette();
  const current = ALL_NAV_ITEMS.find((item) => isActivePath(pathname, item.href));

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-canvas/85 px-4 backdrop-blur-md lg:px-6">
      {/* Mobile shows where you are; desktop already has the sidebar for that. */}
      <span className="text-[15px] font-semibold tracking-tight text-ink lg:hidden">
        {pathname === "/" ? "Life OS" : (current?.label ?? "Life OS")}
      </span>

      <button
        type="button"
        onClick={openPalette}
        className="hidden h-8 w-72 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink-subtle transition-colors hover:border-border-strong lg:flex"
      >
        <Search className="size-3.5" />
        <span>Search tasks, projects, notes…</span>
        <kbd className="ml-auto rounded border border-border px-1 font-sans text-[10px]">⌘⇧K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search"
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:hidden"
        >
          <Search className="size-[18px]" />
        </button>

        <button
          type="button"
          onClick={openCapture}
          aria-label="Quick capture"
          className="hidden size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:flex"
        >
          <Plus className="size-[18px]" />
        </button>

        <Link
          href="/notifications"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
          className={cn(
            "relative flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink",
            isActivePath(pathname, "/notifications") && "bg-surface-sunken text-ink",
          )}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
