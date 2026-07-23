import { getPool } from "./pool";
import { Dataset, DatasetColumn, DatasetRelationshipView, DatasetStatus, EmbeddableColumn, SemanticMatch } from "./types";

// Semantic roles that represent real-world business entities worth embedding
// for cross-dataset similarity search (Stage 3). Structural/measure columns
// (amounts, dates, technical IDs) are intentionally excluded.
export const EMBEDDABLE_ROLES = [
  "vendor",
  "application",
  "service",
  "business_unit",
  "department",
  "cost_center",
  "cloud_resource",
] as const;

export async function createDataset(input: {
  fileName: string;
  storagePath: string;
  sheetName?: string;
  uploadedBy?: string;
}): Promise<Dataset> {
  const { rows } = await getPool().query<Dataset>(
    `insert into datasets (file_name, storage_path, sheet_name, uploaded_by)
     values ($1, $2, $3, $4) returning *`,
    [input.fileName, input.storagePath, input.sheetName ?? null, input.uploadedBy ?? null]
  );
  return rows[0];
}

export async function updateDatasetStatus(id: string, status: DatasetStatus, error?: string) {
  await getPool().query(
    `update datasets set status = $2, updated_at = now() where id = $1`,
    [id, status]
  );
  if (error) {
    await getPool().query(
      `insert into ingestion_runs (dataset_id, stage, status, error, finished_at)
       values ($1, 'ingestion', 'failed', $2, now())`,
      [id, error]
    );
  }
}

export async function setDatasetProfile(id: string, rowCount: number) {
  await getPool().query(`update datasets set row_count = $2, updated_at = now() where id = $1`, [id, rowCount]);
}

export async function setDatasetSourceType(id: string, sourceType: string, confidence: number) {
  await getPool().query(
    `update datasets set source_type = $2, source_type_confidence = $3, updated_at = now() where id = $1`,
    [id, sourceType, confidence]
  );
}

export async function insertColumns(datasetId: string, columns: Omit<DatasetColumn, "id" | "dataset_id">[]) {
  const pool = getPool();
  for (const col of columns) {
    await pool.query(
      `insert into dataset_columns
        (dataset_id, column_name, ordinal, inferred_type, null_pct, distinct_count, sample_values, is_candidate_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (dataset_id, column_name) do update set
         inferred_type = excluded.inferred_type,
         null_pct = excluded.null_pct,
         distinct_count = excluded.distinct_count,
         sample_values = excluded.sample_values,
         is_candidate_key = excluded.is_candidate_key`,
      [
        datasetId,
        col.column_name,
        col.ordinal,
        col.inferred_type,
        col.null_pct,
        col.distinct_count,
        JSON.stringify(col.sample_values ?? []),
        col.is_candidate_key,
      ]
    );
  }
}

export async function listDatasets(): Promise<Dataset[]> {
  const { rows } = await getPool().query<Dataset>(`select * from datasets order by uploaded_at desc`);
  return rows;
}

