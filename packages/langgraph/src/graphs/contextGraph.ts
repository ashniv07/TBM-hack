import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ContextState } from "../context/state";
import { resolveEntitiesNode } from "../context/resolveEntities";
import { buildEdgesNode } from "../context/buildEdges";
import { persistContextGraphNode } from "../context/persistContextGraph";

const ContextAnnotation = Annotation.Root({
  similarityThreshold: Annotation<number | undefined>(),
  uploadsDir: Annotation<string | undefined>(),
  entities: Annotation<ContextState["entities"]>(),
  aliases: Annotation<ContextState["aliases"]>(),
  datasetNodes: Annotation<ContextState["datasetNodes"]>(),
  valueToEntity: Annotation<ContextState["valueToEntity"]>(),
  edges: Annotation<ContextState["edges"]>(),
  warnings: Annotation<ContextState["warnings"]>(),
  stats: Annotation<ContextState["stats"]>(),
  error: Annotation<string | undefined>(),
});

function buildContextModelGraph() {
  const graph = new StateGraph(ContextAnnotation)
    .addNode("resolveEntities", resolveEntitiesNode)
    .addNode("buildEdges", buildEdgesNode)
    .addNode("persistContextGraph", persistContextGraphNode)
    .addEdge(START, "resolveEntities")
    .addConditionalEdges("resolveEntities", (s) => (s.error ? END : "buildEdges"))
    .addConditionalEdges("buildEdges", (s) => (s.error ? END : "persistContextGraph"))
    .addEdge("persistContextGraph", END);

  return graph.compile();
}

export const contextGraph = buildContextModelGraph();

export async function runContextModel(input?: { similarityThreshold?: number; uploadsDir?: string }): Promise<ContextState> {
  const result = await contextGraph.invoke(input ?? {});
  return result as ContextState;
}
