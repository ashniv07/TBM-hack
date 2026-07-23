import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { IngestionState } from "../state";
import { parseExcelNode } from "../nodes/parseExcel";
import { profileDatasetNode } from "../nodes/profileDataset";
import { inferSourceTypeNode } from "../nodes/inferSourceType";
import { persistNode } from "../nodes/persist";

const IngestionAnnotation = Annotation.Root({
  filePath: Annotation<string>(),
  fileName: Annotation<string>(),
  uploadedBy: Annotation<string | undefined>(),
  datasetId: Annotation<string | undefined>(),
  sheet: Annotation<IngestionState["sheet"]>(),
  profile: Annotation<IngestionState["profile"]>(),
  sourceType: Annotation<string | undefined>(),
  sourceTypeConfidence: Annotation<number | undefined>(),
  error: Annotation<string | undefined>(),
});

function buildIngestionGraph() {
  const graph = new StateGraph(IngestionAnnotation)
    .addNode("parseExcel", parseExcelNode)
    .addNode("profileDataset", profileDatasetNode)
    .addNode("inferSourceType", inferSourceTypeNode)
    .addNode("persist", persistNode)
    .addEdge(START, "parseExcel")
    .addConditionalEdges("parseExcel", (s) => (s.error ? END : "profileDataset"))
    .addConditionalEdges("profileDataset", (s) => (s.error ? END : "inferSourceType"))
    .addEdge("inferSourceType", "persist")
    .addEdge("persist", END);

  return graph.compile();
}

export const ingestionGraph = buildIngestionGraph();

export async function runIngestion(input: { filePath: string; fileName: string; uploadedBy?: string }): Promise<IngestionState> {
  const result = await ingestionGraph.invoke(input);
  return result as IngestionState;
}
