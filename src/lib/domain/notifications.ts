import "server-only";

import { and, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notificationPreferences, notifications,
  type Notification, type NotificationCategory, type NotificationPriority,
} from "@/db/schema";

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
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

export const PRIORITY_RANK: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

/** Due means scheduled in the past, not dismissed, not snoozed, not expired. */
function dueNow(userId: string) {
  const now = new Date();
  return and(
    eq(notifications.userId, userId),
    lte(notifications.scheduledFor, now),
    isNull(notifications.dismissedAt),
    or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, now)),
    or(isNull(notifications.expiresAt), sql`${notifications.expiresAt} > ${now.getTime()}`),
  );
}

export async function countUnreadNotifications(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(dueNow(userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(
  userId: string,
  options: { includeRead?: boolean; category?: NotificationCategory; limit?: number } = {},
): Promise<Notification[]> {
  const conditions = [dueNow(userId)];
  if (!options.includeRead) conditions.push(isNull(notifications.readAt));
  if (options.category) conditions.push(eq(notifications.category, options.category));

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.scheduledFor))
    .limit(options.limit ?? 100);
}

export async function getNotificationPreferences(userId: string) {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .orderBy(notificationPreferences.category);
}

/** Grouped by category so the settings page can render one block per category. */
export async function getGroupedPreferences(userId: string) {
  const rows = await getNotificationPreferences(userId);
  const map = new Map<NotificationCategory, typeof rows>();
  for (const row of rows) {
    const list = map.get(row.category) ?? [];
    list.push(row);
    map.set(row.category, list);
  }
  return map;
}
