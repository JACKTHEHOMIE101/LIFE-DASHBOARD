import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./connection";

const url = process.env.DATABASE_URL ?? "file:./data/life-os.db";
if (url.startsWith("file:")) {
  // The libSQL client will not create intermediate directories for us.
  mkdirSync(dirname(url.slice("file:".length)) || ".", { recursive: true });
}

await migrate(db, { migrationsFolder: "./drizzle" });
console.log(`Migrations applied to ${url}`);
process.exit(0);
