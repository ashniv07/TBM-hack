import path from "path";
import { DatasetColumn, getDataset, getDatasetColumns, getEmbeddableColumns } from "@tbm/db";
import { readWorkbookRows } from "../shared/readWorkbookRows";
import { partitionPairedIdColumns } from "../shared/pairedIdColumns";
import { ContextState, DatasetNode, EntityAlias, GraphEdgeCandidate, ResolvedEntity } from "./state";

// Business-relationship edge labels, checked in order: a column-name hint
// (e.g. any "Manufacturer" column) wins over the generic per-role default, so
// "HAS_MANUFACTURER" is used instead of the blander "HAS_VENDOR" when the
// column name says which kind of vendor relationship this is.
const COLUMN_NAME_EDGE_LABELS: [RegExp, string][] = [
  [/manufacturer/i, "HAS_MANUFACTURER"],
  [/location/i, "LOCATED_IN"],
  [/platform/i, "USES_PLATFORM"],
];

const ROLE_EDGE_LABELS: Record<string, string> = {
  vendor: "HAS_VENDOR",
  application: "HAS_APPLICATION",
  service: "HAS_SERVICE",
  business_unit: "HAS_BUSINESS_UNIT",
  department: "HAS_DEPARTMENT",
  cost_center: "HAS_COST_CENTER",
  cloud_resource: "HAS_CLOUD_RESOURCE",
};

export function deriveEdgeLabel(column: DatasetColumn): string {
  for (const [pattern, label] of COLUMN_NAME_EDGE_LABELS) {
    if (pattern.test(column.column_name)) return label;
  }
  const role = column.semantic_role ?? "";
  return ROLE_EDGE_LABELS[role] ?? `HAS_${role.toUpperCase() || "VALUE"}`;
}

// Directional business-relationship labels for same-row co-occurrence between
// two resolved entities of known types — e.g. a Cost Center and a Vendor
// appearing on the same transaction row become a labeled, directed
// "Cost Center -USES_VENDOR-> Vendor" edge instead of a generic, undirected
// "co_occurs_with" link. Only pairs with a real, unambiguous business meaning
// are listed; anything else falls back to the generic co-occurrence edge.
export const ENTITY_TYPE_RELATIONSHIP_LABELS: Record<string, Record<string, string>> = {
  cost_center: { vendor: "USES_VENDOR" },
  department: { vendor: "USES_VENDOR" },
  project: { vendor: "CONTRACTED_WITH" },
  application: { cloud_provider: "HOSTED_BY" },
  infrastructure_asset: { vendor: "MANUFACTURED_BY" },
};

// ">60% overlap" and "mostly unique" per the required PK/FK classification —
// named here so both thresholds are visible and tunable in one place.
const STRUCTURAL_OVERLAP_THRESHOLD = 0.6;
const STRUCTURAL_UNIQUENESS_THRESHOLD = 0.9;

function normalizeColumnName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Same scoring shape as Stage 2's detectRelationships.ts (exact match = 1,
// substring containment = 0.65, else 0) — duplicated rather than imported so
// Stage 4's structural detection doesn't take on a dependency on Stage 2's
// module, which reads only from the 5-value profiling sample and is a
// different (coarser) signal than the real full-column comparison here.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeColumnName(a);
  const nb = normalizeColumnName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.65;
  return 0;
}

export interface StructuralKeyEvaluation {
  isMatch: boolean;
  confidence: number;
  /** true when side A is the PK ("one") side and side B is the FK ("many") side */
  pkIsA: boolean;
}

// Pure decision function for "is this column pair a real PK/FK relationship,
// and which side is which" — pulled out of the dataset-pair loop below so it
// can be unit-tested directly against known scenarios (e.g. the 23-value
// Storage Device ID <-> Storage_Devices_Master_Data case) without needing to
// mock file reads or the database.
export function evaluateStructuralKeyCandidate(params: {
  overlapRatio: number;
  uniquenessA: number;
  uniquenessB: number;
  nameSim: number;
  datatypeMatch: number;
}): StructuralKeyEvaluation {
  const { overlapRatio, uniquenessA, uniquenessB, nameSim, datatypeMatch } = params;
  if (nameSim === 0 || overlapRatio < STRUCTURAL_OVERLAP_THRESHOLD) {
    return { isMatch: false, confidence: 0, pkIsA: false };
  }
  const pkIsA = uniquenessA >= uniquenessB;
  const pkUniqueness = pkIsA ? uniquenessA : uniquenessB;
  if (pkUniqueness < STRUCTURAL_UNIQUENESS_THRESHOLD) {
    return { isMatch: false, confidence: 0, pkIsA };
  }
  const confidence = Number(
    Math.min(0.98, 0.45 * overlapRatio + 0.3 * pkUniqueness + 0.15 * nameSim + 0.1 * datatypeMatch).toFixed(3)
  );
  return { isMatch: true, confidence, pkIsA };
}

