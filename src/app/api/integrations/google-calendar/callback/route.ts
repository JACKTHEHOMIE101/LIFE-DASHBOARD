import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { audit } from "@/lib/actions/activity";
import { getAdapter } from "@/lib/integrations/adapters";
import { storeCredentials } from "@/lib/integrations/credentials";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { redirectUriFor } from "@/lib/integrations/redirect-uri";
import { PROVIDERS } from "@/lib/integrations/registry";

const PROVIDER = "google_calendar";

/**
 * Where Google sends the user back.
 *
 * Deliberately does not call `requireUser`: the owner comes from the signed
 * state, not the session. That way an authorisation code can only ever be
 * attached to the account that started the flow, even if the callback is opened
 * in a different browser or by someone else's link.
 *
 * Every failure ends at the integrations page with a readable reason in the
 * URL. A blank screen after a consent redirect is the least debuggable thing a
 * user can be shown.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string) => `/integrations?error=${encodeURIComponent(message)}`;

  const denied = url.searchParams.get("error");
  if (denied) {
    redirect(back(denied === "access_denied" ? "You declined the Google permission." : denied));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) redirect(back("Google's response was missing the code or state."));

  const verified = await verifyOAuthState(state, PROVIDER);
  if (!verified) {
    redirect(back("That connection link was not valid or had expired. Start again."));
  }

  const definition = PROVIDERS.find((p) => p.id === PROVIDER)!;
  const adapter = getAdapter(PROVIDER)!;

  try {
    const credentials = await adapter.completeConnect!(verified.userId, {
      code,
      redirectUri: redirectUriFor(request, "google-calendar"),
    });

    // The integration row has to exist before credentials can point at it.
    const [integration] = await db
      .insert(integrations)
      .values({
        userId: verified.userId,
        provider: PROVIDER,
        displayName: definition.name,
        status: "connected",
        scopes: definition.scopes,
        connectedAt: new Date(),
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: {
          status: "connected",
          scopes: definition.scopes,
          connectedAt: new Date(),
          lastError: null,
          // A reconnection starts clean: an old cursor belongs to credentials
          // that no longer exist, and reusing it would skip everything.
          config: {},
        },
      })
      .returning();

    const credentialRef = await storeCredentials(verified.userId, integration.id, credentials);

    await db
      .update(integrations)
      .set({ credentialRef })
      .where(and(eq(integrations.id, integration.id), eq(integrations.userId, verified.userId)));

    await audit(verified.userId, "integration.connected", {
      actor: "user",
      entityType: "integration",
      entityId: integration.id,
      meta: { provider: PROVIDER },
    });
  } catch (error) {
    redirect(back(error instanceof Error ? error.message : "Could not complete the connection."));
  }

  redirect("/integrations?connected=google_calendar");
}

export const dynamic = "force-dynamic";
