import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

config({ path: join(__dirname, "..", "..", "..", ".env") });

import { getPool } from "./pool";

async function migrate() {
  const pool = getPool();
  const dir = join(__dirname, "..", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`);
  const applied = new Set((await pool.query("select name from schema_migrations")).rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf-8");
    console.log(`Applying migration ${file}...`);

    // A dedicated client, not pool.query(). Supabase's transaction-mode pooler
    // (port 6543) hands each pool.query() a potentially DIFFERENT server
    // connection, so "begin" / DDL / "commit" issued separately can land on
    // three different backends: the BEGIN checks out one connection, the DDL
    // runs somewhere else, and the COMMIT commits nothing. Observed live —
    // migration 014 reported "Applying... Migrations complete" while none of
    // its DDL reached the database and no error was raised.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
