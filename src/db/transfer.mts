import { createClient, type Client, type InValue } from "@libsql/client";

/**
 * Copies every row from one Life OS database to another, ids intact.
 *
 * Used to move a local SQLite file onto hosted libSQL/Turso when the app goes
 * from "running on my laptop" to "running somewhere my phone can reach".
 *
 *   TARGET_DATABASE_URL="libsql://..." \
 *   TARGET_DATABASE_AUTH_TOKEN="..." \
 *   npm run db:transfer
 *
 * The target must already have the schema — run `db:migrate` against it first.
 * Ids are preserved, so every relationship survives the move.
 */

const sourceUrl = process.env.DATABASE_URL ?? "file:./data/life-os.db";
const targetUrl = process.env.TARGET_DATABASE_URL;
const targetToken = process.env.TARGET_DATABASE_AUTH_TOKEN;

if (!targetUrl) {
  console.error("Set TARGET_DATABASE_URL (and TARGET_DATABASE_AUTH_TOKEN for Turso).");
  process.exit(1);
}
if (targetUrl === sourceUrl) {
  console.error("Source and target are the same database.");
  process.exit(1);
}

/**
 * Parents before children. Foreign keys are declared across most of these, and
 * SQLite will reject a child row whose parent has not landed yet.
 */
const TABLES = [
  "users",
  "user_settings",
  "devices",
  "life_areas",
  "goals",
  "projects",
  "project_goals",
  "milestones",
  "tasks",
  "events",
  "people",
  "interactions",
  "habits",
  "habit_entries",
  "journal_entries",
  "notes",
  "metrics",
  "workouts",
  "exercises",
  "exercise_sets",
  "financial_accounts",
  "transactions",
  "reviews",
  "integrations",
  "sync_records",
  "notifications",
  "notification_preferences",
  "ai_conversations",
  "ai_messages",
  "focus_sessions",
  "signal_dismissals",
  "time_budgets",
  "audit_log",
] as const;

const source = createClient({ url: sourceUrl });
const target = createClient({ url: targetUrl, authToken: targetToken });

async function tableExists(client: Client, name: string) {
  const { rows } = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return rows.length > 0;
}

/* ------------------------------------------------------------- safety check */

if (!(await tableExists(target, "users"))) {
  console.error(
    "The target has no schema. Run this first:\n" +
      `  DATABASE_URL="${targetUrl}" DATABASE_AUTH_TOKEN="<token>" npm run db:migrate`,
  );
  process.exit(1);
}

const existing = await target.execute("SELECT COUNT(*) AS n FROM users");
const targetUsers = Number(existing.rows[0].n);

if (targetUsers > 0 && process.env.TRANSFER_OVERWRITE !== "1") {
  console.error(
    `The target already holds ${targetUsers} user(s). Refusing to write over it.\n` +
      "Re-run with TRANSFER_OVERWRITE=1 to clear the target first.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ transfer */

if (targetUsers > 0) {
  console.log("Clearing the target...");
  // Children first when deleting, which is the reverse of insertion order.
  for (const table of [...TABLES].reverse()) {
    if (await tableExists(target, table)) await target.execute(`DELETE FROM "${table}"`);
  }
}

let total = 0;

for (const table of TABLES) {
  if (!(await tableExists(source, table))) {
    console.log(`${table.padEnd(26)} (not in source, skipped)`);
    continue;
  }

  const { rows, columns } = await source.execute(`SELECT * FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`${table.padEnd(26)} 0`);
    continue;
  }

  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`;

  // Batched so a large table is a handful of round trips rather than hundreds.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await target.batch(
      slice.map((row) => ({
        sql,
        args: columns.map((c) => (row as Record<string, InValue>)[c] ?? null),
      })),
      "write",
    );
  }

  total += rows.length;
  console.log(`${table.padEnd(26)} ${rows.length}`);
}

/* -------------------------------------------------------------- verification */

console.log("\nVerifying...");
let mismatches = 0;

for (const table of TABLES) {
  if (!(await tableExists(source, table))) continue;
  const [a, b] = await Promise.all([
    source.execute(`SELECT COUNT(*) AS n FROM "${table}"`),
    target.execute(`SELECT COUNT(*) AS n FROM "${table}"`),
  ]);
  const from = Number(a.rows[0].n);
  const to = Number(b.rows[0].n);
  if (from !== to) {
    console.error(`  ${table}: source ${from}, target ${to}`);
    mismatches++;
  }
}

source.close();
target.close();

if (mismatches > 0) {
  console.error(`\n${mismatches} table(s) did not match. Nothing was removed from the source.`);
  process.exit(1);
}

console.log(`\n${total} rows transferred, every table matching.`);
console.log("Your local database is untouched — it is still there if anything looks wrong.");
process.exit(0);
