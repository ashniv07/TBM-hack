import { Router } from "express";
import { buildRefinedWorkbook, buildTbmDataModel, buildTbmWorkbook } from "@tbm/langgraph";
import { getColumnMappings, getMissingTemplateColumns, getTemplateCoverage, overrideColumnMapping } from "@tbm/db";
import { UPLOAD_DIR } from "./datasets";
import { wrap } from "../wrap";

export const tbmRouter = Router();

// Stage 7: the Apptio-ready TBM data model. Derived on every request from the
// current context graph, approved ATUM mappings, and readiness scores — there
// is nothing to "generate" and store, so there is nothing to invalidate.
tbmRouter.get("/model", wrap(async (_req, res) => {
  res.json(await buildTbmDataModel({ uploadsDir: UPLOAD_DIR }));
}));

tbmRouter.get("/export.xlsx", wrap(async (_req, res) => {
  const model = await buildTbmDataModel({ uploadsDir: UPLOAD_DIR });
  const buffer = await buildTbmWorkbook(model);
  const stamp = model.generatedAt.slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="tbm-data-model-${stamp}.xlsx"`);
  res.send(buffer);
}));

// Column coverage per dataset -- "the template expects N columns, this file
// supplies M", the metric the client asked for.
tbmRouter.get("/coverage", wrap(async (_req, res) => {
  res.json({ datasets: await getTemplateCoverage() });
}));

tbmRouter.get("/coverage/:datasetId", wrap(async (req, res) => {
  const [mappings, missingColumns] = await Promise.all([
    getColumnMappings(req.params.datasetId),
    getMissingTemplateColumns(req.params.datasetId),
  ]);
  res.json({
    mappings,
    missingColumns,
    unmappedSourceColumns: mappings.filter((m) => !m.template_column).map((m) => m.source_column),
  });
}));

// Reviewer re-points a mapping. Flagged as an override so a pipeline re-run
// never silently undoes it.
tbmRouter.post("/coverage/:datasetId/override", wrap(async (req, res) => {
  const { sourceColumn, templateColumn } = req.body ?? {};
  if (!sourceColumn) return res.status(400).json({ error: "sourceColumn is required" });
  res.json({ mapping: await overrideColumnMapping(req.params.datasetId, sourceColumn, templateColumn ?? null) });
}));

// The customer deliverable: source data re-shaped into its master template,
// with the mapping, gaps, quality findings and ATUM classifications alongside.
tbmRouter.get("/refined/:datasetId.xlsx", wrap(async (req, res) => {
  const result = await buildRefinedWorkbook(req.params.datasetId, { uploadsDir: UPLOAD_DIR });
  const base = result.fileName.replace(/\.xlsx?$/i, "");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${base}-refined.xlsx"`);
  res.send(result.buffer);
}));
