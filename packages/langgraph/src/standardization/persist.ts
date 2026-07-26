import {
  upsertCanonicalSchema,
  insertQualityIssue,
  insertCorrection,
  upsertReadinessScore,
  clearAllQualityIssues,
  clearAllCorrections,
  CanonicalSchema,
  QualityIssue,
  Correction,
  ReadinessScore,
} from "@tbm/db";
import { StandardizationState, StandardizationStats } from "./state";

/**
 * Persists all standardization results to the database.
 * - Upserts canonical schemas
 * - Clears old issues and inserts new ones
 * - Links corrections to issue IDs
 * - Upserts readiness scores
 */
export async function persistStandardizationNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  if (state.error) return {};

  try {
    const persistedSchemas: CanonicalSchema[] = [];
    const persistedIssues: QualityIssue[] = [];
    const persistedCorrections: Correction[] = [];
    const persistedReadinessScores: ReadinessScore[] = [];

    // 1. Persist canonical schemas (upsert)
    for (const schema of state.schemas ?? []) {
      const persisted = await upsertCanonicalSchema({
        sourceType: schema.sourceType,
        semanticRole: schema.semanticRole,
        columnName: schema.columnName,
        inferredType: schema.inferredType,
        isRequired: schema.isRequired,
        frequencyScore: schema.frequencyScore,
      });
      persistedSchemas.push(persisted);
    }

    // 2. Clear old issues and insert new ones
    await clearAllQualityIssues();
    await clearAllCorrections();

    // Map to track issue IDs for linking corrections
    const issueIdMap = new Map<string, string>(); // key -> issue.id

    for (const issue of state.issues ?? []) {
      const persisted = await insertQualityIssue({
        datasetId: issue.datasetId,
        columnId: issue.columnId,
        issueType: issue.issueType,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        affectedRows: issue.affectedRows,
        sampleValues: issue.sampleValues,
        suggestedFix: issue.suggestedFix,
      });
      persistedIssues.push(persisted);

      // Create a key to match corrections to issues
      const key = `${issue.datasetId}::${issue.columnId ?? ""}::${issue.issueType}`;
      issueIdMap.set(key, persisted.id);
    }

    // 3. Insert corrections with linked issue IDs
    for (const correction of state.corrections ?? []) {
      // Find matching issue ID
      const issueKey = `${correction.datasetId}::${correction.columnId ?? ""}::${getIssueTypeForCorrection(correction.correctionType)}`;
      const issueId = issueIdMap.get(issueKey);

      const persisted = await insertCorrection({
        issueId,
        datasetId: correction.datasetId,
        columnId: correction.columnId,
        correctionType: correction.correctionType,
        originalValue: correction.originalValue,
        correctedValue: correction.correctedValue,
        affectedRows: correction.affectedRows,
        confidence: correction.confidence,
        reasoning: correction.reasoning,
      });
      persistedCorrections.push(persisted);
    }

    // 4. Upsert readiness scores
    for (const score of state.readinessScores ?? []) {
      const persisted = await upsertReadinessScore({
        datasetId: score.datasetId,
        overallScore: score.overallScore,
        completenessScore: score.completenessScore,
        validityScore: score.validityScore,
        consistencyScore: score.consistencyScore,
        uniquenessScore: score.uniquenessScore,
        issueCount: score.issueCount,
        criticalIssueCount: score.criticalIssueCount,
        recommendations: score.recommendations,
      });
      persistedReadinessScores.push(persisted);
    }

    // 5. Calculate stats
    const averageReadiness = persistedReadinessScores.length > 0
      ? persistedReadinessScores.reduce((sum, s) => sum + s.overall_score, 0) / persistedReadinessScores.length
      : 0;

    const stats: StandardizationStats = {
      schemasCount: persistedSchemas.length,
      issuesCount: persistedIssues.length,
      correctionsCount: persistedCorrections.length,
      datasetsScored: persistedReadinessScores.length,
      averageReadinessScore: Number(averageReadiness.toFixed(3)),
    };

    return {
      persistedSchemas,
      persistedIssues,
      persistedCorrections,
      persistedReadinessScores,
      stats,
    };
  } catch (err) {
    return { error: `Failed to persist standardization: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function getIssueTypeForCorrection(correctionType: string): string {
  const mapping: Record<string, string> = {
    normalize_date: "invalid_date",
    normalize_currency: "invalid_currency",
    fuzzy_match_entity: "invalid_reference",
    trim_whitespace: "invalid_reference",
    fill_missing: "missing_value",
    remove_duplicate: "duplicate",
  };
  return mapping[correctionType] ?? correctionType;
}
