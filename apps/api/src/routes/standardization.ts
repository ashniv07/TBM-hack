import { Router } from "express";
import { runStandardization, applyCorrectionsToDataset, applyAllApprovedCorrections } from "@tbm/langgraph";
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
  IssueStatus,
  CorrectionStatus,
} from "@tbm/db";
import { UPLOAD_DIR } from "./datasets";

export const standardizationRouter = Router();

// POST /api/standardization/run - Run full Stage 5 pipeline
standardizationRouter.post("/run", async (req, res) => {
  try {
    const result = await runStandardization({ uploadsDir: UPLOAD_DIR });
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    res.json({
      ok: true,
      stats: result.stats,
    });
  } catch (err) {
    console.error("Standardization pipeline failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Standardization pipeline failed",
    });
  }
});

// GET /api/standardization/schemas - List canonical schemas
standardizationRouter.get("/schemas", async (req, res) => {
  try {
    const sourceType = req.query.sourceType as string | undefined;
    const schemas = await getCanonicalSchemas(sourceType);
    res.json({ schemas });
  } catch (err) {
    console.error("Failed to fetch schemas:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch schemas",
    });
  }
});

// GET /api/standardization/issues - List quality issues
standardizationRouter.get("/issues", async (req, res) => {
  try {
    const filters: {
      datasetId?: string;
      status?: IssueStatus;
      severity?: string;
    } = {};

    if (req.query.datasetId) filters.datasetId = req.query.datasetId as string;
    if (req.query.status) filters.status = req.query.status as IssueStatus;
    if (req.query.severity) filters.severity = req.query.severity as string;

    const issues = await getQualityIssues(filters);
    res.json({ issues });
  } catch (err) {
    console.error("Failed to fetch issues:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch issues",
    });
  }
});

// PATCH /api/standardization/issues/:id/status - Update issue status
standardizationRouter.patch("/issues/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !["open", "acknowledged", "resolved", "ignored"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const issue = await updateQualityIssueStatus(req.params.id, status as IssueStatus);
    if (!issue) {
      return res.status(404).json({ error: "Issue not found" });
    }
    res.json({ issue });
  } catch (err) {
    console.error("Failed to update issue status:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to update issue status",
    });
  }
});

// GET /api/standardization/corrections - List corrections
standardizationRouter.get("/corrections", async (req, res) => {
  try {
    const filters: {
      datasetId?: string;
      status?: CorrectionStatus;
      issueId?: string;
    } = {};

    if (req.query.datasetId) filters.datasetId = req.query.datasetId as string;
    if (req.query.status) filters.status = req.query.status as CorrectionStatus;
    if (req.query.issueId) filters.issueId = req.query.issueId as string;

    const corrections = await getCorrections(filters);
    res.json({ corrections });
  } catch (err) {
    console.error("Failed to fetch corrections:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch corrections",
    });
  }
});

// POST /api/standardization/corrections/:id/approve - Approve single correction
standardizationRouter.post("/corrections/:id/approve", async (req, res) => {
  try {
    const approvedBy = req.body.approvedBy as string | undefined;
    const correction = await approveCorrection(req.params.id, approvedBy);
    if (!correction) {
      return res.status(404).json({ error: "Correction not found" });
    }
    res.json({ correction });
  } catch (err) {
    console.error("Failed to approve correction:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to approve correction",
    });
  }
});

// POST /api/standardization/corrections/:id/reject - Reject single correction
standardizationRouter.post("/corrections/:id/reject", async (req, res) => {
  try {
    const correction = await rejectCorrection(req.params.id);
    if (!correction) {
      return res.status(404).json({ error: "Correction not found" });
    }
    res.json({ correction });
  } catch (err) {
    console.error("Failed to reject correction:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to reject correction",
    });
  }
});

// POST /api/standardization/corrections/bulk-approve - Batch approve corrections
standardizationRouter.post("/corrections/bulk-approve", async (req, res) => {
  try {
    const { ids, approvedBy } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }

    const count = await bulkApproveCorrections(ids, approvedBy);
    res.json({ approved: count });
  } catch (err) {
    console.error("Failed to bulk approve corrections:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to bulk approve corrections",
    });
  }
});

