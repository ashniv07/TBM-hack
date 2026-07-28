import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import {
  generateTbmDataModel,
  retrieveTbmDataModel,
  formatAsJson,
  formatAsCsv,
  formatAsXlsx,
} from "@tbm/langgraph";
import { listTbmExports, getTbmExport, getKnowledgeGraphForExport } from "@tbm/db";

export const tbmExportRouter = Router();

const EXPORT_DIR = path.resolve(__dirname, "..", "..", "exports");

// Ensure export directory exists
async function ensureExportDir() {
  try {
    await fs.access(EXPORT_DIR);
  } catch {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
  }
}

/**
 * POST /api/tbm-export/generate
 * Generate a TBM Data Model from the knowledge graph and ATUM mappings.
 */
tbmExportRouter.post("/generate", async (req, res) => {
  try {
    const {
      exportType = "full",
      format = "json",
      includeUnmapped = false,
      includeLowConfidence = false,
      confidenceThreshold = 0.7,
    } = req.body || {};

    const result = await generateTbmDataModel({
      exportType,
      format,
      includeUnmapped,
      includeLowConfidence,
      confidenceThreshold,
    });

    if (result.status === "failed") {
      return res.status(500).json({ error: result.error });
    }

    // Save file if requested
    if (format !== "json" || req.body?.saveFile) {
      await ensureExportDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      let filePath: string;
      let fileContent: Buffer | string;

      if (format === "xlsx") {
        filePath = path.join(EXPORT_DIR, `tbm_export_${timestamp}.xlsx`);
        fileContent = formatAsXlsx(result.model!);
        await fs.writeFile(filePath, fileContent);
      } else if (format === "csv") {
        // For CSV, create a directory with multiple files
        const csvDir = path.join(EXPORT_DIR, `tbm_export_${timestamp}`);
        await fs.mkdir(csvDir, { recursive: true });
        const csvFiles = formatAsCsv(result.model!);
        for (const [filename, content] of Object.entries(csvFiles)) {
          await fs.writeFile(path.join(csvDir, filename), content);
        }
        filePath = csvDir;
      } else {
        filePath = path.join(EXPORT_DIR, `tbm_export_${timestamp}.json`);
        fileContent = formatAsJson(result.model!);
        await fs.writeFile(filePath, fileContent);
      }

      return res.json({
        ok: true,
        exportId: result.exportId,
        recordCount: result.recordCount,
        filePath,
        model: result.model,
      });
    }

    res.json({
      ok: true,
      exportId: result.exportId,
      recordCount: result.recordCount,
      model: result.model,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

/**
 * GET /api/tbm-export/list
 * List all TBM exports.
 */
tbmExportRouter.get("/list", async (_req, res) => {
  try {
    const exports = await listTbmExports();
    res.json({ exports });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list exports" });
  }
});

/**
 * GET /api/tbm-export/:id
 * Get a specific export's details and data.
 */
tbmExportRouter.get("/:id", async (req, res) => {
  try {
    const tbmExport = await getTbmExport(req.params.id);
    if (!tbmExport) {
      return res.status(404).json({ error: "Export not found" });
    }

    const model = await retrieveTbmDataModel(req.params.id);
    res.json({ export: tbmExport, model });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get export" });
  }
});

/**
 * GET /api/tbm-export/:id/download
 * Download export in specified format.
 */
tbmExportRouter.get("/:id/download", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    const model = await retrieveTbmDataModel(req.params.id);

    if (!model) {
      return res.status(404).json({ error: "Export not found or has no data" });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "xlsx") {
      const buffer = formatAsXlsx(model);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="tbm_export_${timestamp}.xlsx"`);
      return res.send(buffer);
    } else if (format === "csv") {
      // For CSV, we'll zip the files or return the first one
      const csvFiles = formatAsCsv(model);
      const files = Object.entries(csvFiles);
      if (files.length === 1) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${files[0][0]}"`);
        return res.send(files[0][1]);
      } else {
        // Return as JSON object with all CSVs
        res.setHeader("Content-Type", "application/json");
        return res.json({ files: csvFiles });
      }
    } else {
      const json = formatAsJson(model);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="tbm_export_${timestamp}.json"`);
      return res.send(json);
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Download failed" });
  }
});

/**
 * GET /api/tbm-export/knowledge-graph
 * Get the full knowledge graph for export preview.
 */
tbmExportRouter.get("/preview/knowledge-graph", async (_req, res) => {
  try {
    const graph = await getKnowledgeGraphForExport();

    // Group entities by type for preview
    const byType: Record<string, number> = {};
    for (const entity of graph.entities) {
      byType[entity.entity_type] = (byType[entity.entity_type] || 0) + 1;
    }

    // Group edges by type
    const edgesByType: Record<string, number> = {};
    for (const edge of graph.edges) {
      edgesByType[edge.edge_type] = (edgesByType[edge.edge_type] || 0) + 1;
    }

    res.json({
      entityCount: graph.entities.length,
      edgeCount: graph.edges.length,
      entitiesByType: byType,
      edgesByType: edgesByType,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get knowledge graph" });
  }
});

/**
 * GET /api/tbm-export/summary
 * Get summary statistics for TBM export readiness.
 */
tbmExportRouter.get("/preview/summary", async (_req, res) => {
  try {
    const graph = await getKnowledgeGraphForExport();

    // Count entities by type
    const entityCounts: Record<string, number> = {};
    for (const entity of graph.entities) {
      entityCounts[entity.entity_type] = (entityCounts[entity.entity_type] || 0) + 1;
    }

    // Count ATUM mappings
    const atumMappedCount = graph.edges.filter((e) => e.edge_type === "maps_to_atum").length;

    res.json({
      costCenters: entityCounts["cost_center"] || 0,
      applications: entityCounts["application"] || 0,
      vendors: entityCounts["vendor"] || 0,
      cloudResources: entityCounts["cloud_resource"] || 0,
      businessUnits: entityCounts["business_unit"] || 0,
      departments: entityCounts["department"] || 0,
      atumMappedEntities: atumMappedCount,
      totalEntities: graph.entities.length,
      totalEdges: graph.edges.length,
      readyForExport: graph.entities.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get summary" });
  }
});
