import { UnderstandingState } from "../understanding/state";
import { classifyColumnsNode } from "../understanding/classifyColumns";
import { detectRelationshipsNode } from "../understanding/detectRelationships";
import { persistClassificationsNode, persistRelationshipsNode } from "../understanding/persist";

export async function runUnderstanding(datasetId: string): Promise<UnderstandingState> {
  let state: UnderstandingState = { datasetId };

  state = { ...state, ...(await classifyColumnsNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await persistClassificationsNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await detectRelationshipsNode(state)) };
  state = { ...state, ...(await persistRelationshipsNode(state)) };
  return state;
}
