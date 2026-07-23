import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { runEmbedding, runIngestion, runUnderstanding } from "@tbm/langgraph";
import { getDataset, getDatasetColumns, getRelationshipsForDataset, listDatasets } from "@tbm/db";

const UPLOAD_DIR = path.join(__dirname, "..", "..", "storage", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    if (!ok) return cb(new Error("Only .xlsx/.xls files are supported"));
    cb(null, true);
  },
});

export const datasetsRouter = Router();

// Batch upload: multiple Excel files, each run through the ingestion graph independently.
datasetsRouter.post("/upload", upload.array("files", 20), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const CONCURRENCY = 3;
  const results: { fileName: string; datasetId?: string; error?: string; stage?: string }[] = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const ingested = await runIngestion({
            filePath: file.path,
            fileName: file.originalname,
            uploadedBy: req.header("x-user-email") ?? undefined,
          });
          if (ingested.error || !ingested.datasetId) {
            return { fileName: file.originalname, error: ingested.error ?? "Ingestion failed", stage: "ingestion" };
          }

          // Stage 2 & 3 run automatically after ingestion so a single upload
          // demonstrates the full pipeline. Failures here don't roll back
          // ingestion — the dataset still shows up in the catalog either way.
          try {
            await runUnderstanding(ingested.datasetId);
            await runEmbedding(ingested.datasetId);
          } catch (stageErr) {
            return {
              fileName: file.originalname,
              datasetId: ingested.datasetId,
              error: stageErr instanceof Error ? stageErr.message : "Understanding/embedding failed",
              stage: "understanding",
            };
          }

          return { fileName: file.originalname, datasetId: ingested.datasetId };
        } catch (err) {
          return { fileName: file.originalname, error: err instanceof Error ? err.message : "Unknown error", stage: "ingestion" };
        }
      })
    );
    results.push(...batchResults);
  }

  res.json({ results });
});

datasetsRouter.get("/", async (_req, res) => {
  const datasets = await listDatasets();
  res.json({ datasets });
});

datasetsRouter.get("/:id", async (req, res) => {
  const dataset = await getDataset(req.params.id);
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });
  const columns = await getDatasetColumns(req.params.id);
  res.json({ dataset, columns });
});

datasetsRouter.get("/:id/relationships", async (req, res) => {
  const dataset = await getDataset(req.params.id);
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });
  const relationships = await getRelationshipsForDataset(req.params.id);
  res.json({ relationships });
});

// Re-run Stage 2 (understanding) on demand, e.g. after uploading a related
// dataset so relationship detection can pick up the new cross-file matches.
datasetsRouter.post("/:id/understand", async (req, res) => {
  const dataset = await getDataset(req.params.id);
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });
  const result = await runUnderstanding(req.params.id);
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ ok: true });
});

// Re-run Stage 3 (embeddings) on demand.
datasetsRouter.post("/:id/embed", async (req, res) => {
  const dataset = await getDataset(req.params.id);
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });
  const result = await runEmbedding(req.params.id);
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ ok: true, embeddedCount: result.embeddedCount });
});
