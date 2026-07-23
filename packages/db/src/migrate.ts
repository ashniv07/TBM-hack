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
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query("insert into schema_migrations (name) values ($1)", [file]);
      await pool.query("commit");
    } catch (err) {
      await pool.query("rollback");
      throw err;
    }
  }
  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
