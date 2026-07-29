import path from "path";
import ExcelJS from "exceljs";
import fs from "fs";
import {
  getDataset,
  getDatasetColumns,
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
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetId}`);
  }

  // Get approved corrections for this dataset
  const corrections = await getCorrections({ datasetId, status: "approved" });
  if (corrections.length === 0) {
    throw new Error("No approved corrections to apply");
  }

  // Find the source file
  const candidatePaths = [dataset.storage_path];
  if (uploadsDir) {
    candidatePaths.push(path.join(uploadsDir, path.basename(dataset.storage_path)));
  }

  let sourcePath: string | null = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }

  if (!sourcePath) {
    throw new Error(`Source file not found: ${dataset.storage_path}`);
  }

  // Get column info for mapping column_id to column_name
  const columns = await getDatasetColumns(datasetId);
  const columnNameById = new Map(columns.map((c) => [c.id, c.column_name]));

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

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(cell.value ?? "").trim();
    headers.push(header);
    columnIndexByName.set(header, colNumber);
  });

  // Group corrections by column
  const correctionsByColumn = new Map<string, Correction[]>();
  for (const correction of corrections) {
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

  // Apply corrections row by row
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header row

    for (const [columnName, columnCorrections] of correctionsByColumn) {
      const colIndex = columnIndexByName.get(columnName);
      if (!colIndex) continue;

      const cell = row.getCell(colIndex);
      const cellValue = cell.value;
      const cellString = cellValue === null || cellValue === undefined
        ? ""
        : cellValue instanceof Date
          ? cellValue.toISOString()
          : String(cellValue).trim();

      for (const correction of columnCorrections) {
        if (!correction.original_value || !correction.corrected_value) continue;

        // Check if this cell matches the original value
        const originalNormalized = correction.original_value.trim().toLowerCase();
        const cellNormalized = cellString.toLowerCase();

        if (cellNormalized === originalNormalized || cellString === correction.original_value) {
          // Apply the correction
          let newValue: string | number | Date = correction.corrected_value;

          // Try to preserve data types
          if (correction.correction_type === "normalize_date") {
            // Parse ISO date string to Date object
            const parsed = new Date(correction.corrected_value);
            if (!isNaN(parsed.getTime())) {
              newValue = parsed;
            }
          } else if (correction.correction_type === "normalize_currency") {
            // Currency codes stay as strings
            newValue = correction.corrected_value.toUpperCase();
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
              originalValue: correction.original_value,
              correctedValue: correction.corrected_value,
              rowsAffected: 1,
            });
            appliedCorrectionIds.push(correction.id);
          }
        }
      }
    }
  });

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
