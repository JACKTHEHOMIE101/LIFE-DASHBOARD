import "server-only";

/**
 * The redirect URI given to the provider.
 *
 * It must be byte-identical between the authorise request and the token
 * exchange, and must match what is registered at the provider, or the exchange
 * fails with an error that names none of that. Deriving it from one place is
 * what stops the two drifting apart.
 *
 * APP_URL wins when set, because a request's own origin on a hosting platform
 * can be a deployment-specific hostname that was never registered.
 */
export function redirectUriFor(request: Request, provider: string) {
  const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return `${base}/api/integrations/${provider}/callback`;
}
