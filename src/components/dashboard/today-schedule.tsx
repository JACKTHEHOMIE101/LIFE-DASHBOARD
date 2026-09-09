import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { CATEGORY_LABEL, durationMinutes } from "@/lib/domain/calendar";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { cn, formatDuration, formatTime } from "@/lib/utils";

const CATEGORY_ACCENT: Record<string, string> = {
  meeting: "var(--color-area-indigo)",
  focus: "var(--color-accent)",
  health: "var(--color-area-rose)",
  social: "var(--color-area-amber)",
  travel: "var(--color-area-cyan)",
  personal: "var(--color-area-violet)",
  other: "var(--color-border-strong)",
};

export function TodaySchedule({
  events,
  freeMinutes,
}: {
  events: CalendarEvent[];
  freeMinutes: number | null;
}) {
  const now = Date.now();

  return (
    <Card>
      <CardHeader
        title="Today"
        description={
          freeMinutes && freeMinutes > 0
            ? `${formatDuration(freeMinutes)} unbooked before the end of the day`
            : undefined
        }
        action={
          <Link href="/calendar" className="text-[12px] text-ink-muted hover:text-ink">
            Calendar
          </Link>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title="Nothing scheduled today"
          description="Connect a calendar in Integrations, or add an event from quick capture."
        />
      ) : (
        <ul className="border-t border-border px-5 py-1">
          {events.map((event) => {
            const past = event.endsAt.getTime() < now;
            const current = !past && event.startsAt.getTime() <= now;
            return (
              <li key={event.id} className="flex items-start gap-3 py-2">
                <time
                  className={cn(
                    "w-11 shrink-0 pt-px text-[12px] tabular",
                    past ? "text-ink-subtle" : "text-ink-muted",
                  )}
                  dateTime={event.startsAt.toISOString()}
                >
                  {event.allDay ? "All day" : formatTime(event.startsAt)}
                </time>

                <span
                  className="mt-1.5 h-4 w-0.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CATEGORY_ACCENT[event.category] }}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      past ? "text-ink-subtle" : "text-ink",
                      current && "font-medium",
                    )}
                  >
                    {event.title}
                    {current ? (
                      <span className="ml-2 text-[11px] font-medium text-accent">Now</span>
                    ) : null}
                  </p>
                  <p className="text-[12px] text-ink-subtle">
                    {CATEGORY_LABEL[event.category]}
                    {!event.allDay ? ` · ${formatDuration(durationMinutes(event))}` : ""}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
