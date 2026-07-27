import { ContextState } from "../context/state";
import { resolveEntitiesNode } from "../context/resolveEntities";
import { buildEdgesNode } from "../context/buildEdges";
import { persistContextGraphNode } from "../context/persistContextGraph";

export async function runContextModel(input?: {
  similarityThreshold?: number;
  uploadsDir?: string;
}): Promise<ContextState> {
  let state: ContextState = { ...(input ?? {}) };

  state = { ...state, ...(await resolveEntitiesNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await buildEdgesNode(state)) };
  if (state.error) return state;

  state = { ...state, ...(await persistContextGraphNode(state)) };
  return state;
}
