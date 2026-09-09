import { client } from "./connection";

/** Drops every table so `npm run db:migrate` can rebuild from scratch. */
const { rows } = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
);

for (const row of rows) {
  await client.execute(`DROP TABLE IF EXISTS "${String(row.name)}"`);
}

console.log(`Dropped ${rows.length} tables. Run \`npm run db:migrate\` next.`);
process.exit(0);
