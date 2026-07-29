-- Source-to-template column mapping.
--
-- The Apptio master workbooks are the target schema, not input: a customer
-- supplies raw source data and the platform maps it onto the template. This
-- records which master type a source file targets and, per column, what it was
-- mapped to — including the columns that mapped to nothing, since "we expect N
-- columns and you supplied M" is the metric the client asked for.

alter table datasets add column if not exists master_type text;
alter table datasets add column if not exists template_coverage numeric;
alter table datasets add column if not exists template_expected_count int;
alter table datasets add column if not exists template_matched_count int;

create table if not exists column_mappings (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  source_column text not null,
  -- null means the source supplied a column the template has no place for.
  template_column text,
  confidence numeric not null default 0,
  -- exact | normalized | contains | token | embedding | manual
  method text not null default 'unmatched',
  -- set when a reviewer re-pointed the mapping; never overwritten by a re-run.
  is_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, source_column)
);

create index if not exists idx_column_mappings_dataset on column_mappings(dataset_id);

-- Template columns a dataset does NOT supply. Stored rather than derived so the
-- gap report survives a template being regenerated with different columns.
create table if not exists missing_template_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  template_column text not null,
  unique (dataset_id, template_column)
);

create index if not exists idx_missing_template_columns_dataset on missing_template_columns(dataset_id);
