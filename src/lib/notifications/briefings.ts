import "server-only";

import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { habitEntries, tasks, users, userSettings } from "@/db/schema";
import { getTodayEvents } from "@/lib/domain/calendar";
import { getTodaysHabits } from "@/lib/domain/habits";
import { formatTime } from "@/lib/utils";
import { zonedDayKey, zonedTimeToInstant } from "@/lib/time-zone";
import { scheduleNotification } from "./engine";

/**
 * The two daily digests.
 *
 * Everything else in the notification system reacts to a single thing changing.
 * These are the only ones that speak at a time the user chose, about the day as
 * a whole — which is what makes the difference between an app you remember to
 * open and one that reaches you.
 *
 * Three rules they follow:
 *
 * They are scheduled, not sent. Generation runs on every cron tick, so the row
 * is created with `scheduledFor` set to the user's chosen wall-clock time and
 * the existing delivery pass picks it up when due. Nothing here needs to know
 * what time it is.
 *
 * They expire. A morning briefing delivered at two in the afternoon is not a
 * morning briefing, it is a stale interruption, so the row is given a window
 * and allowed to lapse if the scheduler was down.
 *
 * They never pad. A day with nothing on it says so in one line rather than
 * manufacturing three bullet points to look useful.
 */

/** How long after its time a briefing is still worth delivering. */
const BRIEFING_WINDOW_HOURS = 3;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Two events from 09:30, 3 tasks due, 1 habit." — or an honest empty day. */
async function morningBody(userId: string, timeZone: string, now: Date) {
  const dayKey = zonedDayKey(now, timeZone);
  // The end of today on the user's clock, which is not the end of today on the
  // server's once the app is hosted.
  const dayEnd = zonedTimeToInstant(dayKey, "23:59", timeZone) ?? now;

  const [events, habits, dueToday] = await Promise.all([
    getTodayEvents(userId),
    getTodaysHabits(userId),
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
          lte(tasks.dueDate, dayEnd),
        ),
      ),
  ]);

  const timed = events.filter((e) => !e.allDay).sort((a, b) => +a.startsAt - +b.startsAt);
  const outstandingHabits = habits.filter((h) => !h.doneToday);

  const parts: string[] = [];
  if (timed.length > 0) {
    parts.push(`${plural(timed.length, "event")} from ${formatTime(timed[0].startsAt)}`);
  }
  if (dueToday.length > 0) parts.push(`${plural(dueToday.length, "task")} due`);
  if (outstandingHabits.length > 0) parts.push(`${plural(outstandingHabits.length, "habit")}`);

  if (parts.length === 0) {
    // Saying "nothing scheduled" is information. Inventing a third bullet to
    // fill the space is not.
    return "Nothing scheduled and nothing due. The day is yours.";
  }

  const first = timed[0] ?? null;
  const lead = `${parts.join(", ")}.`;
  return first ? `${lead} First up: ${first.title} at ${formatTime(first.startsAt)}.` : lead;
}

/** What actually happened, and what did not. */
async function eveningBody(userId: string, timeZone: string, now: Date) {
  const dayKey = zonedDayKey(now, timeZone);
  const dayStart = zonedTimeToInstant(dayKey, "00:00", timeZone) ?? now;

  const [completed, stillOpen, habitsDone] = await Promise.all([
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          eq(tasks.status, "done"),
          gte(tasks.completedAt, dayStart),
        ),
      ),
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
          lt(tasks.dueDate, new Date(dayStart.getTime() + 86_400_000)),
        ),
      ),
    db
      .select({ id: habitEntries.id })
      .from(habitEntries)
      .where(
        and(
          eq(habitEntries.userId, userId),
          eq(habitEntries.date, dayKey),
          eq(habitEntries.completed, true),
        ),
      ),
  ]);

  const done: string[] = [];
  if (completed.length > 0) done.push(`${plural(completed.length, "task")} done`);
  if (habitsDone.length > 0) done.push(`${plural(habitsDone.length, "habit")} logged`);

  const headline = done.length > 0 ? done.join(", ") : "Nothing logged today";

  if (stillOpen.length === 0) {
    return `${headline}. Nothing overdue going into tomorrow.`;
  }

  // Naming the oldest one is the difference between a number and a decision.
  return `${headline}. ${plural(stillOpen.length, "task")} still open, including "${stillOpen[0].title}".`;
}

/**
 * Schedules today's briefings for one user, idempotently.
 *
 * Safe to call on every cron tick: the dedupe key is the kind plus the local
 * day, so the row is created once and updated thereafter rather than
 * duplicated.
 */
export async function generateBriefings(userId: string, now: Date = new Date()) {
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!settings) return { created: 0 };

  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timeZone = owner?.timezone ?? "UTC";

  const dayKey = zonedDayKey(now, timeZone);
  let created = 0;

  const wanted: { kind: "morning" | "evening"; time: string }[] = [];
  if (settings.morningBriefingEnabled) wanted.push({ kind: "morning", time: settings.morningBriefingTime });
  if (settings.eveningBriefingEnabled) wanted.push({ kind: "evening", time: settings.eveningBriefingTime });

  for (const { kind, time } of wanted) {
    const scheduledFor = zonedTimeToInstant(dayKey, time, timeZone);
    if (!scheduledFor) continue;

    const expiresAt = new Date(scheduledFor.getTime() + BRIEFING_WINDOW_HOURS * 3_600_000);
    // Already past its window: the scheduler was down, and a briefing hours
    // late is worse than none. Tomorrow's will be on time.
    if (now > expiresAt) continue;

    const body =
      kind === "morning"
        ? await morningBody(userId, timeZone, now)
        : await eveningBody(userId, timeZone, now);

    await scheduleNotification(userId, {
      category: "system",
      kind: "reminder",
      type: `briefing.${kind}`,
      title: kind === "morning" ? "Today" : "Today in review",
      body,
      // Normal rather than high: a digest arriving at a time the user chose is
      // expected, not urgent, and should not outrank a real deadline.
      priority: "normal",
      scheduledFor,
      expiresAt,
      deepLink: kind === "morning" ? "/" : "/journal",
      dedupeKey: `briefing:${kind}:${dayKey}`,
    });
    created++;
  }

  return { created };
}
