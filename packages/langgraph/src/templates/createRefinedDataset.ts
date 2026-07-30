import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import { getDataset, getColumnMappings, updateDatasetRefinedPath } from "@tbm/db";

/**
 * Creates a refined Excel file containing only mapped columns.
 * This is the output of the Relationship phase and input to Data Quality.
 *
 * The refined file:
 * - Contains only columns that are mapped to the master template
 * - Uses template column names (standardized naming)
 * - Excludes unmapped source columns
 */
export async function createRefinedDataset(
  datasetId: string,
  options?: { uploadsDir?: string }
): Promise<{
  refinedPath: string;
  refinedFileName: string;
  mappedColumns: number;
  totalRows: number;
} | null> {
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    console.log("[CreateRefined] Dataset not found:", datasetId);
    return null;
  }

  // Get column mappings
  const mappings = await getColumnMappings(datasetId);
  const mappedColumns = mappings.filter((m) => m.template_column);

  if (mappedColumns.length === 0) {
    console.log("[CreateRefined] No mapped columns for dataset:", dataset.file_name);
    return null;
  }

  // Find the source file
  const candidatePaths = [dataset.storage_path];
  if (options?.uploadsDir) {
    candidatePaths.push(path.join(options.uploadsDir, path.basename(dataset.storage_path)));
  }

  let sourcePath: string | null = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }

  if (!sourcePath) {
    console.log("[CreateRefined] Source file not found:", dataset.storage_path);
    return null;
  }

  // Read the source workbook
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(sourcePath);
  const sourceWorksheet = sourceWorkbook.worksheets[0];

  if (!sourceWorksheet) {
    console.log("[CreateRefined] No worksheet found in source file");
    return null;
  }

  // Get source headers and their column indices
  const sourceHeaders: string[] = [];
  const sourceColIndex = new Map<string, number>();
  const sourceColIndexLower = new Map<string, number>();

  sourceWorksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(cell.value ?? "").trim();
    sourceHeaders.push(header);
    sourceColIndex.set(header, colNumber);
    sourceColIndexLower.set(header.toLowerCase(), colNumber);
  });

  // Helper to find column index (case-insensitive)
  const findColIndex = (name: string): number | undefined => {
    return sourceColIndex.get(name) ?? sourceColIndexLower.get(name.toLowerCase());
  };

  // Create mapping from source column to template column
  const sourceToTemplate = new Map<string, string>();
  for (const mapping of mappedColumns) {
    if (mapping.template_column) {
      sourceToTemplate.set(mapping.source_column, mapping.template_column);
    }
  }

  // Create a new workbook with only mapped columns
  const refinedWorkbook = new ExcelJS.Workbook();
  const refinedWorksheet = refinedWorkbook.addWorksheet(dataset.sheet_name ?? "Refined Data");

  // Build the header row with template column names
  const refinedHeaders: { sourceCol: string; templateCol: string; sourceIndex: number }[] = [];
  for (const mapping of mappedColumns) {
    const sourceIndex = findColIndex(mapping.source_column);
    if (sourceIndex && mapping.template_column) {
      refinedHeaders.push({
        sourceCol: mapping.source_column,
        templateCol: mapping.template_column,
        sourceIndex,
      });
    }
  }

  // Write header row with template column names
  const headerRow = refinedWorksheet.getRow(1);
  refinedHeaders.forEach((h, idx) => {
    headerRow.getCell(idx + 1).value = h.templateCol;
  });
  headerRow.commit();

  // Copy data rows (only mapped columns)
  let rowCount = 0;
  sourceWorksheet.eachRow({ includeEmpty: false }, (sourceRow, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const refinedRow = refinedWorksheet.getRow(rowNumber);
    refinedHeaders.forEach((h, idx) => {
      const sourceCell = sourceRow.getCell(h.sourceIndex);
      refinedRow.getCell(idx + 1).value = sourceCell.value;
    });
    refinedRow.commit();
    rowCount++;
  });

  // Generate refined file path
  const ext = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, ext);
  const dirName = path.dirname(sourcePath);
  const refinedFileName = `${baseName}_refined${ext}`;
  const refinedPath = path.join(dirName, refinedFileName);

  // Write the refined file
  await refinedWorkbook.xlsx.writeFile(refinedPath);

  // Update dataset with refined path
  await updateDatasetRefinedPath(datasetId, refinedPath);

  console.log(`[CreateRefined] Created refined dataset: ${refinedFileName}`);
  console.log(`[CreateRefined] Mapped columns: ${refinedHeaders.length}, Rows: ${rowCount}`);

  return {
    refinedPath,
    refinedFileName,
    mappedColumns: refinedHeaders.length,
    totalRows: rowCount,
  };
}
