import { EmbeddingState } from "../embedding/state";
import { embedEntitiesNode } from "../embedding/embedEntities";

export async function runEmbedding(
  datasetId: string,
  options?: { uploadsDir?: string }
): Promise<EmbeddingState> {
  const state: EmbeddingState = { datasetId, uploadsDir: options?.uploadsDir };
  return { ...state, ...(await embedEntitiesNode(state)) };
}
