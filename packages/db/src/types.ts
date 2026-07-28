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

// ---------- Stage 5: Data Trust & Standardization Engine ----------

export type IssueSeverity = "info" | "warning" | "error" | "critical";
export type IssueStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type IssueType =
  | "missing_value"
  | "duplicate"
  | "invalid_reference"
  | "invalid_currency"
  | "invalid_date"
  | "outlier"
  | "schema_mismatch";

export type CorrectionStatus = "pending" | "approved" | "rejected" | "applied";
export type CorrectionType =
  | "normalize_date"
  | "normalize_currency"
  | "fuzzy_match_entity"
  | "trim_whitespace"
  | "fill_missing"
  | "remove_duplicate";

export interface CanonicalSchema {
  id: string;
  source_type: string;
  semantic_role: string;
  column_name: string;
  inferred_type: string;
  is_required: boolean;
  frequency_score: number;
  created_at: string;
  updated_at: string;
}

export interface QualityIssue {
  id: string;
  dataset_id: string;
  column_id: string | null;
  issue_type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  title: string;
  description: string;
  affected_rows: number | null;
  sample_values: unknown[] | null;
  suggested_fix: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualityIssueView extends QualityIssue {
  dataset_file_name: string;
  column_name: string | null;
}

export interface Correction {
  id: string;
  issue_id: string | null;
  dataset_id: string;
  column_id: string | null;
  correction_type: CorrectionType;
  status: CorrectionStatus;
  original_value: string | null;
  corrected_value: string | null;
  affected_rows: number | null;
  confidence: number;
  reasoning: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectionView extends Correction {
  dataset_file_name: string;
  column_name: string | null;
  issue_title: string | null;
}

export interface ReadinessScore {
  id: string;
  dataset_id: string;
  overall_score: number;
  completeness_score: number;
  validity_score: number;
  consistency_score: number;
  uniqueness_score: number;
  issue_count: number;
  critical_issue_count: number;
  recommendations: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ReadinessScoreView extends ReadinessScore {
  dataset_file_name: string;
  source_type: string | null;
}

// ---------- Stage 6: ATUM Mapping ----------

export type AtumLayer = "cost_pool" | "resource_tower" | "solution";
export type AtumMappingStatus = "suggested" | "approved" | "rejected" | "overridden" | "unresolved";

export interface AtumTaxonomyItem {
  id: string;
  taxonomy_version: string;
  layer: AtumLayer;
  level_1: string;
  level_1_description: string | null;
  level_2: string | null;
  level_2_description: string | null;
  level_3: string | null;
  level_3_description: string | null;
  examples: string | null;
  path: string;
  search_text: string;
  is_retired: boolean;
  embedding_source: string | null;
}

export interface AtumMapping {
  id: string;
  dataset_id: string;
  column_id: string;
  source_value: string;
  source_context: Record<string, unknown> | null;
  taxonomy_version: string;
  layer: AtumLayer;
  category_id: string | null;
  status: AtumMappingStatus;
  confidence: number;
  method: string;
  reasoning: string | null;
  evidence: Record<string, unknown> | null;
  alternatives: unknown[] | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// One approved/overridden mapping resolved to the Stage 4 entity it classifies.
// Stage 6 uses the first four fields to draw a graph edge; Stage 7 uses the
// rest to place the entity in the exported TBM data model.
export interface AtumEntityClassification {
  mapping_id: string;
  context_entity_id: string;
  category_path: string;
  confidence: number;
  layer: AtumLayer;
  status: AtumMappingStatus;
  method: string;
  source_value: string;
  level_1: string;
  level_2: string | null;
  level_3: string | null;
  dataset_file_name: string;
}

export interface AtumMappingView extends AtumMapping {
  dataset_file_name: string;
  column_name: string;
  semantic_role: string | null;
  category_path: string | null;
  level_1: string | null;
  level_2: string | null;
  level_3: string | null;
}
