import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Local development runs against a SQLite file. Pointing DATABASE_URL at a
 * libSQL/Turso URL moves the same schema to a hosted database with no code
 * changes, which is the path for cross-device sync beyond a single machine.
 *
 * This module deliberately has no `server-only` guard so that CLI scripts
 * (migrate, seed, reset) can reuse it. Application code imports `@/db` instead.
 */

// An empty string is what a mis-pasted hosting variable looks like, and `??`
// would happily pass it through to a connection error 20 frames deep. Treat
// blank as absent.
const value = (key: string) => {
  const raw = process.env[key]?.trim();
  return raw ? raw : undefined;
};

// Vercel's Turso integration provisions the database under its own names. Read
// those as a fallback so a correct integration setup works without also having
// to duplicate the values by hand.
const url =
  value("DATABASE_URL") ?? value("STORAGE_TURSO_DATABASE_URL") ?? "file:./data/life-os.db";
const authToken = value("DATABASE_AUTH_TOKEN") ?? value("STORAGE_TURSO_AUTH_TOKEN");

if (url.startsWith("libsql://") && !authToken) {
  throw new Error(
    "DATABASE_URL points at a hosted libSQL database but DATABASE_AUTH_TOKEN is empty. " +
      "Set both, or neither to fall back to the local file.",
  );
}

declare global {
  var __lifeOsClient: Client | undefined;
}

// Next.js reloads modules on every edit in dev; without this the process would
// accumulate one open database handle per reload.
export const client = globalThis.__lifeOsClient ?? createClient({ url, authToken });
if (process.env.NODE_ENV !== "production") globalThis.__lifeOsClient = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
export type Database = typeof db;
