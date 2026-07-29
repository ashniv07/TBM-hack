-- Stage 7: TBM Data Model Export

-- Track export jobs and their results
create table if not exists tbm_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null, -- 'full' | 'cost_centers' | 'applications' | 'vendors' | 'cloud_resources' | 'allocations'
  status text not null default 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  format text not null default 'json', -- 'json' | 'csv' | 'xlsx'

  -- Export configuration
  include_unmapped boolean not null default false,
  include_low_confidence boolean not null default false,
  confidence_threshold numeric not null default 0.7,

  -- Results
  file_path text,
  record_count int,
  error_message text,

  -- Metadata
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_tbm_exports_status on tbm_exports(status);
create index if not exists idx_tbm_exports_created on tbm_exports(created_at desc);

-- TBM Cost Center dimension (derived from knowledge graph)
create table if not exists tbm_cost_centers (
  id uuid primary key default gen_random_uuid(),
  export_id uuid references tbm_exports(id) on delete cascade,

  -- Core fields for Apptio
  cost_center_code text not null,
  cost_center_name text not null,
  parent_cost_center_code text,
  business_unit_code text,
  business_unit_name text,
  department_code text,
  department_name text,

  -- Provenance
  source_entity_id uuid references context_entities(id),
  confidence numeric not null default 1.0,

  created_at timestamptz not null default now()
);

-- TBM Application dimension
create table if not exists tbm_applications (
  id uuid primary key default gen_random_uuid(),
  export_id uuid references tbm_exports(id) on delete cascade,

  -- Core fields for Apptio
  application_id text not null,
  application_name text not null,
  vendor_name text,
  business_unit_code text,
  cost_center_code text,

  -- ATUM classification
  atum_tower text,
  atum_sub_tower text,
  atum_service_domain text,
  atum_confidence numeric,

  -- Provenance
  source_entity_id uuid references context_entities(id),
  atum_mapping_id uuid references atum_mappings(id),
  confidence numeric not null default 1.0,

  created_at timestamptz not null default now()
);

-- TBM Vendor dimension
create table if not exists tbm_vendors (
  id uuid primary key default gen_random_uuid(),
  export_id uuid references tbm_exports(id) on delete cascade,

  -- Core fields for Apptio
  vendor_id text not null,
  vendor_name text not null,
  vendor_type text, -- 'hardware' | 'software' | 'services' | 'cloud' | 'telecom' | 'other'

  -- ATUM classification (for vendor cost pools)
  atum_cost_pool text,
  atum_confidence numeric,

  -- Provenance
  source_entity_id uuid references context_entities(id),
  confidence numeric not null default 1.0,

  created_at timestamptz not null default now()
);

-- TBM Cloud Resource dimension
create table if not exists tbm_cloud_resources (
  id uuid primary key default gen_random_uuid(),
  export_id uuid references tbm_exports(id) on delete cascade,

  -- Core fields for Apptio
  resource_id text not null,
  resource_name text not null,
  resource_type text,
  cloud_provider text,
  region text,
  account_id text,

  -- ATUM classification
  atum_tower text,
  atum_sub_tower text,
  atum_confidence numeric,

  -- Linked application
  application_id text,

  -- Provenance
  source_entity_id uuid references context_entities(id),
  atum_mapping_id uuid references atum_mappings(id),
  confidence numeric not null default 1.0,

  created_at timestamptz not null default now()
);

-- TBM Cost Allocation facts
create table if not exists tbm_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  export_id uuid references tbm_exports(id) on delete cascade,

  -- Allocation dimensions
  cost_center_code text not null,
  application_id text,
  vendor_id text,
  cloud_resource_id text,

  -- ATUM tower allocation
  atum_tower text,
  atum_sub_tower text,

  -- Amount
  amount numeric not null,
  currency text not null default 'USD',
  period_start date,
  period_end date,

  -- Source
  source_dataset_id uuid references datasets(id),
  source_row_index int,

  created_at timestamptz not null default now()
);

create index if not exists idx_tbm_cost_allocations_export on tbm_cost_allocations(export_id);
create index if not exists idx_tbm_cost_allocations_cost_center on tbm_cost_allocations(cost_center_code);
