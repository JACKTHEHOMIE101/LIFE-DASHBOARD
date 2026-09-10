import "server-only";

import { jwtVerify, SignJWT } from "jose";

/**
 * The `state` parameter carried through an OAuth redirect.
 *
 * Signed rather than random-and-stored so the callback needs no server-side
 * session for it. It has a job beyond identifying the request: without a value
 * the callback can verify, anyone could send a logged-in user to the callback
 * URL with their own authorisation code and attach their Google account to that
 * user's Life OS.
 *
 * Short-lived on purpose. A consent screen takes a minute; a state token that
 * stayed valid for hours would be a replay window for no benefit.
 */

const TTL = "10m";
const AUDIENCE = "life-os/oauth-state";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set, so OAuth state cannot be signed.");
  return new TextEncoder().encode(value);
}

export async function signOAuthState(userId: string, provider: string) {
  return new SignJWT({ provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret());
}

export async function verifyOAuthState(token: string, provider: string) {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    // A state signed for one provider must not authorise another.
    if (payload.provider !== provider || !payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
