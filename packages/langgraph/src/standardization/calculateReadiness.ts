import { getDatasetColumns, getCanonicalSchemas, listDatasets } from "@tbm/db";
import { StandardizationState, DatasetReadiness, DerivedSchema, DetectedIssue } from "./state";

// Readiness score dimension weights
const WEIGHTS = {
  completeness: 0.25,
  validity: 0.30,
  consistency: 0.25,
  uniqueness: 0.20,
};

/**
 * Calculates TBM readiness scores for each dataset.
 * Four dimensions:
 * - Completeness (25%): Required columns present vs canonical schema
 * - Validity (30%): % values passing validation (inverse of issue severity)
 * - Consistency (25%): Cross-dataset reference integrity
 * - Uniqueness (20%): Inverse of duplicate ratio
 */
export async function calculateReadinessNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  if (state.error) return {};

  try {
    const datasets = await listDatasets();
    const readinessScores: DatasetReadiness[] = [];

    // Group issues by dataset
    const issuesByDataset = new Map<string, DetectedIssue[]>();
    for (const issue of state.issues ?? []) {
      const list = issuesByDataset.get(issue.datasetId) ?? [];
      list.push(issue);
      issuesByDataset.set(issue.datasetId, list);
    }

    // Build schema lookup for completeness checking
    const schemaBySourceType = new Map<string, DerivedSchema[]>();
    for (const schema of state.schemas ?? []) {
      const list = schemaBySourceType.get(schema.sourceType) ?? [];
      list.push(schema);
      schemaBySourceType.set(schema.sourceType, list);
    }

    for (const dataset of datasets) {
      const columns = await getDatasetColumns(dataset.id);
      const datasetIssues = issuesByDataset.get(dataset.id) ?? [];

      // 1. Completeness Score
      let completenessScore = 1.0;
      if (dataset.source_type) {
        const canonicalSchemas = schemaBySourceType.get(dataset.source_type) ?? [];
        const requiredRoles = canonicalSchemas
          .filter((s) => s.isRequired)
          .map((s) => s.semanticRole);

        if (requiredRoles.length > 0) {
          const presentRoles = new Set(
            columns
              .filter((c) => c.semantic_role && !c.is_technical)
              .map((c) => c.semantic_role)
          );
          const presentRequired = requiredRoles.filter((r) => presentRoles.has(r));
          completenessScore = presentRequired.length / requiredRoles.length;
        }
      }

      // 2. Validity Score (based on issue severity)
      let validityScore = 1.0;
      const validityIssues = datasetIssues.filter((i) =>
        ["invalid_date", "invalid_currency", "invalid_reference", "missing_value"].includes(i.issueType)
      );

      if (validityIssues.length > 0) {
        // Weight issues by severity
        const severityWeights: Record<string, number> = {
          critical: 0.25,
          error: 0.15,
          warning: 0.08,
          info: 0.03,
        };

        let totalPenalty = 0;
        for (const issue of validityIssues) {
          totalPenalty += severityWeights[issue.severity] ?? 0.05;
        }
        validityScore = Math.max(0, 1 - totalPenalty);
      }

      // 3. Consistency Score (based on invalid references)
      let consistencyScore = 1.0;
      const referenceIssues = datasetIssues.filter((i) => i.issueType === "invalid_reference");

      if (referenceIssues.length > 0) {
        // Penalize based on number of invalid reference issues
        const penalty = Math.min(referenceIssues.length * 0.1, 0.5);
        consistencyScore = 1 - penalty;
      }

      // 4. Uniqueness Score (based on duplicates)
      let uniquenessScore = 1.0;
      const duplicateIssue = datasetIssues.find((i) => i.issueType === "duplicate");

      if (duplicateIssue && duplicateIssue.affectedRows && dataset.row_count) {
        const duplicateRatio = duplicateIssue.affectedRows / dataset.row_count;
        uniquenessScore = 1 - duplicateRatio;
      }

      // Calculate overall score
      const overallScore = Number(
        (
          completenessScore * WEIGHTS.completeness +
          validityScore * WEIGHTS.validity +
          consistencyScore * WEIGHTS.consistency +
          uniquenessScore * WEIGHTS.uniqueness
        ).toFixed(3)
      );

      // Count issues
      const issueCount = datasetIssues.length;
      const criticalIssueCount = datasetIssues.filter(
        (i) => i.severity === "critical" || i.severity === "error"
      ).length;

      // Generate recommendations
      const recommendations = generateRecommendations({
        completenessScore,
        validityScore,
        consistencyScore,
        uniquenessScore,
        issues: datasetIssues,
      });

      readinessScores.push({
        datasetId: dataset.id,
        overallScore,
        completenessScore: Number(completenessScore.toFixed(3)),
        validityScore: Number(validityScore.toFixed(3)),
        consistencyScore: Number(consistencyScore.toFixed(3)),
        uniquenessScore: Number(uniquenessScore.toFixed(3)),
        issueCount,
        criticalIssueCount,
        recommendations,
      });
    }

    return { readinessScores };
  } catch (err) {
    return { error: `Failed to calculate readiness: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function generateRecommendations(params: {
  completenessScore: number;
  validityScore: number;
  consistencyScore: number;
  uniquenessScore: number;
  issues: DetectedIssue[];
}): string[] {
  const recommendations: string[] = [];

  // Completeness recommendations
  if (params.completenessScore < 0.8) {
    recommendations.push(
      "Add missing required columns based on the canonical schema for this source type"
    );
  }

  // Validity recommendations
  if (params.validityScore < 0.8) {
    const invalidDateIssues = params.issues.filter((i) => i.issueType === "invalid_date").length;
    const invalidCurrencyIssues = params.issues.filter((i) => i.issueType === "invalid_currency").length;
    const missingValueIssues = params.issues.filter((i) => i.issueType === "missing_value").length;

    if (invalidDateIssues > 0) {
      recommendations.push("Normalize date formats to ISO 8601 (YYYY-MM-DD)");
    }
    if (invalidCurrencyIssues > 0) {
      recommendations.push("Standardize currency codes to ISO 4217");
    }
    if (missingValueIssues > 0) {
      recommendations.push("Review and fill missing required values");
    }
  }

  // Consistency recommendations
  if (params.consistencyScore < 0.9) {
    const refIssues = params.issues.filter((i) => i.issueType === "invalid_reference");
    if (refIssues.length > 0) {
      recommendations.push(
        "Resolve entity reference mismatches by adding missing entities to the knowledge graph or correcting values"
      );
    }
  }

  // Uniqueness recommendations
  if (params.uniquenessScore < 0.95) {
    recommendations.push("Review and remove duplicate rows to ensure data integrity");
  }

  // Outlier recommendations
  const outlierIssues = params.issues.filter((i) => i.issueType === "outlier");
  if (outlierIssues.length > 0) {
    recommendations.push(
      "Investigate outlier values to determine if they are data entry errors"
    );
  }

  // Schema mismatch recommendations
  const schemaMismatchIssues = params.issues.filter((i) => i.issueType === "schema_mismatch");
  if (schemaMismatchIssues.length > 0) {
    recommendations.push(
      "Align column data types with canonical schema expectations"
    );
  }

  // If no specific recommendations, provide a general one
  if (recommendations.length === 0) {
    if (params.completenessScore >= 0.95 &&
        params.validityScore >= 0.95 &&
        params.consistencyScore >= 0.95 &&
        params.uniquenessScore >= 0.95) {
      recommendations.push("Dataset is TBM-ready with high quality scores");
    } else {
      recommendations.push("Continue monitoring data quality metrics");
    }
  }

  return recommendations;
}
