"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, integrations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/integrations/adapters";
import { forgetCredentials, readCredentials } from "@/lib/integrations/credentials";
import { runSync } from "@/lib/integrations/sync";
import { audit } from "./activity";

/** Pulls now, rather than waiting for the scheduled run. */
export async function syncProvider(provider: string) {
  const user = await requireUser();
  const outcome = await runSync(user.id, provider);
  revalidatePath("/integrations");
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: outcome.ok, message: outcome.message };
}

/**
 * Disconnects a provider.
 *
 * Imported events are soft-deleted rather than left behind. Keeping them would
 * mean a calendar that silently stops updating while still looking current,
 * which is the kind of quietly-wrong state this app is supposed to avoid. Soft,
 * so reconnecting restores them rather than re-importing from scratch.
 */
export async function disconnectProvider(provider: string) {
  const user = await requireUser();

  const [integration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, provider)))
    .limit(1);

  if (!integration) return { ok: false, message: "That provider is not connected." };

  // Revoke at the provider before forgetting the token, or there is nothing
  // left to revoke with and the grant lives on in their Google account.
  const adapter = getAdapter(provider);
  if (adapter?.revoke && integration.credentialRef) {
    const credentials = await readCredentials(user.id, integration.credentialRef);
    if (credentials) await adapter.revoke(credentials);
  }

  await forgetCredentials(user.id, integration.id);

  await db
    .update(integrations)
    .set({ status: "disconnected", credentialRef: null, config: {}, lastError: null })
    .where(eq(integrations.id, integration.id));

  const imported = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(and(eq(events.userId, user.id), eq(events.provider, provider)))
    .returning({ id: events.id });

  await audit(user.id, "integration.disconnected", {
    entityType: "integration",
    entityId: integration.id,
    meta: { provider, eventsRemoved: imported.length },
  });

  revalidatePath("/integrations");
  revalidatePath("/calendar");
  revalidatePath("/");

  return {
    ok: true,
    message:
      imported.length > 0
        ? `Disconnected. ${imported.length} imported event${imported.length === 1 ? "" : "s"} removed from your calendar.`
        : "Disconnected.",
  };
}
