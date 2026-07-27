import { Router } from "express";
import path from "path";
import { importAtumTaxonomy, runAtumMapping } from "@tbm/langgraph";
import { UPLOAD_DIR } from "./datasets";
import {
  AtumLayer,
  AtumMappingStatus,
  listAtumMappings,
  listAtumTaxonomyItems,
  reviewAtumMapping,
} from "@tbm/db";

export const atumRouter = Router();
const DEFAULT_TAXONOMY_FILE = path.resolve(
  __dirname, "..", "..", "..", "..", "packages", "langgraph", "data", "TBM-Taxonomy-v5.0.1-Data-Table.xlsx"
);
const LAYERS = new Set(["cost_pool", "resource_tower", "solution"]);

atumRouter.post("/taxonomy/import", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await importAtumTaxonomy(DEFAULT_TAXONOMY_FILE)) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Taxonomy import failed" });
  }
});

atumRouter.get("/taxonomy", async (req, res) => {
  try {
    const layer = req.query.layer as AtumLayer | undefined;
    if (layer && !LAYERS.has(layer)) return res.status(400).json({ error: "Invalid taxonomy layer" });
    const items = await listAtumTaxonomyItems({ layer, includeRetired: req.query.includeRetired === "true" });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load taxonomy" });
  }
});

atumRouter.post("/run", async (req, res) => {
  try {
    const layer = (req.body?.layer ?? "resource_tower") as AtumLayer;
    if (!LAYERS.has(layer)) return res.status(400).json({ error: "Invalid taxonomy layer" });
    const stats = await runAtumMapping({ layer, useLlm: req.body?.useLlm === true, uploadsDir: UPLOAD_DIR });
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "ATUM mapping failed" });
  }
});

atumRouter.get("/mappings", async (req, res) => {
  try {
    const mappings = await listAtumMappings({
      datasetId: req.query.datasetId as string | undefined,
      status: req.query.status as AtumMappingStatus | undefined,
      layer: req.query.layer as AtumLayer | undefined,
    });
    res.json({ mappings });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load mappings" });
  }
});

atumRouter.post("/mappings/:id/approve", async (req, res) => {
  const mapping = await reviewAtumMapping({ id: req.params.id, status: "approved", reviewedBy: req.body?.reviewedBy });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  res.json({ mapping });
});

atumRouter.post("/mappings/:id/reject", async (req, res) => {
  const mapping = await reviewAtumMapping({ id: req.params.id, status: "rejected", reviewedBy: req.body?.reviewedBy });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  res.json({ mapping });
});

atumRouter.post("/mappings/:id/override", async (req, res) => {
  if (!req.body?.categoryId) return res.status(400).json({ error: "categoryId is required" });
  const mapping = await reviewAtumMapping({
    id: req.params.id, status: "overridden", categoryId: req.body.categoryId, reviewedBy: req.body?.reviewedBy,
  });
  if (!mapping) return res.status(404).json({ error: "Mapping not found" });
  res.json({ mapping });
});

atumRouter.get("/report", async (_req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate ATUM report" });
  }
});
