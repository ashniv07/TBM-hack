export type DatasetStatus =
  | "uploaded"
  | "profiling"
  | "profiled"
  | "understanding"
  | "understood"
  | "embedding"
  | "embedded"
  | "error";

export interface Dataset {
  id: string;
  file_name: string;
  source_type: string | null;
  source_type_confidence: number | null;
  status: DatasetStatus;
  storage_path: string;
  sheet_name: string | null;
  row_count: number | null;
  uploaded_by: string | null;
  business_purpose: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface DatasetColumn {
  id: string;
  dataset_id: string;
  column_name: string;
  ordinal: number;
  inferred_type: string | null;
  null_pct: number | null;
  distinct_count: number | null;
  sample_values: unknown[] | null;
  is_candidate_key: boolean;
  is_technical: boolean;
  semantic_role: string | null;
  semantic_role_confidence: number | null;
}

export interface DatasetRelationship {
  id: string;
  from_column_id: string;
  to_column_id: string;
  relationship_type: string;
  confidence: number;
  reasoning: string | null;
  created_at: string;
}

export interface DatasetRelationshipView extends DatasetRelationship {
  from_dataset_id: string;
  from_dataset_name: string;
  from_column_name: string;
  to_dataset_id: string;
  to_dataset_name: string;
  to_column_name: string;
}

export interface EmbeddableColumn extends DatasetColumn {
  dataset_file_name: string;
  dataset_source_type: string | null;
}

export interface SemanticMatch {
  value_a: string;
  dataset_a_id: string;
  dataset_a_name: string;
  column_a_name: string;
  value_b: string;
  dataset_b_id: string;
  dataset_b_name: string;
  column_b_name: string;
  distance: number;
}

// ---------- Stage 4: Enterprise Context Model (Knowledge Graph) ----------

export interface RawEntityEmbeddingRow {
  id: string;
  dataset_id: string;
  column_id: string;
  entity_value: string;
  embedding: number[];
  embedding_source: string;
  semantic_role: string;
  column_name: string;
}

export interface ContextEntityInput {
  tempId: string;
  entityType: string;
  canonicalName: string;
  confidence: number;
}

export interface ContextDatasetNodeInput {
  tempId: string;
  datasetId: string;
  canonicalName: string;
}

export interface ContextAliasInput {
  entityTempId: string;
  datasetId: string;
  columnId: string;
  entityValue: string;
}

export interface ContextEdgeInput {
  fromTempId: string;
  toTempId: string;
  edgeType: string;
  weight: number;
  confidence: number;
  evidenceDatasetId?: string;
  label?: string;
}

export interface ContextEntityRow {
  id: string;
  entity_type: string;
  canonical_name: string;
  source_dataset_id: string | null;
  resolution_confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ContextEdgeRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  edge_type: string;
  weight: number;
  confidence: number;
  evidence_dataset_id: string | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}
