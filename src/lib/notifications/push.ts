import "server-only";

import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, type Device } from "@/db/schema";

let configured: boolean | null = null;

/** VAPID keys are optional: without them the app runs, just without push. */
function ensureConfigured() {
  if (configured !== null) return configured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@lifeos.local";

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function pushConfigured() {
  return ensureConfigured();
}

export type PushPayload = {
  title: string;
  body: string;
  deepLink: string;
  tag: string;
};

/**
 * Sends one push. A 404 or 410 means the subscription is dead, so the device
 * is unregistered rather than retried forever.
 */
export async function sendPush(device: Device, payload: PushPayload): Promise<boolean> {
  if (!ensureConfigured()) return false;
  if (!device.pushEndpoint || !device.pushP256dh || !device.pushAuth) return false;

  try {
    await webpush.sendNotification(
      {
        endpoint: device.pushEndpoint,
        keys: { p256dh: device.pushP256dh, auth: device.pushAuth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    );
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db
        .update(devices)
        .set({ pushEndpoint: null, pushP256dh: null, pushAuth: null, notificationsEnabled: false })
        .where(eq(devices.id, device.id));
    }
    return false;
  }
}
