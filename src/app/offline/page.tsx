import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * Served by the service worker when a navigation fails with no cached copy.
 * Deliberately dependency-free so it renders from cache with no data access.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-ink">
          L
        </span>
        <h1 className="text-lg font-semibold tracking-tight text-ink">You are offline</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Pages you have already opened are still available. Anything you capture while offline is
          queued and sent when the connection comes back.
        </p>
        {/* A plain anchor on purpose: this page is served from the service
            worker cache with no router attached, and "try again" should force
            a real network request rather than a client-side transition. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
