import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/**
 * One command to get from a fresh clone to a running Life OS:
 * creates .env with a real secret, applies migrations, generates icons, and
 * seeds a demo account. Safe to re-run.
 */

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}

let env = readFileSync(".env", "utf8");
if (/AUTH_SECRET=""/.test(env)) {
  env = env.replace('AUTH_SECRET=""', `AUTH_SECRET="${randomBytes(48).toString("base64url")}"`);
  writeFileSync(".env", env);
  console.log("Generated AUTH_SECRET");
}

run("npm run db:migrate");
run("node scripts/generate-icons.mjs");
run("npm run db:seed");

console.log(`
Setup complete.

  npm run dev     then open http://localhost:3000

Sign in with the seeded demo account:

  email:    demo@lifeos.local
  password: demo-life-os-2026

Optional:
  ANTHROPIC_API_KEY in .env       enables the AI Chief of Staff
  npm run generate:vapid          enables push notifications
`);
