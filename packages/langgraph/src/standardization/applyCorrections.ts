import path from "path";
import ExcelJS from "exceljs";
import fs from "fs";
import {
  getDataset,
  getDatasetColumns,
  getColumnMappings,
  getCorrections,
  markCorrectionApplied,
  createDataset,
  updateDatasetStatus,
  setDatasetSourceType,
  Correction,
  Dataset,
} from "@tbm/db";

export interface ApplyCorrectionResult {
  originalFile: string;
  correctedFile: string;
  correctionsApplied: number;
  /** The new dataset created from the corrected file - use this for subsequent stages */
  correctedDataset?: Dataset;
  /** Original dataset ID that was corrected */
  originalDatasetId: string;
  changes: {
    correctionId: string;
    columnName: string;
    originalValue: string;
    correctedValue: string;
    rowsAffected: number;
  }[];
}

/**
 * Applies approved corrections to a dataset, creating a new corrected file.
 * Original file is never modified (safe mode).
 */
export async function applyCorrectionsToDataset(
  datasetId: string,
  uploadsDir?: string
): Promise<ApplyCorrectionResult> {
  console.log("[ApplyCorrections] Starting for dataset:", datasetId);

  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetId}`);
  }
  console.log("[ApplyCorrections] Dataset:", dataset.file_name);

  // Get approved corrections for this dataset
  const corrections = await getCorrections({ datasetId, status: "approved" });
  console.log("[ApplyCorrections] Found", corrections.length, "approved corrections");

  if (corrections.length === 0) {
    throw new Error("No approved corrections to apply");
  }

  for (const c of corrections) {
    console.log("[ApplyCorrections] Correction:", c.correction_type, "original:", c.original_value, "corrected:", c.corrected_value);
  }

  // Find the source file - prefer refined file (only mapped columns) over raw source
  const candidatePaths: string[] = [];

  // Prefer refined file if available (contains only mapped columns with template names)
  if (dataset.refined_path) {
    candidatePaths.push(dataset.refined_path);
    if (uploadsDir) {
      candidatePaths.push(path.join(uploadsDir, path.basename(dataset.refined_path)));
    }
  }

  // Fall back to source file
  candidatePaths.push(dataset.storage_path);
  if (uploadsDir) {
    candidatePaths.push(path.join(uploadsDir, path.basename(dataset.storage_path)));
  }

  let sourcePath: string | null = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      console.log("[ApplyCorrections] Using file:", sourcePath);
      break;
    }
  }

  if (!sourcePath) {
    throw new Error(`Source file not found: ${dataset.refined_path || dataset.storage_path}`);
  }

  // Get column info for mapping column_id to column_name
  const allColumns = await getDatasetColumns(datasetId);
  const columnNameById = new Map(allColumns.map((c) => [c.id, c.column_name]));

  // Get column mappings to filter only mapped columns (consistent with detectIssues)
  const columnMappings = await getColumnMappings(datasetId);
  const mappedSourceColumns = new Set(
    columnMappings
      .filter((m) => m.template_column) // Only columns that have a template mapping
      .map((m) => m.source_column)
  );

  // Filter to only include mapped columns for duplicate detection
  const columns = allColumns.filter((c) => mappedSourceColumns.has(c.column_name));
  console.log("[ApplyCorrections] Using", columns.length, "mapped columns out of", allColumns.length, "total");

  // Read the workbook
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("No worksheet found in file");
  }

  // Get headers from first row
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  const columnIndexByName = new Map<string, number>();
  const columnIndexByNameLower = new Map<string, number>(); // Case-insensitive lookup

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(cell.value ?? "").trim();
    headers.push(header);
    columnIndexByName.set(header, colNumber);
    columnIndexByNameLower.set(header.toLowerCase(), colNumber);
  });

  console.log("[ApplyCorrections] Excel headers:", headers.join(", "));
  console.log("[ApplyCorrections] DB columns:", columns.map(c => c.column_name).join(", "));

  // Helper to find column index (case-insensitive)
  const findColumnIndex = (name: string): number | undefined => {
    return columnIndexByName.get(name) ?? columnIndexByNameLower.get(name.toLowerCase());
  };

  // Count total rows before changes
  let totalRowsBefore = 0;
  worksheet.eachRow({ includeEmpty: false }, (_, rowNumber) => {
    if (rowNumber > 1) totalRowsBefore++;
  });
  console.log("[ApplyCorrections] Total rows before:", totalRowsBefore);

  // Separate corrections by type
  const valueCorrections: Correction[] = [];
  const duplicateCorrections: Correction[] = [];
  const otherCorrections: Correction[] = [];

  for (const correction of corrections) {
    if (correction.correction_type === "remove_duplicate") {
      duplicateCorrections.push(correction);
    } else if (correction.original_value && correction.corrected_value) {
      valueCorrections.push(correction);
    } else {
      otherCorrections.push(correction);
    }
  }

  // Group value corrections by column
  const correctionsByColumn = new Map<string, Correction[]>();
  for (const correction of valueCorrections) {
    const columnName = correction.column_id
      ? columnNameById.get(correction.column_id)
      : null;

    if (columnName) {
      const list = correctionsByColumn.get(columnName) ?? [];
      list.push(correction);
      correctionsByColumn.set(columnName, list);
    }
  }

  // Track changes made
  const changes: ApplyCorrectionResult["changes"] = [];
  const appliedCorrectionIds: string[] = [];

  // Handle duplicate removal first
  if (duplicateCorrections.length > 0) {
    console.log("[ApplyCorrections] Processing", duplicateCorrections.length, "duplicate corrections");

    // Use key columns if available, otherwise use all columns
    let keyColumns = columns.filter((c) => c.is_candidate_key);
    console.log("[ApplyCorrections] Candidate key columns:", keyColumns.length);

    if (keyColumns.length === 0) {
      // No key columns defined, use all non-technical columns for duplicate detection
      keyColumns = columns.filter((c) => !c.is_technical);
      console.log("[ApplyCorrections] Using all non-technical columns:", keyColumns.length);
    }

    console.log("[ApplyCorrections] Key columns for dedup:", keyColumns.map(c => c.column_name).join(", "));

    if (keyColumns.length > 0) {
      const seen = new Set<string>();
      const rowsToDelete: number[] = [];

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row

        const keyValues = keyColumns.map((c) => {
          const colIndex = findColumnIndex(c.column_name);
          if (!colIndex) {
            console.log("[ApplyCorrections] Column not found in Excel:", c.column_name);
            return "";
          }
          const cell = row.getCell(colIndex);
          return String(cell.value ?? "");
        }).join("|");

        if (seen.has(keyValues)) {
          rowsToDelete.push(rowNumber);
        } else {
          seen.add(keyValues);
        }
      });

      console.log("[ApplyCorrections] Found", rowsToDelete.length, "duplicate rows to delete");

      // Delete duplicate rows (in reverse order to maintain row indices)
      for (const rowNum of rowsToDelete.reverse()) {
        worksheet.spliceRows(rowNum, 1);
      }

      // Count rows after deletion
      let totalRowsAfter = 0;
      worksheet.eachRow({ includeEmpty: false }, (_, rowNumber) => {
        if (rowNumber > 1) totalRowsAfter++;
      });
      console.log("[ApplyCorrections] Total rows after:", totalRowsAfter);

      // Mark duplicate corrections as applied (even if no duplicates found)
      for (const correction of duplicateCorrections) {
        changes.push({
          correctionId: correction.id,
          columnName: "All Columns",
          originalValue: `${rowsToDelete.length} duplicate rows`,
          correctedValue: rowsToDelete.length > 0 ? "Removed" : "No duplicates found",
          rowsAffected: rowsToDelete.length,
        });
        appliedCorrectionIds.push(correction.id);
      }
    } else {
      // No columns at all - still mark as applied
      for (const correction of duplicateCorrections) {
        changes.push({
          correctionId: correction.id,
          columnName: "General",
          originalValue: "Duplicate check",
          correctedValue: "Applied (no columns to check)",
          rowsAffected: 0,
        });
        appliedCorrectionIds.push(correction.id);
      }
    }
  }

  // Apply value corrections row by row
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header row

    for (const [columnName, columnCorrections] of correctionsByColumn) {
      const colIndex = findColumnIndex(columnName);
      if (!colIndex) {
        console.log("[ApplyCorrections] Value correction column not found:", columnName);
        continue;
      }

      const cell = row.getCell(colIndex);
      const cellValue = cell.value;
      const cellString = cellValue === null || cellValue === undefined
        ? ""
        : cellValue instanceof Date
          ? cellValue.toISOString()
          : String(cellValue).trim();

      for (const correction of columnCorrections) {
        // Check if this cell matches the original value
        const originalNormalized = correction.original_value!.trim().toLowerCase();
        const cellNormalized = cellString.toLowerCase();

        if (cellNormalized === originalNormalized || cellString === correction.original_value) {
          // Apply the correction
          let newValue: string | number | Date = correction.corrected_value!;

          // Try to preserve data types
          if (correction.correction_type === "normalize_date") {
            // Parse ISO date string to Date object
            const parsed = new Date(correction.corrected_value!);
            if (!isNaN(parsed.getTime())) {
              newValue = parsed;
            }
          } else if (correction.correction_type === "normalize_currency") {
            // Currency codes stay as strings
            newValue = correction.corrected_value!.toUpperCase();
          }

          cell.value = newValue;

          // Track the change
          const existingChange = changes.find(
            (c) => c.correctionId === correction.id
          );
          if (existingChange) {
            existingChange.rowsAffected++;
          } else {
            changes.push({
              correctionId: correction.id,
              columnName,
              originalValue: correction.original_value!,
              correctedValue: correction.corrected_value!,
              rowsAffected: 1,
            });
            appliedCorrectionIds.push(correction.id);
          }
        }
      }
    }
  });

  // Mark other corrections as applied (meta-level corrections that don't modify data directly)
  for (const correction of otherCorrections) {
    appliedCorrectionIds.push(correction.id);
    changes.push({
      correctionId: correction.id,
      columnName: correction.column_id ? columnNameById.get(correction.column_id) ?? "General" : "General",
      originalValue: correction.original_value ?? "N/A",
      correctedValue: correction.corrected_value ?? correction.reasoning ?? "Applied",
      rowsAffected: correction.affected_rows ?? 0,
    });
  }

  // Generate corrected file path
  const ext = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, ext);
  const dirName = path.dirname(sourcePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const correctedFileName = `${baseName}_corrected_${timestamp}${ext}`;
  const correctedPath = path.join(dirName, correctedFileName);

  // Write the corrected file
  await workbook.xlsx.writeFile(correctedPath);

  // Mark corrections as applied in the database
  for (const correctionId of appliedCorrectionIds) {
    await markCorrectionApplied(correctionId);
  }

  // Register the corrected file as a new dataset for subsequent stages
  // This allows Stage 6 (ATUM), Stage 7 (TBM Export) to use the cleaned data
  const correctedDataset = await createDataset({
    fileName: correctedFileName,
    storagePath: correctedPath,
    sheetName: dataset.sheet_name ?? undefined,
    uploadedBy: "system:correction",
  });

  // Copy source type from original dataset
  if (dataset.source_type) {
    await setDatasetSourceType(
      correctedDataset.id,
      dataset.source_type,
      dataset.source_type_confidence ?? 1.0
    );
  }

  // Mark as ready for processing (skip profiling since it's derived from profiled data)
  await updateDatasetStatus(correctedDataset.id, "profiled");

  return {
    originalFile: sourcePath,
    correctedFile: correctedPath,
    correctionsApplied: appliedCorrectionIds.length,
    correctedDataset,
    originalDatasetId: datasetId,
    changes,
  };
}

/**
 * Applies all approved corrections across all datasets.
 */
export async function applyAllApprovedCorrections(
  uploadsDir?: string
): Promise<{
  results: ApplyCorrectionResult[];
  errors: { datasetId: string; error: string }[];
}> {
  const corrections = await getCorrections({ status: "approved" });

  // Group by dataset
  const datasetIds = new Set(corrections.map((c) => c.dataset_id));

  const results: ApplyCorrectionResult[] = [];
  const errors: { datasetId: string; error: string }[] = [];

  for (const datasetId of datasetIds) {
    try {
      const result = await applyCorrectionsToDataset(datasetId, uploadsDir);
      results.push(result);
    } catch (err) {
      errors.push({
        datasetId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results, errors };
}
