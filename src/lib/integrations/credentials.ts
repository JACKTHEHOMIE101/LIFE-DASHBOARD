import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationCredentials, integrations } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";

/**
 * The only module that reads or writes provider tokens.
 *
 * Everything above this layer works with an opaque `credentialRef`. Adapters
 * receive a plain object at call time and never see where it came from, which
 * is what lets the storage change — to a real secret manager, say — without
 * touching a single adapter.
 */

/** Stores credentials for an integration and returns the reference to keep. */
export async function storeCredentials(
  userId: string,
  integrationId: string,
  values: Record<string, string>,
) {
  const ciphertext = encryptJson(values);

  const [row] = await db
    .insert(integrationCredentials)
    .values({ userId, integrationId, ciphertext })
    .onConflictDoUpdate({
      target: integrationCredentials.integrationId,
      set: { ciphertext, updatedAt: new Date() },
    })
    .returning();

  return row.id;
}

/**
 * Reads credentials by reference, scoped to the owner.
 *
 * The user id is required rather than optional: a reference on its own must
 * never be enough to read a secret, or an id leaking anywhere becomes a way to
 * read someone's tokens.
 */
export async function readCredentials(userId: string, credentialRef: string) {
  const [row] = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(eq(integrationCredentials.id, credentialRef), eq(integrationCredentials.userId, userId)),
    )
    .limit(1);

  if (!row) return null;
  return decryptJson(row.ciphertext);
}

/** Replaces stored credentials in place, keeping the same reference. */
export async function updateCredentials(
  userId: string,
  credentialRef: string,
  values: Record<string, string>,
) {
  await db
    .update(integrationCredentials)
    .set({ ciphertext: encryptJson(values), updatedAt: new Date() })
    .where(
      and(eq(integrationCredentials.id, credentialRef), eq(integrationCredentials.userId, userId)),
    );
}

/**
 * Removes credentials and clears the pointer.
 *
 * Both, in that order: a pointer left behind after the secret is gone reads as
 * "still connected" everywhere in the UI.
 */
export async function forgetCredentials(userId: string, integrationId: string) {
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.integrationId, integrationId),
        eq(integrationCredentials.userId, userId),
      ),
    );

  await db
    .update(integrations)
    .set({ credentialRef: null })
    .where(and(eq(integrations.id, integrationId), eq(integrations.userId, userId)));
}
