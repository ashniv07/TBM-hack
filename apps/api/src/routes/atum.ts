import { Router } from "express";
import path from "path";
import { importAtumTaxonomy, runAtumMapping } from "@tbm/langgraph";
import { UPLOAD_DIR } from "./datasets";
import {
  AtumLayer,
  AtumMappingStatus,
  listAtumMappings,
  listAtumTaxonomyItems,
  removeAtumEdgesForMapping,
  reviewAtumMapping,
  syncAtumEdgesToGraph,
} from "@tbm/db";
import { wrap } from "../wrap";

export const atumRouter = Router();
const DEFAULT_TAXONOMY_FILE = path.resolve(
  __dirname, "..", "..", "..", "..", "packages", "langgraph", "data", "TBM-Taxonomy-v5.0.1-Data-Table.xlsx"
);
// Technology Solutions is intentionally unsupported: the client confirmed it
// varies per organisation and cannot be standardised.
const LAYERS = new Set(["cost_pool", "resource_tower"]);

atumRouter.post("/taxonomy/import", wrap(async (_req, res) => {
  res.json({ ok: true, ...(await importAtumTaxonomy(DEFAULT_TAXONOMY_FILE)) });
}));

atumRouter.get("/taxonomy", wrap(async (req, res) => {
  const layer = req.query.layer as AtumLayer | undefined;
  if (layer && !LAYERS.has(layer)) return res.status(400).json({ error: "Invalid taxonomy layer" });
  const items = await listAtumTaxonomyItems({ layer, includeRetired: req.query.includeRetired === "true" });
  res.json({ items });
}));

atumRouter.post("/run", wrap(async (req, res) => {
  const layer = (req.body?.layer ?? "resource_tower") as AtumLayer;
  if (!LAYERS.has(layer)) return res.status(400).json({ error: "Invalid taxonomy layer" });
  const stats = await runAtumMapping({ layer, useLlm: req.body?.useLlm === true, uploadsDir: UPLOAD_DIR });
  // Auto-approved (>=0.85) mappings should show up in the knowledge graph
  // straight away, otherwise the run looks like it did nothing to the graph.
  const graph = await syncAtumEdgesToGraph({ layer });
  res.json({ ok: true, stats, graph });
}));

atumRouter.get("/mappings", wrap(async (req, res) => {
  const mappings = await listAtumMappings({
    datasetId: req.query.datasetId as string | undefined,
    status: req.query.status as AtumMappingStatus | undefined,
    layer: req.query.layer as AtumLayer | undefined,
  });
  res.json({ mappings });
}));

atumRouter.post("/mappings/:id/approve", wrap(async (req, res) => {
  const mapping = await reviewAtumMapping({ id: req.params.id, status: "approved", reviewedBy: req.body?.reviewedBy });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  const graph = await syncAtumEdgesToGraph({ mappingId: mapping.id });
  // linked=0 means the mapping's anchor value has no Stage 4 alias, so it can
  // never become a graph edge. Surfaced rather than failing silently.
  res.json({ mapping, linkedToGraph: graph.edges > 0 });
}));

// Bulk approve multiple mappings at once
atumRouter.post("/mappings/bulk-approve", wrap(async (req, res) => {
  const { ids, reviewedBy } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  const results: { id: string; success: boolean; linkedToGraph?: boolean }[] = [];
  for (const id of ids) {
    try {
      const mapping = await reviewAtumMapping({ id, status: "approved", reviewedBy });
      if (mapping) {
        const graph = await syncAtumEdgesToGraph({ mappingId: mapping.id });
        results.push({ id, success: true, linkedToGraph: graph.edges > 0 });
      } else {
        results.push({ id, success: false });
      }
    } catch {
      results.push({ id, success: false });
    }
  }
  res.json({
    ok: true,
    approved: results.filter(r => r.success).length,
    results
  });
}));

// Bulk accept suggestions - applies best alternative to all unresolved/uncategorized mappings
atumRouter.post("/mappings/bulk-accept-suggestions", wrap(async (req, res) => {
  const { layer, minConfidence = 0, reviewedBy } = req.body;
  const mappings = await listAtumMappings({ layer });

  // Find mappings that have no category but have alternatives
  const needsSuggestion = mappings.filter(m =>
    !m.category_id && m.alternatives && m.alternatives.length > 0
  );

  const results: { id: string; sourceValue: string; success: boolean; categoryPath?: string }[] = [];

  for (const mapping of needsSuggestion) {
    const best = mapping.alternatives![0];
    if (best.confidence < minConfidence) {
      results.push({ id: mapping.id, sourceValue: mapping.source_value, success: false });
      continue;
    }

    try {
      const updated = await reviewAtumMapping({
        id: mapping.id,
        status: "overridden",
        categoryId: best.categoryId,
        reviewedBy: reviewedBy ?? "bulk-suggestion",
      });
      if (updated) {
        await syncAtumEdgesToGraph({ mappingId: updated.id });
        results.push({
          id: mapping.id,
          sourceValue: mapping.source_value,
          success: true,
          categoryPath: best.path
        });
      } else {
        results.push({ id: mapping.id, sourceValue: mapping.source_value, success: false });
      }
    } catch {
      results.push({ id: mapping.id, sourceValue: mapping.source_value, success: false });
    }
  }

  res.json({
    ok: true,
    applied: results.filter(r => r.success).length,
    total: needsSuggestion.length,
    results
  });
}));

atumRouter.post("/mappings/:id/reject", wrap(async (req, res) => {
  const mapping = await reviewAtumMapping({ id: req.params.id, status: "rejected", reviewedBy: req.body?.reviewedBy });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  // Drop the edge so a rejected entity no longer claims a taxonomy category.
  await removeAtumEdgesForMapping(mapping.id);
  res.json({ mapping });
}));

atumRouter.post("/mappings/:id/override", wrap(async (req, res) => {
  if (!req.body?.categoryId) return res.status(400).json({ error: "categoryId is required" });
  const mapping = await reviewAtumMapping({
    id: req.params.id, status: "overridden", categoryId: req.body.categoryId, reviewedBy: req.body?.reviewedBy,
  });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  // The category changed, so the edge to the old category is stale.
  await removeAtumEdgesForMapping(mapping.id);
  const graph = await syncAtumEdgesToGraph({ mappingId: mapping.id });
  res.json({ mapping, linkedToGraph: graph.edges > 0 });
}));

atumRouter.post("/sync-graph", wrap(async (req, res) => {
  const layer = req.body?.layer as AtumLayer | undefined;
  if (layer && !LAYERS.has(layer)) return res.status(400).json({ error: "Invalid taxonomy layer" });
  res.json({ ok: true, ...(await syncAtumEdgesToGraph({ layer })) });
}));

atumRouter.get("/report", wrap(async (_req, res) => {
  const mappings = await listAtumMappings();
  const byStatus: Record<string, number> = {};
  const byTower: Record<string, number> = {};
  for (const mapping of mappings) {
    byStatus[mapping.status] = (byStatus[mapping.status] ?? 0) + 1;
    if (mapping.level_2) byTower[mapping.level_2] = (byTower[mapping.level_2] ?? 0) + 1;
  }
  const classified = mappings.filter((m) => m.category_id).length;
  res.json({
    total: mappings.length,
    classified,
    coverage: mappings.length ? Number((classified / mappings.length).toFixed(3)) : 0,
    averageConfidence: mappings.length ? Number((mappings.reduce((s, m) => s + Number(m.confidence), 0) / mappings.length).toFixed(3)) : 0,
    byStatus,
    byTower,
  });
}));
