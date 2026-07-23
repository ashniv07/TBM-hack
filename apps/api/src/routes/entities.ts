import { Router } from "express";
import { getCrossDatasetMatches } from "@tbm/db";

export const entitiesRouter = Router();

// Stage 3 demo endpoint: entities from different datasets whose embeddings
// are close together, e.g. "Amazon EC2" (AWS Billing) ~ "AWS EC2" (CMDB).
entitiesRouter.get("/matches", async (req, res) => {
  const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : 0.25;
  const limit = req.query.limit ? Number(req.query.limit) : 30;
  const matches = await getCrossDatasetMatches(maxDistance, limit);
  res.json({ matches });
});
