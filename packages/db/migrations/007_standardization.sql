-- Stage 5: Data Trust & Standardization Engine

-- Canonical schemas derived per source type from analyzing all datasets
-- This represents the "ideal" schema for each source type based on frequency analysis
create table if not exists canonical_schemas (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  semantic_role text not null,
  column_name text not null,
  inferred_type text not null,
  is_required boolean not null default false,
  frequency_score numeric not null default 0,  -- % of datasets of this source_type having this column
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, semantic_role)
);

create index if not exists idx_canonical_schemas_source_type on canonical_schemas(source_type);

-- Quality issues detected across datasets
-- Each issue is linked to a specific dataset and optionally a column
create table if not exists quality_issues (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_id uuid references dataset_columns(id) on delete cascade,
  issue_type text not null,  -- missing_value, duplicate, invalid_reference, invalid_currency, invalid_date, outlier, schema_mismatch
  severity text not null default 'warning',  -- info, warning, error, critical
  status text not null default 'open',  -- open, acknowledged, resolved, ignored
  title text not null,
  description text not null,
  affected_rows int,
  sample_values jsonb,  -- Example problematic values
  suggested_fix text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quality_issues_dataset on quality_issues(dataset_id);
create index if not exists idx_quality_issues_status on quality_issues(status);
create index if not exists idx_quality_issues_severity on quality_issues(severity);

-- AI-proposed corrections with approval workflow
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references quality_issues(id) on delete cascade,
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_id uuid references dataset_columns(id) on delete cascade,
  correction_type text not null,  -- normalize_date, normalize_currency, fuzzy_match_entity, trim_whitespace, fill_missing, remove_duplicate
  status text not null default 'pending',  -- pending, approved, rejected, applied
  original_value text,
  corrected_value text,
  affected_rows int,
  confidence numeric not null default 0,
  reasoning text,
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_corrections_issue on corrections(issue_id);
create index if not exists idx_corrections_dataset on corrections(dataset_id);
create index if not exists idx_corrections_status on corrections(status);

-- TBM readiness scores per dataset
-- Composite score from four dimensions
create table if not exists readiness_scores (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade unique,
  overall_score numeric not null,
  completeness_score numeric not null,  -- Required columns present vs canonical schema
  validity_score numeric not null,  -- % values passing validation
  consistency_score numeric not null,  -- Cross-dataset reference integrity
  uniqueness_score numeric not null,  -- Duplicate ratio
  issue_count int not null default 0,
  critical_issue_count int not null default 0,
  recommendations jsonb,  -- Prioritized list of recommendations
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_readiness_scores_dataset on readiness_scores(dataset_id);
create index if not exists idx_readiness_scores_overall on readiness_scores(overall_score);
