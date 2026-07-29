import { DatasetColumn, getDatasetColumns, saveTemplateMapping } from "@tbm/db";
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
 * 2. An LLM over ONLY what pass 1 left unmatched — 20 source x 69 template
 *    columns on the AWS sample, so one small call rather than a cross-product.
 *
 * Pass 2 was originally embeddings, and measurement killed it. Against the real
 * AWS file the nearest pairs by cosine distance were:
 *
 *      0.417  InvoiceID        -> Unique ID          wrong
 *      0.442  InvoiceID        -> Business Unit ID   wrong
 *      0.454  TaxAmount        -> Invoice Amount     wrong
 *      0.558  AvailabilityZone -> Provider Region    CORRECT, ranked 13th
 *
 * The embedding space clusters "things that look like IDs", which is the wrong
 * axis: no threshold admits the one right answer without first admitting six
 * wrong ones. An LLM can be told the semantics and can decline, which is what
 * this problem actually needs.
 */

function describeColumn(column: DatasetColumn): string {
  const samples = (column.sample_values ?? [])
    .filter((v) => v !== null && v !== undefined && String(v).trim())
    .slice(0, 4)
    .map((v) => String(v).slice(0, 40));
  return samples.length ? `${column.column_name}. Example values: ${samples.join(", ")}` : column.column_name;
}

/**
 * Asks an LLM which of the leftover source columns correspond to which leftover
 * template columns. It may only choose from the supplied lists and is told to
 * return nothing when unsure — a wrong mapping silently corrupts every
 * downstream stage, whereas a missed one shows up honestly in the coverage gap.
 */
async function llmMatchResidue(
  describedSource: string[],
  sourceColumns: string[],
  templateColumns: string[]
): Promise<ColumnMatch[]> {
  if (!process.env.OPENAI_API_KEY) return [];
  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
    const response = await model.invoke(
      `You are mapping a customer's source columns onto an Apptio TBM master template.

SOURCE COLUMNS (name, then example values):
${describedSource.map((d, i) => `${i + 1}. ${d}`).join("\n")}

TEMPLATE COLUMNS you may map to:
${templateColumns.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Rules:
- Only pair a source column with a template column that means the SAME thing.
- Identifiers are not interchangeable: an invoice id is not a business unit id.
- Omit anything you are not confident about. Returning fewer pairs is better
  than returning a wrong one.
- Use the exact strings given.

Return JSON only:
{"pairs":[{"source":"<source column name>","template":"<template column>","confidence":0.0,"why":"short"}]}`
    );
    const content = typeof response.content === "string" ? response.content : "";
    const json = content.match(/\{[\s\S]*\}/);
    if (!json) return [];
    const parsed = JSON.parse(json[0]);

    const validSource = new Set(sourceColumns);
    const validTemplate = new Set(templateColumns);
    const usedSource = new Set<string>();
    const usedTemplate = new Set<string>();
    const out: ColumnMatch[] = [];
    for (const pair of parsed.pairs ?? []) {
      const source = String(pair.source ?? "");
      const template = String(pair.template ?? "");
      // The model can only confirm pairs from the lists it was given, and each
      // column may be used once.
      if (!validSource.has(source) || !validTemplate.has(template)) continue;
      if (usedSource.has(source) || usedTemplate.has(template)) continue;
      usedSource.add(source);
      usedTemplate.add(template);
      out.push({
        sourceColumn: source,
        templateColumn: template,
        confidence: Math.max(0, Math.min(1, Number(pair.confidence) || 0.6)),
        method: "llm" as ColumnMatch["method"],
      });
    }
    return out;
  } catch {
    return [];
  }
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
  llmMatches: number;
}

export async function mapDatasetToTemplate(
  datasetId: string,
  options?: { masterType?: string; useLlm?: boolean }
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
      llmMatches: 0,
    };
  }

  const result = matchColumnsToTemplate(columnNames, template);
  const matches = [...result.matches];
  let llmMatches = 0;

  // ---- Pass 2: LLM over the residue only ----
  const leftoverSource = result.unmappedSourceColumns;
  const leftoverTemplate = result.missingColumns;
  if (options?.useLlm !== false && leftoverSource.length && leftoverTemplate.length) {
    const columnByName = new Map(columns.map((c) => [c.column_name, c]));
    const resolved = await llmMatchResidue(
      leftoverSource.map((name) => {
        const column = columnByName.get(name);
        return column ? describeColumn(column) : name;
      }),
      leftoverSource,
      leftoverTemplate
    );
    for (const match of resolved) {
      matches.push({ ...match, method: "llm" as ColumnMatch["method"] });
      llmMatches++;
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
    llmMatches,
  };
}
