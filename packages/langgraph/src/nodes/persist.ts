import { createDataset, insertColumns, recordRun, setDatasetProfile, setDatasetSourceType, updateDatasetStatus } from "@tbm/db";
import { IngestionState } from "../state";

export async function persistNode(state: IngestionState): Promise<Partial<IngestionState>> {
  if (state.error || !state.sheet || !state.profile) {
    return { error: state.error ?? "Missing data to persist" };
  }

  const dataset = await createDataset({
    fileName: state.fileName,
    storagePath: state.filePath,
    sheetName: state.sheet.sheetName,
    uploadedBy: state.uploadedBy,
  });

  await recordRun(dataset.id, "ingestion", "running");
  await setDatasetProfile(dataset.id, state.sheet.rows.length);
  await insertColumns(
    dataset.id,
    state.profile.map((c) => ({ ...c, is_technical: false, semantic_role: null, semantic_role_confidence: null }))
  );

  if (state.sourceType) {
    await setDatasetSourceType(dataset.id, state.sourceType, state.sourceTypeConfidence ?? 0);
  }

  await updateDatasetStatus(dataset.id, "profiled");
  await recordRun(dataset.id, "ingestion", "succeeded");

  return { datasetId: dataset.id };
}