export async function getDataset(id: string): Promise<Dataset | null> {
  const { rows } = await getPool().query<Dataset>(`select * from datasets where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getDatasetColumns(datasetId: string): Promise<DatasetColumn[]> {
  const { rows } = await getPool().query<DatasetColumn>(
    `select * from dataset_columns where dataset_id = $1 order by ordinal asc`,
    [datasetId]
  );
  return rows;
}

export async function recordRun(datasetId: string, stage: string, status: "running" | "succeeded" | "failed", error?: string) {
  await getPool().query(
    `insert into ingestion_runs (dataset_id, stage, status, error, finished_at)
     values ($1, $2, $3, $4, case when $3 = 'running' then null else now() end)`,
    [datasetId, stage, status, error ?? null]
  );
}

// ---------- Stage 2: Intelligent Data Understanding ----------

export async function setDatasetBusinessPurpose(id: string, purpose: string) {
  await getPool().query(`update datasets set business_purpose = $2, updated_at = now() where id = $1`, [id, purpose]);
}

export async function updateColumnUnderstanding(
  columnId: string,
  input: { semanticRole: string; semanticRoleConfidence: number; isTechnical: boolean }
) {
  await getPool().query(
    `update dataset_columns set semantic_role = $2, semantic_role_confidence = $3, is_technical = $4 where id = $1`,
    [columnId, input.semanticRole, input.semanticRoleConfidence, input.isTechnical]
  );
}

export async function getOtherDatasetColumns(excludeDatasetId: string): Promise<(DatasetColumn & { dataset_file_name: string; dataset_source_type: string | null })[]> {
  const { rows } = await getPool().query(
    `select dc.*, d.file_name as dataset_file_name, d.source_type as dataset_source_type
     from dataset_columns dc
     join datasets d on d.id = dc.dataset_id
     where dc.dataset_id != $1`,
    [excludeDatasetId]
  );
  return rows;
}

export async function insertRelationship(input: {
  fromColumnId: string;
  toColumnId: string;
  relationshipType: string;
  confidence: number;
  reasoning?: string;
}) {
  await getPool().query(
    `insert into dataset_relationships (from_column_id, to_column_id, relationship_type, confidence, reasoning)
     values ($1, $2, $3, $4, $5)
     on conflict (from_column_id, to_column_id) do update set
       relationship_type = excluded.relationship_type,
       confidence = excluded.confidence,
       reasoning = excluded.reasoning`,
    [input.fromColumnId, input.toColumnId, input.relationshipType, input.confidence, input.reasoning ?? null]
  );
}

export async function getRelationshipsForDataset(datasetId: string): Promise<DatasetRelationshipView[]> {
  const { rows } = await getPool().query(
    `select
        r.id, r.from_column_id, r.to_column_id, r.relationship_type, r.confidence, r.reasoning, r.created_at,
        fd.id as from_dataset_id, fd.file_name as from_dataset_name, fc.column_name as from_column_name,
        td.id as to_dataset_id, td.file_name as to_dataset_name, tc.column_name as to_column_name
     from dataset_relationships r
     join dataset_columns fc on fc.id = r.from_column_id
     join datasets fd on fd.id = fc.dataset_id
     join dataset_columns tc on tc.id = r.to_column_id
     join datasets td on td.id = tc.dataset_id
     where fd.id = $1 or td.id = $1
     order by r.confidence desc`,
    [datasetId]
  );
  return rows;
}

// ---------- Stage 3: Semantic Representation (embeddings) ----------

export async function getEmbeddableColumns(datasetId: string): Promise<EmbeddableColumn[]> {
  const { rows } = await getPool().query(
    `select dc.*, d.file_name as dataset_file_name, d.source_type as dataset_source_type
     from dataset_columns dc
     join datasets d on d.id = dc.dataset_id
     where dc.dataset_id = $1
       and dc.is_technical = false
       and dc.semantic_role = any($2::text[])`,
    [datasetId, EMBEDDABLE_ROLES]
  );
  return rows;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function upsertEntityEmbedding(input: {
  datasetId: string;
  columnId: string;
  entityValue: string;
  embedding: number[];
}) {
  await getPool().query(
    `insert into entity_embeddings (dataset_id, column_id, entity_value, embedding)
     values ($1, $2, $3, $4::vector)
     on conflict (column_id, entity_value) do update set embedding = excluded.embedding`,
    [input.datasetId, input.columnId, input.entityValue, toVectorLiteral(input.embedding)]
  );
}

export async function getCrossDatasetMatches(maxDistance = 0.25, limit = 30): Promise<SemanticMatch[]> {
  const { rows } = await getPool().query(
    `select
        ea.entity_value as value_a, da.id as dataset_a_id, da.file_name as dataset_a_name, ca.column_name as column_a_name,
        eb.entity_value as value_b, db_.id as dataset_b_id, db_.file_name as dataset_b_name, cb.column_name as column_b_name,
        (ea.embedding <=> eb.embedding) as distance
     from entity_embeddings ea
     join entity_embeddings eb on eb.dataset_id != ea.dataset_id and eb.id > ea.id
     join datasets da on da.id = ea.dataset_id
     join datasets db_ on db_.id = eb.dataset_id
     join dataset_columns ca on ca.id = ea.column_id
     join dataset_columns cb on cb.id = eb.column_id
     where (ea.embedding <=> eb.embedding) < $1
     order by distance asc
     limit $2`,
    [maxDistance, limit]
  );
  return rows;
}
