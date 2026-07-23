-- Layer 1: Ingestion & profiling schema

create extension if not exists "pgcrypto";

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_type text,                          -- inferred in Stage 2: GL, ERP, AWS Billing, CMDB, ...
  source_type_confidence numeric,
  status text not null default 'uploaded',   -- uploaded|profiling|profiled|understanding|understood|error
  storage_path text not null,
  sheet_name text,
  row_count int,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dataset_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_name text not null,
  ordinal int not null,
  inferred_type text,                        -- string|number|date|currency|boolean|id
  null_pct numeric,
  distinct_count int,
  sample_values jsonb,
  is_candidate_key boolean not null default false,
  semantic_role text,                        -- filled in Stage 2, e.g. "vendor_name"
  semantic_role_confidence numeric,
  unique (dataset_id, column_name)
);

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid references datasets(id) on delete cascade,
  stage text not null,                       -- ingestion|understanding|embedding|...
  status text not null default 'running',    -- running|succeeded|failed
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_dataset_columns_dataset_id on dataset_columns(dataset_id);
create index if not exists idx_ingestion_runs_dataset_id on ingestion_runs(dataset_id);
