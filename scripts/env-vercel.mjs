import { readFileSync } from "node:fs";

/**
 * Prints the production environment exactly as Vercel wants it.
 *
 * Vercel's "Environment Variables" screen accepts a pasted .env block, so this
 * turns seven separate form fills into one paste. The hosted database values
 * are renamed from their TARGET_ prefixes, because on Vercel they are simply
 * the database.
 */

const env = readFileSync(".env", "utf8");

const read = (key) => {
  const match = env.match(new RegExp(`^${key}="?([^"\n]*)"?$`, "m"));
  return match?.[1]?.trim() ?? "";
};

const targetUrl = read("TARGET_DATABASE_URL");
const targetToken = read("TARGET_DATABASE_AUTH_TOKEN");

if (!targetUrl || !targetToken) {
  console.error(`
No hosted database configured yet.

Run this first, with the values from Turso:
  node scripts/set-turso.mjs "<database-url>" "<auth-token>"
`);
  process.exit(1);
}

const output = [
  `DATABASE_URL="${targetUrl}"`,
  `DATABASE_AUTH_TOKEN="${targetToken}"`,
  `AUTH_SECRET="${read("AUTH_SECRET")}"`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY="${read("NEXT_PUBLIC_VAPID_PUBLIC_KEY")}"`,
  `VAPID_PRIVATE_KEY="${read("VAPID_PRIVATE_KEY")}"`,
  `VAPID_SUBJECT="${read("VAPID_SUBJECT")}"`,
  `CRON_SECRET="${read("CRON_SECRET")}"`,
];

// An empty API key is worse than an absent one: the app checks for presence.
const apiKey = read("ANTHROPIC_API_KEY");
if (apiKey) {
  output.push(`ANTHROPIC_API_KEY="${apiKey}"`);
  output.push(`ANTHROPIC_MODEL="${read("ANTHROPIC_MODEL") || "claude-opus-5"}"`);
}

const missing = output.filter((line) => line.includes('=""'));

console.log("\nPaste everything between the lines into Vercel:\n");
console.log("------------------------------------------------------------");
console.log(output.join("\n"));
console.log("------------------------------------------------------------\n");

if (missing.length) {
  console.error("These came out empty, which will break the deploy:");
  for (const line of missing) console.error(`  ${line.split("=")[0]}`);
  process.exit(1);
}

console.log(`${output.length} variables. In Vercel: Settings > Environment Variables,`);
console.log(`paste into the key field — it will split them out automatically.\n`);
