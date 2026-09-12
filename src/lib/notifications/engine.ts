import "server-only";

import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  devices, events, notificationPreferences, notifications, tasks, users, userSettings,
  type NotificationCategory, type NotificationKind, type NotificationPriority,
} from "@/db/schema";
import { PRIORITY_RANK } from "@/lib/domain/notifications";
import { zonedMinutes } from "@/lib/time-zone";
import { sendPush } from "./push";

export type NotificationSpec = {
  category: NotificationCategory;
  kind?: NotificationKind;
  /** Machine name for the rule that produced this, e.g. "task.due". */
  type: string;
  title: string;
  body?: string;
  priority?: NotificationPriority;
  scheduledFor?: Date;
  expiresAt?: Date;
  deepLink?: string;
  actions?: { label: string; action: string; payload?: Record<string, unknown> }[];
  sourceType?: string;
  sourceId?: string;
  /**
   * Stable identity for this notification. Two rules producing the same key
   * collapse into one row, which is what stops a task synced from two
   * providers reminding you twice.
   */
  dedupeKey: string;
};

/**
 * Schedules a notification, idempotently.
 *
 * Re-running the generators is safe and expected: an existing row for the same
 * dedupe key is updated rather than duplicated, and a row the user already
 * dismissed is left alone rather than resurrected.
 */
export async function scheduleNotification(userId: string, spec: NotificationSpec) {
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, spec.dedupeKey)))
    .limit(1);

  if (existing) {
    if (existing.dismissedAt) return existing;
    await db
      .update(notifications)
      .set({
        title: spec.title,
        body: spec.body ?? null,
        priority: spec.priority ?? existing.priority,
        deepLink: spec.deepLink ?? existing.deepLink,
      })
      .where(eq(notifications.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(notifications)
    .values({
      userId,
      category: spec.category,
      kind: spec.kind ?? "notification",
      type: spec.type,
      title: spec.title,
      body: spec.body ?? null,
      priority: spec.priority ?? "normal",
      scheduledFor: spec.scheduledFor ?? new Date(),
      expiresAt: spec.expiresAt ?? null,
      deepLink: spec.deepLink ?? null,
      actions: spec.actions ?? [],
      sourceType: spec.sourceType ?? null,
      sourceId: spec.sourceId ?? null,
      dedupeKey: spec.dedupeKey,
    })
    .returning();

  return created;
}

/** The same instant as the user would read it off a clock on their wall. */
function formatZonedTime(instant: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  } catch {
    return "unknown";
  }
}

/** "22:00" to "07:00" wraps around midnight, which the naive comparison misses. */
export function inQuietHours(now: Date, start: string, end: string, timezone = "UTC") {
  const minutes = zonedMinutes(now, timezone);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  return startMinutes <= endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

/**
 * Source types whose existence is checked before delivery.
 *
 * Deliberately a closed list: a notification carrying a source type not named
 * here is delivered rather than dropped, so adding a generator can never
 * silently start discarding its own output.
 */
const CHECKED_SOURCES = new Set(["task", "event"]);

/** The subset of the given source ids whose rows still exist and are not deleted. */
async function liveSourceIds(
  userId: string,
  rows: { sourceType: string | null; sourceId: string | null }[],
) {
  const wanted = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sourceType || !row.sourceId || !CHECKED_SOURCES.has(row.sourceType)) continue;
    wanted.set(row.sourceType, [...(wanted.get(row.sourceType) ?? []), row.sourceId]);
  }

  const live = new Set<string>();
  const lookup = async (table: typeof tasks | typeof events, ids: string[]) => {
    if (ids.length === 0) return;
    const found = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.userId, userId), inArray(table.id, ids), isNull(table.deletedAt)));
    for (const row of found) live.add(row.id);
  };

  await Promise.all([
    lookup(tasks, wanted.get("task") ?? []),
    lookup(events, wanted.get("event") ?? []),
  ]);

  return live;
}

/**
 * Delivers everything due, honouring per-category channel preferences,
 * priority thresholds and quiet hours.
 *
 * Suppressed notifications are not dropped: they stay in the centre and are
 * picked up by the next delivery pass once quiet hours end.
 */
