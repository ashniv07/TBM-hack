import { describe, expect, it } from "vitest";
import { applyDeterministicRoleOverrides, isTemplateScaffolding } from "./classifyColumns";

// The sample workbooks are Apptio templates: ~24% of their columns are
// scaffolding, not business data. Real client extracts will not match the
// template exactly, so this must be a filter that ignores what it recognises —
// never a schema that assumes columns are present.
describe("isTemplateScaffolding", () => {
  it("catches the join keys the heuristic pattern missed (space, not underscore)", () => {
    for (const c of ["Server_App Key", "App_Service Key", "ITRT_Application Key", "Cost Source_Labor Key"]) {
      expect(isTemplateScaffolding(c), c).toBe(true);
    }
  });

  it("catches metafields, benchmarks, QA helpers, lookups and duplicate counters", () => {
    for (const c of [
      "UID Metafield", "OID Metafield", "Vendor_ITRT Key Metafield",
      "Benchmark Amount", "Benchmark Cost Pool", "Benchmark Sub-Tower",
      "Validity_Cost Center", "Completeness_Total",
      "Instance Type Lookup", "Service Name Lookup",
      "Data Dimensions_Duplicate Count", "Source Table",
    ]) {
      expect(isTemplateScaffolding(c), c).toBe(true);
    }
  });

  it("leaves real business columns alone", () => {
    for (const c of [
      "Amount", "Cost Pool", "Cost Sub Pool", "IT Resource Tower", "IT Resource Sub-Tower",
      "Cost Center", "Cost Center Name", "Vendor Name", "Application Name", "Project Name",
      "Account", "Account Description", "Expense Type", "Depreciation Amount", "Annual Target Spend",
    ]) {
      expect(isTemplateScaffolding(c), c).toBe(false);
    }
  });

  it("forces scaffolding technical regardless of what the classifier decided", () => {
    // The LLM classified these as business roles on a real run; the override
    // must win, or they re-enter canonical schemas and the knowledge graph.
    const [key, benchmark, vendor] = applyDeterministicRoleOverrides([
      { columnId: "1", columnName: "Server_App Key", semanticRole: "application", semanticRoleConfidence: 0.8, isTechnical: false },
      { columnId: "2", columnName: "Benchmark Cost Pool", semanticRole: "cost_center", semanticRoleConfidence: 0.9, isTechnical: false },
      { columnId: "3", columnName: "Vendor Name", semanticRole: "description", semanticRoleConfidence: 0.6, isTechnical: false },
    ]);
    expect(key.isTechnical).toBe(true);
    expect(benchmark.isTechnical).toBe(true);
    // ...while the existing vendor override still applies to real columns.
    expect(vendor.isTechnical).toBe(false);
    expect(vendor.semanticRole).toBe("vendor");
  });
});
