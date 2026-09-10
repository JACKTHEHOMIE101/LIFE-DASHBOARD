"use client";

import { useSyncExternalStore } from "react";
import { Share, SquarePlus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";

/** Standalone means the PWA was installed to the home screen. */
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS predates the standard and uses its own flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so touch points are the giveaway.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * iOS will not deliver a web push notification to a site running in a Safari
 * tab. It only works once the app has been added to the home screen, and there
 * is no install prompt to trigger — the user has to do it through the share
 * sheet. So the app has to say so, or notifications silently never arrive.
 */
export function InstallGuide() {
  const state = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(display-mode: standalone)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (isStandalone() ? "installed" : isIOS() ? "ios" : "other"),
    () => "server" as const,
  );

  if (state === "server" || state === "installed") return null;

  if (state !== "ios") {
    return (
      <Card>
        <CardHeader
          title="Install on this device"
          description="Notifications are more reliable from an installed app than a browser tab."
        />
        <p className="border-t border-border px-5 py-4 text-[13px] text-ink-muted">
          Use your browser&apos;s install option — usually an icon in the address bar, or
          &ldquo;Install app&rdquo; in the menu.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Add to your Home Screen first"
        description="On iPhone this is required, not a nicety."
      />
      <div className="border-t border-border px-5 py-4">
        <p className="text-[13px] text-ink-muted">
          iOS does not deliver notifications to a website open in Safari. It only sends them to an
          app added to the Home Screen, so until you do this, enabling notifications below will
          appear to work and nothing will ever arrive.
        </p>
        <ol className="mt-3 space-y-2 text-[13px] text-ink-muted">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink">
              1
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              Tap the Share button
              <Share className="size-3.5 shrink-0" />
              in the Safari toolbar.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink">
              2
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              Scroll down and choose
              <SquarePlus className="size-3.5 shrink-0" />
              <span className="font-medium text-ink">Add to Home Screen</span>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-medium text-ink">
              3
            </span>
            <span>
              Open Life OS from the new icon, come back to this page, and enable notifications
              there.
            </span>
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-ink-subtle">
          Requires iOS 16.4 or later. It must be Safari that adds it — Chrome on iOS cannot.
        </p>
      </div>
    </Card>
  );
}
