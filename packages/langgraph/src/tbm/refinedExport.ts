import ExcelJS from "exceljs";
import path from "path";
import {
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
 *   ATUM <layer>       one sheet per ATUM layer that produced classifications.
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

  // ---- The refined data itself ----
  let rowsExported = 0;
  if (template) {
    // template column -> the source column that satisfies it
    const sourceFor = new Map<string, string>();
    for (const m of mappings) {
      // Unreviewed LLM suggestions are deliberately NOT used to place data: they
      // were measured wrong more often than right on real input. They appear in
      // the Column Mapping sheet for review, and count only once accepted (which
      // records them as a manual override).
      if (m.template_column && (m.method !== "llm" || m.is_override)) {
        sourceFor.set(m.template_column, m.source_column);
      }
    }

    const sheet = workbook.addWorksheet(sheetName(template.masterType));
    sheet.columns = template.expectedColumns.map((c) => ({ header: c, key: c, width: 22 }));
    header(sheet);

    const rows = await loadRows(dataset.storage_path, options?.uploadsDir);
    if (rows) {
      for (const row of rows) {
        const out: Record<string, unknown> = {};
        for (const templateColumn of template.expectedColumns) {
          const source = sourceFor.get(templateColumn);
          // Unsupplied template columns stay present and empty: the workbook
          // must have the shape Apptio expects.
          out[templateColumn] = source ? row[source] ?? null : null;
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

  // ---- ATUM, one sheet per layer that produced anything ----
  const byLayer = new Map<string, typeof atumMappings>();
  for (const m of atumMappings) {
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
      { metric: "ATUM classifications", value: atumMappings.filter((m) => m.category_id).length },
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

async function loadRows(storagePath: string, uploadsDir?: string) {
  const candidates = [storagePath];
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
