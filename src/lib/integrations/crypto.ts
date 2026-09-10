import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for provider tokens at rest.
 *
 * Deliberately not `server-only`: this is pure and has no database import, so
 * it can be unit tested directly. Nothing here reaches a client because nothing
 * client-side imports it.
 *
 * AES-256-GCM rather than CBC because the tag authenticates the ciphertext:
 * a token tampered with in the database fails to decrypt instead of quietly
 * decoding to something else.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for.

/**
 * A separate key derived from AUTH_SECRET rather than AUTH_SECRET itself.
 *
 * Reusing one secret for two purposes means a weakness in either use — or a
 * rotation for either reason — silently affects the other. The info string is
 * what separates them.
 */
function key(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "life-os-credentials", "integration-tokens", 32));
}

function requireSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set, so provider tokens cannot be stored safely.");
  }
  return secret;
}

/** Returns `iv:tag:ciphertext`, all base64. */
export function encryptJson(value: Record<string, string>, secret = requireSecret()) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString("base64")).join(":");
}

export function decryptJson(payload: string, secret = requireSecret()): Record<string, string> {
  const [ivPart, tagPart, dataPart] = payload.split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Stored credentials are malformed.");
  }

  const decipher = createDecipheriv(ALGORITHM, key(secret), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  // Throws if the ciphertext or tag was altered, or the key is wrong — which
  // is the point: a failure here must be loud, not a silently empty token.
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
