import { rebuildContextGraph } from "@tbm/db";
import { ContextState } from "./state";

export async function persistContextGraphNode(state: ContextState): Promise<Partial<ContextState>> {
  if (state.error) return {};
  if (!state.entities || !state.aliases || !state.datasetNodes || !state.edges) {
    return { error: "Missing computed graph data to persist" };
  }

  const result = await rebuildContextGraph({
    entities: state.entities,
    datasetNodes: state.datasetNodes,
    aliases: state.aliases,
    edges: state.edges,
  });

  return {
    stats: {
      entityCount: result.entityCount,
      aliasCount: result.aliasCount,
      edgeCount: result.edgeCount,
      datasetsProcessed: state.stats?.datasetsProcessed ?? state.datasetNodes.length,
      datasetsSkipped: state.stats?.datasetsSkipped ?? [],
      hashFallbackRatio: state.stats?.hashFallbackRatio ?? 0,
    },
  };
}
