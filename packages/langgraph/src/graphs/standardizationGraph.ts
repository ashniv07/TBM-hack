import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { StandardizationState } from "../standardization/state";
import { deriveSchemasNode } from "../standardization/deriveSchemas";
import { detectIssuesNode } from "../standardization/detectIssues";
import { generateCorrectionsNode } from "../standardization/generateCorrections";
import { calculateReadinessNode } from "../standardization/calculateReadiness";
import { persistStandardizationNode } from "../standardization/persist";

const StandardizationAnnotation = Annotation.Root({
  uploadsDir: Annotation<string | undefined>(),
  schemas: Annotation<StandardizationState["schemas"]>(),
  issues: Annotation<StandardizationState["issues"]>(),
  corrections: Annotation<StandardizationState["corrections"]>(),
  readinessScores: Annotation<StandardizationState["readinessScores"]>(),
  persistedSchemas: Annotation<StandardizationState["persistedSchemas"]>(),
  persistedIssues: Annotation<StandardizationState["persistedIssues"]>(),
  persistedCorrections: Annotation<StandardizationState["persistedCorrections"]>(),
  persistedReadinessScores: Annotation<StandardizationState["persistedReadinessScores"]>(),
  stats: Annotation<StandardizationState["stats"]>(),
  error: Annotation<string | undefined>(),
});

function buildStandardizationGraph() {
  const graph = new StateGraph(StandardizationAnnotation)
    .addNode("deriveSchemas", deriveSchemasNode)
    .addNode("detectIssues", detectIssuesNode)
    .addNode("generateCorrections", generateCorrectionsNode)
    .addNode("calculateReadiness", calculateReadinessNode)
    .addNode("persistStandardization", persistStandardizationNode)
    .addEdge(START, "deriveSchemas")
    .addConditionalEdges("deriveSchemas", (s) => (s.error ? END : "detectIssues"))
    .addConditionalEdges("detectIssues", (s) => (s.error ? END : "generateCorrections"))
    .addConditionalEdges("generateCorrections", (s) => (s.error ? END : "calculateReadiness"))
    .addConditionalEdges("calculateReadiness", (s) => (s.error ? END : "persistStandardization"))
    .addEdge("persistStandardization", END);

  return graph.compile();
}

export const standardizationGraph = buildStandardizationGraph();

export async function runStandardization(input?: { uploadsDir?: string }): Promise<StandardizationState> {
  const result = await standardizationGraph.invoke(input ?? {});
  return result as StandardizationState;
}
