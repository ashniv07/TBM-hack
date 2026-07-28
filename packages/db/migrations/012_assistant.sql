-- Stage 8: AI Assistant

-- Chat sessions
create table if not exists assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chat messages
create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references assistant_sessions(id) on delete cascade,
  role text not null, -- 'user' | 'assistant' | 'system'
  content text not null,
  metadata jsonb, -- sources, tool calls, etc.
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_messages_session on assistant_messages(session_id, created_at);

-- Common queries cache for faster RAG retrieval
create table if not exists assistant_query_cache (
  id uuid primary key default gen_random_uuid(),
  query_text text not null,
  query_embedding vector(1536),
  response_summary text,
  sources jsonb,
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assistant_query_cache_embedding on assistant_query_cache
  using ivfflat (query_embedding vector_cosine_ops) with (lists = 10);
