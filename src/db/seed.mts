import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./connection";
import { users } from "./schema";
import { provisionUserDefaults } from "../lib/onboarding";
import { clearDemoData, seedDemoData } from "../lib/demo/seed-demo";

/**
 * Creates (or reuses) a demo account and fills it with a realistic life.
 * Safe to run repeatedly: existing demo rows are cleared first.
 */
const email = process.env.SEED_EMAIL ?? "demo@lifeos.local";
const password = process.env.SEED_PASSWORD ?? "demo-life-os-2026";
const name = process.env.SEED_NAME ?? "Alex";

let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

if (!user) {
  const passwordHash = await bcrypt.hash(password, 12);
  [user] = await db.insert(users).values({ email, name, passwordHash }).returning();
  console.log(`Created account ${email}`);
} else {
  console.log(`Reusing account ${email}`);
}

await provisionUserDefaults(db, user.id);
await clearDemoData(db, user.id);
await seedDemoData(db, user.id);

console.log("\nDemo data seeded.\n");
console.log(`  email:    ${email}`);
console.log(`  password: ${password}\n`);
process.exit(0);
