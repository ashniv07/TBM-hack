-- Stage 6: explainable ATUM / TBM Taxonomy mapping

create table if not exists atum_taxonomy_items (
  id uuid primary key default gen_random_uuid(),
  taxonomy_version text not null,
  layer text not null, -- cost_pool | resource_tower | solution
  level_1 text not null,
  level_1_description text,
  level_2 text,
  level_2_description text,
  level_3 text,
  level_3_description text,
  examples text,
  path text not null,
  search_text text not null,
  is_retired boolean not null default false,
  embedding vector(1536),
  embedding_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (taxonomy_version, layer, path)
);

create index if not exists idx_atum_taxonomy_layer on atum_taxonomy_items(taxonomy_version, layer);
create index if not exists idx_atum_taxonomy_embedding on atum_taxonomy_items
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);

create table if not exists atum_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layer text not null,
  pattern text not null,
  category_id uuid not null references atum_taxonomy_items(id) on delete cascade,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (layer, pattern, category_id)
);

create table if not exists atum_mappings (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_id uuid not null references dataset_columns(id) on delete cascade,
  source_value text not null,
  taxonomy_version text not null,
  layer text not null,
  category_id uuid references atum_taxonomy_items(id) on delete set null,
  status text not null default 'suggested', -- suggested | approved | rejected | overridden | unresolved
  confidence numeric not null default 0,
  method text not null, -- rule | embedding | hybrid | llm | unresolved
  reasoning text,
  evidence jsonb,
  alternatives jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, column_id, source_value, taxonomy_version, layer)
);

create index if not exists idx_atum_mappings_status on atum_mappings(status);
create index if not exists idx_atum_mappings_dataset on atum_mappings(dataset_id);
create index if not exists idx_atum_mappings_category on atum_mappings(category_id);
