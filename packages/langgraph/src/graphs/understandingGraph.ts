import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { UnderstandingState } from "../understanding/state";
import { classifyColumnsNode } from "../understanding/classifyColumns";
import { detectRelationshipsNode } from "../understanding/detectRelationships";
import { persistClassificationsNode, persistRelationshipsNode } from "../understanding/persist";

const UnderstandingAnnotation = Annotation.Root({
  datasetId: Annotation<string>(),
  businessPurpose: Annotation<string | undefined>(),
  classifications: Annotation<UnderstandingState["classifications"]>(),
  relationships: Annotation<UnderstandingState["relationships"]>(),
  error: Annotation<string | undefined>(),
});

function buildUnderstandingGraph() {
  const graph = new StateGraph(UnderstandingAnnotation)
    .addNode("classifyColumns", classifyColumnsNode)
    .addNode("persistClassifications", persistClassificationsNode)
    .addNode("detectRelationships", detectRelationshipsNode)
    .addNode("persistRelationships", persistRelationshipsNode)
    .addEdge(START, "classifyColumns")
    .addConditionalEdges("classifyColumns", (s) => (s.error ? END : "persistClassifications"))
    .addConditionalEdges("persistClassifications", (s) => (s.error ? END : "detectRelationships"))
    .addEdge("detectRelationships", "persistRelationships")
    .addEdge("persistRelationships", END);

  return graph.compile();
}

export const understandingGraph = buildUnderstandingGraph();

export async function runUnderstanding(datasetId: string): Promise<UnderstandingState> {
  const result = await understandingGraph.invoke({ datasetId });
  return result as UnderstandingState;
}
