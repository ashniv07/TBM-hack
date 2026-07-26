import { getDatasetsBySourceType, getDatasetColumns } from "@tbm/db";
import { StandardizationState, DerivedSchema } from "./state";

// Columns present in 80%+ of datasets of a source type are considered required
const REQUIRED_THRESHOLD = 0.8;

/**
 * Derives canonical schemas per source type by analyzing all datasets.
 * For each source type, counts how often each semantic role appears and
 * marks roles present in 80%+ of datasets as "required".
 */
export async function deriveSchemasNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  try {
    const datasetsBySourceType = await getDatasetsBySourceType();
    const schemas: DerivedSchema[] = [];

    for (const [sourceType, datasets] of datasetsBySourceType) {
      // Count semantic role occurrences across all datasets of this source type
      const roleStats = new Map<string, {
        columnName: string;
        inferredType: string;
        count: number;
      }>();

      for (const dataset of datasets) {
        const columns = await getDatasetColumns(dataset.id);
        const seenRoles = new Set<string>();

        for (const col of columns) {
          if (!col.semantic_role || col.is_technical) continue;

          // Only count each role once per dataset
          if (seenRoles.has(col.semantic_role)) continue;
          seenRoles.add(col.semantic_role);

          const existing = roleStats.get(col.semantic_role);
          if (existing) {
            existing.count++;
            // Keep the most common column name for this role
          } else {
            roleStats.set(col.semantic_role, {
              columnName: col.column_name,
              inferredType: col.inferred_type ?? "string",
              count: 1,
            });
          }
        }
      }

      // Convert to DerivedSchema entries
      for (const [role, stats] of roleStats) {
        const frequencyScore = stats.count / datasets.length;
        schemas.push({
          sourceType,
          semanticRole: role,
          columnName: stats.columnName,
          inferredType: stats.inferredType,
          isRequired: frequencyScore >= REQUIRED_THRESHOLD,
          frequencyScore: Number(frequencyScore.toFixed(3)),
        });
      }
    }

    return { schemas };
  } catch (err) {
    return { error: `Failed to derive schemas: ${err instanceof Error ? err.message : String(err)}` };
  }
}
