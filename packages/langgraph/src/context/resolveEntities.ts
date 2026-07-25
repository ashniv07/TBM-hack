import { getAllEmbeddableEntityRows, getDatasetsWithEmbeddings, RawEntityEmbeddingRow } from "@tbm/db";
import { cosineDistance, UnionFind } from "./clustering";
import { ContextState, DatasetNode, EntityAlias, ResolvedEntity } from "./state";

const DEFAULT_SIMILARITY_THRESHOLD = 0.15;

/**
 * Resolves every raw (column, value) entity observation across all embedded
 * datasets into canonical entities, scoped per semantic role.
 *
 * Two passes, in order of decreasing certainty:
 * 1. Exact-match (case/whitespace-insensitive) grouping — always correct,
 *    independent of embedding quality. Handles "Finance" vs "FINANCE".
 * 2. Embedding-distance clustering (union-find) across the distinct
 *    normalized values from pass 1 — handles "Amazon EC2" ~ "AWS EC2".
 *    Quality of this pass depends on real OpenAI embeddings; see the
 *    hashFallbackRatio warning below.
 */
export async function resolveEntitiesNode(state: ContextState): Promise<Partial<ContextState>> {
  const threshold = state.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const [rows, datasets] = await Promise.all([getAllEmbeddableEntityRows(), getDatasetsWithEmbeddings()]);

  const datasetNodes: DatasetNode[] = datasets.map((d) => ({
    tempId: `dataset:${d.id}`,
    datasetId: d.id,
    canonicalName: d.file_name,
  }));

  if (rows.length === 0) {
    return {
      entities: [],
      aliases: [],
      datasetNodes,
      valueToEntity: {},
      warnings: ["No embedded entities found. Run Stage 3 (embedding) on at least one dataset before building the context model."],
      stats: { entityCount: 0, aliasCount: 0, edgeCount: 0, datasetsProcessed: 0, datasetsSkipped: [], hashFallbackRatio: 0 },
    };
  }

  const confirmedFallbackCount = rows.filter((r) => r.embedding_source === "hash_fallback").length;
  const unknownSourceCount = rows.filter((r) => r.embedding_source === "unknown").length;
  const hashFallbackRatio = Number(((confirmedFallbackCount + unknownSourceCount) / rows.length).toFixed(3));
  const warnings: string[] = [];
  if (confirmedFallbackCount > 0) {
    warnings.push(
      `${Math.round((confirmedFallbackCount / rows.length) * 100)}% of embeddings were confirmed produced without an ` +
        `OpenAI key (hash fallback). Semantic clustering is not meaningful for those values — they will only merge ` +
        `with exact (case/whitespace-insensitive) name matches, so cross-naming matches like "Amazon EC2" ~ "AWS EC2" ` +
        `will be missed until Stage 3 is re-run with OPENAI_API_KEY set.`
    );
  }
  if (unknownSourceCount > 0) {
    warnings.push(
      `${Math.round((unknownSourceCount / rows.length) * 100)}% of embeddings predate embedding-source tracking ` +
        `(added in migration 004) — their true source is unknown, not confirmed non-semantic. Re-run Stage 3 ` +
        `embedding (POST /api/datasets/:id/embed) on the affected datasets to get accurate tagging.`
    );
  }

  const byRole = new Map<string, RawEntityEmbeddingRow[]>();
  for (const row of rows) {
    const list = byRole.get(row.semantic_role) ?? [];
    list.push(row);
    byRole.set(row.semantic_role, list);
  }

  const entities: ResolvedEntity[] = [];
  const aliases: EntityAlias[] = [];
  const valueToEntity: Record<string, string> = {};

  for (const [role, roleRows] of byRole) {
    const normGroups = new Map<string, RawEntityEmbeddingRow[]>();
    for (const row of roleRows) {
      const key = row.entity_value.trim().toLowerCase();
      const list = normGroups.get(key) ?? [];
      list.push(row);
      normGroups.set(key, list);
    }

    const normKeys = Array.from(normGroups.keys()).sort();
    const representative = new Map<string, RawEntityEmbeddingRow>();
    for (const key of normKeys) {
      representative.set(key, normGroups.get(key)![0]);
    }

    const uf = new UnionFind();
    for (let i = 0; i < normKeys.length; i++) {
      for (let j = i + 1; j < normKeys.length; j++) {
        const a = representative.get(normKeys[i])!;
        const b = representative.get(normKeys[j])!;
        if (cosineDistance(a.embedding, b.embedding) < threshold) {
          uf.union(normKeys[i], normKeys[j]);
        }
      }
    }

    const clusters = new Map<string, string[]>();
    for (const key of normKeys) {
      const root = uf.find(key);
      const list = clusters.get(root) ?? [];
      list.push(key);
      clusters.set(root, list);
    }

    let clusterIndex = 0;
    for (const memberKeys of clusters.values()) {
      const tempId = `entity:${role}:${clusterIndex++}`;
      const memberRows = memberKeys.flatMap((k) => normGroups.get(k)!);

      const nameCounts = new Map<string, number>();
      for (const row of memberRows) {
        nameCounts.set(row.entity_value, (nameCounts.get(row.entity_value) ?? 0) + 1);
      }
      const canonicalName = Array.from(nameCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

      // Confidence reflects the weakest merge inside this cluster: a
      // singleton (no fuzzy merge at all) is confidence 1; a cluster formed
      // by uniting several normalized-value groups is only as confident as
      // its most distant pairwise match.
      let maxIntraClusterDistance = 0;
      for (let i = 0; i < memberKeys.length; i++) {
        for (let j = i + 1; j < memberKeys.length; j++) {
          const a = representative.get(memberKeys[i])!;
          const b = representative.get(memberKeys[j])!;
          maxIntraClusterDistance = Math.max(maxIntraClusterDistance, cosineDistance(a.embedding, b.embedding));
        }
      }
      const confidence = Number(Math.max(0, Math.min(1, 1 - maxIntraClusterDistance)).toFixed(3));

      entities.push({ tempId, entityType: role, canonicalName, confidence });

      for (const row of memberRows) {
        aliases.push({
          entityTempId: tempId,
          datasetId: row.dataset_id,
          columnId: row.column_id,
          entityValue: row.entity_value,
        });
        valueToEntity[`${row.column_id}::${row.entity_value}`] = tempId;
      }
    }
  }

  return {
    entities,
    aliases,
    datasetNodes,
    valueToEntity,
    warnings,
    stats: {
      entityCount: entities.length,
      aliasCount: aliases.length,
      edgeCount: 0,
      datasetsProcessed: datasetNodes.length,
      datasetsSkipped: [],
      hashFallbackRatio,
    },
  };
}
