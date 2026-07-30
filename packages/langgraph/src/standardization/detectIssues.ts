import path from "path";
import { EMBEDDABLE_ROLES, getDatasetColumns, getContextEntitiesByType, listDatasets, getColumnMappings } from "@tbm/db";
import { readWorkbookRows } from "../shared/readWorkbookRows";
import { StandardizationState, DetectedIssue, DerivedSchema } from "./state";
import { normalizeDatasetToMaster, NormalizedDataset } from "../templates/normalizeToMaster";

// Valid ISO 4217 currency codes (common subset)
const VALID_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CNY", "INR", "CAD", "AUD", "CHF", "NZD",
  "HKD", "SGD", "KRW", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK", "PLN",
]);

/**
 * Detects quality issues across all datasets.
 * Issue types:
 * - missing_value: High null percentage (>50%)
 * - duplicate: Duplicate rows based on key columns
 * - invalid_reference: Entity not found in knowledge graph
 * - invalid_currency: Invalid currency codes
 * - invalid_date: Unparseable dates
 * - outlier: Values >3 std deviations from mean
 * - schema_mismatch: Column type differs from canonical schema
 */
export async function detectIssuesNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  if (state.error) return {};

  try {
    const datasets = await listDatasets();
    const issues: DetectedIssue[] = [];

    // Build canonical schema lookup
    const schemaBySourceRole = new Map<string, DerivedSchema>();
    for (const schema of state.schemas ?? []) {
      schemaBySourceRole.set(`${schema.sourceType}::${schema.semanticRole}`, schema);
    }

    // Cache context entities by type for reference validation
    const entityCacheByType = new Map<string, Set<string>>();
    async function getEntityNames(entityType: string): Promise<Set<string>> {
      if (!entityCacheByType.has(entityType)) {
        const entities = await getContextEntitiesByType(entityType);
        const names = new Set(entities.map((e) => e.canonical_name.toLowerCase().trim()));
        entityCacheByType.set(entityType, names);
      }
      return entityCacheByType.get(entityType)!;
    }

    for (const dataset of datasets) {
      const allColumns = await getDatasetColumns(dataset.id);

      // Get column mappings to filter only mapped columns
      const columnMappings = await getColumnMappings(dataset.id);
      const mappedSourceColumns = new Set(
        columnMappings
          .filter((m) => m.template_column) // Only columns that have a template mapping
          .map((m) => m.source_column)
      );

      // Filter to only include mapped columns (ignore unmapped source columns)
      // This ensures Data Quality only analyzes the refined/mapped dataset
      const columns = allColumns.filter((c) => mappedSourceColumns.has(c.column_name));

      // Skip datasets with no mapped columns
      if (columns.length === 0 && allColumns.length > 0) {
        console.log(`[DetectIssues] Dataset ${dataset.file_name}: No mapped columns, skipping quality analysis`);
        continue;
      }

      // Try to get normalized (master-formatted) data first
      let normalizedData: NormalizedDataset | null = null;
      let rows: Record<string, unknown>[] = [];
      let columnNameMap: Map<string, string> | null = null; // source column -> template column

      try {
        normalizedData = await normalizeDatasetToMaster(dataset.id, {
          uploadsDir: state.uploadsDir,
        });
        if (normalizedData && normalizedData.rows.length > 0) {
          // Use normalized rows (columns are in master template format)
          rows = normalizedData.rows;
          columnNameMap = new Map(
            Array.from(normalizedData.columnMapping.entries()).map(([template, source]) => [source, template])
          );
        }
      } catch {
        // Normalization failed, fall back to source data
      }

      // Fall back to source data if normalization didn't work
      // Prefer refined file (only mapped columns) over source file
      if (rows.length === 0) {
        try {
          const candidatePaths: string[] = [];
          // Prefer refined file if available (contains only mapped columns with template names)
          if (dataset.refined_path) {
            candidatePaths.push(dataset.refined_path);
            if (state.uploadsDir) {
              candidatePaths.push(path.join(state.uploadsDir, path.basename(dataset.refined_path)));
            }
          }
          // Fall back to source file
          candidatePaths.push(dataset.storage_path);
          if (state.uploadsDir) {
            candidatePaths.push(path.join(state.uploadsDir, path.basename(dataset.storage_path)));
          }
          for (const candidatePath of candidatePaths) {
            try {
              const result = await readWorkbookRows(candidatePath);
              rows = result.rows;
              console.log(`[DetectIssues] Using file: ${candidatePath} with ${rows.length} rows`);
              break;
            } catch {
              // Try next path
            }
          }
        } catch {
          // If we can't read the file, skip row-level analysis
        }
      }

      // Check each column for issues
      for (const col of columns) {
        // Template scaffolding and other technical columns carry no business
        // meaning, so quality findings about them are pure noise for a
        // reviewer — 323 of 447 issues on the sample set were type mismatches
        // on join keys and benchmark helpers.
        if (col.is_technical) continue;

        // Get the column name to use for row lookups:
        // - If we have normalized data, use the mapped template column name
        // - Otherwise use the source column name
        const rowColumnName = columnNameMap?.get(col.column_name) ?? col.column_name;
        const displayColumnName = columnNameMap?.get(col.column_name)
          ? `${columnNameMap.get(col.column_name)} (mapped from ${col.column_name})`
          : col.column_name;

        // 1. Missing value detection (from profiling data)
        if (col.null_pct !== null && col.null_pct > 50) {
          issues.push({
            datasetId: dataset.id,
            columnId: col.id,
            issueType: "missing_value",
            severity: col.null_pct > 80 ? "error" : "warning",
            title: `High null percentage in ${displayColumnName}`,
            description: `Column "${displayColumnName}" has ${col.null_pct.toFixed(1)}% null values, which may indicate data quality issues or missing data collection.`,
            affectedRows: rows.length > 0 ? Math.round(rows.length * col.null_pct / 100) : undefined,
            suggestedFix: col.null_pct > 80
              ? "Consider removing this column or investigating why data is missing"
              : "Review data collection process to reduce null values",
          });
        }

        // 2. Schema mismatch detection
        if (dataset.source_type && col.semantic_role) {
          const canonical = schemaBySourceRole.get(`${dataset.source_type}::${col.semantic_role}`);
          // "other" is a catch-all holding dozens of unrelated columns, so
          // whichever one happened to define it is not a canonical type for the
          // rest. And a mismatch against "unknown" (an all-empty column) yields
          // the uselessly circular "convert column values to unknown type".
          const comparable =
            canonical &&
            col.semantic_role !== "other" &&
            canonical.inferredType !== "unknown" &&
            col.inferred_type !== "unknown";
          if (comparable && canonical!.inferredType !== col.inferred_type) {
            issues.push({
              datasetId: dataset.id,
              columnId: col.id,
              issueType: "schema_mismatch",
              severity: "warning",
              title: `Type mismatch for ${displayColumnName}`,
              description: `Column "${displayColumnName}" has type "${col.inferred_type}" but canonical schema expects "${canonical.inferredType}" for ${col.semantic_role} in ${dataset.source_type} datasets.`,
              suggestedFix: `Convert column values to ${canonical.inferredType} type`,
            });
          }
        }

        // Row-level analysis (only if we have rows)
        if (rows.length === 0) continue;

        // 3. Currency validation (for amount/currency columns)
        if (col.semantic_role === "currency" || col.column_name.toLowerCase().includes("currency")) {
          const invalidCurrencies: string[] = [];
          for (const row of rows) {
            const value = row[rowColumnName];
            if (value === null || value === undefined) continue;
            const code = String(value).trim().toUpperCase();
            if (code && !VALID_CURRENCIES.has(code)) {
              if (!invalidCurrencies.includes(code)) {
                invalidCurrencies.push(code);
              }
            }
          }
          if (invalidCurrencies.length > 0) {
            issues.push({
              datasetId: dataset.id,
              columnId: col.id,
              issueType: "invalid_currency",
              severity: "error",
              title: `Invalid currency codes in ${displayColumnName}`,
              description: `Found ${invalidCurrencies.length} invalid currency code(s) that don't match ISO 4217 standard.`,
              sampleValues: invalidCurrencies.slice(0, 5),
              suggestedFix: "Normalize currency codes to ISO 4217 standard (e.g., USD, EUR, GBP)",
            });
          }
        }

        // 4. Date validation (for date columns)
        if (col.inferred_type === "date" || col.column_name.toLowerCase().includes("date")) {
          const invalidDates: string[] = [];
          for (const row of rows) {
            const value = row[rowColumnName];
            if (value === null || value === undefined || value === "") continue;
            // Skip if already a valid ISO date string or Date object
            if (value instanceof Date) continue;
            const strValue = String(value);
            const parsed = Date.parse(strValue);
            if (isNaN(parsed)) {
              if (!invalidDates.includes(strValue) && invalidDates.length < 10) {
                invalidDates.push(strValue);
              }
            }
          }
          if (invalidDates.length > 0) {
            issues.push({
              datasetId: dataset.id,
              columnId: col.id,
              issueType: "invalid_date",
              severity: "warning",
              title: `Unparseable dates in ${displayColumnName}`,
              description: `Found values that cannot be parsed as valid dates.`,
              sampleValues: invalidDates.slice(0, 5),
              suggestedFix: "Normalize date values to ISO 8601 format (YYYY-MM-DD)",
            });
          }
        }

        // 5. Numeric outlier detection (for numeric columns)
        if (col.inferred_type === "number" || col.inferred_type === "integer") {
          const values: number[] = [];
          for (const row of rows) {
            const value = row[rowColumnName];
            if (value === null || value === undefined) continue;
            const num = typeof value === "number" ? value : parseFloat(String(value));
            if (!isNaN(num)) values.push(num);
          }

          if (values.length > 10) {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);

            if (stdDev > 0) {
              const outliers = values.filter((v) => Math.abs(v - mean) > 3 * stdDev);
              if (outliers.length > 0) {
                issues.push({
                  datasetId: dataset.id,
                  columnId: col.id,
                  issueType: "outlier",
                  severity: "info",
                  title: `Outliers detected in ${displayColumnName}`,
                  description: `Found ${outliers.length} value(s) more than 3 standard deviations from the mean (${mean.toFixed(2)} ± ${stdDev.toFixed(2)}).`,
                  affectedRows: outliers.length,
                  sampleValues: outliers.slice(0, 5),
                  suggestedFix: "Review outlier values to determine if they are data entry errors or valid extreme values",
                });
              }
            }
          }
        }

        // 6. Invalid reference detection (for entity reference columns)
        if (col.semantic_role && (EMBEDDABLE_ROLES as readonly string[]).includes(col.semantic_role)) {
          const knownEntities = await getEntityNames(col.semantic_role);
          if (knownEntities.size > 0) {
            const unknownValues: string[] = [];
            for (const row of rows) {
              const value = row[rowColumnName];
              if (value === null || value === undefined || value === "") continue;
              const strValue = String(value).toLowerCase().trim();
              if (!knownEntities.has(strValue)) {
                if (!unknownValues.includes(String(value)) && unknownValues.length < 20) {
                  unknownValues.push(String(value));
                }
              }
            }
            if (unknownValues.length > 0) {
              issues.push({
                datasetId: dataset.id,
                columnId: col.id,
                issueType: "invalid_reference",
                severity: "warning",
                title: `Unknown ${col.semantic_role} references in ${displayColumnName}`,
                description: `Found ${unknownValues.length} value(s) not found in the knowledge graph as known ${col.semantic_role} entities.`,
                sampleValues: unknownValues.slice(0, 5),
                suggestedFix: `Add missing ${col.semantic_role} entities to the knowledge graph or correct the values`,
              });
            }
          }
        }
      }

      // 7. Duplicate row detection
      // Use candidate key columns if available, otherwise use all mapped non-technical columns
      // Note: 'columns' is already filtered to only include mapped columns
      let keyColumns = columns.filter((c) => c.is_candidate_key);
      let usingAllColumns = false;

      if (keyColumns.length === 0) {
        // No candidate keys - use all mapped non-technical columns for duplicate detection
        keyColumns = columns.filter((c) => !c.is_technical);
        usingAllColumns = true;
      }

      if (keyColumns.length > 0 && rows.length > 0) {
        const seen = new Map<string, number>();
        let duplicateCount = 0;
        const duplicateExamples: string[] = [];

        for (const row of rows) {
          // Use the mapped column name for duplicate detection
          const keyValues = keyColumns.map((c) => {
            const keyColName = columnNameMap?.get(c.column_name) ?? c.column_name;
            return String(row[keyColName] ?? "");
          }).join("|");
          const count = (seen.get(keyValues) ?? 0) + 1;
          seen.set(keyValues, count);
          if (count === 2) {
            duplicateCount++;
            if (duplicateExamples.length < 5) {
              duplicateExamples.push(keyValues.substring(0, 100)); // Truncate for display
            }
          } else if (count > 2) {
            duplicateCount++;
          }
        }

        if (duplicateCount > 0) {
          const keyColNames = keyColumns.map((c) => c.column_name).join(", ");
          issues.push({
            datasetId: dataset.id,
            issueType: "duplicate",
            severity: duplicateCount > rows.length * 0.1 ? "error" : "warning",
            title: `Duplicate rows detected`,
            description: usingAllColumns
              ? `Found ${duplicateCount} exact duplicate row(s) across all ${keyColumns.length} columns.`
              : `Found ${duplicateCount} duplicate row(s) based on key column(s): ${keyColNames}.`,
            affectedRows: duplicateCount,
            sampleValues: duplicateExamples,
            suggestedFix: "Review and remove duplicate rows",
          });
        }
      }
    }

    return { issues };
  } catch (err) {
    return { error: `Failed to detect issues: ${err instanceof Error ? err.message : String(err)}` };
  }
}
