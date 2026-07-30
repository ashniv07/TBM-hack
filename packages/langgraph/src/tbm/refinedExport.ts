import ExcelJS from "exceljs";
import path from "path";
import {
  AtumMappingView,
  ColumnMapping,
  getColumnMappings,
  getDataset,
  getMissingTemplateColumns,
  getQualityIssues,
  listAtumMappings,
} from "@tbm/db";
import { readWorkbookRows } from "../shared/readWorkbookRows";
import { findMasterTemplate } from "../templates/masterTemplates";

/**
 * The customer-facing deliverable: one workbook per source file, containing the
 * data re-shaped into its Apptio master template, plus the evidence for every
 * decision taken to get there.
 *
 * Sheet layout:
 *   <Master Type>      the source rows under TEMPLATE column names, in template
 *                      order. Columns the source did not supply are present but
 *                      empty — the shape must match what Apptio expects, and a
 *                      blank column is a visible gap rather than a silent one.
 *   Column Mapping     source column -> template column, with confidence and
 *                      the method that produced it. This is the audit trail for
 *                      the sheet above and the review surface for corrections.
 *   Missing Columns    template columns nothing supplied.
 *   Unmapped Source    columns the customer sent that the template has no place
 *                      for. Carried here rather than dropped, since they are
 *                      often where a missing mapping is hiding.
 *   Data Quality       issues found against this dataset.
 *   ATUM <layer>       one sheet per ATUM layer with APPROVED classifications only.
 *   Summary            coverage and counts.
 */

export interface RefinedExportResult {
  datasetId: string;
  fileName: string;
  masterType: string | null;
  rowsExported: number;
  buffer: Buffer;
}

function sheetName(name: string): string {
  return name.replace(/[[\]*?/\\:]/g, " ").slice(0, 31);
}

function header(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
}

