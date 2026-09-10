"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  devices, notificationPreferences, notifications, userSettings,
  type NotificationCategory, type NotificationPriority,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { deliverDueNotifications } from "@/lib/notifications/engine";
import { generateNotifications } from "@/lib/notifications/generators";
import { pushConfigured, sendPush } from "@/lib/notifications/push";
import { setTaskDone, snoozeTask } from "./tasks";

/** Rebuilds the notification set from current data, then delivers what is due. */
export async function refreshNotifications() {
  const user = await requireUser();
  await generateNotifications(user.id, user.settings.weekStartsOn);
  const result = await deliverDueNotifications(user.id);
  revalidatePath("/notifications");
  revalidatePath("/");
  return result;
}

export async function markNotificationRead(notificationId: string) {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function markAllRead() {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function dismissNotification(notificationId: string) {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
  revalidatePath("/notifications");
  revalidatePath("/");
}

export async function snoozeNotification(notificationId: string, hours: number) {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ snoozedUntil: new Date(Date.now() + hours * 3_600_000), deliveredAt: null })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
  revalidatePath("/notifications");
  revalidatePath("/");
}

/**
 * Runs an action attached to a notification, so simple things can be done
 * without opening the record they refer to.
 */
export async function runNotificationAction(
  notificationId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const user = await requireUser();

  switch (action) {
    case "task.complete":
      await setTaskDone(String(payload.taskId), true);
      break;
    case "task.snooze":
      await snoozeTask(String(payload.taskId), Number(payload.days ?? 1));
      break;
    default:
      return { ok: false, message: "Unknown action." };
  }

  await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));

  revalidatePath("/notifications");
  revalidatePath("/");
  return { ok: true, message: "Done." };
}

/* ------------------------------------------------------------ preferences */

export async function updateNotificationPreference(
  category: NotificationCategory,
  channel: "inapp" | "push" | "email",
  values: { enabled?: boolean; priorityThreshold?: NotificationPriority; leadMinutes?: number[] },
) {
  const user = await requireUser();
  await db
    .insert(notificationPreferences)
    .values({ userId: user.id, category, channel, ...values })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: values,
    });
  revalidatePath("/settings/notifications");
}

const quietHoursSchema = z.object({
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  criticalBypassesQuietHours: z.boolean(),
  morningBriefingEnabled: z.boolean(),
  morningBriefingTime: z.string().regex(/^\d{2}:\d{2}$/),
  eveningBriefingEnabled: z.boolean(),
  eveningBriefingTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function updateQuietHours(_prev: unknown, formData: FormData) {
  const user = await requireUser();
  const parsed = quietHoursSchema.safeParse({
    quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
    quietHoursStart: String(formData.get("quietHoursStart") ?? "22:00"),
    quietHoursEnd: String(formData.get("quietHoursEnd") ?? "07:00"),
    criticalBypassesQuietHours: formData.get("criticalBypassesQuietHours") === "on",
    morningBriefingEnabled: formData.get("morningBriefingEnabled") === "on",
    morningBriefingTime: String(formData.get("morningBriefingTime") ?? "07:30"),
    eveningBriefingEnabled: formData.get("eveningBriefingEnabled") === "on",
    eveningBriefingTime: String(formData.get("eveningBriefingTime") ?? "20:30"),
  });
  if (!parsed.success) return { error: "Check the times and try again." };

  await db.update(userSettings).set(parsed.data).where(eq(userSettings.userId, user.id));
  revalidatePath("/settings/notifications");
  return { ok: true };
}

/* ---------------------------------------------------------------- devices */

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Registers this browser or phone for push. Called after permission is granted. */
export async function registerDevice(
  subscription: unknown,
  meta: { name: string; platform?: string; userAgent?: string },
) {
  const user = await requireUser();
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, message: "That subscription was not valid." };

  await db
    .insert(devices)
    .values({
      userId: user.id,
      name: meta.name.slice(0, 60),
      platform: meta.platform ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      pushEndpoint: parsed.data.endpoint,
      pushP256dh: parsed.data.keys.p256dh,
      pushAuth: parsed.data.keys.auth,
      notificationsEnabled: true,
    })
    .onConflictDoUpdate({
      target: devices.pushEndpoint,
      set: {
        userId: user.id,
        notificationsEnabled: true,
        lastActiveAt: new Date(),
        pushP256dh: parsed.data.keys.p256dh,
        pushAuth: parsed.data.keys.auth,
      },
    });

  revalidatePath("/settings/devices");
  return { ok: true, message: "This device will receive notifications." };
}

export async function removeDevice(deviceId: string) {
  const user = await requireUser();
  await db.delete(devices).where(and(eq(devices.id, deviceId), eq(devices.userId, user.id)));
  revalidatePath("/settings/devices");
}

/**
 * Sends a push to every enabled device, right now.
 *
 * Push has a long chain — VAPID keys, a service worker, an OS permission, and
 * on iOS a Home Screen install — and every link fails silently. Without a way
 * to test it deliberately you find out it is broken by never being reminded of
 * anything, which is the one failure the app must not have. This deliberately
 * bypasses quiet hours and preferences: the user asked for it in this moment.
 */
export async function sendTestNotification() {
  const user = await requireUser();

  if (!pushConfigured()) {
    return { ok: false, message: "Push is not configured on the server (VAPID keys are missing)." };
  }

  const enabled = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, user.id), eq(devices.notificationsEnabled, true)));

  if (enabled.length === 0) {
    return { ok: false, message: "No device is registered for notifications yet." };
  }

  const results = await Promise.all(
    enabled.map((device) =>
      sendPush(device, {
        title: "Life OS is connected",
        body: "Notifications will reach this device.",
        deepLink: "/settings/devices",
        tag: "test",
      }),
    ),
  );

  const sent = results.filter(Boolean).length;

  if (sent === 0) {
    // A rejected subscription is the usual cause, and it is worth saying so:
    // it means the device needs re-registering, not that push is broken.
    return {
      ok: false,
      message:
        enabled.length === 1
          ? "The push service rejected this device. Turn notifications off and on again to re-register it."
          : "The push service rejected every registered device. Re-register them below.",
    };
  }

  return {
    ok: true,
    message:
      sent === enabled.length
        ? `Sent to ${sent} device${sent === 1 ? "" : "s"}. It should arrive within a few seconds.`
        : `Sent to ${sent} of ${enabled.length} devices. The others were rejected and need re-registering.`,
  };
}