// POST /api/standardization/corrections/:id/apply - Apply approved correction
standardizationRouter.post("/corrections/:id/apply", async (req, res) => {
  try {
    const correction = await markCorrectionApplied(req.params.id);
    if (!correction) {
      return res.status(404).json({
        error: "Correction not found or not approved",
      });
    }
    res.json({ correction });
  } catch (err) {
    console.error("Failed to apply correction:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to apply correction",
    });
  }
});

// GET /api/standardization/readiness - List all readiness scores
standardizationRouter.get("/readiness", async (req, res) => {
  try {
    const scores = await getReadinessScores();
    res.json({ scores });
  } catch (err) {
    console.error("Failed to fetch readiness scores:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch readiness scores",
    });
  }
});

// GET /api/standardization/readiness/:datasetId - Single dataset readiness score
standardizationRouter.get("/readiness/:datasetId", async (req, res) => {
  try {
    const score = await getReadinessScore(req.params.datasetId);
    if (!score) {
      return res.status(404).json({ error: "Readiness score not found for dataset" });
    }
    res.json({ score });
  } catch (err) {
    console.error("Failed to fetch readiness score:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch readiness score",
    });
  }
});

// GET /api/standardization/report - Full data quality report
standardizationRouter.get("/report", async (req, res) => {
  try {
    const [schemas, issues, corrections, scores] = await Promise.all([
      getCanonicalSchemas(),
      getQualityIssues(),
      getCorrections(),
      getReadinessScores(),
    ]);

    // Calculate summary statistics
    const totalIssues = issues.length;
    const criticalIssues = issues.filter((i) => i.severity === "critical" || i.severity === "error").length;
    const openIssues = issues.filter((i) => i.status === "open").length;
    const pendingCorrections = corrections.filter((c) => c.status === "pending").length;
    const avgReadiness = scores.length > 0
      ? scores.reduce((sum, s) => sum + s.overall_score, 0) / scores.length
      : 0;

    // Group issues by type
    const issuesByType: Record<string, number> = {};
    for (const issue of issues) {
      issuesByType[issue.issue_type] = (issuesByType[issue.issue_type] ?? 0) + 1;
    }

    // Group issues by severity
    const issuesBySeverity: Record<string, number> = {};
    for (const issue of issues) {
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] ?? 0) + 1;
    }

    // Datasets needing attention (low readiness)
    const datasetsNeedingAttention = scores
      .filter((s) => s.overall_score < 0.7)
      .sort((a, b) => a.overall_score - b.overall_score)
      .slice(0, 10);

    res.json({
      summary: {
        totalSchemas: schemas.length,
        totalIssues,
        criticalIssues,
        openIssues,
        pendingCorrections,
        datasetsScored: scores.length,
        averageReadinessScore: Number(avgReadiness.toFixed(3)),
      },
      issuesByType,
      issuesBySeverity,
      datasetsNeedingAttention: datasetsNeedingAttention.map((s) => ({
        datasetId: s.dataset_id,
        fileName: s.dataset_file_name,
        overallScore: s.overall_score,
        recommendations: s.recommendations,
      })),
      schemas,
      recentIssues: issues.slice(0, 20),
      recentCorrections: corrections.slice(0, 20),
    });
  } catch (err) {
    console.error("Failed to generate report:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate report",
    });
  }
});

// POST /api/standardization/apply/:datasetId - Apply approved corrections to a dataset (safe mode)
standardizationRouter.post("/apply/:datasetId", async (req, res) => {
  try {
    const result = await applyCorrectionsToDataset(req.params.datasetId, UPLOAD_DIR);
    res.json({
      ok: true,
      originalFile: result.originalFile,
      correctedFile: result.correctedFile,
      correctionsApplied: result.correctionsApplied,
      changes: result.changes,
    });
  } catch (err) {
    console.error("Failed to apply corrections:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to apply corrections",
    });
  }
});

// POST /api/standardization/apply-all - Apply all approved corrections across all datasets
standardizationRouter.post("/apply-all", async (req, res) => {
  try {
    const { results, errors } = await applyAllApprovedCorrections(UPLOAD_DIR);
    res.json({
      ok: errors.length === 0,
      results: results.map((r) => ({
        originalFile: r.originalFile,
        correctedFile: r.correctedFile,
        correctionsApplied: r.correctionsApplied,
        changes: r.changes,
      })),
      errors,
    });
  } catch (err) {
    console.error("Failed to apply all corrections:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to apply all corrections",
    });
  }
});
