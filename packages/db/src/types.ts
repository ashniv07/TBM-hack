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
  /** Which Apptio master template this source file targets. */
  master_type: string | null;
  template_coverage: number | null;
  template_expected_count: number | null;
  template_matched_count: number | null;
  /** Path to refined dataset with only mapped columns (output of Relationship phase). */
  refined_path: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface ColumnMapping {
  id: string;
  dataset_id: string;
  source_column: string;
  /** null = the source supplied a column the template has no place for. */
  template_column: string | null;
  confidence: number;
  method: string;
  is_override: boolean;
}

/** "The template expects N columns; this file supplies M." */
export interface TemplateCoverageRow {
  dataset_id: string;
  file_name: string;
  master_type: string | null;
  template_coverage: number | null;
  template_expected_count: number | null;
  template_matched_count: number | null;
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
  embedding: Float32Array;
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

export interface AtumAlternative {
  categoryId: string;
  path: string;
  confidence: number;
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
  alternatives: AtumAlternative[] | null;
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

// ---------- Stage 7: TBM Data Model Export ----------

export type TbmExportType = "full" | "cost_centers" | "applications" | "vendors" | "cloud_resources" | "allocations";
export type TbmExportStatus = "pending" | "running" | "completed" | "failed";
export type TbmExportFormat = "json" | "csv" | "xlsx";

export interface TbmExport {
  id: string;
  export_type: TbmExportType;
  status: TbmExportStatus;
  format: TbmExportFormat;
  include_unmapped: boolean;
  include_low_confidence: boolean;
  confidence_threshold: number;
  file_path: string | null;
  record_count: number | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TbmCostCenter {
  id: string;
  export_id: string | null;
  cost_center_code: string;
  cost_center_name: string;
  parent_cost_center_code: string | null;
  business_unit_code: string | null;
  business_unit_name: string | null;
  department_code: string | null;
  department_name: string | null;
  source_entity_id: string | null;
  confidence: number;
}

export interface TbmApplication {
  id: string;
  export_id: string | null;
  application_id: string;
  application_name: string;
  vendor_name: string | null;
  business_unit_code: string | null;
  cost_center_code: string | null;
  atum_tower: string | null;
  atum_sub_tower: string | null;
  atum_service_domain: string | null;
  atum_confidence: number | null;
  source_entity_id: string | null;
  atum_mapping_id: string | null;
  confidence: number;
}

export interface TbmVendor {
  id: string;
  export_id: string | null;
  vendor_id: string;
  vendor_name: string;
  vendor_type: string | null;
  atum_cost_pool: string | null;
  atum_confidence: number | null;
  source_entity_id: string | null;
  confidence: number;
}

export interface TbmCloudResource {
  id: string;
  export_id: string | null;
  resource_id: string;
  resource_name: string;
  resource_type: string | null;
  cloud_provider: string | null;
  region: string | null;
  account_id: string | null;
  atum_tower: string | null;
  atum_sub_tower: string | null;
  atum_confidence: number | null;
  application_id: string | null;
  source_entity_id: string | null;
  atum_mapping_id: string | null;
  confidence: number;
}

export interface TbmCostAllocation {
  id: string;
  export_id: string | null;
  cost_center_code: string;
  application_id: string | null;
  vendor_id: string | null;
  cloud_resource_id: string | null;
  atum_tower: string | null;
  atum_sub_tower: string | null;
  amount: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  source_dataset_id: string | null;
  source_row_index: number | null;
}

export interface TbmDataModel {
  costCenters: TbmCostCenter[];
  applications: TbmApplication[];
  vendors: TbmVendor[];
  cloudResources: TbmCloudResource[];
  allocations: TbmCostAllocation[];
  metadata: {
    exportId: string;
    exportedAt: string;
    totalRecords: number;
    taxonomyVersion: string;
  };
}

// ---------- Stage 8: AI Assistant ----------

export type AssistantRole = "user" | "assistant" | "system";

export interface AssistantSession {
  id: string;
  title: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantMessage {
  id: string;
  session_id: string;
  role: AssistantRole;
  content: string;
  metadata: {
    sources?: { type: string; id: string; name: string }[];
    toolCalls?: { tool: string; args: Record<string, unknown> }[];
    processingTime?: number;
  } | null;
  created_at: string;
}

export interface AssistantQueryCache {
  id: string;
  query_text: string;
  response_summary: string | null;
  sources: unknown[] | null;
  hit_count: number;
  created_at: string;
}
