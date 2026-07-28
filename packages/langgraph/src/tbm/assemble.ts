import {
  AtumEntityClassification,
  ContextEdgeRow,
  ContextEntityRow,
  Dataset,
  ReadinessScoreView,
} from "@tbm/db";
import { TAXONOMY_VERSION } from "../atum/importTaxonomy";
import { TbmCostFact, TbmDataModel, TbmObject, TbmRelationship, TbmSourceDataset } from "./state";

/** Readiness at or above this is considered safe to load into Apptio as-is. */
export const TBM_READY_THRESHOLD = 0.7;

// Graph node types that model *how the platform works*, not the enterprise:
// dataset nodes are lineage (exported separately as Source Datasets),
// attribute_group nodes are the per-column grouping layer Stage 4 inserts, and
// atum_category nodes are taxonomy entries, not business objects.
const NON_OBJECT_TYPES = new Set(["dataset", "attribute_group", "atum_category"]);

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(3));
}

/**
 * Pure assembly of the Apptio-ready model from Stage 4/5/6 outputs. Kept free
 * of database access so the shaping rules (which nodes become objects, which
 * edges survive, how ATUM layers collapse onto one object row) are directly
 * testable — see assemble.test.ts.
 */
export function assembleTbmModel(input: {
  nodes: (ContextEntityRow & { alias_count: number })[];
  edges: (ContextEdgeRow & { from_name: string; from_type: string; to_name: string; to_type: string })[];
  classifications: AtumEntityClassification[];
  datasets: Dataset[];
  readiness: ReadinessScoreView[];
  costFacts?: TbmCostFact[];
  generatedAt?: string;
}): TbmDataModel {
  const costFacts = input.costFacts ?? [];
  const datasetNameById = new Map(input.datasets.map((d) => [d.id, d.file_name]));
  const nodeTypeById = new Map(input.nodes.map((n) => [n.id, n.entity_type]));

  // Which datasets contributed evidence for each entity. Every edge Stage 4
  // wrote carries the dataset it was observed in, so this needs no extra query.
  const datasetsByEntity = new Map<string, Set<string>>();
  for (const edge of input.edges) {
    if (!edge.evidence_dataset_id) continue;
    const fileName = datasetNameById.get(edge.evidence_dataset_id);
    if (!fileName) continue;
    for (const id of [edge.from_entity_id, edge.to_entity_id]) {
      const set = datasetsByEntity.get(id) ?? new Set<string>();
      set.add(fileName);
      datasetsByEntity.set(id, set);
    }
  }

  // An entity can be classified once per ATUM layer (cost pool / tower /
  // solution). Highest-confidence mapping wins within a layer.
  const byEntity = new Map<string, Map<string, AtumEntityClassification>>();
  for (const c of input.classifications) {
    const layers = byEntity.get(c.context_entity_id) ?? new Map();
    const existing = layers.get(c.layer);
    if (!existing || Number(c.confidence) > Number(existing.confidence)) layers.set(c.layer, c);
    byEntity.set(c.context_entity_id, layers);
  }

  const objects: TbmObject[] = input.nodes
    .filter((node) => !NON_OBJECT_TYPES.has(node.entity_type))
    .map((node) => {
      const layers = byEntity.get(node.id);
      const costPool = layers?.get("cost_pool");
      const tower = layers?.get("resource_tower");
      const solution = layers?.get("solution");
      const confidences = [...(layers?.values() ?? [])].map((c) => Number(c.confidence));
      return {
        id: node.id,
        name: node.canonical_name,
        objectType: node.entity_type,
        resolutionConfidence: Number(node.resolution_confidence),
        aliasCount: node.alias_count,
        sourceDatasets: [...(datasetsByEntity.get(node.id) ?? [])].sort(),
        costPool: costPool?.level_1 ?? null,
        // Level 2 is the tower itself ("Compute", "Network"); level 1 is the
        // broader tier it sits in, used only when a mapping stopped at level 1.
        resourceTower: tower ? tower.level_2 ?? tower.level_1 : null,
        solution: solution ? solution.level_2 ?? solution.level_1 : null,
        atumPaths: Object.fromEntries(
          [...(layers?.entries() ?? [])].map(([layer, c]) => [layer, c.category_path])
        ),
        atumConfidence: confidences.length ? average(confidences) : null,
      };
    })
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));

  // Relationships worth preserving in Apptio: dataset<->dataset foreign keys
  // (financial lineage) and entity<->entity business links. contains_reference
  // and maps_to_atum are internal plumbing — the first is replaced by each
  // object's sourceDatasets, the second by its ATUM columns.
  const relationships: TbmRelationship[] = input.edges
    .filter(
      (edge) =>
        edge.edge_type !== "maps_to_atum" &&
        nodeTypeById.get(edge.from_entity_id) !== "attribute_group" &&
        nodeTypeById.get(edge.to_entity_id) !== "attribute_group"
    )
    .map((edge) => ({
      fromId: edge.from_entity_id,
      fromName: edge.from_name,
      fromType: edge.from_type,
      relationship: edge.label ?? edge.edge_type,
      toId: edge.to_entity_id,
      toName: edge.to_name,
      toType: edge.to_type,
      confidence: Number(edge.confidence),
      evidenceDataset: edge.evidence_dataset_id ? datasetNameById.get(edge.evidence_dataset_id) ?? null : null,
    }));

  const readinessByDataset = new Map(input.readiness.map((r) => [r.dataset_id, r]));
  const sourceDatasets: TbmSourceDataset[] = input.datasets.map((dataset) => {
    const score = readinessByDataset.get(dataset.id);
    const overall = score ? Number(score.overall_score) : null;
    return {
      datasetId: dataset.id,
      fileName: dataset.file_name,
      sourceType: dataset.source_type,
      rowCount: dataset.row_count,
      businessPurpose: dataset.business_purpose,
      readinessScore: overall,
      issueCount: score?.issue_count ?? null,
      criticalIssueCount: score?.critical_issue_count ?? null,
      tbmReady: overall !== null && overall >= TBM_READY_THRESHOLD,
    };
  });

  const classified = objects.filter((o) => o.atumConfidence !== null);
  const objectsByType: Record<string, number> = {};
  const objectsByTower: Record<string, number> = {};
  for (const object of objects) {
    objectsByType[object.objectType] = (objectsByType[object.objectType] ?? 0) + 1;
    if (object.resourceTower) objectsByTower[object.resourceTower] = (objectsByTower[object.resourceTower] ?? 0) + 1;
  }

  const costByPool: Record<string, number> = {};
  const costByTower: Record<string, number> = {};
  let totalCost = 0;
  for (const fact of costFacts) {
    totalCost += fact.amount;
    const pool = fact.costPool || "Unallocated";
    const tower = fact.resourceTower || "Unallocated";
    costByPool[pool] = Number(((costByPool[pool] ?? 0) + fact.amount).toFixed(2));
    costByTower[tower] = Number(((costByTower[tower] ?? 0) + fact.amount).toFixed(2));
  }

  const unclassified = objects.length - classified.length;
  const notReady = sourceDatasets.filter((d) => !d.tbmReady);
  const warnings: string[] = [];
  if (objects.length === 0) {
    warnings.push("No business objects in the context graph — rebuild the Enterprise Context Model (Stage 4) first.");
  }
  if (unclassified > 0) {
    warnings.push(
      `${unclassified} of ${objects.length} object(s) have no approved ATUM classification and will load into Apptio unallocated. Approve more Stage 6 mappings to close the gap.`
    );
  }
  if (notReady.length > 0) {
    warnings.push(
      `${notReady.length} source dataset(s) score below the ${TBM_READY_THRESHOLD} TBM-readiness threshold: ${notReady
        .slice(0, 5)
        .map((d) => d.fileName)
        .join(", ")}${notReady.length > 5 ? ", …" : ""}.`
    );
  }
  if (relationships.length === 0 && objects.length > 0) {
    warnings.push("No relationships were preserved — Apptio will not be able to allocate cost across these objects.");
  }
  if (costFacts.length === 0) {
    warnings.push("No cost facts were extracted — without amounts there is nothing for Apptio to allocate. Check that the source workbooks are readable from this machine.");
  } else if (costByTower.Unallocated) {
    const share = Math.round((costByTower.Unallocated / totalCost) * 100);
    warnings.push(`${share}% of total spend carries no resource tower and will land unallocated in Apptio.`);
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    taxonomyVersion: TAXONOMY_VERSION,
    summary: {
      objects: objects.length,
      classifiedObjects: classified.length,
      classificationCoverage: objects.length ? Number((classified.length / objects.length).toFixed(3)) : 0,
      relationships: relationships.length,
      sourceDatasets: sourceDatasets.length,
      tbmReadyDatasets: sourceDatasets.filter((d) => d.tbmReady).length,
      averageReadiness: average(sourceDatasets.flatMap((d) => (d.readinessScore === null ? [] : [d.readinessScore]))),
      averageMappingConfidence: average(classified.map((o) => o.atumConfidence!)),
      objectsByType,
      objectsByTower,
      totalCost: Number(totalCost.toFixed(2)),
      costFactRows: costFacts.length,
      costByPool,
      costByTower,
    },
    objects,
    relationships,
    costFacts,
    sourceDatasets,
    warnings,
  };
}
