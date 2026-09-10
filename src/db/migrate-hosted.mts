import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/**
 * Applies migrations to the hosted database rather than the local file.
 *
 * Reads TARGET_DATABASE_URL so the same .env can hold both, and so nobody has
 * to remember to prefix a command with the right environment variable.
 */
const url = process.env.TARGET_DATABASE_URL;
const authToken = process.env.TARGET_DATABASE_AUTH_TOKEN;

if (!url) {
  console.error("TARGET_DATABASE_URL is not set. Run scripts/set-turso.mjs first.");
  process.exit(1);
}

const db = drizzle(createClient({ url, authToken }));
await migrate(db, { migrationsFolder: "./drizzle" });

console.log(`Tables created on ${url}`);
process.exit(0);
