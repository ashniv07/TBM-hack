import { config } from "dotenv";
import { join } from "path";

config({ path: join(__dirname, "..", "..", "..", ".env") });

import { getPool } from "./pool";

// Destructive: drops every table in the public schema, including
// schema_migrations, so the next `db:migrate` replays all migrations from
// scratch. Extensions (pgcrypto, vector) are schema-level objects and are
// deliberately left alone — re-creating them needs privileges a pooled app
// role may not have.
async function reset() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to drop tables without --yes. Use `npm run db:reset`.");
    process.exit(1);
  }

  const pool = getPool();
  const { rows: before } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  );
  if (before.length === 0) {
    console.log("No tables to drop.");
    await pool.end();
    return;
  }

  console.log(`Dropping ${before.length} tables: ${before.map((r) => r.tablename).join(", ")}`);
  await pool.query(`do $$ declare r record; begin
    for r in (select tablename from pg_tables where schemaname = 'public') loop
      execute format('drop table if exists public.%I cascade', r.tablename);
    end loop;
  end $$;`);

  const { rows: after } = await pool.query<{ count: string }>(
    `select count(*) from pg_tables where schemaname = 'public'`
  );
  console.log(`Done. ${after[0].count} tables remain. Run \`npm run db:migrate\` next.`);
  await pool.end();
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
