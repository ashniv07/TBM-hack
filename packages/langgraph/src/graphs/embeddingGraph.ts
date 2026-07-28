import { EmbeddingState } from "../embedding/state";
import { embedEntitiesNode } from "../embedding/embedEntities";

export async function runEmbedding(
  datasetId: string,
  options?: { uploadsDir?: string; rows?: Record<string, unknown>[] }
): Promise<EmbeddingState> {
  const state: EmbeddingState = { datasetId, uploadsDir: options?.uploadsDir, rows: options?.rows };
  return { ...state, ...(await embedEntitiesNode(state)) };
}
