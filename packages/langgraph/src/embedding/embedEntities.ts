import { getEmbeddableColumns, recordRun, updateDatasetStatus, upsertEntityEmbedding } from "@tbm/db";
import { embedTexts } from "./embedText";
import { EmbeddingState } from "./state";

export async function embedEntitiesNode(state: EmbeddingState): Promise<Partial<EmbeddingState>> {
  await recordRun(state.datasetId, "embedding", "running");
  await updateDatasetStatus(state.datasetId, "embedding");

  const columns = await getEmbeddableColumns(state.datasetId);

  // (columnId, entityValue) pairs across all embeddable columns in this dataset
  const pairs: { columnId: string; value: string }[] = [];
  for (const col of columns) {
    const distinctValues = Array.from(
      new Set((col.sample_values ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0))
    );
    for (const value of distinctValues) {
      pairs.push({ columnId: col.id, value });
    }
  }

  if (pairs.length === 0) {
    await updateDatasetStatus(state.datasetId, "embedded");
    await recordRun(state.datasetId, "embedding", "succeeded");
    return { embeddedCount: 0 };
  }

  const vectors = await embedTexts(pairs.map((p) => p.value));

  for (let i = 0; i < pairs.length; i++) {
    await upsertEntityEmbedding({
      datasetId: state.datasetId,
      columnId: pairs[i].columnId,
      entityValue: pairs[i].value,
      embedding: vectors[i],
    });
  }

  await updateDatasetStatus(state.datasetId, "embedded");
  await recordRun(state.datasetId, "embedding", "succeeded");

  return { embeddedCount: pairs.length };
}
