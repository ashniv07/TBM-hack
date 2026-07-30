import * as XLSX from "xlsx";
import { getDataset, getColumnMappings, getMissingTemplateColumns, getDatasetColumns } from "@tbm/db";
import { findMasterTemplate } from "./masterTemplates";

/**
 * A normalized row with columns renamed to master template column names.
 * Missing template columns are included with null values.
 */
export interface NormalizedRow {
  [masterColumn: string]: unknown;
}

/**
 * Result of normalizing a dataset to master format.
 */
export interface NormalizedDataset {
  datasetId: string;
  masterType: string;
  /** Column names in master template format */
  columns: string[];
  /** Data rows with master template column names */
  rows: NormalizedRow[];
  /** Mapping from master column name to original source column name */
  columnMapping: Map<string, string>;
  /** Template columns that have no source data (placeholder with nulls) */
  missingColumns: string[];
  /** Source columns that aren't mapped to any template column */
  unmappedSourceColumns: string[];
  /** Coverage percentage (0-1) */
  coverage: number;
}

/**
 * Reads source data from disk if available, or returns existing parsed rows.
 */
async function readSourceData(
  filePath: string,
  existingRows?: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (existingRows && existingRows.length > 0) {
    return existingRows;
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  } catch {
    return [];
  }
}

/**
 * Transforms source data into master template format.
 *
 * This function:
 * 1. Reads source data from the Excel file
 * 2. Uses column mappings to rename columns to master template names
 * 3. Adds placeholder columns for expected template columns that weren't supplied
 * 4. Returns the transformed data ready for data quality checks
 *
 * The transformation happens on-the-fly without persisting the normalized data,
 * keeping storage lean while still enabling quality checks on master-formatted data.
 */
export async function normalizeDatasetToMaster(
  datasetId: string,
  options?: {
    /** Path to uploads directory */
    uploadsDir?: string;
    /** Pre-parsed rows from ingestion */
    existingRows?: Record<string, unknown>[];
  }
): Promise<NormalizedDataset | null> {
  const dataset = await getDataset(datasetId);
  if (!dataset || !dataset.master_type) {
    return null;
  }

  const template = findMasterTemplate(dataset.master_type);
  if (!template) {
    return null;
  }

  // Get the column mappings
  const mappings = await getColumnMappings(datasetId);
  const missingColumns = await getMissingTemplateColumns(datasetId);

  // Build reverse mapping: source column → template column
  const sourceToTemplate = new Map<string, string>();
  const templateToSource = new Map<string, string>();

  for (const mapping of mappings) {
    if (mapping.template_column) {
      sourceToTemplate.set(mapping.source_column, mapping.template_column);
      templateToSource.set(mapping.template_column, mapping.source_column);
    }
  }

  // Determine unmapped source columns
  const unmappedSourceColumns = mappings
    .filter((m) => !m.template_column)
    .map((m) => m.source_column);

  // Read the source data
  let sourceRows: Record<string, unknown>[] = [];

  if (options?.existingRows && options.existingRows.length > 0) {
    sourceRows = options.existingRows;
  } else if (dataset.storage_path) {
    const filePath = options?.uploadsDir
      ? `${options.uploadsDir}/${dataset.storage_path.split("/").pop()}`
      : dataset.storage_path;
    sourceRows = await readSourceData(filePath);
  }

  // Build the list of all master columns (mapped + missing)
  const allMasterColumns: string[] = [];

  // First add mapped columns in template order
  for (const expectedCol of template.expectedColumns) {
    if (templateToSource.has(expectedCol)) {
      allMasterColumns.push(expectedCol);
    }
  }

  // Add missing columns
  for (const missingCol of missingColumns) {
    if (!allMasterColumns.includes(missingCol)) {
      allMasterColumns.push(missingCol);
    }
  }

  // Transform each row to master format
  const normalizedRows: NormalizedRow[] = sourceRows.map((sourceRow) => {
    const normalizedRow: NormalizedRow = {};

    // Map source columns to master column names
    for (const [sourceCol, value] of Object.entries(sourceRow)) {
      const templateCol = sourceToTemplate.get(sourceCol);
      if (templateCol) {
        normalizedRow[templateCol] = value;
      }
    }

    // Add null placeholders for missing columns
    for (const missingCol of missingColumns) {
      normalizedRow[missingCol] = null;
    }

    return normalizedRow;
  });

  // Calculate coverage
  const mappedCount = templateToSource.size;
  const expectedCount = template.expectedColumns.length;
  const coverage = expectedCount > 0 ? mappedCount / expectedCount : 0;

  return {
    datasetId,
    masterType: dataset.master_type,
    columns: allMasterColumns,
    rows: normalizedRows,
    columnMapping: templateToSource,
    missingColumns,
    unmappedSourceColumns,
    coverage,
  };
}

/**
 * Gets normalized data for multiple datasets of the same master type.
 * Useful for cross-dataset quality checks.
 */
export async function normalizeDatasetsByMasterType(
  masterType: string,
  options?: { uploadsDir?: string }
): Promise<NormalizedDataset[]> {
  const { listDatasets } = await import("@tbm/db");
  const datasets = await listDatasets();

  const matchingDatasets = datasets.filter((d) => d.master_type === masterType);
  const results: NormalizedDataset[] = [];

  for (const dataset of matchingDatasets) {
    const normalized = await normalizeDatasetToMaster(dataset.id, options);
    if (normalized) {
      results.push(normalized);
    }
  }

  return results;
}

/**
 * Gets a summary of normalization status for a dataset.
 * Useful for displaying in the UI without loading all rows.
 */
export async function getNormalizationSummary(datasetId: string): Promise<{
  datasetId: string;
  masterType: string | null;
  coverage: number;
  mappedColumns: number;
  missingColumns: number;
  unmappedSourceColumns: number;
  totalExpectedColumns: number;
  canNormalize: boolean;
} | null> {
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    return null;
  }

  if (!dataset.master_type) {
    return {
      datasetId,
      masterType: null,
      coverage: 0,
      mappedColumns: 0,
      missingColumns: 0,
      unmappedSourceColumns: 0,
      totalExpectedColumns: 0,
      canNormalize: false,
    };
  }

  const template = findMasterTemplate(dataset.master_type);
  const mappings = await getColumnMappings(datasetId);
  const missingCols = await getMissingTemplateColumns(datasetId);

  const mappedCount = mappings.filter((m) => m.template_column).length;
  const unmappedCount = mappings.filter((m) => !m.template_column).length;

  return {
    datasetId,
    masterType: dataset.master_type,
    coverage: dataset.template_coverage ?? 0,
    mappedColumns: mappedCount,
    missingColumns: missingCols.length,
    unmappedSourceColumns: unmappedCount,
    totalExpectedColumns: template?.expectedColumns.length ?? 0,
    canNormalize: mappedCount > 0,
  };
}
