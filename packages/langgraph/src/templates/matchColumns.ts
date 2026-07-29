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

export type MatchMethod = "exact" | "normalized" | "contains" | "token" | "llm";

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

// Source systems abbreviate; the Apptio template spells things out. Both sides
// are folded to one canonical token so "UsageQuantity" can reach "Usage Qty".
const ABBREVIATIONS: Record<string, string> = {
  qty: "quantity", amt: "amount", num: "number", no: "number",
  desc: "description", acct: "account", org: "organization",
  identifier: "id", pct: "percent", avg: "average", dt: "date",
};

// "user:" is the AWS cost-and-usage-report tag namespace, not part of the name:
// "user: Cost Center" is the customer's Cost Center column.
const IGNORED_TOKENS = new Set(["user", "tag", "the", "of", "a"]);

/**
 * camelCase-aware. Without the split, "PayerAccountName" stayed a single token
 * and only raw substring comparison could match anything — which is how
 * "LinkedAccountId" matched the template's "Count" (strip punctuation and
 * "linkedaccountid" really does contain "count"). Tokenizing first makes that
 * impossible while still matching the pairs that genuinely correspond.
 */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => !IGNORED_TOKENS.has(t));
}

function isSubset(small: string[], large: Set<string>): boolean {
  return small.length > 0 && small.every((t) => large.has(t));
}

/** 0 when the pair should not be considered a match at all. */
function score(source: string, template: string): { confidence: number; method: MatchMethod } | null {
  if (source.trim() === template.trim()) return { confidence: 1, method: "exact" };
  if (normalize(source) === normalize(template)) return { confidence: 0.98, method: "normalized" };

  const ta = tokens(source);
  const tb = tokens(template);
  if (ta.length === 0 || tb.length === 0) return null;
  const sa = new Set(ta);
  const sb = new Set(tb);

  if (ta.length === tb.length && isSubset(ta, sb)) return { confidence: 0.95, method: "normalized" };

  // Every token of one name appears in the other: "user: Cost Center" ->
  // "Cost Center", "TotalCost" -> "Cost". Scaled by how much extra the longer
  // name carries, so "Cost" alone is a weaker claim than a near-complete match.
  if (isSubset(tb, sa) || isSubset(ta, sb)) {
    const ratio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length);
    return { confidence: Number((0.62 + ratio * 0.28).toFixed(3)), method: "contains" };
  }

  const shared = [...sa].filter((t) => sb.has(t)).length;
  if (shared === 0) return null;
  const jaccard = shared / new Set([...ta, ...tb]).size;
  // A single shared token out of many is usually coincidence ("Name", "ID").
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
