export interface Dataset {
  id: string;
  file_name: string;
  source_type: string | null;
  source_type_confidence: number | null;
  status: string;
  sheet_name: string | null;
  row_count: number | null;
  business_purpose: string | null;
  uploaded_at: string;
}

export interface DatasetColumn {
  id: string;
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
  relationship_type: string;
  confidence: number;
  reasoning: string | null;
  from_dataset_id: string;
  from_dataset_name: string;
  from_column_name: string;
  to_dataset_id: string;
  to_dataset_name: string;
  to_column_name: string;
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

export interface UploadResult {
  fileName: string;
  datasetId?: string;
  error?: string;
  stage?: string;
}

const API_BASE = "/api";

export async function uploadDatasets(files: File[]): Promise<UploadResult[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));

  const res = await fetch(`${API_BASE}/datasets/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  const data = await res.json();
  return data.results as UploadResult[];
}

export async function fetchDatasets(): Promise<Dataset[]> {
  const res = await fetch(`${API_BASE}/datasets`);
  if (!res.ok) throw new Error(`Failed to fetch datasets: ${res.statusText}`);
  const data = await res.json();
  return data.datasets as Dataset[];
}

export async function fetchDatasetDetail(id: string): Promise<{ dataset: Dataset; columns: DatasetColumn[] }> {
  const res = await fetch(`${API_BASE}/datasets/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch dataset: ${res.statusText}`);
  return res.json();
}

export async function fetchRelationships(datasetId: string): Promise<DatasetRelationship[]> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/relationships`);
  if (!res.ok) throw new Error(`Failed to fetch relationships: ${res.statusText}`);
  const data = await res.json();
  return data.relationships as DatasetRelationship[];
}

export async function rerunUnderstanding(datasetId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/understand`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to run understanding: ${res.statusText}`);
}

export async function rerunEmbedding(datasetId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/embed`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to run embedding: ${res.statusText}`);
}

export async function fetchSemanticMatches(): Promise<SemanticMatch[]> {
  const res = await fetch(`${API_BASE}/entities/matches`);
  if (!res.ok) throw new Error(`Failed to fetch semantic matches: ${res.statusText}`);
  const data = await res.json();
  return data.matches as SemanticMatch[];
}

// ---------- Stage 4: Enterprise Context Model ----------

export interface ContextNode {
  id: string;
  entity_type: string;
  canonical_name: string;
  source_dataset_id: string | null;
  resolution_confidence: number;
  alias_count: number;
}

export interface ContextEdge {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  edge_type: string;
  weight: number;
  confidence: number;
  evidence_dataset_id: string | null;
  label: string | null;
  from_name: string;
  from_type: string;
  to_name: string;
  to_type: string;
}

