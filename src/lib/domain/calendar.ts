import "server-only";

import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { events, type CalendarEvent, type EventCategory } from "@/db/schema";
import { addDays, endOfDay, startOfDay, startOfWeek } from "@/lib/utils";

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  meeting: "Meeting",
  focus: "Focus",
  health: "Health",
  personal: "Personal",
  social: "Social",
  travel: "Travel",
  other: "Other",
};

export async function getEventsBetween(userId: string, from: Date, to: Date) {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        gte(events.startsAt, from),
        lt(events.startsAt, to),
      ),
    )
    .orderBy(asc(events.startsAt));
}

export async function getTodayEvents(userId: string) {
  const now = new Date();
  return getEventsBetween(userId, startOfDay(now), endOfDay(now));
}

/** Events that have not finished yet today, for "what is next". */
export async function getRemainingTodayEvents(userId: string) {
  const now = new Date();
  const todays = await getTodayEvents(userId);
  return todays.filter((e) => e.endsAt.getTime() >= now.getTime());
}

function durationMinutes(event: CalendarEvent) {
  return Math.max(0, Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000));
}

export type CalendarAnalytics = {
  totalEvents: number;
  meetingMinutes: number;
  focusMinutes: number;
  otherMinutes: number;
  /** Working hours in the period that are not booked. */
  freeMinutes: number;
  busiestDay: { date: Date; minutes: number } | null;
  overloadedDays: { date: Date; meetingMinutes: number }[];
  fragmentedDays: { date: Date; gaps: number }[];
  byCategory: { category: EventCategory; minutes: number }[];
};

/** A day with more than this in meetings is called overloaded. */
const OVERLOAD_MEETING_MINUTES = 240;
/** Assumed working window used for free-time maths. */
const WORKDAY_MINUTES = 8 * 60;

/**
 * Calendar analytics over an arbitrary window.
 *
 * "Fragmented" counts the gaps between meetings that are too short to do
 * anything real with (under 45 minutes) — the actual cost of a scattered day,
 * which a simple meeting-hours total misses entirely.
 */
export function analyseEvents(list: CalendarEvent[], from: Date, days: number): CalendarAnalytics {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of list) {
    const key = startOfDay(event.startsAt).toISOString();
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }

  let meetingMinutes = 0;
  let focusMinutes = 0;
  let otherMinutes = 0;
  const categoryTotals = new Map<EventCategory, number>();

  for (const event of list) {
    const minutes = durationMinutes(event);
    categoryTotals.set(event.category, (categoryTotals.get(event.category) ?? 0) + minutes);
    if (event.category === "meeting") meetingMinutes += minutes;
    else if (event.category === "focus") focusMinutes += minutes;
    else otherMinutes += minutes;
  }

  const overloadedDays: CalendarAnalytics["overloadedDays"] = [];
  const fragmentedDays: CalendarAnalytics["fragmentedDays"] = [];
  let busiestDay: CalendarAnalytics["busiestDay"] = null;

  for (const [key, dayEvents] of byDay) {
    const date = new Date(key);
    const dayMeetingMinutes = dayEvents
      .filter((e) => e.category === "meeting")
      .reduce((sum, e) => sum + durationMinutes(e), 0);
    const dayMinutes = dayEvents.reduce((sum, e) => sum + durationMinutes(e), 0);

    if (!busiestDay || dayMinutes > busiestDay.minutes) busiestDay = { date, minutes: dayMinutes };
    if (dayMeetingMinutes >= OVERLOAD_MEETING_MINUTES) {
      overloadedDays.push({ date, meetingMinutes: dayMeetingMinutes });
    }

    const meetings = dayEvents
      .filter((e) => e.category === "meeting")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    let gaps = 0;
    for (let i = 1; i < meetings.length; i++) {
      const gap = (meetings[i].startsAt.getTime() - meetings[i - 1].endsAt.getTime()) / 60_000;
      if (gap > 0 && gap < 45) gaps++;
    }
    if (gaps >= 2) fragmentedDays.push({ date, gaps });
  }

  // Weekend days are excluded: unbooked Saturday is not "free work time".
  let workdays = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i).getDay();
    if (d !== 0 && d !== 6) workdays++;
  }

  return {
    totalEvents: list.length,
    meetingMinutes,
    focusMinutes,
    otherMinutes,
    freeMinutes: Math.max(0, workdays * WORKDAY_MINUTES - meetingMinutes - focusMinutes),
    busiestDay,
    overloadedDays: overloadedDays.sort((a, b) => b.meetingMinutes - a.meetingMinutes),
    fragmentedDays,
    byCategory: [...categoryTotals.entries()]
      .map(([category, minutes]) => ({ category, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

export async function getWeekAnalytics(userId: string, weekStartsOn = 1) {
  const from = startOfWeek(new Date(), weekStartsOn);
  const to = addDays(from, 7);
  const list = await getEventsBetween(userId, from, to);
  return { from, to, analytics: analyseEvents(list, from, 7), events: list };
}

export type FreeSlot = { start: Date; end: Date; minutes: number };

/**
 * Open windows between booked events inside working hours, used by the AI when
 * it suggests when something could actually happen.
 */
export function findFreeSlots(
  list: CalendarEvent[],
  day: Date,
  options: { dayStartHour?: number; dayEndHour?: number; minMinutes?: number } = {},
): FreeSlot[] {
  const { dayStartHour = 9, dayEndHour = 18, minMinutes = 30 } = options;
  const windowStart = new Date(startOfDay(day).setHours(dayStartHour, 0, 0, 0));
  const windowEnd = new Date(startOfDay(day).setHours(dayEndHour, 0, 0, 0));

  const booked = list
    .filter((e) => e.endsAt > windowStart && e.startsAt < windowEnd && !e.allDay)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const slots: FreeSlot[] = [];
  let cursor = windowStart;

  for (const event of booked) {
    if (event.startsAt > cursor) {
      const minutes = (event.startsAt.getTime() - cursor.getTime()) / 60_000;
      if (minutes >= minMinutes) {
        slots.push({ start: cursor, end: event.startsAt, minutes: Math.round(minutes) });
      }
    }
    if (event.endsAt > cursor) cursor = event.endsAt;
  }

  if (windowEnd > cursor) {
    const minutes = (windowEnd.getTime() - cursor.getTime()) / 60_000;
    if (minutes >= minMinutes) {
      slots.push({ start: cursor, end: windowEnd, minutes: Math.round(minutes) });
    }
  }

  return slots;
}

export { durationMinutes };
