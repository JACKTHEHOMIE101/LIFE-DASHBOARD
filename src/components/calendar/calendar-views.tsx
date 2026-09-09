import Link from "next/link";
import type { CalendarEvent } from "@/db/schema";
import { CATEGORY_LABEL, durationMinutes } from "@/lib/domain/calendar";
import { cn, formatTime, isoDate, isToday, startOfDay } from "@/lib/utils";

const CATEGORY_COLOR: Record<string, string> = {
  meeting: "var(--color-area-indigo)",
  focus: "var(--color-accent)",
  health: "var(--color-area-rose)",
  social: "var(--color-area-amber)",
  travel: "var(--color-area-cyan)",
  personal: "var(--color-area-violet)",
  other: "var(--color-area-slate)",
};

/** Grid runs 6am to midnight; anything outside is clamped into the edges. */
const GRID_START_HOUR = 6;
const GRID_END_HOUR = 24;
const HOUR_HEIGHT = 48;

function positionFor(event: CalendarEvent, day: Date) {
  const dayStart = startOfDay(day).getTime();
  const startMinutes = (event.startsAt.getTime() - dayStart) / 60_000;
  const endMinutes = (event.endsAt.getTime() - dayStart) / 60_000;
  const gridStart = GRID_START_HOUR * 60;
  const gridEnd = GRID_END_HOUR * 60;

  const top = ((Math.max(startMinutes, gridStart) - gridStart) / 60) * HOUR_HEIGHT;
  const height = Math.max(
    ((Math.min(endMinutes, gridEnd) - Math.max(startMinutes, gridStart)) / 60) * HOUR_HEIGHT,
    18,
  );
  return { top, height };
}

function EventBlock({ event, day, compact }: { event: CalendarEvent; day: Date; compact?: boolean }) {
  const { top, height } = positionFor(event, day);
  const color = CATEGORY_COLOR[event.category] ?? CATEGORY_COLOR.other;

  return (
    <div
      className="absolute right-0.5 left-0.5 overflow-hidden rounded-md px-1.5 py-0.5"
      style={{
        top,
        height,
        backgroundColor: `color-mix(in oklch, ${color} 14%, var(--color-surface))`,
        borderLeft: `2px solid ${color}`,
      }}
      title={`${event.title} · ${formatTime(event.startsAt)}–${formatTime(event.endsAt)} · ${CATEGORY_LABEL[event.category]}`}
    >
      <p className="truncate text-[11px] font-medium text-ink">{event.title}</p>
      {!compact && height > 32 ? (
        <p className="truncate text-[10px] text-ink-muted">{formatTime(event.startsAt)}</p>
      ) : null}
    </div>
  );
}

function TimeGutter() {
  return (
    <div className="w-11 shrink-0">
      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => (
        <div
          key={i}
          className="relative text-right text-[10px] text-ink-subtle"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="absolute -top-1.5 right-2">{`${String(GRID_START_HOUR + i).padStart(2, "0")}:00`}</span>
        </div>
      ))}
    </div>
  );
}

function HourLines() {
  return (
    <>
      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => (
        <div
          key={i}
          className="absolute right-0 left-0 border-t border-border"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}
    </>
  );
}

export function DayView({ events, day }: { events: CalendarEvent[]; day: Date }) {
  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);

  return (
    <div>
      {allDay.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5 border-b border-border pb-2 pl-11">
          {allDay.map((e) => (
            <span key={e.id} className="rounded-md bg-surface-sunken px-2 py-1 text-[12px] text-ink-muted">
              {e.title}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex overflow-x-auto">
        <TimeGutter />
        <div
          className="relative min-w-0 flex-1"
          style={{ height: (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT }}
        >
          <HourLines />
          {timed.map((event) => (
            <EventBlock key={event.id} event={event} day={day} />
          ))}
          {timed.length === 0 ? (
            <p className="absolute inset-x-0 top-16 text-center text-[13px] text-ink-subtle">
              Nothing scheduled.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WeekView({
  events,
  days,
}: {
  events: CalendarEvent[];
  days: Date[];
}) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = isoDate(event.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[42rem]">
        <div className="flex border-b border-border pb-1.5">
          <div className="w-11 shrink-0" />
          {days.map((day) => (
            <div key={day.toISOString()} className="min-w-0 flex-1 text-center">
              <p className="text-[11px] text-ink-subtle">
                {day.toLocaleDateString("en-GB", { weekday: "short" })}
              </p>
              <p
                className={cn(
                  "text-[13px] font-medium",
                  isToday(day) ? "text-accent" : "text-ink-muted",
                )}
              >
                {day.getDate()}
              </p>
            </div>
          ))}
        </div>

        <div className="flex">
          <TimeGutter />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                "relative min-w-0 flex-1 border-l border-border",
                isToday(day) && "bg-accent-soft/25",
              )}
              style={{ height: (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT }}
            >
              <HourLines />
              {(byDay.get(isoDate(day)) ?? [])
                .filter((e) => !e.allDay)
                .map((event) => (
                  <EventBlock key={event.id} event={event} day={day} compact />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonthView({
  events,
  days,
  month,
}: {
  events: CalendarEvent[];
  days: Date[];
  month: number;
}) {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = isoDate(event.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[36rem] grid-cols-7 gap-px rounded-lg bg-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="bg-surface px-2 py-1.5 text-center text-[11px] text-ink-subtle">
            {label}
          </div>
        ))}

        {days.map((day) => {
          const dayEvents = byDay.get(isoDate(day)) ?? [];
          const outside = day.getMonth() !== month;
          return (
            <Link
              key={day.toISOString()}
              href={`/calendar?view=day&date=${isoDate(day)}`}
              className={cn(
                "min-h-24 bg-surface p-1.5 transition-colors hover:bg-surface-sunken",
                outside && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                  isToday(day) ? "bg-accent font-medium text-accent-ink" : "text-ink-muted",
                )}
              >
                {day.getDate()}
              </span>

              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <p key={event.id} className="flex items-center gap-1 truncate text-[10px] text-ink-muted">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLOR[event.category] }}
                    />
                    <span className="truncate">{event.title}</span>
                  </p>
                ))}
                {dayEvents.length > 3 ? (
                  <p className="text-[10px] text-ink-subtle">+{dayEvents.length - 3} more</p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export { durationMinutes };
