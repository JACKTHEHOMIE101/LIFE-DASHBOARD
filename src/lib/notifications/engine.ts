import "server-only";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  devices, notificationPreferences, notifications, users, userSettings,
  type NotificationCategory, type NotificationKind, type NotificationPriority,
} from "@/db/schema";
import { PRIORITY_RANK } from "@/lib/domain/notifications";
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

/**
 * Wall-clock minutes past midnight in a given zone.
 *
 * `Date.getHours()` reports the *server's* local time. That is the user's own
 * clock when the app runs on their laptop and UTC once it is hosted, which
 * silently shifts quiet hours by the offset between them — the failure mode is
 * silence during the evening and alerts at 2am, with nothing in any log.
 */
function zonedMinutes(instant: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch {
    // An unrecognised zone string must not silence every notification, so fall
    // through to the server clock rather than throwing.
  }
  return instant.getHours() * 60 + instant.getMinutes();
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
  if (!settings) return { delivered: 0, suppressed: 0, clock: null };

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

  if (due.length === 0) return { delivered: 0, suppressed: 0, clock };

  const [prefs, deviceRows] = await Promise.all([
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.notificationsEnabled, true))),
  ]);

  let delivered = 0;
  let suppressed = 0;

  for (const notification of due) {
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

  return { delivered, suppressed, clock };
}
