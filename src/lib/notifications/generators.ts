import "server-only";

import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, notificationPreferences, tasks } from "@/db/schema";
import { getAttentionSignals } from "@/lib/domain/attention";
import { addDays, formatDuration, formatTime, isoDate, startOfDay } from "@/lib/utils";
import { scheduleNotification } from "./engine";

/** Lead times a user has configured for a category, or a sensible default. */
async function leadMinutesFor(userId: string, category: string, fallback: number[]) {
  const [pref] = await db
    .select({ leadMinutes: notificationPreferences.leadMinutes })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        sql`${notificationPreferences.category} = ${category}`,
        eq(notificationPreferences.channel, "push"),
      ),
    )
    .limit(1);
  return pref?.leadMinutes?.length ? pref.leadMinutes : fallback;
}

/**
 * Turns the current state of the Life OS into scheduled notifications.
 *
 * Idempotent by construction: every rule builds a dedupe key from the source
 * record and the lead time, so running this on every request, on a cron, or
 * twice in a row produces the same set of rows.
 */
export async function generateNotifications(userId: string, weekStartsOn = 1) {
  const now = new Date();
  let created = 0;

  /* ------------------------------------------------------------- tasks */

  const taskLeads = await leadMinutesFor(userId, "tasks", [1440, 180]);
  const upcoming = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, priority: tasks.priority })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        sql`${tasks.status} in ('todo','in_progress','blocked')`,
        gte(tasks.dueDate, now),
        lte(tasks.dueDate, addDays(now, 3)),
      ),
    );

  for (const task of upcoming) {
    if (!task.dueDate) continue;
    for (const lead of taskLeads) {
      const fireAt = new Date(task.dueDate.getTime() - lead * 60_000);
      // Only schedule reminders that are still ahead of us.
      if (fireAt < now) continue;
      await scheduleNotification(userId, {
        category: "tasks",
        kind: "reminder",
        type: "task.due",
        title: task.title,
        body: `Due in ${formatDuration(lead)}`,
        priority: task.priority === "must" ? "high" : "normal",
        scheduledFor: fireAt,
        expiresAt: addDays(task.dueDate, 1),
        deepLink: `/tasks?view=today&task=${task.id}`,
        actions: [
          { label: "Complete", action: "task.complete", payload: { taskId: task.id } },
          { label: "Snooze", action: "task.snooze", payload: { taskId: task.id, days: 1 } },
        ],
        sourceType: "task",
        sourceId: task.id,
        dedupeKey: `task.due:${task.id}:${lead}`,
      });
      created++;
    }
  }

  const overdue = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        sql`${tasks.status} in ('todo','in_progress','blocked')`,
        lt(tasks.dueDate, startOfDay(now)),
      ),
    );

  if (overdue.length > 0) {
    // One rolled-up notification per day rather than one per task.
    await scheduleNotification(userId, {
      category: "tasks",
      type: "task.overdue",
      title: `${overdue.length} ${overdue.length === 1 ? "task is" : "tasks are"} overdue`,
      body: overdue
        .slice(0, 3)
        .map((t) => t.title)
        .join(", "),
      priority: overdue.length >= 5 ? "high" : "normal",
      deepLink: "/tasks?view=overdue",
      dedupeKey: `task.overdue:${isoDate(now)}`,
      expiresAt: addDays(now, 1),
    });
    created++;
  }

  /* ---------------------------------------------------------- calendar */

  const calendarLeads = await leadMinutesFor(userId, "calendar", [60, 15]);
  const soon = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        gte(events.startsAt, now),
        lte(events.startsAt, addDays(now, 1)),
        eq(events.allDay, false),
      ),
    );

  for (const event of soon) {
    for (const lead of calendarLeads) {
      const fireAt = new Date(event.startsAt.getTime() - lead * 60_000);
      if (fireAt < now) continue;
      await scheduleNotification(userId, {
        category: "calendar",
        kind: "reminder",
        type: "event.upcoming",
        title: event.title,
        body: `Starts at ${formatTime(event.startsAt)}${event.location ? ` · ${event.location}` : ""}`,
        priority: lead <= 15 ? "high" : "normal",
        scheduledFor: fireAt,
        expiresAt: event.endsAt,
        deepLink: `/calendar?view=day&date=${isoDate(event.startsAt)}`,
        sourceType: "event",
        sourceId: event.id,
        dedupeKey: `event.upcoming:${event.id}:${lead}`,
      });
      created++;
    }
  }

  /* --------------------------------------------------- attention signals */

  // Anything the Attention panel already decided is worth surfacing becomes a
  // notification too, at the same severity and with the same explanation.
  const signals = await getAttentionSignals(userId, weekStartsOn);
  const CATEGORY_MAP = {
    tasks: "tasks",
    calendar: "calendar",
    projects: "projects",
    goals: "goals",
    health: "health",
    finance: "finance",
    relationships: "relationships",
    system: "system",
  } as const;

  for (const signal of signals) {
    if (signal.category === "tasks") continue; // already covered above
    await scheduleNotification(userId, {
      category: CATEGORY_MAP[signal.category],
      kind: signal.category === "health" || signal.category === "finance" ? "insight" : "notification",
      type: `signal.${signal.category}`,
      title: signal.title,
      body: signal.why,
      priority: signal.severity === "critical" ? "critical" : signal.severity === "high" ? "high" : "low",
      deepLink: signal.href,
      dedupeKey: `signal:${signal.key}`,
      expiresAt: addDays(now, 7),
    });
    created++;
  }

  return { created };
}
