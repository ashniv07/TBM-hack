import { Router } from "express";
import { buildTbmDataModel, buildTbmWorkbook } from "@tbm/langgraph";
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
