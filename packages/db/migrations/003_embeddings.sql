-- Stage 3: Semantic Representation (entity embeddings)
-- Supabase Postgres ships pgvector, so we store embeddings alongside everything
-- else instead of standing up a separate vector store.

create extension if not exists vector;

create table if not exists entity_embeddings (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  column_id uuid not null references dataset_columns(id) on delete cascade,
  entity_value text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (column_id, entity_value)
);

create index if not exists idx_entity_embeddings_dataset on entity_embeddings(dataset_id);

-- ivfflat requires an approximate row count to size lists sensibly; fine to create
-- with a small `lists` value for hackathon-scale data and rebuild later if needed.
create index if not exists idx_entity_embeddings_vector on entity_embeddings
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);
