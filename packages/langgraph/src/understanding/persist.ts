import { insertRelationships, recordRun, setDatasetBusinessPurpose, updateColumnUnderstandings, updateDatasetStatus } from "@tbm/db";
import { UnderstandingState } from "./state";

export async function persistClassificationsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  if (state.error || !state.classifications || !state.businessPurpose) {
    return { error: state.error ?? "Missing classification results" };
  }

  await recordRun(state.datasetId, "understanding", "running");
  await setDatasetBusinessPurpose(state.datasetId, state.businessPurpose);
  await updateColumnUnderstandings(state.classifications);

  return {};
}

export async function persistRelationshipsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  if (state.error) return {};

  await insertRelationships(state.relationships ?? []);
  await updateDatasetStatus(state.datasetId, "understood");
  await recordRun(state.datasetId, "understanding", "succeeded");

  return {};
}
