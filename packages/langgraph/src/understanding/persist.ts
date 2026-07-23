import { insertRelationship, recordRun, setDatasetBusinessPurpose, updateColumnUnderstanding, updateDatasetStatus } from "@tbm/db";
import { UnderstandingState } from "./state";

export async function persistClassificationsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  if (state.error || !state.classifications || !state.businessPurpose) {
    return { error: state.error ?? "Missing classification results" };
  }

  await recordRun(state.datasetId, "understanding", "running");
  await setDatasetBusinessPurpose(state.datasetId, state.businessPurpose);

  for (const c of state.classifications) {
    await updateColumnUnderstanding(c.columnId, {
      semanticRole: c.semanticRole,
      semanticRoleConfidence: c.semanticRoleConfidence,
      isTechnical: c.isTechnical,
    });
  }

  return {};
}

export async function persistRelationshipsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  if (state.error) return {};

  for (const r of state.relationships ?? []) {
    await insertRelationship({
      fromColumnId: r.fromColumnId,
      toColumnId: r.toColumnId,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
      reasoning: r.reasoning,
    });
  }

  await updateDatasetStatus(state.datasetId, "understood");
  await recordRun(state.datasetId, "understanding", "succeeded");

  return {};
}
