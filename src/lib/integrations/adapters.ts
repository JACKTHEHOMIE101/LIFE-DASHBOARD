import type { ProviderAdapter } from "./types";
import { googleCalendarAdapter } from "./providers/google-calendar";

/**
 * Adapters that actually exist, keyed by provider id.
 *
 * The registry in `registry.ts` describes every provider the architecture is
 * designed for; this is the subset with code behind it. Keeping them apart is
 * what lets the integrations page say honestly which is which, rather than
 * offering a Connect button that leads nowhere.
 */
const ADAPTERS: Record<string, ProviderAdapter> = {
  google_calendar: googleCalendarAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/**
 * Whether a provider can be connected right now.
 *
 * An adapter with no OAuth credentials configured is not connectable, and
 * saying so up front is better than a Google error page after two redirects.
 */
export function adapterReady(provider: string) {
  if (!getAdapter(provider)) return false;
  if (provider === "google_calendar") {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }
  return true;
}

export function implementedProviders() {
  return Object.keys(ADAPTERS);
}
