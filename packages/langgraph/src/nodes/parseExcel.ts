import ExcelJS from "exceljs";
import { IngestionState } from "../state";

export async function parseExcelNode(state: IngestionState): Promise<Partial<IngestionState>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(state.filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { error: "No worksheet found in file" };
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

  return {
    sheet: {
      sheetName: worksheet.name,
      headers,
      rows,
    },
  };
}
