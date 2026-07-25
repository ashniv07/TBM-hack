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
