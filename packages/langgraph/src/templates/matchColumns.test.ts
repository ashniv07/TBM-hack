import { describe, expect, it } from "vitest";
import { matchColumnsToTemplate } from "./matchColumns";
import { MASTER_TEMPLATES, findMasterTemplate } from "./masterTemplates";
import { MasterTemplate } from "./masterTemplates";

const template = (expectedColumns: string[]): MasterTemplate => ({
  masterType: "Storage", sourceWorkbook: "x.xlsx", expectedColumns, internalColumns: [],
});

describe("matchColumnsToTemplate", () => {
  it("reports the coverage figure the client asked for", () => {
    const r = matchColumnsToTemplate(
      ["Storage Device ID", "Total Space", "Vendor"],
      template(["Storage Device ID", "Total Space", "Used Space", "Vendor", "Location"])
    );
    expect(r.expectedCount).toBe(5);
    expect(r.matchedCount).toBe(3);
    expect(r.coverage).toBe(0.6);
    expect(r.missingColumns).toEqual(["Used Space", "Location"]);
  });

  it("assigns 1:1 — the client's Storage ID / Storage Identifier case", () => {
    // Both source columns resemble the single template column; only one may win,
    // or coverage would count the same requirement twice.
    const r = matchColumnsToTemplate(["Storage ID", "Storage Identifier"], template(["Storage ID"]));
    expect(r.matchedCount).toBe(1);
    expect(r.matches[0].sourceColumn).toBe("Storage ID");
    expect(r.matches[0].method).toBe("exact");
    expect(r.unmappedSourceColumns).toEqual(["Storage Identifier"]);
  });

  it("matches across naming conventions", () => {
    const r = matchColumnsToTemplate(
      ["storage_device_id", "COST CENTER NAME"],
      template(["Storage Device ID", "Cost Center Name"])
    );
    expect(r.matchedCount).toBe(2);
    expect(r.matches.every((m) => m.method === "normalized")).toBe(true);
  });

  it("does not match on one coincidental shared token", () => {
    const r = matchColumnsToTemplate(["Employee Name"], template(["Vendor Name"]));
    expect(r.matchedCount).toBe(0);
  });

  it("counts an empty source file as zero coverage, not a crash", () => {
    const r = matchColumnsToTemplate([], template(["A", "B"]));
    expect(r.coverage).toBe(0);
    expect(r.missingColumns).toEqual(["A", "B"]);
  });

  it("uses only business columns as the denominator", () => {
    // Vendors: 51 expected, 20 Apptio-internal. Counting the internal ones
    // would make full coverage impossible for any customer.
    const vendors = findMasterTemplate("Vendors")!;
    expect(vendors.expectedColumns.some((c) => /Metafield|Benchmark|_Key$/i.test(c))).toBe(false);
    expect(vendors.internalColumns.length).toBeGreaterThan(0);
  });

  it("ships a template for every master type", () => {
    expect(MASTER_TEMPLATES.length).toBe(18);
    expect(findMasterTemplate("chart of accounts")?.expectedColumns).toContain("Cost Pool");
    expect(findMasterTemplate("chart of accounts")?.expectedColumns).toContain("Cost Sub Pool");
  });
});
