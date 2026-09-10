import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAdapter, adapterReady } from "@/lib/integrations/adapters";
import { signOAuthState } from "@/lib/integrations/oauth-state";
import { redirectUriFor } from "@/lib/integrations/redirect-uri";

const PROVIDER = "google_calendar";

/**
 * Starts the Google consent flow.
 *
 * A GET that redirects rather than a server action, because the browser has to
 * end up at Google's own page: consent has to happen somewhere the user can see
 * the address bar and check who is asking.
 */
export async function GET(request: Request) {
  const user = await requireUser();

  if (!adapterReady(PROVIDER)) {
    return Response.json(
      { error: "Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 503 },
    );
  }

  const adapter = getAdapter(PROVIDER)!;
  const redirectUri = redirectUriFor(request, "google-calendar");
  const url = await adapter.beginConnect!(user.id, redirectUri);
  if (!url) return Response.json({ error: "Could not start the connection." }, { status: 500 });

  const state = await signOAuthState(user.id, PROVIDER);
  redirect(`${url}&state=${encodeURIComponent(state)}`);
}

export const dynamic = "force-dynamic";
