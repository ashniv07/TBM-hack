import { getApprovedAtumMappingsForGraph, getContextGraph, getReadinessScores, listDatasets } from "@tbm/db";
import { assembleTbmModel } from "./assemble";
import { buildCostFacts } from "./costFacts";
import { TbmDataModel } from "./state";

/**
 * Stage 7 — generates the Apptio-ready TBM data model from the current state of
 * Stages 4-6. Read-only: four queries and one pure assembly step, no writes and
 * no persisted model, so the export can never disagree with the graph.
 */
export async function buildTbmDataModel(options?: { uploadsDir?: string }): Promise<TbmDataModel> {
  // ponytail: cost facts are re-read from the source workbooks on every call,
  // which is the slow part (~150k rows across the sample set). Cache keyed on
  // dataset updated_at if this becomes the bottleneck — but a stored model is a
  // second source of truth, so measure before adding one.
  const [graph, classifications, datasets, readiness, cost] = await Promise.all([
    getContextGraph(),
    getApprovedAtumMappingsForGraph(),
    listDatasets(),
    getReadinessScores(),
    buildCostFacts({ uploadsDir: options?.uploadsDir }),
  ]);

  const model = assembleTbmModel({
    nodes: graph.nodes,
    edges: graph.edges,
    classifications,
    datasets,
    readiness,
    costFacts: cost.facts,
  });
  if (cost.unreadableDatasets.length) {
    model.warnings.push(
      `Could not read ${cost.unreadableDatasets.length} workbook(s) for cost extraction: ${cost.unreadableDatasets.join(", ")}.`
    );
  }
  return model;
}
