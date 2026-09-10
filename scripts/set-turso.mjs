import { readFileSync, writeFileSync } from "node:fs";

/**
 * Writes the Turso connection details into .env so they never have to be
 * copied between windows by hand.
 *
 *   node scripts/set-turso.mjs "libsql://...turso.io" "eyJhbGci..."
 */

const [url, token] = process.argv.slice(2);

if (!url || !token) {
  console.error(`
Usage:
  node scripts/set-turso.mjs "<database-url>" "<auth-token>"

Get the two values with:
  turso db show life-os --url
  turso db tokens create life-os
`);
  process.exit(1);
}

if (!url.startsWith("libsql://") && !url.startsWith("https://")) {
  console.error(`That does not look like a Turso URL: ${url}`);
  console.error(`It should start with libsql://`);
  process.exit(1);
}

let env = readFileSync(".env", "utf8");

function setValue(key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  // Replace it if present (including commented-out), otherwise append.
  if (pattern.test(env)) env = env.replace(pattern, line);
  else if (new RegExp(`^# ${key}=`, "m").test(env)) {
    env = env.replace(new RegExp(`^# ${key}=.*$`, "m"), line);
  } else env += `\n${line}\n`;
}

// The local file stays the default for development; these are the hosted
// values, kept alongside so the transfer and env:vercel scripts can read them.
setValue("TARGET_DATABASE_URL", url);
setValue("TARGET_DATABASE_AUTH_TOKEN", token);

writeFileSync(".env", env);

console.log("Saved to .env:");
console.log(`  TARGET_DATABASE_URL         ${url}`);
console.log(`  TARGET_DATABASE_AUTH_TOKEN  ${token.slice(0, 8)}… (${token.length} chars)`);
console.log(`
Next:
  npm.cmd run db:migrate:hosted    create the tables on Turso
  npm.cmd run db:transfer          copy your data across
  npm.cmd run env:vercel           print what to paste into Vercel
`);
