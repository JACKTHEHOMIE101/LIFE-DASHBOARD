import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/life-os.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
  casing: "snake_case",
});
