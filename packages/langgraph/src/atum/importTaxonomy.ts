import ExcelJS from "exceljs";
import { AtumLayer, setAtumTaxonomyEmbedding, upsertAtumTaxonomyItem } from "@tbm/db";
import { embedTexts } from "../embedding/embedText";

export const TAXONOMY_VERSION = "5.0.1";

interface SheetSpec {
  sheet: string;
  layer: AtumLayer;
  level1: number; level1Description: number;
  level2: number; level2Description: number;
  level3?: number; level3Description?: number; examples?: number;
}

const SHEETS: SheetSpec[] = [
  { sheet: "Technology Cost Pools", layer: "cost_pool", level1: 2, level1Description: 3, level2: 4, level2Description: 6 },
  { sheet: "Technology Resource Towers", layer: "resource_tower", level1: 2, level1Description: 3, level2: 4, level2Description: 5, level3: 6, level3Description: 7 },
  { sheet: "Technology Solutions", layer: "solution", level1: 3, level1Description: 4, level2: 5, level2Description: 6, level3: 7, level3Description: 8, examples: 10 },
];

function text(row: ExcelJS.Row, index?: number): string {
  if (!index) return "";
  const value = row.getCell(index).text;
  return value?.trim() ?? "";
}

export async function importAtumTaxonomy(filePath: string): Promise<{
  imported: number; active: number; retired: number; embeddingSource: string;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const parsed: Parameters<typeof upsertAtumTaxonomyItem>[0][] = [];

  for (const spec of SHEETS) {
    const sheet = workbook.getWorksheet(spec.sheet);
    if (!sheet) throw new Error(`Taxonomy worksheet not found: ${spec.sheet}`);

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const level1 = text(row, spec.level1);
      const level2 = text(row, spec.level2);
      const level3 = text(row, spec.level3);
      if (!level1 || !level2) continue;

      const retired = text(row, 1).toLowerCase() === "yes";
      const parts = [level1, level2, level3].filter(Boolean);
      const descriptions = [text(row, spec.level1Description), text(row, spec.level2Description), text(row, spec.level3Description)];
      const examples = text(row, spec.examples);
      const searchText = [...parts, ...descriptions, examples].filter(Boolean).join(". ");
      parsed.push({
        taxonomyVersion: TAXONOMY_VERSION,
        layer: spec.layer,
        level1,
        level1Description: descriptions[0],
        level2,
        level2Description: descriptions[1],
        level3: level3 || undefined,
        level3Description: descriptions[2] || undefined,
        examples: examples || undefined,
        path: parts.join(" > "),
        searchText,
        isRetired: retired,
      });
    }
  }

  // A remote Postgres connection makes hundreds of sequential upserts very
  // slow. Use small concurrent chunks so we gain throughput without
  // exhausting the database pool.
  const imported: { id: string; searchText: string; retired: boolean }[] = [];
  for (let i = 0; i < parsed.length; i += 10) {
    const batch = parsed.slice(i, i + 10);
    const items = await Promise.all(batch.map((input) => upsertAtumTaxonomyItem(input)));
    items.forEach((item, index) => imported.push({
      id: item.id,
      searchText: batch[index].searchText,
      retired: batch[index].isRetired,
    }));
  }

  const active = imported.filter((item) => !item.retired);
  let embeddingSource = "none";
  for (let i = 0; i < active.length; i += 100) {
    const batch = active.slice(i, i + 100);
    const result = await embedTexts(batch.map((item) => item.searchText));
    embeddingSource = result.source;
    await Promise.all(batch.map((item, j) =>
      setAtumTaxonomyEmbedding(item.id, result.vectors[j], result.source)
    ));
  }

  return { imported: imported.length, active: active.length, retired: imported.length - active.length, embeddingSource };
}
