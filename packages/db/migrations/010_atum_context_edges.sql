-- Stage 6 -> Stage 4 feedback loop: an approved ATUM mapping becomes a
-- 'maps_to_atum' edge from the Stage 4 canonical entity to a taxonomy node,
-- so the knowledge graph shows which ATUM category an entity resolved to
-- instead of the mapping living in a table nobody can see from the graph.

-- Taxonomy categories participate in the graph as their own node kind
-- (entity_type = 'atum_category', canonical_name = the taxonomy path). The
-- path is unique per category, so it doubles as the canonical name and is the
-- upsert target used by syncAtumEdgesToGraph().
--
-- Deliberately partial: a plain unique (entity_type, canonical_name) would
-- also constrain the entities Stage 4 clusters, which have no such guarantee.
create unique index if not exists idx_context_entities_atum_category
  on context_entities(canonical_name) where entity_type = 'atum_category';

-- Remember which mapping produced an edge so rejecting or overriding that
-- mapping can drop exactly its edge rather than rebuilding the whole graph.
alter table context_edges add column if not exists atum_mapping_id uuid
  references atum_mappings(id) on delete cascade;

create index if not exists idx_context_edges_atum_mapping
  on context_edges(atum_mapping_id);
