import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { events, integrations, syncRecords } from "@/db/schema";
import { readCredentials, updateCredentials } from "./credentials";
import { getAdapter } from "./adapters";
import { accessTokenExpired, refreshAccessToken } from "./providers/google-calendar";
import type { NormalisedRecord } from "./types";

/**
 * Runs one provider's sync and writes the result into Life OS.
 *
 * The bookkeeping matters as much as the data: a sync row is opened before any
 * network call and closed in a `finally`, so a run that dies halfway leaves a
 * failed record with the reason rather than nothing at all. A silent
 * integration is worse than a broken one, because the calendar simply looks
 * empty and nothing says why.
 */

export type SyncOutcome = {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  message: string;
};

/**
 * Ensures the access token is usable, refreshing and persisting if not.
 *
 * Adapters are handed credentials and cannot store them, so the refreshed token
 * has to be written here or every sync would refresh again.
 */
async function usableCredentials(
  userId: string,
  credentialRef: string,
  credentials: Record<string, string>,
) {
  if (!accessTokenExpired(credentials)) return credentials;
  if (!credentials.refreshToken) {
    throw new Error("This connection has no refresh token. Reconnect it.");
  }

  const refreshed = { ...credentials, ...(await refreshAccessToken(credentials.refreshToken)) };
  await updateCredentials(userId, credentialRef, refreshed);
  return refreshed;
}

/** Writes normalised events, counting inserts and updates separately. */
async function writeEvents(userId: string, provider: string, records: NormalisedRecord[]) {
  let created = 0;
  let updated = 0;

  for (const record of records) {
    if (record.kind !== "event") continue;

    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.provider, provider), eq(events.externalId, record.externalId)))
      .limit(1);

    const values = {
      userId,
      title: record.title,
      description: record.description ?? null,
      location: record.location ?? null,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      allDay: record.allDay,
      attendees: record.attendees ?? [],
      calendarId: record.calendarId ?? null,
      calendarName: record.calendarName ?? null,
      origin: "imported" as const,
      provider,
      externalId: record.externalId,
      lastSyncedAt: new Date(),
      // An event deleted at the provider and then restored should come back,
      // rather than staying invisible because of an older soft delete.
      deletedAt: null,
    };

    if (existing.length > 0) {
      await db.update(events).set(values).where(eq(events.id, existing[0].id));
      updated++;
    } else {
      await db.insert(events).values(values);
      created++;
    }
  }

  return { created, updated };
}

/**
 * Soft-deletes events the provider says are gone.
 *
 * Soft, so a mistake at the provider — or a sync token that returned too much —
 * is recoverable, and so anything that referenced the event still resolves.
 */
async function removeEvents(userId: string, provider: string, externalIds: string[]) {
  if (externalIds.length === 0) return 0;

  const doomed = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.provider, provider),
        inArray(events.externalId, externalIds),
        isNull(events.deletedAt),
      ),
    );

  if (doomed.length === 0) return 0;

  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(inArray(events.id, doomed.map((row) => row.id)));

  return doomed.length;
}

export async function runSync(userId: string, provider: string): Promise<SyncOutcome> {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .limit(1);

  if (!integration || integration.status === "disconnected" || !integration.credentialRef) {
    return { ok: false, created: 0, updated: 0, deleted: 0, message: "That provider is not connected." };
  }

  const adapter = getAdapter(provider);
  if (!adapter) {
    return { ok: false, created: 0, updated: 0, deleted: 0, message: "No adapter is implemented for that provider." };
  }

  const previousCursor = (integration.config?.cursor as string | undefined) ?? null;

  const [run] = await db
    .insert(syncRecords)
    .values({
      userId,
      integrationId: integration.id,
      startedAt: new Date(),
      status: "running",
      mode: previousCursor ? "incremental" : "full",
    })
    .returning();

  await db.update(integrations).set({ status: "syncing" }).where(eq(integrations.id, integration.id));

  try {
    const stored = await readCredentials(userId, integration.credentialRef);
    if (!stored) throw new Error("The stored credentials for this connection are missing. Reconnect it.");

    const credentials = await usableCredentials(userId, integration.credentialRef, stored);

    const result = await adapter.sync({
      userId,
      cursor: previousCursor,
      credentials,
      config: integration.config ?? {},
    });

    const { created, updated } = await writeEvents(userId, provider, result.records);
    const deleted = await removeEvents(userId, provider, result.deletedExternalIds ?? []);

    await db
      .update(syncRecords)
      .set({ status: "success", finishedAt: new Date(), created, updated, deleted, cursor: result.cursor })
      .where(eq(syncRecords.id, run.id));

    await db
      .update(integrations)
      .set({
        status: "connected",
        lastSyncAt: new Date(),
        lastError: null,
        config: { ...(integration.config ?? {}), cursor: result.cursor },
      })
      .where(eq(integrations.id, integration.id));

    const changed = created + updated + deleted;
    return {
      ok: true,
      created,
      updated,
      deleted,
      message:
        changed === 0
          ? "Already up to date."
          : `${created} added, ${updated} updated, ${deleted} removed.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sync failed.";

    await db
      .update(syncRecords)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(syncRecords.id, run.id));

    await db
      .update(integrations)
      .set({ status: "error", lastError: message })
      .where(eq(integrations.id, integration.id));

    return { ok: false, created: 0, updated: 0, deleted: 0, message };
  }
}

/** Every connected provider that has an adapter, for the scheduled run. */
export async function syncAllForUser(userId: string) {
  const connected = await db
    .select({ provider: integrations.provider })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.status, "connected")));

  const outcomes: { provider: string; outcome: SyncOutcome }[] = [];
  for (const row of connected) {
    if (!getAdapter(row.provider)) continue;
    outcomes.push({ provider: row.provider, outcome: await runSync(userId, row.provider) });
  }
  return outcomes;
}
