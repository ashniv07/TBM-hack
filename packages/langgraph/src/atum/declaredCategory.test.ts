import { describe, expect, it } from "vitest";
import { AtumTaxonomyItem, DatasetColumn } from "@tbm/db";
import { buildDeclaredCategoryIndex, findDeclaredColumn, normalizeTaxonomyKey } from "./declaredCategory";

function item(level_1: string, level_2: string | null, level_3: string | null): AtumTaxonomyItem {
  return {
    id: [level_1, level_2, level_3].filter(Boolean).join("|"),
    path: [level_1, level_2, level_3].filter(Boolean).join(" > "),
    level_1, level_2, level_3, layer: "resource_tower", taxonomy_version: "5.0.1",
    level_1_description: null, level_2_description: null, level_3_description: null,
    examples: null, search_text: "", is_retired: false, embedding_source: null,
  };
}

function column(name: string): DatasetColumn {
  return { column_name: name } as DatasetColumn;
}

// Shape taken from the real taxonomy: Domain > Tower > Sub-Tower.
const TAXONOMY = [
  item("Infrastructure", "Compute", null),
  item("Infrastructure", "Compute", "Servers"),
  item("Infrastructure", "Network", "LAN"),
  item("Infrastructure", "Storage", null),
  item("Application", "Application", "Application Development"),
];

describe("findDeclaredColumn", () => {
  it("prefers the more specific sub-tower column over the tower column", () => {
    const columns = [column("IT Resource Tower"), column("IT Resource Sub-Tower")];
    expect(findDeclaredColumn(columns, "resource_tower")?.column_name).toBe("IT Resource Sub-Tower");
  });

  it("finds Cost Pool, which carries no hint keyword and is dropped by isUsefulColumn", () => {
    expect(findDeclaredColumn([column("Cost Pool")], "cost_pool")?.column_name).toBe("Cost Pool");
    expect(findDeclaredColumn([column("Cost Sub Pool")], "cost_pool")?.column_name).toBe("Cost Sub Pool");
  });

  it("returns null when the dataset declares nothing, so retrieval still runs", () => {
    expect(findDeclaredColumn([column("Vendor Name"), column("Amount")], "resource_tower")).toBeNull();
    expect(findDeclaredColumn([column("IT Resource Tower")], "solution")).toBeNull();
  });
});

describe("buildDeclaredCategoryIndex", () => {
  const index = buildDeclaredCategoryIndex(TAXONOMY);

  it("resolves a declared value regardless of the level it was written at", () => {
    expect(index.get(normalizeTaxonomyKey("Servers"))?.path).toBe("Infrastructure > Compute > Servers");
    expect(index.get(normalizeTaxonomyKey("Storage"))?.path).toBe("Infrastructure > Storage");
    expect(index.get(normalizeTaxonomyKey("Infrastructure"))?.level_1).toBe("Infrastructure");
  });

  it("maps a declared tower to the tower, not to one of its children", () => {
    // "Compute" exists both as a bare tower and as the parent of "Servers".
    expect(index.get(normalizeTaxonomyKey("Compute"))?.path).toBe("Infrastructure > Compute");
  });

  it("normalizes punctuation and case, which is what makes the real values match", () => {
    expect(normalizeTaxonomyKey("LAN/WAN")).toBe("lanwan");
    expect(index.get(normalizeTaxonomyKey("application development"))?.level_3).toBe("Application Development");
    expect(index.get(normalizeTaxonomyKey("Application-Development"))?.level_3).toBe("Application Development");
  });

  it("misses unknown values so they fall through to the retrieval path", () => {
    // "Other" appears 4x in the sample data and is genuinely not in ATUM.
    expect(index.get(normalizeTaxonomyKey("Other"))).toBeUndefined();
    expect(index.get(normalizeTaxonomyKey("Platform"))).toBeUndefined();
  });
});
