import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./connection";
import { users } from "./schema";

/**
 * Sets the owner's email and/or password directly against the database.
 *
 * This is the recovery path when you are locked out, since the app has no
 * self-serve password reset by design (single-user, no mail server).
 *
 * Credentials are read from the environment rather than argv so they do not
 * end up in shell history:
 *
 *   LIFEOS_EMAIL=you@example.com LIFEOS_PASSWORD=... npm run db:set-credentials
 *
 * The password is hashed with bcrypt at the same cost the signup path uses and
 * is never stored, logged or echoed in plain text.
 */

const email = process.env.LIFEOS_EMAIL?.trim().toLowerCase();
const password = process.env.LIFEOS_PASSWORD;

if (!email && !password) {
  console.error("Set LIFEOS_EMAIL and/or LIFEOS_PASSWORD. Nothing to do.");
  process.exit(1);
}
if (password && password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const [owner] = await db.select().from(users).limit(1);
if (!owner) {
  console.error("No account exists yet. Run `npm run db:seed`, or sign up in the app.");
  process.exit(1);
}

const changes: Partial<typeof users.$inferInsert> = {};
if (email) changes.email = email;
if (password) changes.passwordHash = await bcrypt.hash(password, 12);

await db.update(users).set(changes).where(eq(users.id, owner.id));

console.log("Updated the owner account.");
console.log(`  email:    ${email ?? owner.email}`);
console.log(`  password: ${password ? "changed" : "unchanged"}`);
console.log("\nAny existing session cookie stays valid; sign out to test the new details.");

process.exit(0);
