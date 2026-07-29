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
const LAYERS = new Set(["cost_pool", "resource_tower", "solution"]);

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
