-- Stage 4: Enterprise Context Model (Knowledge Graph)

-- Tags each embedding with how it was produced so Stage 4 can warn when
-- clustering relies on the non-semantic hash fallback (see embedText.ts).
-- Rows written before this column existed get 'unknown' rather than being
-- mislabeled as either real or fallback.
alter table entity_embeddings add column if not exists embedding_source text not null default 'unknown';

-- Graph nodes: either a canonical business entity (entity_type = one of the
-- 7 embeddable roles) or a source dataset itself (entity_type = 'dataset'),
-- so chains like "General Ledger -> Cost Center -> Business Unit" can be
-- represented as a single connected graph instead of two node kinds.
create table if not exists context_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  canonical_name text not null,
  source_dataset_id uuid references datasets(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_context_entities_type on context_entities(entity_type);

-- Exactly one dataset-node per dataset.
create unique index if not exists idx_context_entities_dataset_node
  on context_entities(source_dataset_id) where entity_type = 'dataset';

-- Every raw (column, value) observation that got merged into a canonical
-- entity, kept around so a canonical entity can show its aliases and so
-- rebuilds can resolve a cell value back to its entity.
create table if not exists context_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  context_entity_id uuid not null references context_entities(id) on delete cascade,
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_id uuid not null references dataset_columns(id) on delete cascade,
  entity_value text not null,
  unique (column_id, entity_value)
);

create index if not exists idx_context_entity_aliases_entity on context_entity_aliases(context_entity_id);

create table if not exists context_edges (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references context_entities(id) on delete cascade,
  to_entity_id uuid not null references context_entities(id) on delete cascade,
  edge_type text not null,              -- 'contains_reference' (dataset -> entity) | 'co_occurs_with' (entity <-> entity)
  weight int not null default 1,        -- number of rows/observations supporting this edge
  confidence numeric not null default 0.5,
  evidence_dataset_id uuid references datasets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, edge_type)
);

create index if not exists idx_context_edges_from on context_edges(from_entity_id);
create index if not exists idx_context_edges_to on context_edges(to_entity_id);
