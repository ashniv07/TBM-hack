import { IngestionState } from "../state";
import { readWorkbookRows } from "../shared/readWorkbookRows";

export async function parseExcelNode(state: IngestionState): Promise<Partial<IngestionState>> {
  try {
    const sheet = await readWorkbookRows(state.filePath);
    return { sheet };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse Excel file" };
  }
}
