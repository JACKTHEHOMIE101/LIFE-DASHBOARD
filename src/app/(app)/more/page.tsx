import Link from "next/link";
import type { Metadata } from "next";
import { Bell, ChevronRight, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { countUnreadNotifications } from "@/lib/domain/notifications";
import { MORE_GROUPS } from "@/lib/navigation";
import { Card, CardHeader } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/shell/theme";

export const metadata: Metadata = { title: "More" };

/**
 * Mobile secondary navigation. Everything that is not one of the five tabs
 * lives exactly one tap deeper, rather than being crushed into the tab bar.
 */
export default async function MorePage() {
  const user = await requireUser();
  const unread = await countUnreadNotifications(user.id);

  return (
    <div className="animate-in lg:hidden">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight text-ink">{user.name}</p>
          <p className="truncate text-[13px] text-ink-subtle">{user.email}</p>
        </div>
      </header>

      <Card className="mb-4">
        <Link
          href="/notifications"
          className="flex min-h-12 items-center gap-3 px-5 py-3 transition-colors active:bg-surface-sunken"
        >
          <Bell className="size-4 shrink-0 text-ink-subtle" />
          <span className="flex-1 text-sm text-ink">Notifications</span>
          {unread > 0 ? (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-critical px-1.5 text-[11px] font-semibold text-white">
              {unread}
            </span>
          ) : null}
          <ChevronRight className="size-4 shrink-0 text-ink-subtle" />
        </Link>
      </Card>

      <div className="space-y-4">
        {MORE_GROUPS.map((group) => (
          <Card key={group.label}>
            <CardHeader title={group.label} />
            <ul className="divide-y divide-border border-t border-border">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-12 items-center gap-3 px-5 py-3 transition-colors active:bg-surface-sunken"
                  >
                    <item.icon className="size-4 shrink-0 text-ink-subtle" />
                    <span className="flex-1 text-sm text-ink">{item.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-ink-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}

        <Card>
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <span className="text-sm text-ink">Appearance</span>
            <ThemeToggle />
          </div>
        </Card>

        <form action={signOut}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card border border-border bg-surface px-5 py-3 text-sm text-critical transition-colors active:bg-surface-sunken"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
