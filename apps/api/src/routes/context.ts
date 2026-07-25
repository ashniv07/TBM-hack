import { Router } from "express";
import { runContextModel } from "@tbm/langgraph";
import { getContextEntityAliases, getContextGraph, traceFromEntity } from "@tbm/db";
import { UPLOAD_DIR } from "./datasets";

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
contextRouter.post("/rebuild", async (req, res) => {
  try {
    const similarityThreshold = req.body?.similarityThreshold !== undefined ? Number(req.body.similarityThreshold) : undefined;
    const result = await runContextModel({ similarityThreshold, uploadsDir: UPLOAD_DIR });
    if (result.error) return res.status(500).json({ error: result.error });
    res.json({ ok: true, stats: result.stats, warnings: result.warnings ?? [] });
  } catch (err) {
    // Without this, a transient DB error (e.g. a statement timeout under
    // concurrent load on the shared Supabase instance) becomes an unhandled
    // promise rejection that crashes the whole process, not just this request.
    console.error("Context rebuild failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Context rebuild failed" });
  }
});

contextRouter.get("/graph", async (_req, res) => {
  try {
    const graph = await getContextGraph();
    res.json(graph);
  } catch (err) {
    console.error("Fetching context graph failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load context graph" });
  }
});

contextRouter.get("/entities/:id/aliases", async (req, res) => {
  try {
    const aliases = await getContextEntityAliases(req.params.id);
    res.json({ aliases });
  } catch (err) {
    console.error("Fetching entity aliases failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load aliases" });
  }
});

// Bounded-depth traversal from one entity — the queryable form of the
// "General Ledger -> Cost Center -> Business Unit -> ..." example chain.
contextRouter.get("/entities/:id/trace", async (req, res) => {
  try {
    const depth = req.query.depth ? Number(req.query.depth) : 6;
    const trace = await traceFromEntity(req.params.id, depth);
    res.json(trace);
  } catch (err) {
    console.error("Entity trace failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Trace failed" });
  }
});
