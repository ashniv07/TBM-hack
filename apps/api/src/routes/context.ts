import { Router } from "express";
import { runContextModel } from "@tbm/langgraph";
import { getContextEntityAliases, getContextGraph, traceFromEntity } from "@tbm/db";
import { UPLOAD_DIR } from "./datasets";
import { wrap } from "../wrap";

export const contextRouter = Router();

// Stage 4: rebuilds the entire Enterprise Context Model (Knowledge Graph)
// from every dataset that has reached Stage 3. This is a global, idempotent
// recompute rather than a per-dataset operation — the graph is inherently
// cross-dataset, so there's no meaningful "context model for one file".
//
// uploadsDir is passed through so row-level linking can still find a file
// whose storage_path was recorded on a different machine (e.g. a teammate's
// laptop, if the Postgres database is shared but local uploads aren't) — it
// retries using just the file's basename inside this server's own uploads dir.
contextRouter.post("/rebuild", wrap(async (req, res) => {
  const similarityThreshold = req.body?.similarityThreshold !== undefined ? Number(req.body.similarityThreshold) : undefined;
  const result = await runContextModel({ similarityThreshold, uploadsDir: UPLOAD_DIR });
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ ok: true, stats: result.stats, warnings: result.warnings ?? [] });
}));

contextRouter.get("/graph", wrap(async (_req, res) => {
  res.json(await getContextGraph());
}));

contextRouter.get("/entities/:id/aliases", wrap(async (req, res) => {
  res.json({ aliases: await getContextEntityAliases(req.params.id) });
}));

// Bounded-depth traversal from one entity — the queryable form of the
// "General Ledger -> Cost Center -> Business Unit -> ..." example chain.
contextRouter.get("/entities/:id/trace", wrap(async (req, res) => {
  const depth = req.query.depth ? Number(req.query.depth) : 6;
  res.json(await traceFromEntity(req.params.id, depth));
}));
