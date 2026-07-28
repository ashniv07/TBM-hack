import { describe, expect, it } from "vitest";
import { AtumEntityClassification, ContextEdgeRow, ContextEntityRow, Dataset, ReadinessScoreView } from "@tbm/db";
import { assembleTbmModel, TBM_READY_THRESHOLD } from "./assemble";

function node(over: Partial<ContextEntityRow & { alias_count: number }>) {
  return {
    id: "n1", entity_type: "vendor", canonical_name: "EMC", source_dataset_id: null,
    resolution_confidence: 1, created_at: "", updated_at: "", alias_count: 2, ...over,
  } as ContextEntityRow & { alias_count: number };
}

function edge(over: Partial<ContextEdgeRow & { from_name: string; from_type: string; to_name: string; to_type: string }>) {
  return {
    id: "e1", from_entity_id: "n1", to_entity_id: "n2", edge_type: "co_occurs_with", weight: 1,
    confidence: 0.8, evidence_dataset_id: "d1", label: null, created_at: "", updated_at: "",
    from_name: "EMC", from_type: "vendor", to_name: "CC-210", to_type: "cost_center", ...over,
  } as ContextEdgeRow & { from_name: string; from_type: string; to_name: string; to_type: string };
}

function classification(over: Partial<AtumEntityClassification>) {
  return {
    mapping_id: "m1", context_entity_id: "n1", category_path: "Infrastructure > Storage > SAN",
    confidence: 0.9, layer: "resource_tower", status: "approved", method: "hybrid",
    source_value: "EMC", level_1: "Infrastructure", level_2: "Storage", level_3: "SAN",
    dataset_file_name: "Storage_Devices_Master_Data.xlsx", ...over,
  } as AtumEntityClassification;
}

const dataset = { id: "d1", file_name: "Storage_Devices_Master_Data.xlsx", source_type: "CMDB", row_count: 23, business_purpose: null } as Dataset;

function readiness(score: number) {
  return { dataset_id: "d1", overall_score: score, issue_count: 3, critical_issue_count: 0 } as ReadinessScoreView;
}

describe("assembleTbmModel", () => {
  it("excludes platform-internal node types from the object tables", () => {
    const model = assembleTbmModel({
      nodes: [
        node({ id: "n1" }),
        node({ id: "d-node", entity_type: "dataset", canonical_name: "Storage_Devices_Master_Data.xlsx" }),
        node({ id: "g1", entity_type: "attribute_group", canonical_name: "Manufacturer" }),
        node({ id: "a1", entity_type: "atum_category", canonical_name: "Infrastructure > Storage" }),
      ],
      edges: [], classifications: [], datasets: [dataset], readiness: [],
    });
    expect(model.objects.map((o) => o.id)).toEqual(["n1"]);
  });

  it("collapses one classification per ATUM layer onto a single object row", () => {
    const model = assembleTbmModel({
      nodes: [node({ id: "n1" })],
      edges: [],
      classifications: [
        classification({}),
        classification({ mapping_id: "m2", layer: "cost_pool", level_1: "Outside Services", level_2: null, confidence: 0.7, category_path: "Outside Services" }),
      ],
      datasets: [dataset], readiness: [],
    });
    const [object] = model.objects;
    expect(object.resourceTower).toBe("Storage");
    expect(object.costPool).toBe("Outside Services");
    expect(object.solution).toBeNull();
    expect(object.atumConfidence).toBe(0.8); // mean of the two layers
  });

  it("keeps the highest-confidence mapping when a layer has competing ones", () => {
    const model = assembleTbmModel({
      nodes: [node({ id: "n1" })],
      edges: [],
      classifications: [
        classification({ confidence: 0.5, level_2: "Network" }),
        classification({ mapping_id: "m2", confidence: 0.95, level_2: "Storage" }),
      ],
      datasets: [dataset], readiness: [],
    });
    expect(model.objects[0].resourceTower).toBe("Storage");
  });

  it("drops plumbing edges but keeps business and lineage relationships", () => {
    const model = assembleTbmModel({
      nodes: [node({ id: "n1" }), node({ id: "n2", entity_type: "cost_center", canonical_name: "CC-210" }), node({ id: "g1", entity_type: "attribute_group" })],
      edges: [
        edge({ label: "USES_VENDOR" }),
        edge({ id: "e2", from_entity_id: "g1", to_entity_id: "n1", edge_type: "contains_reference", from_type: "attribute_group" }),
        edge({ id: "e3", edge_type: "maps_to_atum" }),
      ],
      classifications: [], datasets: [dataset], readiness: [],
    });
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0].relationship).toBe("USES_VENDOR");
    expect(model.relationships[0].evidenceDataset).toBe("Storage_Devices_Master_Data.xlsx");
  });

  it("flags datasets below the readiness threshold and objects with no classification", () => {
    const model = assembleTbmModel({
      nodes: [node({ id: "n1" })],
      edges: [],
      classifications: [],
      datasets: [dataset],
      readiness: [readiness(TBM_READY_THRESHOLD - 0.1)],
    });
    expect(model.summary.tbmReadyDatasets).toBe(0);
    expect(model.summary.classificationCoverage).toBe(0);
    expect(model.warnings.some((w) => w.includes("no approved ATUM classification"))).toBe(true);
    expect(model.warnings.some((w) => w.includes("TBM-readiness threshold"))).toBe(true);
  });

  it("derives each object's source datasets from the edges that evidenced it", () => {
    const model = assembleTbmModel({
      nodes: [node({ id: "n1" }), node({ id: "n2", entity_type: "cost_center" })],
      edges: [edge({})],
      classifications: [], datasets: [dataset], readiness: [readiness(0.9)],
    });
    expect(model.objects.find((o) => o.id === "n1")!.sourceDatasets).toEqual(["Storage_Devices_Master_Data.xlsx"]);
    expect(model.summary.tbmReadyDatasets).toBe(1);
  });
});
