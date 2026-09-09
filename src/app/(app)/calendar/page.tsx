import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { analyseEvents, getEventsBetween } from "@/lib/domain/calendar";
import { DayView, MonthView, WeekView } from "@/components/calendar/calendar-views";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { StatTile } from "@/components/ui/charts";
import { addDays, cn, formatDuration, isoDate, startOfDay, startOfWeek } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

type View = "day" | "week" | "month";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const view = ((Array.isArray(params.view) ? params.view[0] : params.view) ?? "week") as View;
  const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
  const anchor = dateParam ? startOfDay(new Date(`${dateParam}T12:00:00`)) : startOfDay(new Date());
  const weekStartsOn = user.settings.weekStartsOn;

  // Each view resolves its own window, plus the days it needs to render.
  let from: Date;
  let to: Date;
  let days: Date[] = [];

  if (view === "day") {
    from = anchor;
    to = addDays(anchor, 1);
    days = [anchor];
  } else if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first, weekStartsOn);
    // Six weeks always covers a month regardless of which weekday it opens on.
    days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    from = gridStart;
    to = addDays(gridStart, 42);
  } else {
    from = startOfWeek(anchor, weekStartsOn);
    to = addDays(from, 7);
    days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }

  const events = await getEventsBetween(user.id, from, to);
  const spanDays = view === "day" ? 1 : view === "week" ? 7 : 42;
  const analytics = analyseEvents(events, from, spanDays);

  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  const prev = isoDate(addDays(anchor, -step));
  const next = isoDate(addDays(anchor, step));

  const heading =
    view === "day"
      ? anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
      : view === "month"
        ? anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
        : `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(from, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

  return (
    <div className="animate-in">
      <PageHeader
        title="Calendar"
        description="One normalised view. Provider calendars merge into this rather than replacing it."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1" aria-label="Calendar views">
          {(["day", "week", "month"] as View[]).map((v) => (
            <Link
              key={v}
              href={`/calendar?view=${v}&date=${isoDate(anchor)}`}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[13px] capitalize transition-colors",
                view === v
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
              )}
            >
              {v}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/calendar?view=${view}&date=${prev}`}
            aria-label="Previous period"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-40 text-center text-[13px] font-medium text-ink">{heading}</span>
          <Link
            href={`/calendar?view=${view}&date=${next}`}
            aria-label="Next period"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
          >
            <ChevronRight className="size-4" />
          </Link>
          <Link
            href={`/calendar?view=${view}`}
            className="ml-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-ink-muted hover:border-border-strong hover:text-ink"
          >
            Today
          </Link>
        </div>
      </div>

      <Card className="mb-5 p-4">
        {events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="Nothing on the calendar"
            description="Connect Google, Outlook or Apple Calendar in Integrations, or add events from quick capture."
          />
        ) : view === "day" ? (
          <DayView events={events} day={anchor} />
        ) : view === "week" ? (
          <WeekView events={events} days={days} />
        ) : (
          <MonthView events={events} days={days} month={anchor.getMonth()} />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Time in this period"
          description={
            analytics.totalEvents === 0
              ? "Nothing to analyse yet"
              : `${analytics.totalEvents} events`
          }
        />
        <div className="grid grid-cols-2 gap-5 border-t border-border px-5 py-4 sm:grid-cols-4">
          <StatTile label="Meetings" value={formatDuration(analytics.meetingMinutes) ?? "0m"} />
          <StatTile label="Focus blocks" value={formatDuration(analytics.focusMinutes) ?? "0m"} />
          <StatTile label="Other" value={formatDuration(analytics.otherMinutes) ?? "0m"} />
          <StatTile
            label="Unbooked work time"
            value={formatDuration(analytics.freeMinutes) ?? "0m"}
            sub="Weekdays, 8h each"
          />
        </div>

        {analytics.overloadedDays.length > 0 || analytics.fragmentedDays.length > 0 ? (
          <ul className="space-y-1.5 border-t border-border px-5 py-3.5 text-[13px] text-ink-muted">
            {analytics.overloadedDays.slice(0, 3).map((day) => (
              <li key={day.date.toISOString()}>
                <span className="font-medium text-ink">
                  {day.date.toLocaleDateString("en-GB", { weekday: "long" })}
                </span>{" "}
                has {formatDuration(day.meetingMinutes)} of meetings.
              </li>
            ))}
            {analytics.fragmentedDays.slice(0, 3).map((day) => (
              <li key={`frag-${day.date.toISOString()}`}>
                <span className="font-medium text-ink">
                  {day.date.toLocaleDateString("en-GB", { weekday: "long" })}
                </span>{" "}
                is fragmented: {day.gaps} gaps between meetings too short to use.
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
