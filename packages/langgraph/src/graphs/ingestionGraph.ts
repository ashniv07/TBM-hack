import { IngestionState } from "../state";
import { parseExcelNode } from "../nodes/parseExcel";
import { profileDatasetNode } from "../nodes/profileDataset";
import { inferSourceTypeNode } from "../nodes/inferSourceType";
import { persistNode } from "../nodes/persist";

export async function runIngestion(input: {
  filePath: string;
  fileName: string;
  uploadedBy?: string;
}): Promise<IngestionState> {
  let state: IngestionState = { ...input };

  state = { ...state, ...(await parseExcelNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await profileDatasetNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await inferSourceTypeNode(state)) };
  state = { ...state, ...(await persistNode(state)) };
  return state;
}
