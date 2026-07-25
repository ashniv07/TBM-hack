import { describe, expect, it } from "vitest";
import { partitionPairedIdColumns } from "./pairedIdColumns";
import { DatasetColumn } from "@tbm/db";

function column(overrides: Partial<DatasetColumn>): DatasetColumn {
  return {
    id: overrides.column_name ?? "col",
    dataset_id: "ds-1",
    ordinal: 0,
    inferred_type: "string",
    null_pct: 0,
    distinct_count: null,
    sample_values: [],
    is_candidate_key: false,
    is_technical: false,
    semantic_role: null,
    semantic_role_confidence: null,
    column_name: "Column",
    ...overrides,
  };
}

describe("partitionPairedIdColumns", () => {
  it("suppresses Vendor ID when Vendor Name exists in the same dataset", () => {
    const vendorName = column({ column_name: "Vendor Name", semantic_role: "vendor" });
    const vendorId = column({ column_name: "Vendor ID", semantic_role: "vendor" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([vendorName, vendorId]);

    expect(embeddable.map((c) => c.column_name)).toEqual(["Vendor Name"]);
    expect(suppressedIdPairs).toHaveLength(1);
    expect(suppressedIdPairs[0].idColumn.column_name).toBe("Vendor ID");
    expect(suppressedIdPairs[0].nameColumn.column_name).toBe("Vendor Name");
  });

  it("applies the same rule to application/project/business_unit/department/cost_center", () => {
    const cases: [string, string, string][] = [
      ["Application Name", "Application ID", "application"],
      ["Project Name", "Project ID", "project"],
      ["Business Unit", "Business Unit ID", "business_unit"],
      ["Department Name", "Department ID", "department"],
      ["Cost Center Name", "Cost Center ID", "cost_center"],
    ];
    for (const [nameCol, idCol, role] of cases) {
      const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([
        column({ column_name: nameCol, semantic_role: role }),
        column({ column_name: idCol, semantic_role: role }),
      ]);
      expect(embeddable.map((c) => c.column_name)).toEqual([nameCol]);
      expect(suppressedIdPairs).toHaveLength(1);
    }
  });

  it("does NOT suppress Storage Device ID / Server ID / Asset ID (infrastructure_asset role has no name sibling to prefer)", () => {
    const storageDeviceId = column({ column_name: "Storage Device ID", semantic_role: "infrastructure_asset" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([storageDeviceId]);
    expect(embeddable).toHaveLength(1);
    expect(suppressedIdPairs).toHaveLength(0);
  });

  it("leaves the ID column embeddable when there is no Name-style sibling (ID-only dataset)", () => {
    const vendorId = column({ column_name: "Vendor ID", semantic_role: "vendor" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([vendorId]);
    expect(embeddable).toHaveLength(1);
    expect(suppressedIdPairs).toHaveLength(0);
  });

  it("leaves everything embeddable when there are multiple ambiguous Name-style columns", () => {
    const nameA = column({ column_name: "Vendor Name", semantic_role: "vendor" });
    const nameB = column({ column_name: "Legacy Vendor Name", semantic_role: "vendor" });
    const vendorId = column({ column_name: "Vendor ID", semantic_role: "vendor" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([nameA, nameB, vendorId]);
    expect(embeddable).toHaveLength(3);
    expect(suppressedIdPairs).toHaveLength(0);
  });

  it("does not falsely treat words ending in -id (e.g. 'Rapid') as ID-style columns", () => {
    const vendorName = column({ column_name: "Vendor Name", semantic_role: "vendor" });
    const weird = column({ column_name: "Rapid", semantic_role: "vendor" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([vendorName, weird]);
    expect(embeddable).toHaveLength(2); // both stay, since neither un-ambiguously reads as "the ID column"
    expect(suppressedIdPairs).toHaveLength(0);
  });

  it("recognizes camelCase ID suffixes (e.g. VendorID) as ID-style", () => {
    const vendorName = column({ column_name: "Vendor", semantic_role: "vendor" });
    const vendorId = column({ column_name: "VendorID", semantic_role: "vendor" });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([vendorName, vendorId]);
    expect(embeddable.map((c) => c.column_name)).toEqual(["Vendor"]);
    expect(suppressedIdPairs).toHaveLength(1);
  });

  it("uses value shape to catch a code column with no ID suffix (e.g. 'Cost Center' holding codes like CC-210)", () => {
    // Regression: neither "Cost Center" nor "Cost Center Name" ends in "ID",
    // so the name-suffix heuristic alone left both as ambiguous "name-like"
    // columns, and CC-210/CC-320/etc. kept showing up as separate cost_center
    // nodes alongside the real names ("Apps - Mfg & Dist").
    const costCenterCode = column({
      column_name: "Cost Center",
      semantic_role: "cost_center",
      sample_values: ["CC-200", "CC-210", "CC-220", "CC-320", "CC-330"],
    });
    const costCenterName = column({
      column_name: "Cost Center Name",
      semantic_role: "cost_center",
      sample_values: ["Apps - Back Office", "Apps - Mfg & Dist", "Data Center Ops", "Network Services", "Service Desk"],
    });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([costCenterCode, costCenterName]);

    expect(embeddable.map((c) => c.column_name)).toEqual(["Cost Center Name"]);
    expect(suppressedIdPairs).toHaveLength(1);
    expect(suppressedIdPairs[0].idColumn.column_name).toBe("Cost Center");
    expect(suppressedIdPairs[0].nameColumn.column_name).toBe("Cost Center Name");
  });

  it("value-shape fallback is order-independent", () => {
    const costCenterName = column({
      column_name: "Cost Center Name",
      semantic_role: "cost_center",
      sample_values: ["Apps - Back Office", "Apps - Mfg & Dist"],
    });
    const costCenterCode = column({
      column_name: "Cost Center",
      semantic_role: "cost_center",
      sample_values: ["CC-200", "CC-210"],
    });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([costCenterName, costCenterCode]);
    expect(embeddable.map((c) => c.column_name)).toEqual(["Cost Center Name"]);
    expect(suppressedIdPairs).toHaveLength(1);
  });

  it("does not suppress either column when neither's values clearly look like codes", () => {
    const a = column({ column_name: "Cost Center", semantic_role: "cost_center", sample_values: ["Field Support", "Data Center Ops"] });
    const b = column({ column_name: "Cost Center Name", semantic_role: "cost_center", sample_values: ["Apps - Back Office", "Network Services"] });
    const { embeddable, suppressedIdPairs } = partitionPairedIdColumns([a, b]);
    expect(embeddable).toHaveLength(2);
    expect(suppressedIdPairs).toHaveLength(0);
  });
});
