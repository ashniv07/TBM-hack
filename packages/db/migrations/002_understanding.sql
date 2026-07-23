-- Layer 2: Intelligent Data Understanding

alter table dataset_columns add column if not exists is_technical boolean not null default false;
alter table dataset_columns add column if not exists business_purpose text; -- filled once per dataset (Stage 2)
alter table datasets add column if not exists business_purpose text;

create table if not exists dataset_relationships (
  id uuid primary key default gen_random_uuid(),
  from_column_id uuid not null references dataset_columns(id) on delete cascade,
  to_column_id uuid not null references dataset_columns(id) on delete cascade,
  relationship_type text not null default 'candidate_key_match', -- candidate_key_match|foreign_key|semantic_match
  confidence numeric not null,
  reasoning text,
  created_at timestamptz not null default now(),
  unique (from_column_id, to_column_id)
);

create index if not exists idx_dataset_relationships_from on dataset_relationships(from_column_id);
create index if not exists idx_dataset_relationships_to on dataset_relationships(to_column_id);