export interface ContextGraphResponse {
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface ContextRebuildStats {
  entityCount: number;
  aliasCount: number;
  edgeCount: number;
  datasetsProcessed: number;
  datasetsSkipped: string[];
  hashFallbackRatio: number;
}

export interface ContextRebuildResult {
  ok: boolean;
  stats: ContextRebuildStats;
  warnings: string[];
}

export interface ContextTraceNode {
  id: string;
  entity_type: string;
  canonical_name: string;
  resolution_confidence: number;
  depth: number;
}

export interface ContextTraceResult {
  nodes: ContextTraceNode[];
  edges: ContextEdge[];
}

export async function rebuildContextModel(): Promise<ContextRebuildResult> {
  const res = await fetch(`${API_BASE}/context/rebuild`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to rebuild context model: ${res.statusText}`);
  return res.json();
}

export async function fetchContextGraph(): Promise<ContextGraphResponse> {
  const res = await fetch(`${API_BASE}/context/graph`);
  if (!res.ok) throw new Error(`Failed to fetch context graph: ${res.statusText}`);
  return res.json();
}

export async function fetchContextTrace(entityId: string, depth = 6): Promise<ContextTraceResult> {
  const res = await fetch(`${API_BASE}/context/entities/${entityId}/trace?depth=${depth}`);
  if (!res.ok) throw new Error(`Failed to fetch trace: ${res.statusText}`);
  return res.json();
}

// ---------- Stage 5: Data Trust & Standardization Engine ----------

export interface CanonicalSchema {
  id: string;
  source_type: string;
  semantic_role: string;
  column_name: string;
  inferred_type: string;
  is_required: boolean;
  frequency_score: number;
}

export interface QualityIssue {
  id: string;
  dataset_id: string;
  column_id: string | null;
  issue_type: string;
  severity: "info" | "warning" | "error" | "critical";
  status: "open" | "acknowledged" | "resolved" | "ignored";
  title: string;
  description: string;
  affected_rows: number | null;
  sample_values: unknown[] | null;
  suggested_fix: string | null;
  dataset_file_name: string;
  column_name: string | null;
}

export interface Correction {
  id: string;
  issue_id: string | null;
  dataset_id: string;
  column_id: string | null;
  correction_type: string;
  status: "pending" | "approved" | "rejected" | "applied";
  original_value: string | null;
  corrected_value: string | null;
  affected_rows: number | null;
  confidence: number;
  reasoning: string | null;
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
  dataset_file_name: string;
  source_type: string | null;
}

export interface StandardizationStats {
  schemasCount: number;
  issuesCount: number;
  correctionsCount: number;
  datasetsScored: number;
  averageReadinessScore: number;
}

export interface StandardizationRunResult {
  ok: boolean;
  stats: StandardizationStats;
}

export interface DataQualityReport {
  summary: {
    totalSchemas: number;
    totalIssues: number;
    criticalIssues: number;
    openIssues: number;
    pendingCorrections: number;
    datasetsScored: number;
    averageReadinessScore: number;
  };
  issuesByType: Record<string, number>;
  issuesBySeverity: Record<string, number>;
  datasetsNeedingAttention: {
    datasetId: string;
    fileName: string;
    overallScore: number;
    recommendations: string[] | null;
  }[];
  schemas: CanonicalSchema[];
  recentIssues: QualityIssue[];
  recentCorrections: Correction[];
}

export async function runStandardization(): Promise<StandardizationRunResult> {
  const res = await fetch(`${API_BASE}/standardization/run`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to run standardization: ${res.statusText}`);
  return res.json();
}

export async function fetchCanonicalSchemas(sourceType?: string): Promise<CanonicalSchema[]> {
  const url = sourceType
    ? `${API_BASE}/standardization/schemas?sourceType=${encodeURIComponent(sourceType)}`
    : `${API_BASE}/standardization/schemas`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch schemas: ${res.statusText}`);
  const data = await res.json();
  return data.schemas;
}

export async function fetchQualityIssues(filters?: {
  datasetId?: string;
  status?: string;
  severity?: string;
}): Promise<QualityIssue[]> {
  const params = new URLSearchParams();
  if (filters?.datasetId) params.set("datasetId", filters.datasetId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.severity) params.set("severity", filters.severity);

  const url = `${API_BASE}/standardization/issues${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch issues: ${res.statusText}`);
  const data = await res.json();
  return data.issues;
}

export async function updateIssueStatus(id: string, status: string): Promise<QualityIssue> {
  const res = await fetch(`${API_BASE}/standardization/issues/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Failed to update issue: ${res.statusText}`);
  const data = await res.json();
  return data.issue;
}

export async function fetchCorrections(filters?: {
  datasetId?: string;
  status?: string;
}): Promise<Correction[]> {
  const params = new URLSearchParams();
  if (filters?.datasetId) params.set("datasetId", filters.datasetId);
  if (filters?.status) params.set("status", filters.status);

  const url = `${API_BASE}/standardization/corrections${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch corrections: ${res.statusText}`);
  const data = await res.json();
  return data.corrections;
}

export async function approveCorrection(id: string): Promise<Correction> {
  const res = await fetch(`${API_BASE}/standardization/corrections/${id}/approve`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to approve correction: ${res.statusText}`);
  const data = await res.json();
  return data.correction;
}

export async function rejectCorrection(id: string): Promise<Correction> {
  const res = await fetch(`${API_BASE}/standardization/corrections/${id}/reject`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to reject correction: ${res.statusText}`);
  const data = await res.json();
  return data.correction;
}

export async function bulkApproveCorrections(ids: string[]): Promise<number> {
  const res = await fetch(`${API_BASE}/standardization/corrections/bulk-approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to bulk approve: ${res.statusText}`);
  const data = await res.json();
  return data.approved;
}

export async function applyCorrection(id: string): Promise<Correction> {
  const res = await fetch(`${API_BASE}/standardization/corrections/${id}/apply`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to apply correction: ${res.statusText}`);
  const data = await res.json();
  return data.correction;
}

export async function fetchReadinessScores(): Promise<ReadinessScore[]> {
  const res = await fetch(`${API_BASE}/standardization/readiness`);
  if (!res.ok) throw new Error(`Failed to fetch readiness scores: ${res.statusText}`);
  const data = await res.json();
  return data.scores;
}

export async function fetchReadinessScore(datasetId: string): Promise<ReadinessScore> {
  const res = await fetch(`${API_BASE}/standardization/readiness/${datasetId}`);
  if (!res.ok) throw new Error(`Failed to fetch readiness score: ${res.statusText}`);
  const data = await res.json();
  return data.score;
}

export async function fetchDataQualityReport(): Promise<DataQualityReport> {
  const res = await fetch(`${API_BASE}/standardization/report`);
  if (!res.ok) throw new Error(`Failed to fetch report: ${res.statusText}`);
  return res.json();
}

export interface ApplyCorrectionChange {
  correctionId: string;
  columnName: string;
  originalValue: string;
  correctedValue: string;
  rowsAffected: number;
}

export interface CorrectedDatasetInfo {
  id: string;
  fileName: string;
  storagePath: string;
  status: string;
  sourceType: string | null;
}

export interface ApplyCorrectionsResult {
  ok: boolean;
  originalFile: string;
  correctedFile: string;
  correctionsApplied: number;
  originalDatasetId: string;
  /** The new dataset registered from the corrected file - use for subsequent stages */
  correctedDataset: CorrectedDatasetInfo | null;
  changes: ApplyCorrectionChange[];
}

export interface ApplyAllCorrectionsResult {
  ok: boolean;
  results: ApplyCorrectionsResult[];
  errors: { datasetId: string; error: string }[];
}

export interface ProcessCorrectedResult {
  ok: boolean;
  datasetId: string;
  fileName: string;
  stages: {
    understanding: { columnsClassified: number; relationshipsDetected: number };
    embedding: { entitiesEmbedded: number };
  };
  message: string;
}

export async function applyCorrectionsToDataset(datasetId: string): Promise<ApplyCorrectionsResult> {
  const res = await fetch(`${API_BASE}/standardization/apply/${datasetId}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to apply corrections: ${res.statusText}`);
  return res.json();
}

export async function applyAllCorrections(): Promise<ApplyAllCorrectionsResult> {
  const res = await fetch(`${API_BASE}/standardization/apply-all`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to apply all corrections: ${res.statusText}`);
  return res.json();
}

/**
 * Process a corrected dataset through Stages 2-3 (Understanding + Embedding)
 * This integrates the corrected data into the knowledge graph, making it ready
 * for Stage 4 (Context), Stage 6 (ATUM), and Stage 7 (TBM Export).
 */
export async function processCorrectedDataset(datasetId: string): Promise<ProcessCorrectedResult> {
  const res = await fetch(`${API_BASE}/standardization/process-corrected/${datasetId}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to process corrected dataset: ${res.statusText}`);
  return res.json();
}

// ---------- Stage 6: ATUM Mapping ----------

export type AtumLayer = "cost_pool" | "resource_tower" | "solution";

export interface AtumTaxonomyItem {
  id: string; layer: AtumLayer; path: string; level_1: string;
  level_2: string | null; level_3: string | null;
}

export interface AtumMapping {
  id: string; dataset_id: string; dataset_file_name: string; column_name: string;
  semantic_role: string | null; source_value: string; layer: AtumLayer;
  category_id: string | null; category_path: string | null;
  level_1: string | null; level_2: string | null; level_3: string | null;
  status: "suggested" | "approved" | "rejected" | "overridden" | "unresolved";
  confidence: number; method: string; reasoning: string | null;
  source_context: Record<string, string | number> | null;
  /** canonicalEntityName is null when the mapping has no Stage 4 entity and so cannot reach the graph. */
  evidence: {
    vectorSimilarity?: number; lexicalScore?: number; rule?: string; occurrences?: number;
    contextEntityId?: string | null; canonicalEntityName?: string | null;
  } | null;
  alternatives: { categoryId: string; path: string; confidence: number }[] | null;
}

export interface AtumReport {
  total: number; classified: number; coverage: number; averageConfidence: number;
  byStatus: Record<string, number>; byTower: Record<string, number>;
}

export async function importAtumTaxonomy() {
  const res = await fetch(`${API_BASE}/atum/taxonomy/import`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error ?? "Taxonomy import failed");
  return res.json() as Promise<{ ok: boolean; imported: number; active: number; retired: number; embeddingSource: string }>;
}

export async function runAtumMapping(layer: AtumLayer, useLlm = false) {
  const res = await fetch(`${API_BASE}/atum/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layer, useLlm }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "ATUM mapping failed");
  return res.json() as Promise<{
    ok: boolean;
    stats: {
      candidates: number; mapped: number; autoMapped: number; needsReview: number; unresolved: number;
      skippedDatasets: string[]; fallbackDatasets: string[]; linkedToContext: number; embeddingSource: string;
    };
    graph: { edges: number; categories: number; mappings: number };
  }>;
}

export async function syncAtumGraph(layer: AtumLayer) {
  const res = await fetch(`${API_BASE}/atum/sync-graph`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layer }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "ATUM graph sync failed");
  return res.json() as Promise<{ ok: boolean; edges: number; categories: number; mappings: number }>;
}

