"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { NAV_GROUPS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "./command-palette-context";
import { ThemeToggle } from "./theme";

export function Sidebar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const pathname = usePathname();
  const { openPalette, openCapture } = useCommandPalette();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-sunken lg:flex">
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-ink">
            L
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">Life OS</span>
        </Link>
      </div>

      <div className="space-y-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={openCapture}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-accent px-2.5 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-4" />
          Quick capture
        </button>
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink-subtle transition-colors hover:border-border-strong hover:text-ink-muted"
        >
          <Search className="size-3.5" />
          <span>Search</span>
          <kbd className="ml-auto rounded border border-border px-1 font-sans text-[10px] text-ink-subtle">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
                        active
                          ? "bg-surface font-medium text-ink shadow-card"
                          : "text-ink-muted hover:bg-surface hover:text-ink",
                      )}
                    >
                      <item.icon
                        className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-subtle")}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
            {userName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{userName}</p>
            <p className="truncate text-[11px] text-ink-subtle">{userEmail}</p>
          </div>
        </div>
        <ThemeToggle className="w-full justify-center" />
      </div>
    </aside>
  );
}
