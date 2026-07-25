import ExcelJS from "exceljs";
import fs from "fs";

export interface WorkbookRows {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * Reads the first worksheet of an .xlsx/.xls file into headers + row records.
 * Shared by Stage 1 ingestion and Stage 4 context-model row linking so both
 * stages see exactly the same data — if this diverged, Stage 4 could "find"
 * relationships involving values Stage 1/2/3 never profiled or embedded.
 */
export async function readWorkbookRows(filePath: string): Promise<WorkbookRows> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheet found in file");
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? "").trim());
  });

  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      const cell = row.getCell(idx + 1);
      record[header] = cell.value instanceof Date ? cell.value.toISOString() : cell.value ?? null;
    });
    rows.push(record);
  });

  return { sheetName: worksheet.name, headers, rows };
}
