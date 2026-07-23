import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { EmbeddingState } from "../embedding/state";
import { embedEntitiesNode } from "../embedding/embedEntities";

const EmbeddingAnnotation = Annotation.Root({
  datasetId: Annotation<string>(),
  embeddedCount: Annotation<number | undefined>(),
  error: Annotation<string | undefined>(),
});

function buildEmbeddingGraph() {
  const graph = new StateGraph(EmbeddingAnnotation)
    .addNode("embedEntities", embedEntitiesNode)
    .addEdge(START, "embedEntities")
    .addEdge("embedEntities", END);

  return graph.compile();
}

export const embeddingGraph = buildEmbeddingGraph();

export async function runEmbedding(datasetId: string): Promise<EmbeddingState> {
  const result = await embeddingGraph.invoke({ datasetId });
  return result as EmbeddingState;
}
