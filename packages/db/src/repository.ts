import { getPool } from "./pool";
import {
  CanonicalSchema,
  ContextAliasInput,
  ContextDatasetNodeInput,
  ContextEdgeInput,
  ContextEdgeRow,
  ContextEntityInput,
  ContextEntityRow,
  Correction,
  CorrectionStatus,
  CorrectionView,
  Dataset,
  DatasetColumn,
  DatasetRelationshipView,
  DatasetStatus,
  EmbeddableColumn,
  IssueStatus,
  QualityIssue,
  QualityIssueView,
  RawEntityEmbeddingRow,
  ReadinessScore,
  ReadinessScoreView,
  SemanticMatch,
  AtumLayer,
  AtumMapping,
  AtumMappingStatus,
  AtumMappingView,
  AtumTaxonomyItem,
} from "./types";

// Semantic roles that represent real-world business entities worth embedding
// for cross-dataset similarity search (Stage 3) and promoting to Stage 4
// graph nodes. Structural/measure columns (amounts, dates, technical IDs) are
// intentionally excluded — and so is "person": Stage 2 still classifies
// Owner/Manager/Contact columns as person (so they're not mislabeled as a
// business unit or department), but individual human names are metadata
// about a business entity, not enterprise entities in their own right, so
// they're deliberately never embedded or turned into graph nodes.
export const EMBEDDABLE_ROLES = [
  "vendor",
  "application",
  "service",
  "business_unit",
  "department",
  "cost_center",
  "cloud_resource",
  "cloud_provider",
  "infrastructure_asset",
  "project",
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
  embeddingSource: string;
}) {
  await getPool().query(
    `insert into entity_embeddings (dataset_id, column_id, entity_value, embedding, embedding_source)
     values ($1, $2, $3, $4::vector, $5)
     on conflict (column_id, entity_value) do update set
       embedding = excluded.embedding,
       embedding_source = excluded.embedding_source`,
    [input.datasetId, input.columnId, input.entityValue, toVectorLiteral(input.embedding), input.embeddingSource]
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

// ---------- Stage 4: Enterprise Context Model (Knowledge Graph) ----------

function parseVectorLiteral(value: string): number[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}

// All embeddable entity values across every dataset, joined back to their
// semantic role, for Stage 4's cross-dataset clustering step.
export async function getAllEmbeddableEntityRows(): Promise<RawEntityEmbeddingRow[]> {
  const { rows } = await getPool().query(
    `select ee.id, ee.dataset_id, ee.column_id, ee.entity_value, ee.embedding::text as embedding,
            ee.embedding_source, dc.semantic_role, dc.column_name
     from entity_embeddings ee
     join dataset_columns dc on dc.id = ee.column_id
     where dc.semantic_role = any($1::text[])`,
    [EMBEDDABLE_ROLES]
  );
  return rows.map((r: any) => ({ ...r, embedding: parseVectorLiteral(r.embedding) }));
}

// Only datasets that have actually reached Stage 3 (i.e. have at least one
// embedding) are eligible to become dataset-nodes in the context model —
// this naturally excludes datasets stuck in "profiled"/"understood" due to
// an earlier pipeline failure.
export async function getDatasetsWithEmbeddings(): Promise<Dataset[]> {
  const { rows } = await getPool().query<Dataset>(
    `select distinct d.* from datasets d join entity_embeddings ee on ee.dataset_id = d.id order by d.file_name`
  );
  return rows;
}

// Rebuilds the entire context graph atomically: the old graph is only ever
// replaced by a fully-formed new one, never left half-written by a failure
// partway through (each rebuild runs in a single transaction).
// Row count per batched INSERT — comfortably under Postgres' 65535-parameter
// limit for every table here (7 columns/row at most => 3500 params/batch),
// while cutting network round-trips to the (remote, shared) Supabase instance
// from one-per-row to one-per-500-rows. This matters a lot in practice: Stage
// 4 now embeds several more roles than before (vendor/project/cloud_provider/
// infrastructure_asset), so a single rebuild can produce hundreds of aliases
// and edges — at one round-trip each, that alone was taking minutes.
const REBUILD_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export async function rebuildContextGraph(input: {
  entities: ContextEntityInput[];
  datasetNodes: ContextDatasetNodeInput[];
  aliases: ContextAliasInput[];
  edges: ContextEdgeInput[];
}): Promise<{ entityCount: number; datasetNodeCount: number; aliasCount: number; edgeCount: number }> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("delete from context_edges");
    await client.query("delete from context_entity_aliases");
    await client.query("delete from context_entities");

    const idMap = new Map<string, string>();

    // Batched multi-row INSERT ... RETURNING id. Postgres returns rows for a
    // plain VALUES-list insert in the same order the values were given, so
    // zipping the batch back onto the returned ids by index is safe here (no
    // triggers/rules on context_entities that could reorder them). The length
    // check below fails loudly instead of silently mismapping if that were
    // ever violated.
    for (const batch of chunk(input.datasetNodes, REBUILD_BATCH_SIZE)) {
      if (batch.length === 0) continue;
      const params: unknown[] = [];
      const tuples = batch.map((node, i) => {
        params.push(node.canonicalName, node.datasetId);
        return `('dataset', $${i * 2 + 1}, $${i * 2 + 2})`;
      });
      const { rows } = await client.query(
        `insert into context_entities (entity_type, canonical_name, source_dataset_id) values ${tuples.join(", ")} returning id`,
        params
      );
      if (rows.length !== batch.length) throw new Error("Dataset node insert count mismatch during context rebuild");
      batch.forEach((node, i) => idMap.set(node.tempId, rows[i].id));
    }

    for (const batch of chunk(input.entities, REBUILD_BATCH_SIZE)) {
      if (batch.length === 0) continue;
      const params: unknown[] = [];
      const tuples = batch.map((entity, i) => {
        params.push(entity.entityType, entity.canonicalName, entity.confidence);
        return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
      });
      const { rows } = await client.query(
        `insert into context_entities (entity_type, canonical_name, resolution_confidence) values ${tuples.join(", ")} returning id`,
        params
      );
      if (rows.length !== batch.length) throw new Error("Entity insert count mismatch during context rebuild");
      batch.forEach((entity, i) => idMap.set(entity.tempId, rows[i].id));
    }

    const resolvedAliases = input.aliases
      .map((alias) => ({ ...alias, entityId: idMap.get(alias.entityTempId) }))
      .filter((alias): alias is typeof alias & { entityId: string } => Boolean(alias.entityId));

    for (const batch of chunk(resolvedAliases, REBUILD_BATCH_SIZE)) {
      if (batch.length === 0) continue;
      const params: unknown[] = [];
      const tuples = batch.map((alias, i) => {
        params.push(alias.entityId, alias.datasetId, alias.columnId, alias.entityValue);
        return `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`;
      });
      await client.query(
        `insert into context_entity_aliases (context_entity_id, dataset_id, column_id, entity_value)
         values ${tuples.join(", ")}
         on conflict (column_id, entity_value) do update set context_entity_id = excluded.context_entity_id`,
        params
      );
    }

    const resolvedEdges = input.edges
      .map((edge) => ({ ...edge, fromId: idMap.get(edge.fromTempId), toId: idMap.get(edge.toTempId) }))
      .filter(
        (edge): edge is typeof edge & { fromId: string; toId: string } =>
          Boolean(edge.fromId) && Boolean(edge.toId) && edge.fromId !== edge.toId
      );

    for (const batch of chunk(resolvedEdges, REBUILD_BATCH_SIZE)) {
      if (batch.length === 0) continue;
      const params: unknown[] = [];
      const tuples = batch.map((edge, i) => {
        params.push(edge.fromId, edge.toId, edge.edgeType, edge.weight, edge.confidence, edge.evidenceDatasetId ?? null, edge.label ?? null);
        const base = i * 7;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      });
      await client.query(
        `insert into context_edges (from_entity_id, to_entity_id, edge_type, weight, confidence, evidence_dataset_id, label)
         values ${tuples.join(", ")}
         on conflict (from_entity_id, to_entity_id, edge_type) do update set
           weight = context_edges.weight + excluded.weight,
           confidence = greatest(context_edges.confidence, excluded.confidence),
           label = excluded.label,
           updated_at = now()`,
        params
      );
    }

    await client.query("commit");
    return {
      entityCount: input.entities.length,
      datasetNodeCount: input.datasetNodes.length,
      aliasCount: resolvedAliases.length,
      edgeCount: resolvedEdges.length,
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getContextGraph(): Promise<{
  nodes: (ContextEntityRow & { alias_count: number })[];
  edges: (ContextEdgeRow & { from_name: string; from_type: string; to_name: string; to_type: string })[];
}> {
  const [nodesResult, edgesResult] = await Promise.all([
    getPool().query(
      `select ce.*, count(cea.id)::int as alias_count
       from context_entities ce
       left join context_entity_aliases cea on cea.context_entity_id = ce.id
       group by ce.id
       order by ce.entity_type, ce.canonical_name`
    ),
    getPool().query(
      `select e.*, fa.canonical_name as from_name, fa.entity_type as from_type,
              ta.canonical_name as to_name, ta.entity_type as to_type
       from context_edges e
       join context_entities fa on fa.id = e.from_entity_id
       join context_entities ta on ta.id = e.to_entity_id
       order by (e.edge_type = 'foreign_key') desc, e.confidence desc`
    ),
  ]);
  return { nodes: nodesResult.rows, edges: edgesResult.rows };
}

export async function getContextEntityAliases(
  contextEntityId: string
): Promise<{ dataset_id: string; dataset_file_name: string; column_name: string; entity_value: string }[]> {
  const { rows } = await getPool().query(
    `select cea.dataset_id, d.file_name as dataset_file_name, dc.column_name, cea.entity_value
     from context_entity_aliases cea
     join datasets d on d.id = cea.dataset_id
     join dataset_columns dc on dc.id = cea.column_id
     where cea.context_entity_id = $1
     order by d.file_name, dc.column_name`,
    [contextEntityId]
  );
  return rows;
}

// ---------- Stage 5: Data Trust & Standardization Engine ----------

// Get datasets grouped by source type for schema derivation
export async function getDatasetsBySourceType(): Promise<Map<string, Dataset[]>> {
  const { rows } = await getPool().query<Dataset>(
    `select * from datasets where source_type is not null order by source_type, file_name`
  );
  const grouped = new Map<string, Dataset[]>();
  for (const row of rows) {
    const sourceType = row.source_type!;
    if (!grouped.has(sourceType)) grouped.set(sourceType, []);
    grouped.get(sourceType)!.push(row);
  }
  return grouped;
}

// Get context entities by type for cross-dataset validation
export async function getContextEntitiesByType(entityType: string): Promise<ContextEntityRow[]> {
  const { rows } = await getPool().query<ContextEntityRow>(
    `select * from context_entities where entity_type = $1 order by canonical_name`,
    [entityType]
  );
  return rows;
}

// Canonical Schemas
export async function upsertCanonicalSchema(input: {
  sourceType: string;
  semanticRole: string;
  columnName: string;
  inferredType: string;
  isRequired: boolean;
  frequencyScore: number;
}): Promise<CanonicalSchema> {
  const { rows } = await getPool().query<CanonicalSchema>(
    `insert into canonical_schemas (source_type, semantic_role, column_name, inferred_type, is_required, frequency_score)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (source_type, semantic_role) do update set
       column_name = excluded.column_name,
       inferred_type = excluded.inferred_type,
       is_required = excluded.is_required,
       frequency_score = excluded.frequency_score,
       updated_at = now()
     returning *`,
    [input.sourceType, input.semanticRole, input.columnName, input.inferredType, input.isRequired, input.frequencyScore]
  );
  return rows[0];
}

export async function getCanonicalSchemas(sourceType?: string): Promise<CanonicalSchema[]> {
  if (sourceType) {
    const { rows } = await getPool().query<CanonicalSchema>(
      `select * from canonical_schemas where source_type = $1 order by is_required desc, frequency_score desc`,
      [sourceType]
    );
    return rows;
  }
  const { rows } = await getPool().query<CanonicalSchema>(
    `select * from canonical_schemas order by source_type, is_required desc, frequency_score desc`
  );
  return rows;
}

// Quality Issues
export async function insertQualityIssue(input: {
  datasetId: string;
  columnId?: string;
  issueType: string;
  severity: string;
  title: string;
  description: string;
  affectedRows?: number;
  sampleValues?: unknown[];
  suggestedFix?: string;
}): Promise<QualityIssue> {
  const { rows } = await getPool().query<QualityIssue>(
    `insert into quality_issues (dataset_id, column_id, issue_type, severity, title, description, affected_rows, sample_values, suggested_fix)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      input.datasetId,
      input.columnId ?? null,
      input.issueType,
      input.severity,
      input.title,
      input.description,
      input.affectedRows ?? null,
      input.sampleValues ? JSON.stringify(input.sampleValues) : null,
      input.suggestedFix ?? null,
    ]
  );
  return rows[0];
}

export async function getQualityIssues(filters?: {
  datasetId?: string;
  status?: IssueStatus;
  severity?: string;
}): Promise<QualityIssueView[]> {
  let query = `
    select qi.*, d.file_name as dataset_file_name, dc.column_name
    from quality_issues qi
    join datasets d on d.id = qi.dataset_id
    left join dataset_columns dc on dc.id = qi.column_id
    where 1=1
  `;
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.datasetId) {
    query += ` and qi.dataset_id = $${paramIdx++}`;
    params.push(filters.datasetId);
  }
  if (filters?.status) {
    query += ` and qi.status = $${paramIdx++}`;
    params.push(filters.status);
  }
  if (filters?.severity) {
    query += ` and qi.severity = $${paramIdx++}`;
    params.push(filters.severity);
  }

  // Sort by severity (critical first) then by created_at
  query += ` order by
    case qi.severity
      when 'critical' then 1
      when 'error' then 2
      when 'warning' then 3
      when 'info' then 4
    end,
    qi.created_at desc`;

  const { rows } = await getPool().query<QualityIssueView>(query, params);
  return rows;
}

export async function updateQualityIssueStatus(id: string, status: IssueStatus): Promise<QualityIssue | null> {
  const { rows } = await getPool().query<QualityIssue>(
    `update quality_issues set status = $2, updated_at = now() where id = $1 returning *`,
    [id, status]
  );
  return rows[0] ?? null;
}

export async function clearQualityIssuesForDataset(datasetId: string): Promise<number> {
  const result = await getPool().query(
    `delete from quality_issues where dataset_id = $1`,
    [datasetId]
  );
  return result.rowCount ?? 0;
}

export async function clearAllQualityIssues(): Promise<number> {
  const result = await getPool().query(`delete from quality_issues`);
  return result.rowCount ?? 0;
}

// Corrections
export async function insertCorrection(input: {
  issueId?: string;
  datasetId: string;
  columnId?: string;
  correctionType: string;
  originalValue?: string;
  correctedValue?: string;
  affectedRows?: number;
  confidence: number;
  reasoning?: string;
}): Promise<Correction> {
  const { rows } = await getPool().query<Correction>(
    `insert into corrections (issue_id, dataset_id, column_id, correction_type, original_value, corrected_value, affected_rows, confidence, reasoning)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      input.issueId ?? null,
      input.datasetId,
      input.columnId ?? null,
      input.correctionType,
      input.originalValue ?? null,
      input.correctedValue ?? null,
      input.affectedRows ?? null,
      input.confidence,
      input.reasoning ?? null,
    ]
  );
  return rows[0];
}

export async function getCorrections(filters?: {
  datasetId?: string;
  status?: CorrectionStatus;
  issueId?: string;
}): Promise<CorrectionView[]> {
  let query = `
    select c.*, d.file_name as dataset_file_name, dc.column_name, qi.title as issue_title
    from corrections c
    join datasets d on d.id = c.dataset_id
    left join dataset_columns dc on dc.id = c.column_id
    left join quality_issues qi on qi.id = c.issue_id
    where 1=1
  `;
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.datasetId) {
    query += ` and c.dataset_id = $${paramIdx++}`;
    params.push(filters.datasetId);
  }
  if (filters?.status) {
    query += ` and c.status = $${paramIdx++}`;
    params.push(filters.status);
  }
  if (filters?.issueId) {
    query += ` and c.issue_id = $${paramIdx++}`;
    params.push(filters.issueId);
  }

  query += ` order by c.confidence desc, c.created_at desc`;

  const { rows } = await getPool().query<CorrectionView>(query, params);
  return rows;
}

export async function approveCorrection(id: string, approvedBy?: string): Promise<Correction | null> {
  const { rows } = await getPool().query<Correction>(
    `update corrections set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
     where id = $1 returning *`,
    [id, approvedBy ?? null]
  );
  return rows[0] ?? null;
}

export async function rejectCorrection(id: string): Promise<Correction | null> {
  const { rows } = await getPool().query<Correction>(
    `update corrections set status = 'rejected', updated_at = now() where id = $1 returning *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function bulkApproveCorrections(ids: string[], approvedBy?: string): Promise<number> {
  const result = await getPool().query(
    `update corrections set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
     where id = any($1::uuid[]) and status = 'pending'`,
    [ids, approvedBy ?? null]
  );
  return result.rowCount ?? 0;
}

export async function markCorrectionApplied(id: string): Promise<Correction | null> {
  const { rows } = await getPool().query<Correction>(
    `update corrections set status = 'applied', applied_at = now(), updated_at = now()
     where id = $1 and status = 'approved' returning *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function clearCorrectionsForDataset(datasetId: string): Promise<number> {
  const result = await getPool().query(
    `delete from corrections where dataset_id = $1`,
    [datasetId]
  );
  return result.rowCount ?? 0;
}

export async function clearAllCorrections(): Promise<number> {
  const result = await getPool().query(`delete from corrections`);
  return result.rowCount ?? 0;
}

// Readiness Scores
export async function upsertReadinessScore(input: {
  datasetId: string;
  overallScore: number;
  completenessScore: number;
  validityScore: number;
  consistencyScore: number;
  uniquenessScore: number;
  issueCount: number;
  criticalIssueCount: number;
  recommendations?: string[];
}): Promise<ReadinessScore> {
  const { rows } = await getPool().query<ReadinessScore>(
    `insert into readiness_scores (dataset_id, overall_score, completeness_score, validity_score, consistency_score, uniqueness_score, issue_count, critical_issue_count, recommendations)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (dataset_id) do update set
       overall_score = excluded.overall_score,
       completeness_score = excluded.completeness_score,
       validity_score = excluded.validity_score,
       consistency_score = excluded.consistency_score,
       uniqueness_score = excluded.uniqueness_score,
       issue_count = excluded.issue_count,
       critical_issue_count = excluded.critical_issue_count,
       recommendations = excluded.recommendations,
       updated_at = now()
     returning *`,
    [
      input.datasetId,
      input.overallScore,
      input.completenessScore,
      input.validityScore,
      input.consistencyScore,
      input.uniquenessScore,
      input.issueCount,
      input.criticalIssueCount,
      input.recommendations ? JSON.stringify(input.recommendations) : null,
    ]
  );
  return rows[0];
}

export async function getReadinessScores(): Promise<ReadinessScoreView[]> {
  const { rows } = await getPool().query<ReadinessScoreView>(
    `select rs.*, d.file_name as dataset_file_name, d.source_type
     from readiness_scores rs
     join datasets d on d.id = rs.dataset_id
     order by rs.overall_score desc`
  );
  return rows;
}

export async function getReadinessScore(datasetId: string): Promise<ReadinessScoreView | null> {
  const { rows } = await getPool().query<ReadinessScoreView>(
    `select rs.*, d.file_name as dataset_file_name, d.source_type
     from readiness_scores rs
     join datasets d on d.id = rs.dataset_id
     where rs.dataset_id = $1`,
    [datasetId]
  );
  return rows[0] ?? null;
}

// Bounded-depth traversal from a single entity, treating edges as undirected
// (a "contains_reference" edge is still walkable in reverse) so the result
// reflects true connectivity rather than requiring the caller to know which
// direction a given hop was stored in. Cycles are prevented via the path array.
export async function traceFromEntity(
  entityId: string,
  maxDepth = 6
): Promise<{
  nodes: { id: string; entity_type: string; canonical_name: string; resolution_confidence: number; depth: number }[];
  edges: (ContextEdgeRow & { from_name: string; to_name: string })[];
}> {
  const { rows: reach } = await getPool().query(
    `with recursive traversal(entity_id, depth, path) as (
       select $1::uuid, 0, array[$1::uuid]
       union all
       select
         case when e.from_entity_id = t.entity_id then e.to_entity_id else e.from_entity_id end,
         t.depth + 1,
         t.path || (case when e.from_entity_id = t.entity_id then e.to_entity_id else e.from_entity_id end)
       from traversal t
       join context_edges e on e.from_entity_id = t.entity_id or e.to_entity_id = t.entity_id
       where t.depth < $2
         and not ((case when e.from_entity_id = t.entity_id then e.to_entity_id else e.from_entity_id end) = any(t.path))
     )
     select entity_id, min(depth) as depth from traversal group by entity_id order by depth asc`,
    [entityId, maxDepth]
  );

  if (reach.length === 0) return { nodes: [], edges: [] };
  const ids = reach.map((r) => r.entity_id);

  const [{ rows: nodes }, { rows: edges }] = await Promise.all([
    getPool().query(
      `select id, entity_type, canonical_name, resolution_confidence from context_entities where id = any($1::uuid[])`,
      [ids]
    ),
    getPool().query(
      `select e.*, fa.canonical_name as from_name, ta.canonical_name as to_name
       from context_edges e
       join context_entities fa on fa.id = e.from_entity_id
       join context_entities ta on ta.id = e.to_entity_id
       where e.from_entity_id = any($1::uuid[]) and e.to_entity_id = any($1::uuid[])`,
      [ids]
    ),
  ]);

  const depthById = new Map<string, number>(reach.map((r) => [r.entity_id, Number(r.depth)]));
  return {
    nodes: nodes.map((n: any) => ({ ...n, depth: depthById.get(n.id) ?? 0 })),
    edges,
  };
}

// ---------- Stage 6: ATUM Mapping ----------

export async function upsertAtumTaxonomyItem(input: {
  taxonomyVersion: string; layer: AtumLayer; level1: string; level1Description?: string;
  level2?: string; level2Description?: string; level3?: string; level3Description?: string;
  examples?: string; path: string; searchText: string; isRetired: boolean;
}): Promise<AtumTaxonomyItem> {
  const { rows } = await getPool().query<AtumTaxonomyItem>(
    `insert into atum_taxonomy_items
       (taxonomy_version, layer, level_1, level_1_description, level_2, level_2_description,
        level_3, level_3_description, examples, path, search_text, is_retired)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (taxonomy_version, layer, path) do update set
       level_1_description=excluded.level_1_description, level_2=excluded.level_2,
       level_2_description=excluded.level_2_description, level_3=excluded.level_3,
       level_3_description=excluded.level_3_description, examples=excluded.examples,
       search_text=excluded.search_text, is_retired=excluded.is_retired, updated_at=now()
     returning *`,
    [input.taxonomyVersion, input.layer, input.level1, input.level1Description ?? null,
     input.level2 ?? null, input.level2Description ?? null, input.level3 ?? null,
     input.level3Description ?? null, input.examples ?? null, input.path, input.searchText, input.isRetired]
  );
  return rows[0];
}

export async function setAtumTaxonomyEmbedding(id: string, embedding: number[], source: string): Promise<void> {
  await getPool().query(
    `update atum_taxonomy_items set embedding=$2::vector, embedding_source=$3, updated_at=now() where id=$1`,
    [id, toVectorLiteral(embedding), source]
  );
}

export async function listAtumTaxonomyItems(filters?: { layer?: AtumLayer; includeRetired?: boolean }): Promise<AtumTaxonomyItem[]> {
  const params: unknown[] = [];
  let query = `select * from atum_taxonomy_items where 1=1`;
  if (!filters?.includeRetired) query += ` and is_retired=false`;
  if (filters?.layer) { params.push(filters.layer); query += ` and layer=$${params.length}`; }
  query += ` order by layer, level_1, level_2, level_3`;
  return (await getPool().query<AtumTaxonomyItem>(query, params)).rows;
}

export async function findNearestAtumItems(
  embedding: number[], layer: AtumLayer, limit = 5
): Promise<(AtumTaxonomyItem & { distance: number })[]> {
  const { rows } = await getPool().query(
    `select *, (embedding <=> $1::vector) as distance from atum_taxonomy_items
     where layer=$2 and is_retired=false and embedding is not null
     order by embedding <=> $1::vector limit $3`,
    [toVectorLiteral(embedding), layer, limit]
  );
  return rows;
}

export async function getAtumMappingInputs(): Promise<{
  dataset_id: string; column_id: string; source_value: string; semantic_role: string | null; embedding: number[];
}[]> {
  const { rows } = await getPool().query(
    `select ee.dataset_id, ee.column_id, ee.entity_value as source_value, dc.semantic_role,
            ee.embedding::text as embedding
     from entity_embeddings ee join dataset_columns dc on dc.id=ee.column_id
     order by ee.dataset_id, ee.column_id, ee.entity_value`
  );
  return rows.map((r: any) => ({ ...r, embedding: parseVectorLiteral(r.embedding) }));
}

export async function upsertAtumMapping(input: {
  datasetId: string; columnId: string; sourceValue: string; taxonomyVersion: string; layer: AtumLayer;
  categoryId?: string; status: AtumMappingStatus; confidence: number; method: string;
  reasoning?: string; evidence?: Record<string, unknown>; alternatives?: unknown[]; sourceContext?: Record<string, unknown>;
}): Promise<AtumMapping> {
  const { rows } = await getPool().query<AtumMapping>(
    `insert into atum_mappings
       (dataset_id,column_id,source_value,taxonomy_version,layer,category_id,status,confidence,method,reasoning,evidence,alternatives,source_context)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (dataset_id,column_id,source_value,taxonomy_version,layer) do update set
       category_id=excluded.category_id, status=case when atum_mappings.status in ('approved','overridden') then atum_mappings.status else excluded.status end,
       confidence=excluded.confidence, method=excluded.method, reasoning=excluded.reasoning,
       evidence=excluded.evidence, alternatives=excluded.alternatives, source_context=excluded.source_context, updated_at=now()
     returning *`,
    [input.datasetId,input.columnId,input.sourceValue,input.taxonomyVersion,input.layer,input.categoryId ?? null,
     input.status,input.confidence,input.method,input.reasoning ?? null,JSON.stringify(input.evidence ?? {}),
     JSON.stringify(input.alternatives ?? []),JSON.stringify(input.sourceContext ?? {})]
  );
  return rows[0];
}

export async function clearAtumMappingsForLayer(layer: AtumLayer): Promise<number> {
  const result = await getPool().query(`delete from atum_mappings where layer=$1`, [layer]);
  return result.rowCount ?? 0;
}

export async function listAtumMappings(filters?: { datasetId?: string; status?: AtumMappingStatus; layer?: AtumLayer }): Promise<AtumMappingView[]> {
  const params: unknown[] = [];
  let query = `select m.*, d.file_name as dataset_file_name, dc.column_name, dc.semantic_role,
                      t.path as category_path, t.level_1, t.level_2, t.level_3
               from atum_mappings m join datasets d on d.id=m.dataset_id
               join dataset_columns dc on dc.id=m.column_id
               left join atum_taxonomy_items t on t.id=m.category_id where 1=1`;
  if (filters?.datasetId) { params.push(filters.datasetId); query += ` and m.dataset_id=$${params.length}`; }
  if (filters?.status) { params.push(filters.status); query += ` and m.status=$${params.length}`; }
  if (filters?.layer) { params.push(filters.layer); query += ` and m.layer=$${params.length}`; }
  query += ` order by m.confidence desc, d.file_name, m.source_value`;
  return (await getPool().query<AtumMappingView>(query, params)).rows;
}

// Stage 4 lookup used by Stage 6 to resolve an anchor cell value back to the
// canonical entity it was clustered into. Keyed by (column_id, lowercased
// value) because that is exactly the grain context_entity_aliases is unique on.
export async function getContextEntityAliasMap(): Promise<
  Map<string, { contextEntityId: string; canonicalName: string; entityType: string }>
> {
  const { rows } = await getPool().query(
    `select cea.column_id, cea.entity_value, cea.context_entity_id,
            ce.canonical_name, ce.entity_type
     from context_entity_aliases cea
     join context_entities ce on ce.id = cea.context_entity_id`
  );
  return new Map(
    rows.map((row: any) => [
      `${row.column_id}::${String(row.entity_value).toLowerCase()}`,
      { contextEntityId: row.context_entity_id, canonicalName: row.canonical_name, entityType: row.entity_type },
    ])
  );
}

// Approved/overridden mappings joined back to the Stage 4 entity that produced
// them. The join is on (dataset_id, column_id, entity_value) — the same grain
// Stage 3 embedded — so a mapping anchored on a non-embeddable column simply
// does not appear here (see extractContext.ts displayPriority).
export async function getApprovedAtumMappingsForGraph(filters?: {
  layer?: AtumLayer;
  mappingId?: string;
}): Promise<{ mapping_id: string; context_entity_id: string; category_path: string; confidence: number }[]> {
  const params: unknown[] = [];
  let query = `select m.id as mapping_id, cea.context_entity_id, t.path as category_path, m.confidence
               from atum_mappings m
               join atum_taxonomy_items t on t.id = m.category_id
               join context_entity_aliases cea
                 on cea.dataset_id = m.dataset_id
                and cea.column_id = m.column_id
                and lower(cea.entity_value) = lower(m.source_value)
               where m.status in ('approved','overridden')`;
  if (filters?.layer) { params.push(filters.layer); query += ` and m.layer = $${params.length}`; }
  if (filters?.mappingId) { params.push(filters.mappingId); query += ` and m.id = $${params.length}`; }
  return (await getPool().query(query, params)).rows;
}

export async function removeAtumEdgesForMapping(mappingId: string): Promise<number> {
  const result = await getPool().query(`delete from context_edges where atum_mapping_id = $1`, [mappingId]);
  return result.rowCount ?? 0;
}

// Materialise approved mappings as graph edges. Idempotent: re-running only
// upserts, so an unchanged mapping does not duplicate its edge.
export async function syncAtumEdgesToGraph(filters?: {
  layer?: AtumLayer;
  mappingId?: string;
}): Promise<{ edges: number; categories: number; mappings: number }> {
  const mappings = await getApprovedAtumMappingsForGraph(filters);
  if (mappings.length === 0) return { edges: 0, categories: 0, mappings: 0 };

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const categoryIds = new Map<string, string>();
    for (const path of new Set(mappings.map((m) => m.category_path))) {
      const { rows } = await client.query(
        `insert into context_entities (entity_type, canonical_name) values ('atum_category', $1)
         on conflict (canonical_name) where entity_type = 'atum_category'
         do update set updated_at = now()
         returning id`,
        [path]
      );
      categoryIds.set(path, rows[0].id);
    }

    let edges = 0;
    for (const mapping of mappings) {
      const result = await client.query(
        `insert into context_edges
           (from_entity_id, to_entity_id, edge_type, weight, confidence, atum_mapping_id)
         values ($1, $2, 'maps_to_atum', 1, $3, $4)
         on conflict (from_entity_id, to_entity_id, edge_type)
         do update set confidence = excluded.confidence,
                       atum_mapping_id = excluded.atum_mapping_id,
                       updated_at = now()`,
        [mapping.context_entity_id, categoryIds.get(mapping.category_path), mapping.confidence, mapping.mapping_id]
      );
      edges += result.rowCount ?? 0;
    }
    await client.query("commit");
    return { edges, categories: categoryIds.size, mappings: mappings.length };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function reviewAtumMapping(input: {
  id: string; status: "approved" | "rejected" | "overridden"; reviewedBy?: string; categoryId?: string;
}): Promise<AtumMapping | null> {
  const { rows } = await getPool().query<AtumMapping>(
    `update atum_mappings set status=$2, reviewed_by=$3, reviewed_at=now(),
       category_id=coalesce($4, category_id), confidence=case when $2='overridden' then 1 else confidence end,
       method=case when $2='overridden' then 'manual_override' else method end, updated_at=now()
     where id=$1 returning *`,
    [input.id,input.status,input.reviewedBy ?? null,input.categoryId ?? null]
  );
  return rows[0] ?? null;
}