export async function fetchAtumMappings(layer?: AtumLayer): Promise<AtumMapping[]> {
  const res = await fetch(`${API_BASE}/atum/mappings${layer ? `?layer=${layer}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch ATUM mappings");
  return (await res.json()).mappings;
}

export async function fetchAtumTaxonomy(layer: AtumLayer): Promise<AtumTaxonomyItem[]> {
  const res = await fetch(`${API_BASE}/atum/taxonomy?layer=${layer}`);
  if (!res.ok) throw new Error("Failed to fetch ATUM taxonomy");
  return (await res.json()).items;
}

export async function fetchAtumReport(): Promise<AtumReport> {
  const res = await fetch(`${API_BASE}/atum/report`);
  if (!res.ok) throw new Error("Failed to fetch ATUM report");
  return res.json();
}

export async function reviewAtumMapping(id: string, action: "approve" | "reject", categoryId?: string) {
  const endpoint = categoryId ? "override" : action;
  const res = await fetch(`${API_BASE}/atum/mappings/${id}/${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId }),
  });
  if (!res.ok) throw new Error("Failed to review ATUM mapping");
  return res.json();
}

// ---------- Stage 7: TBM Data Model Export ----------

export type TbmExportType = "full" | "cost_centers" | "applications" | "vendors" | "cloud_resources" | "allocations";
export type TbmExportFormat = "json" | "csv" | "xlsx";

export interface TbmExport {
  id: string;
  export_type: TbmExportType;
  status: "pending" | "running" | "completed" | "failed";
  format: TbmExportFormat;
  include_unmapped: boolean;
  include_low_confidence: boolean;
  confidence_threshold: number;
  file_path: string | null;
  record_count: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TbmCostCenter {
  cost_center_code: string;
  cost_center_name: string;
  parent_cost_center_code: string | null;
  business_unit_code: string | null;
  business_unit_name: string | null;
  department_code: string | null;
  department_name: string | null;
  confidence: number;
}

export interface TbmApplication {
  application_id: string;
  application_name: string;
  vendor_name: string | null;
  business_unit_code: string | null;
  cost_center_code: string | null;
  atum_tower: string | null;
  atum_sub_tower: string | null;
  atum_service_domain: string | null;
  atum_confidence: number | null;
  confidence: number;
}

export interface TbmVendor {
  vendor_id: string;
  vendor_name: string;
  vendor_type: string | null;
  atum_cost_pool: string | null;
  atum_confidence: number | null;
  confidence: number;
}

export interface TbmCloudResource {
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
  confidence: number;
}

export interface TbmDataModel {
  costCenters: TbmCostCenter[];
  applications: TbmApplication[];
  vendors: TbmVendor[];
  cloudResources: TbmCloudResource[];
  metadata: {
    exportId: string;
    exportedAt: string;
    totalRecords: number;
    taxonomyVersion: string;
  };
}

export interface TbmExportSummary {
  costCenters: number;
  applications: number;
  vendors: number;
  cloudResources: number;
  businessUnits: number;
  departments: number;
  atumMappedEntities: number;
  totalEntities: number;
  totalEdges: number;
  readyForExport: boolean;
}

export interface TbmGenerateResult {
  ok: boolean;
  exportId: string;
  recordCount: number;
  model: TbmDataModel;
  filePath?: string;
}

export async function fetchTbmExportSummary(): Promise<TbmExportSummary> {
  const res = await fetch(`${API_BASE}/tbm-export/preview/summary`);
  if (!res.ok) throw new Error("Failed to fetch TBM export summary");
  return res.json();
}

export async function generateTbmExport(options: {
  exportType?: TbmExportType;
  format?: TbmExportFormat;
  includeUnmapped?: boolean;
  includeLowConfidence?: boolean;
  confidenceThreshold?: number;
  saveFile?: boolean;
}): Promise<TbmGenerateResult> {
  const res = await fetch(`${API_BASE}/tbm-export/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "TBM export failed");
  return res.json();
}

export async function fetchTbmExports(): Promise<TbmExport[]> {
  const res = await fetch(`${API_BASE}/tbm-export/list`);
  if (!res.ok) throw new Error("Failed to fetch TBM exports");
  return (await res.json()).exports;
}

export async function fetchTbmExportDetail(id: string): Promise<{ export: TbmExport; model: TbmDataModel | null }> {
  const res = await fetch(`${API_BASE}/tbm-export/${id}`);
  if (!res.ok) throw new Error("Failed to fetch TBM export");
  return res.json();
}

export async function downloadTbmExport(id: string, format: TbmExportFormat): Promise<void> {
  const res = await fetch(`${API_BASE}/tbm-export/${id}/download?format=${format}`);
  if (!res.ok) throw new Error("Failed to download TBM export");

  const contentType = res.headers.get("Content-Type") || "";
  const disposition = res.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="(.+)"/);
  const filename = filenameMatch ? filenameMatch[1] : `tbm_export.${format}`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Stage 8: AI Assistant ----------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { type: string; id: string; name: string }[];
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  processingTime: number;
}

