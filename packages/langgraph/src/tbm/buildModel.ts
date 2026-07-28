import { getApprovedAtumMappingsForGraph, getContextGraph, getReadinessScores, listDatasets } from "@tbm/db";
import { assembleTbmModel } from "./assemble";
import { TbmDataModel } from "./state";

/**
 * Stage 7 — generates the Apptio-ready TBM data model from the current state of
 * Stages 4-6. Read-only: four queries and one pure assembly step, no writes and
 * no persisted model, so the export can never disagree with the graph.
 */
export async function buildTbmDataModel(): Promise<TbmDataModel> {
  const [graph, classifications, datasets, readiness] = await Promise.all([
    getContextGraph(),
    getApprovedAtumMappingsForGraph(),
    listDatasets(),
    getReadinessScores(),
  ]);

  return assembleTbmModel({
    nodes: graph.nodes,
    edges: graph.edges,
    classifications,
    datasets,
    readiness,
  });
}
