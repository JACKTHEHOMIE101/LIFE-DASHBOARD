"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Clock, RefreshCw, Sparkles, X } from "lucide-react";
import type { Notification, NotificationCategory, NotificationKind } from "@/db/schema";
import {
  dismissNotification, markAllRead, markNotificationRead, refreshNotifications,
  runNotificationAction, snoozeNotification,
} from "@/lib/actions/notifications";
import {
  Badge, Button, Card, CardHeader, EmptyState, LinkButton,
} from "@/components/ui/primitives";
import { cn, formatDate, formatTime, isToday } from "@/lib/utils";

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  tasks: "Tasks",
  calendar: "Calendar",
  projects: "Projects",
  goals: "Goals",
  health: "Health",
  finance: "Finance",
  relationships: "Relationships",
  ai: "AI",
  system: "System",
};

/**
 * The three kinds are visually distinct because they mean different things:
 * a reminder is something you asked for, a notification is something that
 * happened, an insight is something the system inferred.
 */
const KIND_STYLE: Record<NotificationKind, { label: string; tone: "accent" | "neutral" | "info"; Icon: typeof Bell }> = {
  reminder: { label: "Reminder", tone: "accent", Icon: Clock },
  notification: { label: "Notification", tone: "neutral", Icon: Bell },
  insight: { label: "Insight", tone: "info", Icon: Sparkles },
};

function NotificationRow({ notification }: { notification: Notification }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = !notification.readAt;
  const kind = KIND_STYLE[notification.kind];

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-5 py-3.5 transition-colors",
        unread && "bg-accent-soft/25",
        pending && "opacity-60",
      )}
    >
      <kind.Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notification.priority === "critical" || notification.priority === "high"
            ? "text-caution"
            : "text-ink-subtle",
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("text-sm", unread ? "font-medium text-ink" : "text-ink-muted")}>
            {notification.title}
          </p>
          <Badge tone={kind.tone}>{kind.label}</Badge>
          <span className="text-[11px] text-ink-subtle">
            {CATEGORY_LABEL[notification.category]}
          </span>
        </div>

        {notification.body ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{notification.body}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
          <span className="text-ink-subtle">
            {isToday(notification.scheduledFor)
              ? formatTime(notification.scheduledFor)
              : formatDate(notification.scheduledFor)}
          </span>

          {notification.deepLink ? (
            <Link
              href={notification.deepLink}
              onClick={() => run(() => markNotificationRead(notification.id))}
              className="font-medium text-accent hover:underline"
            >
              Open
            </Link>
          ) : null}

          {notification.actions.map((action) => (
            <button
              key={action.action}
              type="button"
              onClick={() =>
                run(() =>
                  runNotificationAction(notification.id, action.action, action.payload ?? {}),
                )
              }
              className="text-ink-muted hover:text-ink"
            >
              {action.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => run(() => snoozeNotification(notification.id, 24))}
            className="text-ink-muted hover:text-ink"
          >
            Snooze a day
          </button>
        </div>
      </div>

      <div className="flex shrink-0 gap-0.5">
        {unread ? (
          <button
            type="button"
            aria-label={`Mark "${notification.title}" as read`}
            onClick={() => run(() => markNotificationRead(notification.id))}
            className="flex size-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            <Check className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Dismiss "${notification.title}"`}
          onClick={() => run(() => dismissNotification(notification.id))}
          className="flex size-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

export function NotificationCenter({ notifications }: { notifications: Notification[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread" | NotificationCategory>("unread");
  const [pending, startTransition] = useTransition();

  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const categories = [...new Set(notifications.map((n) => n.category))];

  const visible = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.readAt;
    return n.category === filter;
  });

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Filter notifications">
          {(["unread", "all", ...categories] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value as typeof filter)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                filter === value
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
              )}
            >
              {value === "unread"
                ? `Unread${unreadCount ? ` (${unreadCount})` : ""}`
                : value === "all"
                  ? "All"
                  : CATEGORY_LABEL[value as NotificationCategory]}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(refreshNotifications)}>
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
            Refresh
          </Button>
          {unreadCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => run(markAllRead)}>
              <Check className="size-3.5" />
              Mark all read
            </Button>
          ) : null}
          <LinkButton href="/settings/notifications" size="sm">
            Preferences
          </LinkButton>
        </div>
      </div>

      <Card>
        <CardHeader
          title={filter === "unread" ? "Unread" : filter === "all" ? "Everything" : CATEGORY_LABEL[filter as NotificationCategory]}
          description={`${visible.length} shown`}
        />
        {visible.length === 0 ? (
          <EmptyState
            icon={<BellOff className="size-5" />}
            title={filter === "unread" ? "Nothing unread" : "Nothing here"}
            description="Life OS only notifies about things that cross a real threshold, so a quiet list is normal."
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {visible.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
