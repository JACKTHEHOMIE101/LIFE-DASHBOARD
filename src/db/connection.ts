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
const url = process.env.DATABASE_URL ?? "file:./data/life-os.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

declare global {
  // eslint-disable-next-line no-var
  var __lifeOsClient: Client | undefined;
}

// Next.js reloads modules on every edit in dev; without this the process would
// accumulate one open database handle per reload.
export const client = globalThis.__lifeOsClient ?? createClient({ url, authToken });
if (process.env.NODE_ENV !== "production") globalThis.__lifeOsClient = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
export type Database = typeof db;
