import { MASTER_TEMPLATES, MasterTemplate } from "./masterTemplates";
import { TemplateCoverage, matchColumnsToTemplate } from "./matchColumns";

/**
 * Works out which master template a customer's source file is meant to satisfy,
 * by scoring its columns against all 18 and taking the best fit.
 *
 * A customer sends "their storage data" or "their AWS billing" — they do not
 * label it with an Apptio master type, and the file name will not follow our
 * conventions. The columns are the only reliable signal.
 *
 * Scored on how much of the SOURCE file the template explains, not raw
 * coverage: an AWS export supplying 16 of its 36 columns to Cloud Service
 * Providers is a better fit than one supplying 3 of 36 to a template that
 * happens to have very few expected columns.
 */
export interface MasterTypeGuess {
  template: MasterTemplate;
  coverage: TemplateCoverage;
  /** Share of the source file's columns this template accounts for, 0-1. */
  sourceExplained: number;
  runnerUp: string | null;
}

// Below this, the file matches nothing recognisable and should be reported as
// unknown rather than forced into the least-bad template.
const MIN_SOURCE_EXPLAINED = 0.15;

export function inferMasterType(sourceColumns: string[]): MasterTypeGuess | null {
  if (sourceColumns.length === 0) return null;

  const scored = MASTER_TEMPLATES.map((template) => {
    const coverage = matchColumnsToTemplate(sourceColumns, template);
    return {
      template,
      coverage,
      sourceExplained: Number((coverage.matchedCount / sourceColumns.length).toFixed(3)),
    };
  }).sort((a, b) => b.sourceExplained - a.sourceExplained || b.coverage.coverage - a.coverage.coverage);

  const best = scored[0];
  if (!best || best.sourceExplained < MIN_SOURCE_EXPLAINED) return null;
  return { ...best, runnerUp: scored[1]?.template.masterType ?? null };
}
