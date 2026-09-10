"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, Smartphone, Trash2 } from "lucide-react";
import { registerDevice, removeDevice, sendTestNotification } from "@/lib/actions/notifications";
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState,
} from "@/components/ui/primitives";
import { formatDate, formatTime, isToday } from "@/lib/utils";

type DeviceRow = {
  id: string;
  name: string;
  platform: string | null;
  notificationsEnabled: boolean;
  hasSubscription: boolean;
  lastActiveAt: string;
};

/** VAPID keys arrive base64url-encoded and the Push API wants raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function describeDevice() {
  const ua = navigator.userAgent;
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  return { name: `${browser} on ${platform}`, platform, userAgent: ua };
}

export function DevicesView({
  devices,
  vapidPublicKey,
  pushConfigured,
}: {
  devices: DeviceRow[];
  vapidPublicKey: string | null;
  pushConfigured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The browser's own permission state, read through useSyncExternalStore so
   * it is a genuine external read rather than state seeded by an effect. There
   * is no event to subscribe to: it only changes when we ask for it, and the
   * override below covers that case.
   */
  const ambient = useSyncExternalStore(
    () => () => {},
    () =>
      "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
        ? (Notification.permission as NotificationPermission | "unsupported")
        : "unsupported",
    () => "default" as NotificationPermission | "unsupported",
  );
  const [granted, setGranted] = useState<NotificationPermission | null>(null);
  const permission = granted ?? ambient;

  async function enablePush() {
    setError(null);
    setMessage(null);

    if (!vapidPublicKey) {
      setError("No VAPID public key is configured on the server.");
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setGranted(result);
      if (result !== "granted") {
        setError("Permission was not granted, so this device will not receive push.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Reuse an existing subscription rather than creating a duplicate.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const meta = describeDevice();
      startTransition(async () => {
        const response = await registerDevice(subscription.toJSON(), meta);
        if (response.ok) {
          setMessage(response.message);
          router.refresh();
        } else {
          setError(response.message);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push on this device.");
    }
  }

  function sendTest() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const response = await sendTestNotification();
      if (response.ok) setMessage(response.message);
      else setError(response.message);
    });
  }

  return (
    <div className="space-y-5">
      {!pushConfigured ? (
        <ErrorState
          title="Push is not configured on the server"
          description="Run `npm run generate:vapid`, add the two keys to .env, and restart. Everything else in Life OS works without it."
        />
      ) : null}

      <Card>
        <CardHeader
          title="This device"
          description={
            permission === "unsupported"
              ? "This browser does not support web push."
              : permission === "granted"
                ? "Notifications are allowed here."
                : permission === "denied"
                  ? "Notifications are blocked. Re-allow them in your browser settings for this site."
                  : "Not yet enabled."
          }
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
          <BellRing className="size-4 text-ink-subtle" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
            Turning this on registers this browser so reminders reach you when Life OS is closed.
          </p>
          <Button
            size="sm"
            variant="primary"
            disabled={
              pending ||
              !pushConfigured ||
              permission === "unsupported" ||
              permission === "denied"
            }
            onClick={enablePush}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Enable on this device
          </Button>
        </div>

        {message ? <p className="px-5 pb-4 text-[13px] text-positive">{message}</p> : null}
        {error ? (
          <p role="alert" className="px-5 pb-4 text-[13px] text-critical">
            {error}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Registered devices"
          description={
            devices.length > 0
              ? "Send a test to check the whole chain — server, push service, and this phone — rather than waiting for a real reminder."
              : undefined
          }
          action={
            devices.length > 0 ? (
              <Button size="sm" variant="secondary" disabled={pending} onClick={sendTest}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Send a test
              </Button>
            ) : undefined
          }
        />
        {devices.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="size-5" />}
            title="No devices registered"
            description="Enable notifications above, or install Life OS on your phone and enable them there."
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-5 py-3.5">
                <Smartphone className="size-4 shrink-0 text-ink-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{device.name}</p>
                  <p className="text-[12px] text-ink-subtle">
                    Last active{" "}
                    {isToday(new Date(device.lastActiveAt))
                      ? formatTime(new Date(device.lastActiveAt))
                      : formatDate(new Date(device.lastActiveAt))}
                  </p>
                </div>
                <Badge tone={device.notificationsEnabled && device.hasSubscription ? "positive" : "neutral"}>
                  {device.notificationsEnabled && device.hasSubscription ? "Notifications on" : "Inactive"}
                </Badge>
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`Remove ${device.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      await removeDevice(device.id);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
