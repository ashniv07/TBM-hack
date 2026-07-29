import { DatasetColumn, getDatasetColumns, saveTemplateMapping } from "@tbm/db";
import { embedTexts } from "../embedding/embedText";
import { toUnitVector, unitCosineDistance } from "../context/clustering";
import { MasterTemplate, findMasterTemplate } from "./masterTemplates";
import { ColumnMatch, matchColumnsToTemplate } from "./matchColumns";
import { inferMasterType } from "./inferMasterType";

/**
 * Maps a source dataset's columns onto its Apptio master template and records
 * the gap.
 *
 * Two passes, in order of decreasing certainty — the same shape Stage 4 uses:
 *
 * 1. Deterministic string matching (matchColumns.ts). Exact, normalized,
 *    token-subset and abbreviation-aware. Cheap and explainable.
 * 2. Embeddings, but ONLY over what pass 1 left unmatched. On the AWS sample
 *    that is 20 source x 69 template columns rather than 36 x 85, so it is one
 *    small embedding call rather than a full cross-product. `ProductCode ->
 *    ProductCode` does not need a vector; `AvailabilityZone -> Provider Region`
 *    does.
 *
 * Column names alone are a weak signal, so the embedded text carries sample
 * values too: "eu-west-1, us-east-1" identifies a region far more clearly than
 * the word "AvailabilityZone".
 */

// Cosine distance below which an embedding match is accepted. Deliberately
// tight: a wrong mapping silently corrupts every downstream stage, whereas a
// missed one shows up honestly in the coverage gap.
const EMBEDDING_MAX_DISTANCE = 0.28;

function describeColumn(column: DatasetColumn): string {
  const samples = (column.sample_values ?? [])
    .filter((v) => v !== null && v !== undefined && String(v).trim())
    .slice(0, 4)
    .map((v) => String(v).slice(0, 40));
  return samples.length ? `${column.column_name}. Example values: ${samples.join(", ")}` : column.column_name;
}

export interface TemplateMappingResult {
  datasetId: string;
  masterType: string | null;
  expectedCount: number;
  matchedCount: number;
  coverage: number;
  matches: ColumnMatch[];
  missingColumns: string[];
  unmappedSourceColumns: string[];
  embeddingMatches: number;
  embeddingSource: string;
}

export async function mapDatasetToTemplate(
  datasetId: string,
  options?: { masterType?: string; useEmbeddings?: boolean }
): Promise<TemplateMappingResult> {
  const columns = await getDatasetColumns(datasetId);
  const columnNames = columns.map((c) => c.column_name);

  // An explicit master type wins; otherwise work it out from the columns,
  // because customers do not label their exports.
  const template: MasterTemplate | undefined = options?.masterType
    ? findMasterTemplate(options.masterType)
    : inferMasterType(columnNames)?.template;

  if (!template) {
    await saveTemplateMapping({
      datasetId, masterType: null, expectedCount: 0, matchedCount: 0, coverage: 0,
      mappings: columnNames.map((c) => ({ sourceColumn: c, templateColumn: null, confidence: 0, method: "unmatched" })),
      missingColumns: [],
    });
    return {
      datasetId, masterType: null, expectedCount: 0, matchedCount: 0, coverage: 0,
      matches: [], missingColumns: [], unmappedSourceColumns: columnNames,
      embeddingMatches: 0, embeddingSource: "none",
    };
  }

  const result = matchColumnsToTemplate(columnNames, template);
  const matches = [...result.matches];
  let embeddingMatches = 0;
  let embeddingSource = "none";

  // ---- Pass 2: embeddings over the residue only ----
  const leftoverSource = result.unmappedSourceColumns;
  const leftoverTemplate = result.missingColumns;
  if (options?.useEmbeddings !== false && leftoverSource.length && leftoverTemplate.length) {
    const columnByName = new Map(columns.map((c) => [c.column_name, c]));
    const sourceTexts = leftoverSource.map((name) => {
      const column = columnByName.get(name);
      return column ? describeColumn(column) : name;
    });

    const embedded = await embedTexts([...sourceTexts, ...leftoverTemplate]);
    embeddingSource = embedded.source;
    // The hash fallback carries no semantic meaning, so a "match" from it would
    // be noise dressed up as a mapping.
    if (embedded.source !== "hash_fallback") {
      const sourceVectors = leftoverSource.map((_, i) => toUnitVector(embedded.vectors[i]));
      const templateVectors = leftoverTemplate.map((_, i) => toUnitVector(embedded.vectors[leftoverSource.length + i]));

      const candidates: { s: number; t: number; distance: number }[] = [];
      for (let s = 0; s < leftoverSource.length; s++) {
        for (let t = 0; t < leftoverTemplate.length; t++) {
          const distance = unitCosineDistance(sourceVectors[s], templateVectors[t]);
          if (distance < EMBEDDING_MAX_DISTANCE) candidates.push({ s, t, distance });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);

      const usedSource = new Set<number>();
      const usedTemplate = new Set<number>();
      for (const c of candidates) {
        if (usedSource.has(c.s) || usedTemplate.has(c.t)) continue;
        usedSource.add(c.s);
        usedTemplate.add(c.t);
        matches.push({
          sourceColumn: leftoverSource[c.s],
          templateColumn: leftoverTemplate[c.t],
          confidence: Number((1 - c.distance).toFixed(3)),
          method: "embedding" as ColumnMatch["method"],
        });
        embeddingMatches++;
      }
    }
  }

  const matchedSource = new Set(matches.map((m) => m.sourceColumn));
  const matchedTemplate = new Set(matches.map((m) => m.templateColumn));
  const missingColumns = template.expectedColumns.filter((c) => !matchedTemplate.has(c));
  const unmappedSourceColumns = columnNames.filter((c) => !matchedSource.has(c));

  await saveTemplateMapping({
    datasetId,
    masterType: template.masterType,
    expectedCount: template.expectedColumns.length,
    matchedCount: matches.length,
    coverage: template.expectedColumns.length
      ? Number((matches.length / template.expectedColumns.length).toFixed(3))
      : 0,
    mappings: [
      ...matches.map((m) => ({
        sourceColumn: m.sourceColumn, templateColumn: m.templateColumn,
        confidence: m.confidence, method: m.method,
      })),
      ...unmappedSourceColumns.map((c) => ({
        sourceColumn: c, templateColumn: null, confidence: 0, method: "unmatched",
      })),
    ],
    missingColumns,
  });

  return {
    datasetId,
    masterType: template.masterType,
    expectedCount: template.expectedColumns.length,
    matchedCount: matches.length,
    coverage: template.expectedColumns.length
      ? Number((matches.length / template.expectedColumns.length).toFixed(3))
      : 0,
    matches,
    missingColumns,
    unmappedSourceColumns,
    embeddingMatches,
    embeddingSource,
  };
}