function edgeKey(fromId: string, toId: string, edgeType: string): string {
  return `${edgeType}::${fromId}::${toId}`;
}

function distinctStringValues(rows: Record<string, unknown>[], columnName: string): Set<string> {
  const values = new Set<string>();
  for (const row of rows) {
    const raw = row[columnName];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value) values.add(value);
  }
  return values;
}

async function loadDatasetRows(node: DatasetNode, uploadsDir?: string): Promise<Record<string, unknown>[] | null> {
  const dataset = await getDataset(node.datasetId);
  if (!dataset) return null;

  const candidatePaths = [dataset.storage_path];
  if (uploadsDir) {
    candidatePaths.push(path.join(uploadsDir, path.basename(dataset.storage_path)));
  }

  for (const candidate of candidatePaths) {
    try {
      return (await readWorkbookRows(candidate)).rows;
    } catch {
      // try next candidate path
    }
  }
  return null;
}

/**
 * Builds the context graph's edges in two phases, structural before semantic:
 *
 * Phase 1 — structural (dataset -> dataset, edgeType "foreign_key"): compares
 * every non-technical column pair across every dataset pair using the FULL
 * re-read row data (never the 5-value profiling sample, which is far too
 * sparse for high-cardinality ID columns to show real overlap). A pair
 * qualifies as a key relationship only when value overlap exceeds
 * STRUCTURAL_OVERLAP_THRESHOLD and the more-unique side clears
 * STRUCTURAL_UNIQUENESS_THRESHOLD — mirroring how a real PK/FK pair looks:
 * one side (the dimension/master table) is close to fully unique, the other
 * (the fact table) repeats each key many times. The edge points from the
 * repeating ("many"/FK) side to the unique ("one"/PK) side.
 *
 * Phase 2 — semantic (dataset -> entity, entity <-> entity): the original
 * Stage 3-entity-driven edges, unchanged in logic but now reusing the same
 * per-dataset row cache built for phase 1 instead of re-reading each file a
 * second time.
 */