export async function deliverDueNotifications(userId: string) {
  const now = new Date();

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!settings) return { delivered: 0, suppressed: 0, dropped: 0, clock: null };

  // Quiet hours are a statement about the user's evening, not the server's.
  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timezone = owner?.timezone ?? "UTC";

  const quiet =
    settings.quietHoursEnabled &&
    inQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd, timezone);

  // Reported back to the caller: "3 suppressed" is unreadable without knowing
  // which clock made that call, and a wrong timezone is invisible otherwise.
  const clock = { timezone, localTime: formatZonedTime(now, timezone), quiet };

  const due = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        lte(notifications.scheduledFor, now),
        isNull(notifications.deliveredAt),
        isNull(notifications.dismissedAt),
        or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, now)),
        or(isNull(notifications.expiresAt), gt(notifications.expiresAt, now)),
      ),
    );

  if (due.length === 0) return { delivered: 0, suppressed: 0, dropped: 0, clock };

  /*
   * A reminder for something that no longer exists is worse than no reminder:
   * it spends attention and there is nothing to be done with it. Checking at
   * delivery rather than on delete covers every path a row can leave by — the
   * demo clear, a soft delete, a cascade, an edit made straight to the
   * database — with one rule instead of one per caller.
   */
  const live = await liveSourceIds(userId, due);
  const isOrphan = (n: { sourceType: string | null; sourceId: string | null }) =>
    Boolean(n.sourceType && n.sourceId && CHECKED_SOURCES.has(n.sourceType) && !live.has(n.sourceId));

  const orphaned = due.filter(isOrphan);
  if (orphaned.length > 0) {
    // Dismissed rather than deleted: the generators will not resurrect a
    // dismissed row, so this also stops it coming back on the next run.
    await db
      .update(notifications)
      .set({ dismissedAt: now })
      .where(inArray(notifications.id, orphaned.map((n) => n.id)));
  }

  const relevant = due.filter((n) => !isOrphan(n));
  if (relevant.length === 0) {
    return { delivered: 0, suppressed: 0, dropped: orphaned.length, clock };
  }

  const [prefs, deviceRows] = await Promise.all([
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.notificationsEnabled, true))),
  ]);

  let delivered = 0;
  let suppressed = 0;

  for (const notification of relevant) {
    const pushPref = prefs.find(
      (p) => p.category === notification.category && p.channel === "push",
    );
    const allowedByPref =
      pushPref?.enabled &&
      PRIORITY_RANK[notification.priority] >= PRIORITY_RANK[pushPref.priorityThreshold];

    // Critical notifications may pass quiet hours if the user allows it.
    const blockedByQuietHours =
      quiet &&
      !(notification.priority === "critical" && settings.criticalBypassesQuietHours);

    if (!allowedByPref || blockedByQuietHours || deviceRows.length === 0) {
      // In-app delivery still counts as delivered: it is already visible in
      // the notification centre without interrupting anyone.
      await db
        .update(notifications)
        .set({ deliveredAt: now, deliveredChannels: ["inapp"] })
        .where(eq(notifications.id, notification.id));
      if (blockedByQuietHours) suppressed++;
      continue;
    }

    const results = await Promise.all(
      deviceRows.map((device) =>
        sendPush(device, {
          title: notification.title,
          // Bodies are deliberately non-specific for sensitive categories;
          // the detail lives behind authentication.
          body:
            notification.category === "finance"
              ? "Open Life OS to see the details."
              : (notification.body ?? ""),
          deepLink: notification.deepLink ?? "/notifications",
          tag: notification.dedupeKey,
        }),
      ),
    );

    await db
      .update(notifications)
      .set({
        deliveredAt: now,
        deliveredChannels: results.some(Boolean) ? ["inapp", "push"] : ["inapp"],
      })
      .where(eq(notifications.id, notification.id));

    delivered++;
  }

  return { delivered, suppressed, dropped: orphaned.length, clock };
}
