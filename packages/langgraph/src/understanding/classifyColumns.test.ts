import { describe, expect, it } from "vitest";
import { applyDeterministicRoleOverrides } from "./classifyColumns";
import { ColumnClassification } from "./state";

function classification(columnName: string, semanticRole: string, isTechnical = false): ColumnClassification {
  return { columnId: columnName, columnName, semanticRole: semanticRole as any, semanticRoleConfidence: 0.5, isTechnical };
}

describe("applyDeterministicRoleOverrides", () => {
  it("forces Vendor Name to role vendor even if the LLM guessed otherwise", () => {
    const input = [classification("Vendor Name", "other")];
    const [result] = applyDeterministicRoleOverrides(input);
    expect(result.semanticRole).toBe("vendor");
    expect(result.isTechnical).toBe(false);
  });

  it("forces Manufacturer to role vendor (observed live misclassification as 'description')", () => {
    const input = [classification("Manufacturer", "description")];
    const [result] = applyDeterministicRoleOverrides(input);
    expect(result.semanticRole).toBe("vendor");
  });

  it("recognizes vendor/supplier name variants regardless of spacing or casing", () => {
    for (const name of ["VendorName", "vendor_name", "Supplier Name", "SUPPLIER ID"]) {
      const [result] = applyDeterministicRoleOverrides([classification(name, "other")]);
      expect(result.semanticRole).toBe("vendor");
    }
  });

  it("forces owner/manager/contact/created-by/updated-by columns to role person, never a business role", () => {
    for (const name of ["Owner", "Cost Center Owner", "Manager", "Contact", "Created By", "Updated By"]) {
      const [result] = applyDeterministicRoleOverrides([classification(name, "business_unit")]);
      expect(result.semanticRole).toBe("person");
    }
  });

  it("forces transactional identifier columns to role identifier + is_technical=true", () => {
    for (const name of ["Journal ID", "Voucher ID", "Invoice Number", "PO Number"]) {
      const [result] = applyDeterministicRoleOverrides([classification(name, "other", false)]);
      expect(result.semanticRole).toBe("identifier");
      expect(result.isTechnical).toBe(true);
    }
  });

  it("classifies Cost Center / Business Unit / Department / Application / Cloud Provider / Storage Device ID / Project columns deterministically", () => {
    const cases: [string, string][] = [
      ["Cost Center Name", "cost_center"],
      ["Business Unit", "business_unit"],
      ["BU Name", "business_unit"],
      ["Department Description", "department"],
      ["Application Name", "application"],
      ["App Consumer", "application"],
      ["Cloud Provider", "cloud_provider"],
      ["CSP", "cloud_provider"],
      ["Storage Device ID", "infrastructure_asset"],
      ["Server ID", "infrastructure_asset"],
      ["Project Name", "project"],
      ["Project ID", "project"],
    ];
    for (const [name, expectedRole] of cases) {
      const [result] = applyDeterministicRoleOverrides([classification(name, "other")]);
      expect(result.semanticRole).toBe(expectedRole);
    }
  });

  it("leaves columns with no deterministic rule untouched", () => {
    const input = [classification("Random Free Text Column", "description", false)];
    const [result] = applyDeterministicRoleOverrides(input);
    expect(result.semanticRole).toBe("description");
  });

  it("does not confuse a substring match (e.g. 'Vendor Contact Email' is not forced to vendor)", () => {
    const [result] = applyDeterministicRoleOverrides([classification("Vendor Contact Email", "other")]);
    expect(result.semanticRole).not.toBe("vendor");
  });

  it("forces a derived/concatenated column (e.g. 'Cost Center + Name') to role description, never cost_center", () => {
    // Regression: normalizing away "+" previously collapsed "Cost Center + Name"
    // onto the same key as "Cost Center Name", forcing it to role cost_center
    // and duplicating every real cost center under a second, differently
    // formatted node (e.g. "Apps - Mfg & Dist" + "Apps - Mfg & Dist (CC-210)").
    for (const name of ["Cost Center + Name", "Vendor + Name", "Department + Code"]) {
      const [result] = applyDeterministicRoleOverrides([classification(name, "cost_center")]);
      expect(result.semanticRole).toBe("description");
    }
  });

  it("does not let a concatenated column collide with its plain Name sibling", () => {
    const [plain] = applyDeterministicRoleOverrides([classification("Cost Center Name", "other")]);
    const [concatenated] = applyDeterministicRoleOverrides([classification("Cost Center + Name", "other")]);
    expect(plain.semanticRole).toBe("cost_center");
    expect(concatenated.semanticRole).toBe("description");
  });
});
