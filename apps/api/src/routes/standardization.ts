import { Router } from "express";
import {
  runStandardization, applyCorrectionsToDataset, applyAllApprovedCorrections,
  runUnderstanding, runEmbedding,
} from "@tbm/langgraph";
import {
  getCanonicalSchemas,
  getQualityIssues,
  updateQualityIssueStatus,
  getCorrections,
  approveCorrection,
  rejectCorrection,
  bulkApproveCorrections,
  markCorrectionApplied,
  getReadinessScores,
  getReadinessScore,
  getDataset,
  updateDatasetStatus,
  IssueStatus,
  CorrectionStatus,
} from "@tbm/db";
import { UPLOAD_DIR } from "./datasets";
import { wrap } from "../wrap";

export const standardizationRouter = Router();

// POST /api/standardization/run - Run full Stage 5 pipeline
standardizationRouter.post(
  "/run",
  wrap(async (_req, res) => {
    const result = await runStandardization({ uploadsDir: UPLOAD_DIR });
    if (result.error) return res.status(500).json({ error: result.error });
    res.json({ ok: true, stats: result.stats });
  })
);

// GET /api/standardization/schemas - List canonical schemas
standardizationRouter.get(
  "/schemas",
  wrap(async (req, res) => {
    const schemas = await getCanonicalSchemas(req.query.sourceType as string | undefined);
    res.json({ schemas });
  })
);

// GET /api/standardization/issues - List quality issues
standardizationRouter.get(
  "/issues",
  wrap(async (req, res) => {
    const issues = await getQualityIssues({
      datasetId: req.query.datasetId as string | undefined,
      status: req.query.status as IssueStatus | undefined,
      severity: req.query.severity as string | undefined,
    });
    res.json({ issues });
  })
);

// PATCH /api/standardization/issues/:id/status - Update issue status
standardizationRouter.patch(
  "/issues/:id/status",
  wrap(async (req, res) => {
    const { status } = req.body;
    if (!status || !["open", "acknowledged", "resolved", "ignored"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const issue = await updateQualityIssueStatus(req.params.id, status as IssueStatus);
    if (!issue) return res.status(404).json({ error: "Issue not found" });
    res.json({ issue });
  })
);

// GET /api/standardization/corrections - List corrections
standardizationRouter.get(
  "/corrections",
  wrap(async (req, res) => {
    const corrections = await getCorrections({
      datasetId: req.query.datasetId as string | undefined,
      status: req.query.status as CorrectionStatus | undefined,
      issueId: req.query.issueId as string | undefined,
    });
    res.json({ corrections });
  })
);

// POST /api/standardization/corrections/:id/approve - Approve single correction
standardizationRouter.post(
  "/corrections/:id/approve",
  wrap(async (req, res) => {
    const correction = await approveCorrection(req.params.id, req.body?.approvedBy);
    if (!correction) return res.status(404).json({ error: "Correction not found" });
    res.json({ correction });
  })
);

// POST /api/standardization/corrections/:id/reject - Reject single correction
standardizationRouter.post(
  "/corrections/:id/reject",
  wrap(async (req, res) => {
    const correction = await rejectCorrection(req.params.id);
    if (!correction) return res.status(404).json({ error: "Correction not found" });
    res.json({ correction });
  })
);

// POST /api/standardization/corrections/bulk-approve - Batch approve corrections
standardizationRouter.post(
  "/corrections/bulk-approve",
  wrap(async (req, res) => {
    const { ids, approvedBy } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    res.json({ approved: await bulkApproveCorrections(ids, approvedBy) });
  })
);

// POST /api/standardization/corrections/:id/apply - Mark an approved correction applied
standardizationRouter.post(
  "/corrections/:id/apply",
  wrap(async (req, res) => {
    const correction = await markCorrectionApplied(req.params.id);
    if (!correction) return res.status(404).json({ error: "Correction not found or not approved" });
    res.json({ correction });
  })
);

// GET /api/standardization/readiness - List all readiness scores
standardizationRouter.get(
  "/readiness",
  wrap(async (_req, res) => {
    res.json({ scores: await getReadinessScores() });
  })
);

// GET /api/standardization/readiness/:datasetId - Single dataset readiness score
standardizationRouter.get(
  "/readiness/:datasetId",
  wrap(async (req, res) => {
    const score = await getReadinessScore(req.params.datasetId);
    if (!score) return res.status(404).json({ error: "Readiness score not found for dataset" });
    res.json({ score });
  })
);

// GET /api/standardization/report - Full data quality report
standardizationRouter.get(
  "/report",
  wrap(async (_req, res) => {
    const [schemas, issues, corrections, scores] = await Promise.all([
      getCanonicalSchemas(),
      getQualityIssues(),
      getCorrections(),
      getReadinessScores(),
    ]);

    const issuesByType: Record<string, number> = {};
    const issuesBySeverity: Record<string, number> = {};
    for (const issue of issues) {
      issuesByType[issue.issue_type] = (issuesByType[issue.issue_type] ?? 0) + 1;
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] ?? 0) + 1;
    }
    const avgReadiness = scores.length
      ? scores.reduce((sum, s) => sum + Number(s.overall_score), 0) / scores.length
      : 0;

    res.json({
      summary: {
        totalSchemas: schemas.length,
        totalIssues: issues.length,
        criticalIssues: issues.filter((i) => i.severity === "critical" || i.severity === "error").length,
        openIssues: issues.filter((i) => i.status === "open").length,
        pendingCorrections: corrections.filter((c) => c.status === "pending").length,
        datasetsScored: scores.length,
        averageReadinessScore: Number(avgReadiness.toFixed(3)),
      },
      issuesByType,
      issuesBySeverity,
      datasetsNeedingAttention: scores
        .filter((s) => s.overall_score < 0.7)
        .sort((a, b) => a.overall_score - b.overall_score)
        .slice(0, 10)
        .map((s) => ({
          datasetId: s.dataset_id,
          fileName: s.dataset_file_name,
          overallScore: s.overall_score,
          recommendations: s.recommendations,
        })),
      schemas,
      recentIssues: issues.slice(0, 20),
      recentCorrections: corrections.slice(0, 20),
    });
  })
);