export interface ChatSuggestion {
  category: string;
  prompt: string;
}

export async function sendChatMessage(message: string, sessionId?: string, screenContext?: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId, screenContext }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Chat failed");
  return res.json();
}

export async function fetchChatSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE}/assistant/sessions`);
  if (!res.ok) throw new Error("Failed to fetch chat sessions");
  return (await res.json()).sessions;
}

export async function fetchChatHistory(sessionId: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const res = await fetch(`${API_BASE}/assistant/sessions/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch chat history");
  return res.json();
}

export async function fetchChatSuggestions(): Promise<ChatSuggestion[]> {
  const res = await fetch(`${API_BASE}/assistant/suggestions`);
  if (!res.ok) throw new Error("Failed to fetch suggestions");
  return (await res.json()).suggestions;
}

// ---------- Stage 9: Analytics Dashboard ----------

export interface AnalyticsOverview {
  summary: {
    totalDatasets: number;
    totalRows: number;
    totalEntities: number;
    totalEdges: number;
    totalIssues: number;
    openIssues: number;
    totalMappings: number;
    approvedMappings: number;
    avgReadiness: number;
    atumCoverage: number;
  };
  dataQuality: {
    issuesByType: Record<string, number>;
    issuesBySeverity: Record<string, number>;
    readinessDistribution: {
      excellent: number;
      good: number;
      fair: number;
      poor: number;
    };
    avgScores: {
      completeness: number;
      validity: number;
      consistency: number;
      uniqueness: number;
    };
  };
  atumMapping: {
    mappingsByStatus: Record<string, number>;
    mappingsByLayer: Record<string, number>;
    mappingsByTower: Record<string, number>;
    coverage: number;
  };
  knowledgeGraph: {
    entityTypes: Record<string, number>;
    edgeTypes: Record<string, number>;
  };
  datasets: {
    sourceTypes: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

export interface DatasetAnalytics {
  id: string;
  fileName: string;
  sourceType: string | null;
  status: string;
  rowCount: number | null;
  uploadedAt: string;
  readiness: {
    overall: number;
    completeness: number;
    validity: number;
    consistency: number;
    uniqueness: number;
  } | null;
  issues: {
    total: number;
    critical: number;
    open: number;
  };
}

export async function fetchAnalyticsOverview(): Promise<AnalyticsOverview> {
  const res = await fetch(`${API_BASE}/analytics/overview`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

export async function fetchDatasetAnalytics(): Promise<DatasetAnalytics[]> {
  const res = await fetch(`${API_BASE}/analytics/datasets`);
  if (!res.ok) throw new Error("Failed to fetch dataset analytics");
  return (await res.json()).datasets;
}
