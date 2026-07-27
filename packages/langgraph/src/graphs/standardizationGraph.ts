import { StandardizationState } from "../standardization/state";
import { deriveSchemasNode } from "../standardization/deriveSchemas";
import { detectIssuesNode } from "../standardization/detectIssues";
import { generateCorrectionsNode } from "../standardization/generateCorrections";
import { calculateReadinessNode } from "../standardization/calculateReadiness";
import { persistStandardizationNode } from "../standardization/persist";

export async function runStandardization(input?: {
  uploadsDir?: string;
}): Promise<StandardizationState> {
  let state: StandardizationState = { ...(input ?? {}) };

  for (const node of [
    deriveSchemasNode,
    detectIssuesNode,
    generateCorrectionsNode,
    calculateReadinessNode,
    persistStandardizationNode,
  ]) {
    state = { ...state, ...(await node(state)) };
    if (state.error) return state;
  }
  return state;
}
