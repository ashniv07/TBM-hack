import { describe, expect, it } from "vitest";
import { DatasetColumn, EMBEDDABLE_ROLES } from "@tbm/db";
import { displayPriority } from "./extractContext";

function column(overrides: Partial<DatasetColumn>): DatasetColumn {
  return {
    id: "c1", dataset_id: "d1", column_name: "col", ordinal: 1, inferred_type: "string",
    null_pct: 0, distinct_count: 10, sample_values: [], is_candidate_key: false,
    is_technical: false, semantic_role: null, semantic_role_confidence: null, ...overrides,
  };
}

describe("ATUM anchor column selection (Stage 6 -> Stage 4 join key)", () => {
  it("ranks every embeddable role as anchorable", () => {
    // A role in EMBEDDABLE_ROLES but missing from ANCHOR_ROLE_ORDER would get
    // no alias join, so its approved mappings would silently never reach the graph.
    for (const role of EMBEDDABLE_ROLES) {
      expect(displayPriority(column({ semantic_role: role }))).toBeLessThan(100);
    }
  });

  it("prefers an embeddable-role column over a free-text hint column", () => {
    // The exact regression: a column *named* "Service Description" with a
    // free-text role must not outrank a real vendor-role column.
    const freeText = column({ column_name: "Service Description", semantic_role: "description" });
    const vendor = column({ column_name: "Supplier", semantic_role: "vendor" });
    expect(displayPriority(vendor)).toBeLessThan(displayPriority(freeText));
  });

  it("never lets an unembedded role anchor, whatever the column is called", () => {
    for (const role of ["description", "person", "identifier", "cost_amount", null]) {
      expect(displayPriority(column({ column_name: "Application Resource", semantic_role: role }))).toBe(100);
    }
  });
});
