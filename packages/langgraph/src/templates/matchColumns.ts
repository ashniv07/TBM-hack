import { MasterTemplate } from "./masterTemplates";

/**
 * Matches a customer's source columns onto a master template's expected
 * columns, and reports how much of the template was satisfied.
 *
 * This is the metric the client asked for: "the master data expects N columns,
 * your file supplies M of them." It is deliberately a *constrained* match —
 * every candidate answer is a known template column — rather than the
 * open-ended "what is this column?" classification Stage 2 does today.
 *
 * Scaffolding (join keys, metafields, benchmark and QA helper columns) is
 * already excluded from `expectedColumns`: Apptio generates those during
 * transformation, so a customer cannot supply them and counting them would
 * understate every coverage figure.
 */

export type MatchMethod = "exact" | "normalized" | "contains" | "token";

export interface ColumnMatch {
  sourceColumn: string;
  templateColumn: string;
  confidence: number;
  method: MatchMethod;
}

export interface TemplateCoverage {
  masterType: string;
  expectedCount: number;
  matchedCount: number;
  /** matchedCount / expectedCount, 0-1. */
  coverage: number;
  matches: ColumnMatch[];
  /** Template columns the source file does not supply. */
  missingColumns: string[];
  /** Source columns that map to nothing in the template. */
  unmappedSourceColumns: string[];
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/** 0 when the pair should not be considered a match at all. */
function score(source: string, template: string): { confidence: number; method: MatchMethod } | null {
  if (source.trim() === template.trim()) return { confidence: 1, method: "exact" };

  const a = normalize(source);
  const b = normalize(template);
  if (!a || !b) return null;
  if (a === b) return { confidence: 0.98, method: "normalized" };
  if (a.includes(b) || b.includes(a)) {
    // Longer shared portion relative to the longer name = better containment.
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return { confidence: Number((0.6 + ratio * 0.3).toFixed(3)), method: "contains" };
  }

  const ta = new Set(tokens(source));
  const tb = tokens(template);
  if (ta.size === 0 || tb.length === 0) return null;
  const shared = tb.filter((t) => ta.has(t)).length;
  if (shared === 0) return null;
  const jaccard = shared / new Set([...ta, ...tb]).size;
  // One shared token out of many is usually coincidence ("Name", "ID").
  if (jaccard < 0.34) return null;
  return { confidence: Number((0.4 + jaccard * 0.4).toFixed(3)), method: "token" };
}

/**
 * Greedy 1:1 assignment, highest-confidence pair first. A template column can
 * be satisfied by only one source column and vice versa — otherwise "Storage
 * ID" and "Storage Identifier" would both claim the template's "Storage ID"
 * and inflate coverage.
 */
export function matchColumnsToTemplate(sourceColumns: string[], template: MasterTemplate): TemplateCoverage {
  const candidates: ColumnMatch[] = [];
  for (const sourceColumn of sourceColumns) {
    for (const templateColumn of template.expectedColumns) {
      const s = score(sourceColumn, templateColumn);
      if (s) candidates.push({ sourceColumn, templateColumn, confidence: s.confidence, method: s.method });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence || a.templateColumn.localeCompare(b.templateColumn));

  const usedSource = new Set<string>();
  const usedTemplate = new Set<string>();
  const matches: ColumnMatch[] = [];
  for (const candidate of candidates) {
    if (usedSource.has(candidate.sourceColumn) || usedTemplate.has(candidate.templateColumn)) continue;
    usedSource.add(candidate.sourceColumn);
    usedTemplate.add(candidate.templateColumn);
    matches.push(candidate);
  }

  matches.sort((a, b) => b.confidence - a.confidence || a.templateColumn.localeCompare(b.templateColumn));

  return {
    masterType: template.masterType,
    expectedCount: template.expectedColumns.length,
    matchedCount: matches.length,
    coverage: template.expectedColumns.length
      ? Number((matches.length / template.expectedColumns.length).toFixed(3))
      : 0,
    matches,
    missingColumns: template.expectedColumns.filter((c) => !usedTemplate.has(c)),
    unmappedSourceColumns: sourceColumns.filter((c) => !usedSource.has(c)),
  };
}
