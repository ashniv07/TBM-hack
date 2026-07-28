import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_RELATIONSHIP_LABELS, deriveEdgeLabel, evaluateStructuralKeyCandidate } from "./buildEdges";
import { nameSimilarity } from "../shared/nameSimilarity";
import { DatasetColumn } from "@tbm/db";

function column(overrides: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: "col-1",
    dataset_id: "ds-1",
    column_name: "Column",
    ordinal: 0,
    inferred_type: "string",
    null_pct: 0,
    distinct_count: null,
    sample_values: [],
    is_candidate_key: false,
    is_technical: false,
    semantic_role: null,
    semantic_role_confidence: null,
    ...overrides,
  };
}

describe("evaluateStructuralKeyCandidate (foreign-key discovery)", () => {
  it("reproduces the real Storage Device ID <-> Storage_Devices_Master_Data scenario (23/23 match)", () => {
    // Storage_Master_Data: 52,838 rows, 23 distinct Storage Device ID values (repeating "many" side).
    // Storage_Devices_Master_Data: 26 rows, 26 distinct Storage Device ID values (unique "one" side).
    // All 23 master-side values are present in the 26 device-side values -> overlap ratio 1.
    const result = evaluateStructuralKeyCandidate({
      overlapRatio: 1,
      uniquenessA: 23 / 52838, // Storage_Master_Data side
      uniquenessB: 26 / 26, // Storage_Devices_Master_Data side
      nameSim: 1, // identical column name
      datatypeMatch: 1,
    });
    expect(result.isMatch).toBe(true);
    expect(result.pkIsA).toBe(false); // PK ("one" / unique) side is B, not A
    expect(result.confidence).toBeCloseTo(0.98, 2); // clamped at the 0.98 ceiling
  });

  it("rejects a pair with no plausible column-name match", () => {
    const result = evaluateStructuralKeyCandidate({
      overlapRatio: 0.9,
      uniquenessA: 0.1,
      uniquenessB: 0.99,
      nameSim: 0,
      datatypeMatch: 1,
    });
    expect(result.isMatch).toBe(false);
  });

  it("rejects a pair below the 60% overlap threshold", () => {
    const result = evaluateStructuralKeyCandidate({
      overlapRatio: 0.4,
      uniquenessA: 0.1,
      uniquenessB: 0.99,
      nameSim: 1,
      datatypeMatch: 1,
    });
    expect(result.isMatch).toBe(false);
  });

  it("rejects a pair where neither side is at least 90% unique (no real key side)", () => {
    const result = evaluateStructuralKeyCandidate({
      overlapRatio: 0.8,
      uniquenessA: 0.5,
      uniquenessB: 0.6,
      nameSim: 1,
      datatypeMatch: 1,
    });
    expect(result.isMatch).toBe(false);
  });
});

describe("nameSimilarity", () => {
  it("scores identical (normalized) names as 1", () => {
    expect(nameSimilarity("Storage Device ID", "storage_device_id")).toBe(1);
  });

  it("scores containment as 0.65", () => {
    expect(nameSimilarity("Storage Device ID", "Device ID")).toBe(0.65);
  });

  it("scores unrelated names as 0", () => {
    expect(nameSimilarity("Storage Device ID", "Cost Center")).toBe(0);
  });
});

describe("deriveEdgeLabel", () => {
  it("prefers a column-name hint over the generic role label", () => {
    expect(deriveEdgeLabel(column({ column_name: "Manufacturer", semantic_role: "vendor" }))).toBe("HAS_MANUFACTURER");
  });

  it("falls back to the role-based label when no column-name hint matches", () => {
    expect(deriveEdgeLabel(column({ column_name: "Vendor Name", semantic_role: "vendor" }))).toBe("HAS_VENDOR");
    expect(deriveEdgeLabel(column({ column_name: "Cost Center Name", semantic_role: "cost_center" }))).toBe(
      "HAS_COST_CENTER"
    );
  });
});

describe("ENTITY_TYPE_RELATIONSHIP_LABELS (business relationships)", () => {
  it("labels Cost Center/Department -> Vendor as USES_VENDOR", () => {
    expect(ENTITY_TYPE_RELATIONSHIP_LABELS.cost_center.vendor).toBe("USES_VENDOR");
    expect(ENTITY_TYPE_RELATIONSHIP_LABELS.department.vendor).toBe("USES_VENDOR");
  });

  it("labels Project -> Vendor as CONTRACTED_WITH", () => {
    expect(ENTITY_TYPE_RELATIONSHIP_LABELS.project.vendor).toBe("CONTRACTED_WITH");
  });

  it("labels Application -> Cloud Provider as HOSTED_BY", () => {
    expect(ENTITY_TYPE_RELATIONSHIP_LABELS.application.cloud_provider).toBe("HOSTED_BY");
  });

  it("labels Infrastructure Asset -> Vendor as MANUFACTURED_BY", () => {
    expect(ENTITY_TYPE_RELATIONSHIP_LABELS.infrastructure_asset.vendor).toBe("MANUFACTURED_BY");
  });
});
