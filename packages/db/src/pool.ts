import { Pool, types } from "pg";

// node-postgres returns `numeric` columns as STRINGS, to preserve the arbitrary
// precision Postgres allows. That is a sensible default for money, and a trap
// for everything in this schema: `sum + row.overall_score` silently becomes
// string concatenation, so an average of nineteen real scores evaluated to NaN
// and rendered as "0% avg readiness" while individual rows showed 57%
// (`*` coerces, `+` concatenates).
//
// Every numeric column here is a score, confidence, weight, or percentage —
// overall/completeness/validity/consistency/uniqueness_score, confidence,
// frequency_score, resolution_confidence, null_pct, source_type_confidence.
// None needs more than float64, and there is no currency column in the
// database (cost amounts are read from the source workbooks). So parse them as
// numbers once, here, instead of relying on every call site to remember.
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value));

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/tbm_trust";
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}
