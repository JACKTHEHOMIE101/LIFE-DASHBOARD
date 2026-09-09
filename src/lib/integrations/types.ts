/**
 * Integration architecture.
 *
 *     Provider API
 *          |
 *     ProviderAdapter        (provider-specific, one file per provider)
 *          |
 *     NormalisedRecord[]     (the only shape the rest of the app ever sees)
 *          |
 *     Life OS tables         (upserted by provider + externalId)
 *          |
 *     UI / analytics / AI
 *
 * Nothing above the adapter layer knows which provider data came from. A UI
 * component never imports a provider module, and adding a provider means
 * writing one adapter and registering it — no changes anywhere else.
 *
 * This file is deliberately free of server-only imports so the registry can be
 * rendered on the integrations page.
 */

export type IntegrationDomain =
  | "calendar" | "tasks" | "notes" | "health" | "fitness" | "finance" | "files" | "communication";

export type AuthKind = "oauth2" | "api_key" | "file_import" | "device";

export type ProviderDefinition = {
  id: string;
  name: string;
  domain: IntegrationDomain;
  description: string;
  authKind: AuthKind;
  /** Scopes requested at connect time, shown to the user before they consent. */
  scopes: string[];
  /** What Life OS will read, in plain language, for the permissions screen. */
  reads: string[];
  /** Whether an adapter implementation exists yet. */
  status: "available" | "planned";
  /** Whether the provider supports cursor-based incremental sync. */
  incremental: boolean;
};

/** Normalised records an adapter can emit. Mirrors the core Life OS models. */
export type NormalisedRecord =
  | { kind: "event"; externalId: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean; location?: string; description?: string; attendees?: { name?: string; email?: string }[]; calendarId?: string; calendarName?: string; category?: string }
  | { kind: "task"; externalId: string; title: string; description?: string; dueDate?: Date; completedAt?: Date; priority?: "must" | "should" | "could"; projectExternalId?: string }
  | { kind: "metric"; externalId: string; metric: string; date: string; value: number; unit: string }
  | { kind: "workout"; externalId: string; name: string; type: string; startedAt: Date; durationMinutes?: number; distanceMeters?: number; calories?: number; avgHeartRate?: number }
  | { kind: "account"; externalId: string; name: string; institution?: string; accountType: string; balanceMinor: number; isLiability: boolean; currency: string }
  | { kind: "transaction"; externalId: string; accountExternalId: string; date: string; description: string; merchant?: string; amountMinor: number; category: string; currency: string }
  | { kind: "note"; externalId: string; title: string; body: string; url?: string };

export type SyncContext = {
  userId: string;
  /** Opaque cursor from the previous successful sync, if any. */
  cursor: string | null;
  /** Credentials resolved server-side. Adapters never read env or the database. */
  credentials: Record<string, string>;
  config: Record<string, unknown>;
};

export type SyncResult = {
  records: NormalisedRecord[];
  /** Cursor to persist for the next incremental run. */
  cursor: string | null;
  /** External ids deleted at the provider since the last sync. */
  deletedExternalIds?: string[];
};

/**
 * The contract every provider implements. Connect and disconnect handle the
 * credential lifecycle; sync is the only method that moves data.
 */
export type ProviderAdapter = {
  definition: ProviderDefinition;
  /** Returns the URL to send the user to, or null for non-redirect auth. */
  beginConnect?(userId: string, redirectUri: string): Promise<string | null>;
  /** Exchanges whatever the provider returned for storable credentials. */
  completeConnect?(userId: string, params: Record<string, string>): Promise<Record<string, string>>;
  /** Pulls records since the cursor. Must be safe to call repeatedly. */
  sync(context: SyncContext): Promise<SyncResult>;
  /** Revokes tokens at the provider. Local rows are removed regardless. */
  revoke?(credentials: Record<string, string>): Promise<void>;
};