// POST /api/standardization/apply/:datasetId - Apply approved corrections to a dataset (safe mode)
standardizationRouter.post(
  "/apply/:datasetId",
  wrap(async (req, res) => {
    const result = await applyCorrectionsToDataset(req.params.datasetId, UPLOAD_DIR);
    res.json({
      ok: true,
      originalFile: result.originalFile,
      correctedFile: result.correctedFile,
      correctionsApplied: result.correctionsApplied,
      originalDatasetId: result.originalDatasetId,
      // The corrected file is registered as its own dataset, so Stages 6 and 7
      // can consume it without re-uploading.
      correctedDataset: result.correctedDataset ? {
        id: result.correctedDataset.id,
        fileName: result.correctedDataset.file_name,
        storagePath: result.correctedDataset.storage_path,
        status: result.correctedDataset.status,
        sourceType: result.correctedDataset.source_type,
      } : null,
      changes: result.changes,
    });
  })
);

// POST /api/standardization/apply-all - Apply all approved corrections across all datasets
standardizationRouter.post(
  "/apply-all",
  wrap(async (_req, res) => {
    const { results, errors } = await applyAllApprovedCorrections(UPLOAD_DIR);
    res.json({
      ok: errors.length === 0,
      results: results.map((r) => ({
        originalFile: r.originalFile,
        correctedFile: r.correctedFile,
        correctionsApplied: r.correctionsApplied,
        originalDatasetId: r.originalDatasetId,
        correctedDataset: r.correctedDataset ? {
          id: r.correctedDataset.id,
          fileName: r.correctedDataset.file_name,
          storagePath: r.correctedDataset.storage_path,
          status: r.correctedDataset.status,
          sourceType: r.correctedDataset.source_type,
        } : null,
        changes: r.changes,
      })),
      errors,
    });
  })
);

// POST /api/standardization/process-corrected/:datasetId - run Stages 2-3 on a
// corrected dataset so it joins the knowledge graph and becomes eligible for
// ATUM mapping, without a re-upload.
standardizationRouter.post(
  "/process-corrected/:datasetId",
  wrap(async (req, res) => {
    const datasetId = req.params.datasetId;
    const dataset = await getDataset(datasetId);
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });

    const understanding = await runUnderstanding(datasetId);
    if (understanding.error) return res.status(500).json({ error: understanding.error, stage: "understanding" });

    const embedding = await runEmbedding(datasetId, { uploadsDir: UPLOAD_DIR });
    if (embedding.error) return res.status(500).json({ error: embedding.error, stage: "embedding" });

    await updateDatasetStatus(datasetId, "embedded");
    res.json({
      ok: true,
      datasetId,
      fileName: dataset.file_name,
      stages: {
        understanding: {
          columnsClassified: understanding.classifications?.length ?? 0,
          relationshipsDetected: understanding.relationships?.length ?? 0,
        },
        embedding: { entitiesEmbedded: embedding.embeddedCount ?? 0 },
      },
      message: "Corrected dataset processed through Stages 2-3. Ready for Stage 4 (Context), Stage 6 (ATUM) and Stage 7 (TBM model).",
    });
  })
);