export async function buildEdgesNode(state: ContextState): Promise<Partial<ContextState>> {
  if (state.error) return {};
  if (!state.datasetNodes || !state.valueToEntity) {
    return { error: "Missing entity resolution results" };
  }

  const edgeMap = new Map<string, GraphEdgeCandidate>();
  const warnings = [...(state.warnings ?? [])];
  const skippedDatasets: string[] = [];
  const entityTypeByTempId = new Map((state.entities ?? []).map((e) => [e.tempId, e.entityType]));

  function addSemanticEdge(
    fromTempId: string,
    toTempId: string,
    edgeType: "contains_reference" | "co_occurs_with",
    evidenceDatasetId: string,
    label?: string
  ) {
    if (fromTempId === toTempId) return;
    let a = fromTempId;
    let b = toTempId;
    // A labeled business relationship (e.g. Cost Center -USES_VENDOR-> Vendor)
    // is directional and must not be collapsed with its reverse pairing — only
    // fold into a canonical, undirected ordering when there's no such label.
    if (edgeType === "co_occurs_with" && !label && a > b) {
      [a, b] = [b, a];
    }
    const key = edgeKey(a, b, edgeType) + (label ? `::${label}` : "");
    const existing = edgeMap.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      edgeMap.set(key, { fromTempId: a, toTempId: b, edgeType, weight: 1, confidence: 0, evidenceDatasetId, label });
    }
  }

  // Same-row entity pair -> directed business label, if the two entities'
  // types have a known, unambiguous relationship (see ENTITY_TYPE_RELATIONSHIP_LABELS).
  // Falls back to undirected/unlabeled when types don't match a known pair.
  function addEntityPairEdge(tempIdA: string, tempIdB: string, evidenceDatasetId: string) {
    const typeA = entityTypeByTempId.get(tempIdA);
    const typeB = entityTypeByTempId.get(tempIdB);
    const labelAB = typeA && typeB ? ENTITY_TYPE_RELATIONSHIP_LABELS[typeA]?.[typeB] : undefined;
    const labelBA = typeA && typeB ? ENTITY_TYPE_RELATIONSHIP_LABELS[typeB]?.[typeA] : undefined;
    if (labelAB) {
      addSemanticEdge(tempIdA, tempIdB, "co_occurs_with", evidenceDatasetId, labelAB);
    } else if (labelBA) {
      addSemanticEdge(tempIdB, tempIdA, "co_occurs_with", evidenceDatasetId, labelBA);
    } else {
      addSemanticEdge(tempIdA, tempIdB, "co_occurs_with", evidenceDatasetId);
    }
  }

  // Load every dataset's rows and non-technical columns once, shared by both phases.
  const rowsByDataset = new Map<string, Record<string, unknown>[] | null>();
  const columnsByDataset = new Map<string, DatasetColumn[]>();
  for (const node of state.datasetNodes) {
    const rows = await loadDatasetRows(node, state.uploadsDir);
    rowsByDataset.set(node.datasetId, rows);
    columnsByDataset.set(node.datasetId, (await getDatasetColumns(node.datasetId)).filter((c) => !c.is_technical));
    if (!rows) {
      skippedDatasets.push(node.canonicalName);
      warnings.push(
        `Could not re-read "${node.canonicalName}" for row-level linking. Structural key detection and entity ` +
          `co-occurrence could not be computed for it — only dataset -> entity references from profiled samples.`
      );
    }
  }

  // ---------- Phase 1: structural dataset -> dataset key edges ----------
  const distinctValuesByColumn = new Map<string, Set<string>>(); // columnId -> distinct values, computed once
  function getDistinctValues(datasetId: string, col: DatasetColumn): Set<string> {
    const cached = distinctValuesByColumn.get(col.id);
    if (cached) return cached;
    const rows = rowsByDataset.get(datasetId);
    const values = rows ? distinctStringValues(rows, col.column_name) : new Set<string>();
    distinctValuesByColumn.set(col.id, values);
    return values;
  }

  for (let i = 0; i < state.datasetNodes.length; i++) {
    for (let j = i + 1; j < state.datasetNodes.length; j++) {
      const nodeA = state.datasetNodes[i];
      const nodeB = state.datasetNodes[j];
      if (!rowsByDataset.get(nodeA.datasetId) || !rowsByDataset.get(nodeB.datasetId)) continue;

      const colsA = columnsByDataset.get(nodeA.datasetId)!;
      const colsB = columnsByDataset.get(nodeB.datasetId)!;

      for (const colA of colsA) {
        const valuesA = getDistinctValues(nodeA.datasetId, colA);
        if (valuesA.size === 0) continue;

        for (const colB of colsB) {
          const nameSim = nameSimilarity(colA.column_name, colB.column_name);
          if (nameSim === 0) continue; // structural links require at least a plausible name match

          const valuesB = getDistinctValues(nodeB.datasetId, colB);
          if (valuesB.size === 0) continue;

          let intersection = 0;
          const [smaller, larger] = valuesA.size <= valuesB.size ? [valuesA, valuesB] : [valuesB, valuesA];
          for (const v of smaller) if (larger.has(v)) intersection++;
          const overlapRatio = intersection / smaller.size;

          const rowsA = rowsByDataset.get(nodeA.datasetId)!.length;
          const rowsB = rowsByDataset.get(nodeB.datasetId)!.length;
          const uniquenessA = valuesA.size / rowsA;
          const uniquenessB = valuesB.size / rowsB;
          const datatypeMatch = colA.inferred_type && colA.inferred_type === colB.inferred_type ? 1 : 0.5;

          const evaluation = evaluateStructuralKeyCandidate({ overlapRatio, uniquenessA, uniquenessB, nameSim, datatypeMatch });
          if (!evaluation.isMatch) continue;

          // FK side (repeating / "many") -> PK side (unique / "one")
          const fkNode = evaluation.pkIsA ? nodeB : nodeA;
          const pkNode = evaluation.pkIsA ? nodeA : nodeB;
          const fkCol = evaluation.pkIsA ? colB : colA;

          const key = edgeKey(fkNode.tempId, pkNode.tempId, "foreign_key");
          const existing = edgeMap.get(key);
          if (!existing || evaluation.confidence > existing.confidence) {
            edgeMap.set(key, {
              fromTempId: fkNode.tempId,
              toTempId: pkNode.tempId,
              edgeType: "foreign_key",
              weight: intersection,
              confidence: evaluation.confidence,
              evidenceDatasetId: fkNode.datasetId,
              label: fkCol.column_name,
            });
          }
        }
      }
    }
  }

  // ---------- Phase 2: hierarchical semantic edges ----------
  // Instead of dataset -> entity directly (a star topology), each embeddable
  // column becomes its own "attribute_group" node sitting between the
  // dataset and its values: dataset -[HAS_MANUFACTURER]-> "Manufacturer" ->
  // EMC / Hitachi Data Systems. Entity <-> entity co-occurrence (same-row
  // evidence) is unaffected by this — it stays a direct link between the two
  // real value entities, since that signal isn't about any one column.
  const groupEntities: ResolvedEntity[] = [];
  // ID-style columns (e.g. "Vendor ID") that were suppressed in favor of a
  // same-role Name column (e.g. "Vendor Name") don't get their own node —
  // instead their per-row value is attached as a property/alias of whichever
  // entity the row's Name value resolved to. Keyed by `${columnId}::${value}`
  // to dedupe repeats of the same ID across many rows before insertion.
  const idPropertyAliases = new Map<string, EntityAlias>();

  for (const node of state.datasetNodes) {
    const { embeddable: embeddableColumns, suppressedIdPairs } = partitionPairedIdColumns(
      await getEmbeddableColumns(node.datasetId)
    );
    if (embeddableColumns.length === 0) continue;

    const rows = rowsByDataset.get(node.datasetId);
    const columnsWithValues = new Set<string>();

    function groupTempIdFor(columnId: string): string {
      return `group:${node.datasetId}:${columnId}`;
    }

    if (rows) {
      for (const row of rows) {
        const resolvedByColumn: { columnId: string; tempId: string }[] = [];
        for (const col of embeddableColumns) {
          const raw = row[col.column_name];
          if (typeof raw !== "string") continue;
          const value = raw.trim();
          if (!value) continue;
          const tempId = state.valueToEntity[`${col.id}::${value}`];
          if (!tempId) continue; // value wasn't embedded — e.g. file changed since Stage 3 ran
          columnsWithValues.add(col.id);
          addSemanticEdge(groupTempIdFor(col.id), tempId, "contains_reference", node.datasetId);
          resolvedByColumn.push({ columnId: col.id, tempId });
        }
        for (let i = 0; i < resolvedByColumn.length; i++) {
          for (let j = i + 1; j < resolvedByColumn.length; j++) {
            if (resolvedByColumn[i].columnId === resolvedByColumn[j].columnId) continue;
            addEntityPairEdge(resolvedByColumn[i].tempId, resolvedByColumn[j].tempId, node.datasetId);
          }
        }
        for (const { idColumn, nameColumn } of suppressedIdPairs) {
          const rawId = row[idColumn.column_name];
          const rawName = row[nameColumn.column_name];
          if (typeof rawId !== "string" || typeof rawName !== "string") continue;
          const idValue = rawId.trim();
          const nameValue = rawName.trim();
          if (!idValue || !nameValue) continue;
          const nameTempId = state.valueToEntity[`${nameColumn.id}::${nameValue}`];
          if (!nameTempId) continue; // this row's Name value wasn't resolved to an entity
          idPropertyAliases.set(`${idColumn.id}::${idValue}`, {
            entityTempId: nameTempId,
            datasetId: node.datasetId,
            columnId: idColumn.id,
            entityValue: idValue,
          });
        }
      }
    } else {
      // Degraded fallback: profiled sample_values arrays are independent
      // per-column top-5 slices, not row-aligned, so only containment
      // (never co-occurrence) can be inferred from them.
      const columns = columnsByDataset.get(node.datasetId)!;
      for (const col of columns) {
        if (!embeddableColumns.find((c) => c.id === col.id)) continue;
        for (const v of col.sample_values ?? []) {
          if (typeof v !== "string") continue;
          const value = v.trim();
          if (!value) continue;
          const tempId = state.valueToEntity[`${col.id}::${value}`];
          if (!tempId) continue;
          columnsWithValues.add(col.id);
          addSemanticEdge(groupTempIdFor(col.id), tempId, "contains_reference", node.datasetId);
        }
      }
    }

    // Create the attribute_group node + its labeled dataset -> group edge,
    // but only for columns that actually produced at least one linked value.
    for (const col of embeddableColumns) {
      if (!columnsWithValues.has(col.id)) continue;
      const groupTempId = groupTempIdFor(col.id);
      groupEntities.push({
        tempId: groupTempId,
        entityType: "attribute_group",
        canonicalName: col.column_name,
        confidence: 1,
      });
      edgeMap.set(edgeKey(node.tempId, groupTempId, "contains_reference"), {
        fromTempId: node.tempId,
        toTempId: groupTempId,
        edgeType: "contains_reference",
        weight: 1,
        confidence: 0.9,
        evidenceDatasetId: node.datasetId,
        label: deriveEdgeLabel(col),
      });
    }
  }

  for (const edge of edgeMap.values()) {
    if (edge.edgeType === "contains_reference" && !edge.label) edge.confidence = 0.9;
    else if (edge.edgeType === "co_occurs_with") edge.confidence = Math.min(0.4 + edge.weight * 0.1, 0.95);
    // foreign_key and labeled dataset->group edges: confidence already set precisely above — leave as-is.
  }

  return {
    entities: [...(state.entities ?? []), ...groupEntities],
    aliases: [...(state.aliases ?? []), ...idPropertyAliases.values()],
    edges: Array.from(edgeMap.values()),
    warnings,
    stats: state.stats ? { ...state.stats, datasetsSkipped: skippedDatasets } : undefined,
  };
}