export async function buildRefinedWorkbook(
  datasetId: string,
  options?: { uploadsDir?: string }
): Promise<RefinedExportResult> {
  const dataset = await getDataset(datasetId);
  if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

  const [mappings, missingColumns, issues, atumMappings] = await Promise.all([
    getColumnMappings(datasetId),
    getMissingTemplateColumns(datasetId),
    getQualityIssues({ datasetId }),
    listAtumMappings({ datasetId }),
  ]);

  const template = dataset.master_type ? findMasterTemplate(dataset.master_type) : undefined;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TBM Data Trust & Intelligence Platform";
  workbook.created = new Date();

  // Filter to only approved ATUM mappings for the export
  const approvedMappings = atumMappings.filter((m) => m.status === "approved" || m.status === "overridden");

  // Build ATUM lookup by value (case-insensitive) for cost_pool layer
  // Maps source values to their ATUM classification (level_1 = Cost Pool, level_2 = Cost Sub Pool)
  const costPoolLookup = new Map<string, { l1: string; l2: string; l3: string }>();
  for (const m of approvedMappings) {
    if (!m.category_id || m.layer !== "cost_pool") continue;
    const valueKey = m.source_value.toLowerCase();
    costPoolLookup.set(valueKey, {
      l1: m.level_1 ?? "",
      l2: m.level_2 ?? "",
      l3: m.level_3 ?? "",
    });
  }

  // Build ATUM lookup for resource_tower layer
  const resourceTowerLookup = new Map<string, { l1: string; l2: string; l3: string }>();
  for (const m of approvedMappings) {
    if (!m.category_id || m.layer !== "resource_tower") continue;
    const valueKey = m.source_value.toLowerCase();
    resourceTowerLookup.set(valueKey, {
      l1: m.level_1 ?? "",
      l2: m.level_2 ?? "",
      l3: m.level_3 ?? "",
    });
  }

  // ---- The refined data itself ----
  let rowsExported = 0;
  if (template) {
    // template column -> the source column that satisfies it
    const sourceFor = new Map<string, string>();
    for (const m of mappings) {
      if (m.template_column && (m.method !== "llm" || m.is_override)) {
        sourceFor.set(m.template_column, m.source_column);
      }
    }

    const sheet = workbook.addWorksheet(sheetName(template.masterType));
    // Use only template columns (ATUM will update Cost Pool / Cost Sub Pool directly)
    sheet.columns = template.expectedColumns.map((c) => ({ header: c, key: c, width: 22 }));
    header(sheet);

    // Load refined file - this is the source for both data and ATUM lookups
    // The refined dataset from Data Quality phase contains the mapped columns
    const refinedRows = await loadRows(dataset, options?.uploadsDir);

    if (refinedRows) {
      for (const row of refinedRows) {
        const out: Record<string, unknown> = {};
        for (const templateColumn of template.expectedColumns) {
          // In refined file, columns are already named with template names
          // In source file, we need to map source -> template
          const sourceCol = sourceFor.get(templateColumn);
          // Try template column name first (for refined file), then source column name
          out[templateColumn] = row[templateColumn] ?? (sourceCol ? row[sourceCol] : null) ?? null;
        }

        // Apply ATUM Cost Pool mapping: update "Cost Pool" and "Cost Sub Pool" columns
        // by looking up any cell value in the REFINED row against approved ATUM mappings
        if (costPoolLookup.size > 0) {
          for (const cellValue of Object.values(row)) {
            if (cellValue == null || cellValue === "") continue;
            const match = costPoolLookup.get(String(cellValue).toLowerCase());
            if (match) {
              // Override Cost Pool with ATUM level 1, Cost Sub Pool with ATUM level 2
              if (match.l1) out["Cost Pool"] = match.l1;
              if (match.l2) out["Cost Sub Pool"] = match.l2;
              break; // Use first match found
            }
          }
        }

        // Apply ATUM Resource Tower mapping: update "IT Resource Tower" and "IT Resource Sub Tower" columns
        if (resourceTowerLookup.size > 0) {
          for (const cellValue of Object.values(row)) {
            if (cellValue == null || cellValue === "") continue;
            const match = resourceTowerLookup.get(String(cellValue).toLowerCase());
            if (match) {
              // Override Resource Tower columns with ATUM values
              if (match.l1) out["IT Resource Tower"] = match.l1;
              if (match.l2) out["IT Resource Sub Tower"] = match.l2;
              break; // Use first match found
            }
          }
        }

        sheet.addRow(out);
        rowsExported++;
      }
    }
  }

  addTable(workbook, "Column Mapping",
    [
      { header: "Source Column", key: "source", width: 34 },
      { header: "Template Column", key: "template", width: 34 },
      { header: "Confidence", key: "confidence", width: 12 },
      { header: "Method", key: "method", width: 14 },
      { header: "Reviewer Override", key: "override", width: 18 },
    ],
    mappings.map((m: ColumnMapping) => ({
      source: m.source_column,
      template: m.template_column ?? "",
      confidence: m.template_column ? Number(m.confidence) : "",
      method: m.method,
      override: m.is_override ? "yes" : "",
    }))
  );

  addTable(workbook, "Missing Columns",
    [{ header: "Template Column Not Supplied", key: "c", width: 44 }],
    missingColumns.map((c) => ({ c }))
  );

  addTable(workbook, "Unmapped Source",
    [{ header: "Source Column With No Template Place", key: "c", width: 44 }],
    mappings.filter((m) => !m.template_column).map((m) => ({ c: m.source_column }))
  );

  addTable(workbook, "Data Quality",
    [
      { header: "Severity", key: "severity", width: 12 },
      { header: "Type", key: "type", width: 20 },
      { header: "Column", key: "column", width: 28 },
      { header: "Issue", key: "title", width: 44 },
      { header: "Suggested Fix", key: "fix", width: 52 },
    ],
    issues.map((i) => ({
      severity: i.severity, type: i.issue_type, column: i.column_name ?? "",
      title: i.title, fix: i.suggested_fix ?? "",
    }))
  );

  // ---- ATUM sheets - ONLY approved/overridden mappings ----
  const byLayer = new Map<string, AtumMappingView[]>();
  for (const m of approvedMappings) {
    if (!m.category_id) continue;
    byLayer.set(m.layer, [...(byLayer.get(m.layer) ?? []), m]);
  }
  for (const [layer, layerMappings] of byLayer) {
    const label = layer === "cost_pool" ? "ATUM Cost Pools" : layer === "resource_tower" ? "ATUM Resource Towers" : `ATUM ${layer}`;
    addTable(workbook, label,
      [
        { header: "Source Value", key: "value", width: 34 },
        { header: "Column", key: "column", width: 26 },
        { header: "Level 1", key: "l1", width: 24 },
        { header: "Level 2", key: "l2", width: 24 },
        { header: "Level 3", key: "l3", width: 24 },
        { header: "Confidence", key: "confidence", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Method", key: "method", width: 18 },
        { header: "Reasoning", key: "reasoning", width: 70 },
      ],
      layerMappings.map((m) => ({
        value: m.source_value, column: m.column_name,
        l1: m.level_1 ?? "", l2: m.level_2 ?? "", l3: m.level_3 ?? "",
        confidence: Number(m.confidence), status: m.status, method: m.method,
        reasoning: m.reasoning ?? "",
      }))
    );
  }

  const summary = addTable(workbook, "Summary",
    [{ header: "Metric", key: "metric", width: 34 }, { header: "Value", key: "value", width: 60 }],
    [
      { metric: "Source file", value: dataset.file_name },
      { metric: "Master template", value: dataset.master_type ?? "not recognised" },
      { metric: "Template columns expected", value: dataset.template_expected_count ?? 0 },
      { metric: "Columns supplied", value: dataset.template_matched_count ?? 0 },
      { metric: "Column coverage", value: `${Math.round(Number(dataset.template_coverage ?? 0) * 100)}%` },
      { metric: "Source columns with no template place", value: mappings.filter((m) => !m.template_column).length },
      { metric: "Rows exported", value: rowsExported },
      { metric: "Quality issues", value: issues.length },
      { metric: "ATUM approved classifications", value: approvedMappings.filter((m) => m.category_id).length },
      { metric: "ATUM total classifications", value: atumMappings.filter((m) => m.category_id).length },
      { metric: "Generated", value: new Date().toISOString() },
    ]
  );
  summary.getColumn("value").alignment = { wrapText: true };

  return {
    datasetId,
    fileName: dataset.file_name,
    masterType: dataset.master_type,
    rowsExported,
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

function addTable(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[]
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName(name));
  sheet.columns = columns;
  header(sheet);
  sheet.addRows(rows);
  return sheet;
}

async function loadRows(dataset: { refined_path: string | null; storage_path: string }, uploadsDir?: string) {
  // Prefer refined file (only mapped columns with template column names)
  const candidates: string[] = [];
  if (dataset.refined_path) {
    candidates.push(dataset.refined_path);
    if (uploadsDir) candidates.push(path.join(uploadsDir, path.basename(dataset.refined_path)));
  }
  // Fall back to source file
  candidates.push(dataset.storage_path);
  if (uploadsDir) candidates.push(path.join(uploadsDir, path.basename(dataset.storage_path)));

  for (const candidate of candidates) {
    try {
      return (await readWorkbookRows(candidate)).rows;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function loadSourceRows(storagePath: string, uploadsDir?: string) {
  // Load directly from source file (for ATUM lookups which use original values)
  const candidates: string[] = [storagePath];
  if (uploadsDir) candidates.push(path.join(uploadsDir, path.basename(storagePath)));

  for (const candidate of candidates) {
    try {
      return (await readWorkbookRows(candidate)).rows;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
