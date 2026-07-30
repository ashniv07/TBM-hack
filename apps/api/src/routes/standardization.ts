import { Router } from "express";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import {
  runStandardization, applyCorrectionsToDataset, applyAllApprovedCorrections,
  runUnderstanding, runEmbedding, generateAIFixForIssue,
  normalizeDatasetToMaster, getNormalizationSummary,
} from "@tbm/langgraph";
import {
  getCanonicalSchemas,
  getQualityIssues,
  getQualityIssue,
  updateQualityIssueStatus,
  getCorrections,
  approveCorrection,
  rejectCorrection,
  bulkApproveCorrections,
  markCorrectionApplied,
  getReadinessScores,
  getReadinessScore,
  getDataset,
  listDatasets,
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

// POST /api/standardization/issues/:id/acknowledge - Acknowledge issue and apply AI fix
// This generates corrections, auto-approves them, and marks the issue as acknowledged
standardizationRouter.post(
  "/issues/:id/acknowledge",
  wrap(async (req, res) => {
    const issueId = req.params.id;

    // 1. Get the issue to verify it exists
    const issue = await getQualityIssue(issueId);
    if (!issue) return res.status(404).json({ error: "Issue not found" });

    // 2. Generate AI fix for the issue
    const fixResult = await generateAIFixForIssue(issueId);
    if (!fixResult.ok) {
      return res.status(400).json({ error: fixResult.error || "Failed to generate fix" });
    }

    // 3. Auto-approve all generated corrections
    const correctionIds = fixResult.corrections?.map((c: { id: string }) => c.id) ?? [];
    if (correctionIds.length > 0) {
      await bulkApproveCorrections(correctionIds);
    }

    // 4. Mark issue as acknowledged
    await updateQualityIssueStatus(issueId, "acknowledged");

    // 5. Fetch updated corrections
    const corrections = await getCorrections({ issueId });

    res.json({
      ok: true,
      issue: { ...issue, status: "acknowledged" },
      corrections,
      message: `Generated and approved ${correctionIds.length} correction(s)`,
    });
  })
);

// POST /api/standardization/issues/:id/reject - Reject an issue (mark as ignored)
standardizationRouter.post(
  "/issues/:id/reject",
  wrap(async (req, res) => {
    const issue = await updateQualityIssueStatus(req.params.id, "ignored");
    if (!issue) return res.status(404).json({ error: "Issue not found" });
    res.json({ ok: true, issue });
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

// GET /api/standardization/download-corrected/:datasetId - Download the corrected dataset file
standardizationRouter.get(
  "/download-corrected/:datasetId",
  async (req, res) => {
    const datasetId = req.params.datasetId;
    console.log("[Download] === Starting download for dataset:", datasetId);

    try {
      const dataset = await getDataset(datasetId);
      if (!dataset) {
        console.log("[Download] Dataset not found in DB");
        res.status(404);
        res.json({ error: "Dataset not found" });
        return;
      }

      console.log("[Download] Dataset found:", dataset.file_name);
      console.log("[Download] storage_path:", dataset.storage_path);
      console.log("[Download] UPLOAD_DIR:", UPLOAD_DIR);

      // Try to find the file
      const candidatePaths = [
        dataset.storage_path,
        path.join(UPLOAD_DIR, path.basename(dataset.storage_path)),
      ];

      let filePath: string | null = null;
      for (const candidate of candidatePaths) {
        const exists = fs.existsSync(candidate);
        console.log("[Download] Checking:", candidate, "exists:", exists);
        if (exists) {
          filePath = candidate;
          break;
        }
      }

      if (!filePath) {
        console.log("[Download] File not found on disk");
        res.status(404);
        res.json({
          error: "File not found on disk",
          storage_path: dataset.storage_path,
          upload_dir: UPLOAD_DIR,
          checked_paths: candidatePaths
        });
        return;
      }

      // Get absolute path
      const absolutePath = path.resolve(filePath);
      console.log("[Download] Absolute path:", absolutePath);

      // Get file stats
      const stats = fs.statSync(absolutePath);
      console.log("[Download] File size:", stats.size);

      const fileName = dataset.file_name;
      console.log("[Download] Sending as:", fileName);

      // Use sendFile with explicit options
      res.sendFile(absolutePath, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        }
      }, (err) => {
        if (err) {
          console.error("[Download] sendFile error:", err);
        } else {
          console.log("[Download] File sent successfully");
        }
      });
    } catch (err) {
      console.error("[Download] Error:", err);
      res.status(500);
      res.json({ error: err instanceof Error ? err.message : "Download failed" });
    }
  }
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

// GET /api/standardization/preview - Get preview of all corrections grouped by dataset
// Shows which columns will be changed and the before/after values
standardizationRouter.get(
  "/preview",
  wrap(async (req, res) => {
    const datasetId = req.query.datasetId as string | undefined;

    // Get all approved and applied corrections (both show in preview)
    const [approved, applied] = await Promise.all([
      getCorrections({ datasetId, status: "approved" as CorrectionStatus }),
      getCorrections({ datasetId, status: "applied" as CorrectionStatus }),
    ]);
    const corrections = [...approved, ...applied];

    // Group corrections by dataset
    const byDataset: Record<string, {
      datasetId: string;
      fileName: string;
      columns: Record<string, {
        columnName: string;
        changes: { original: string; corrected: string; type: string; confidence: number; reasoning?: string }[];
      }>;
    }> = {};

    for (const c of corrections) {
      if (!byDataset[c.dataset_id]) {
        byDataset[c.dataset_id] = {
          datasetId: c.dataset_id,
          fileName: c.dataset_file_name ?? "Unknown",
          columns: {},
        };
      }

      const colKey = c.column_id ?? "_general";
      const colName = c.column_name ?? "General";

      if (!byDataset[c.dataset_id].columns[colKey]) {
        byDataset[c.dataset_id].columns[colKey] = {
          columnName: colName,
          changes: [],
        };
      }

      byDataset[c.dataset_id].columns[colKey].changes.push({
        original: c.original_value ?? "",
        corrected: c.corrected_value ?? "",
        type: c.correction_type,
        confidence: c.confidence,
        reasoning: c.reasoning ?? undefined,
      });
    }

    // Convert to array format
    const datasets = Object.values(byDataset).map(d => ({
      ...d,
      columns: Object.values(d.columns),
      totalChanges: Object.values(d.columns).reduce((sum, col) => sum + col.changes.length, 0),
    }));

    res.json({
      datasets,
      totalDatasets: datasets.length,
      totalChanges: datasets.reduce((sum, d) => sum + d.totalChanges, 0),
    });
  })
);

// GET /api/standardization/export/:datasetId - Export standardization report for a dataset
// Returns an Excel file with all issues, corrections, and changes
standardizationRouter.get(
  "/export/:datasetId",
  wrap(async (req, res) => {
    const datasetId = req.params.datasetId;
    const dataset = await getDataset(datasetId);
    if (!dataset) return res.status(404).json({ error: "Dataset not found" });

    // Fetch all data for this dataset
    const [issues, corrections, score] = await Promise.all([
      getQualityIssues({ datasetId }),
      getCorrections({ datasetId }),
      getReadinessScore(datasetId),
    ]);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = [
      ["Dataset", dataset.file_name],
      ["Source Type", dataset.source_type ?? "Unknown"],
      ["Total Issues", issues.length],
      ["Open Issues", issues.filter(i => i.status === "open").length],
      ["Acknowledged Issues", issues.filter(i => i.status === "acknowledged").length],
      ["Resolved Issues", issues.filter(i => i.status === "resolved").length],
      ["Total Corrections", corrections.length],
      ["Applied Corrections", corrections.filter(c => c.status === "applied").length],
      ["Approved Corrections", corrections.filter(c => c.status === "approved").length],
      ["Pending Corrections", corrections.filter(c => c.status === "pending").length],
      [""],
      ["Readiness Scores"],
      ["Overall", score ? `${Math.round(score.overall_score * 100)}%` : "N/A"],
      ["Completeness", score ? `${Math.round(score.completeness_score * 100)}%` : "N/A"],
      ["Validity", score ? `${Math.round(score.validity_score * 100)}%` : "N/A"],
      ["Consistency", score ? `${Math.round(score.consistency_score * 100)}%` : "N/A"],
      ["Uniqueness", score ? `${Math.round(score.uniqueness_score * 100)}%` : "N/A"],
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    // Issues sheet
    const issuesData = [
      ["ID", "Type", "Severity", "Status", "Column", "Title", "Description", "Affected Rows", "Suggested Fix"],
      ...issues.map(i => [
        i.id,
        i.issue_type,
        i.severity,
        i.status,
        i.column_name ?? "",
        i.title,
        i.description ?? "",
        i.affected_rows ?? "",
        i.suggested_fix ?? "",
      ]),
    ];
    const issuesWs = XLSX.utils.aoa_to_sheet(issuesData);
    XLSX.utils.book_append_sheet(wb, issuesWs, "Issues");

    // Corrections sheet
    const correctionsData = [
      ["ID", "Type", "Status", "Column", "Original Value", "Corrected Value", "Confidence", "Reasoning", "Applied At"],
      ...corrections.map(c => [
        c.id,
        c.correction_type,
        c.status,
        c.column_name ?? "",
        c.original_value ?? "",
        c.corrected_value ?? "",
        `${Math.round(c.confidence * 100)}%`,
        c.reasoning ?? "",
        c.applied_at ?? "",
      ]),
    ];
    const correctionsWs = XLSX.utils.aoa_to_sheet(correctionsData);
    XLSX.utils.book_append_sheet(wb, correctionsWs, "Corrections");

    // Changes preview sheet (applied corrections only)
    const appliedCorrections = corrections.filter(c => c.status === "applied" || c.status === "approved");
    const changesData = [
      ["Column", "Original Value", "Corrected Value", "Correction Type", "Confidence"],
      ...appliedCorrections.map(c => [
        c.column_name ?? "General",
        c.original_value ?? "",
        c.corrected_value ?? "",
        c.correction_type,
        `${Math.round(c.confidence * 100)}%`,
      ]),
    ];
    const changesWs = XLSX.utils.aoa_to_sheet(changesData);
    XLSX.utils.book_append_sheet(wb, changesWs, "Changes Preview");

    // Generate buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Send file
    const fileName = `standardization_report_${dataset.file_name.replace(/\.[^.]+$/, "")}_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  })
);

// GET /api/standardization/export-all - Export full standardization report for all datasets
standardizationRouter.get(
  "/export-all",
  wrap(async (_req, res) => {
    const [datasets, allIssues, allCorrections, scores] = await Promise.all([
      listDatasets(),
      getQualityIssues(),
      getCorrections(),
      getReadinessScores(),
    ]);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Overview sheet
    const overviewData = [
      ["Standardization Report"],
      ["Generated", new Date().toISOString()],
      [""],
      ["Summary"],
      ["Total Datasets", datasets.length],
      ["Total Issues", allIssues.length],
      ["Critical Issues", allIssues.filter(i => i.severity === "critical" || i.severity === "error").length],
      ["Open Issues", allIssues.filter(i => i.status === "open").length],
      ["Total Corrections", allCorrections.length],
      ["Applied Corrections", allCorrections.filter(c => c.status === "applied").length],
      ["Average Readiness", scores.length ? `${Math.round(scores.reduce((sum, s) => sum + s.overall_score, 0) / scores.length * 100)}%` : "N/A"],
    ];
    const overviewWs = XLSX.utils.aoa_to_sheet(overviewData);
    XLSX.utils.book_append_sheet(wb, overviewWs, "Overview");

    // Datasets sheet
    const datasetsData = [
      ["Dataset", "Source Type", "Issues", "Corrections", "Overall Score", "Completeness", "Validity", "Consistency", "Uniqueness"],
      ...datasets.map(d => {
        const score = scores.find(s => s.dataset_id === d.id);
        const issueCount = allIssues.filter(i => i.dataset_id === d.id).length;
        const corrCount = allCorrections.filter(c => c.dataset_id === d.id).length;
        return [
          d.file_name,
          d.source_type ?? "",
          issueCount,
          corrCount,
          score ? `${Math.round(score.overall_score * 100)}%` : "N/A",
          score ? `${Math.round(score.completeness_score * 100)}%` : "N/A",
          score ? `${Math.round(score.validity_score * 100)}%` : "N/A",
          score ? `${Math.round(score.consistency_score * 100)}%` : "N/A",
          score ? `${Math.round(score.uniqueness_score * 100)}%` : "N/A",
        ];
      }),
    ];
    const datasetsWs = XLSX.utils.aoa_to_sheet(datasetsData);
    XLSX.utils.book_append_sheet(wb, datasetsWs, "Datasets");

    // All Issues sheet
    const issuesData = [
      ["Dataset", "Type", "Severity", "Status", "Column", "Title", "Description", "Suggested Fix"],
      ...allIssues.map(i => [
        i.dataset_file_name ?? "",
        i.issue_type,
        i.severity,
        i.status,
        i.column_name ?? "",
        i.title,
        i.description ?? "",
        i.suggested_fix ?? "",
      ]),
    ];
    const issuesWs = XLSX.utils.aoa_to_sheet(issuesData);
    XLSX.utils.book_append_sheet(wb, issuesWs, "All Issues");

    // All Corrections sheet
    const correctionsData = [
      ["Dataset", "Type", "Status", "Column", "Original", "Corrected", "Confidence", "Reasoning"],
      ...allCorrections.map(c => [
        c.dataset_file_name ?? "",
        c.correction_type,
        c.status,
        c.column_name ?? "",
        c.original_value ?? "",
        c.corrected_value ?? "",
        `${Math.round(c.confidence * 100)}%`,
        c.reasoning ?? "",
      ]),
    ];
    const correctionsWs = XLSX.utils.aoa_to_sheet(correctionsData);
    XLSX.utils.book_append_sheet(wb, correctionsWs, "All Corrections");

    // Generate buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Send file
    const fileName = `standardization_report_all_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  })
);

// GET /api/standardization/normalization/:datasetId - Get normalization summary for a dataset
// Shows how well the source data maps to master template format
standardizationRouter.get(
  "/normalization/:datasetId",
  wrap(async (req, res) => {
    const summary = await getNormalizationSummary(req.params.datasetId);
    if (!summary) {
      return res.status(404).json({ error: "Dataset not found" });
    }
    res.json(summary);
  })
);

// GET /api/standardization/normalized-data/:datasetId - Get normalized (master-formatted) data
// Returns the dataset with columns renamed to master template column names
standardizationRouter.get(
  "/normalized-data/:datasetId",
  wrap(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const normalized = await normalizeDatasetToMaster(req.params.datasetId, {
      uploadsDir: UPLOAD_DIR,
    });

    if (!normalized) {
      return res.status(404).json({
        error: "Cannot normalize dataset",
        reason: "Dataset not found or has no master type assigned",
      });
    }

    // Paginate rows for large datasets
    const paginatedRows = normalized.rows.slice(offset, offset + limit);

    res.json({
      datasetId: normalized.datasetId,
      masterType: normalized.masterType,
      columns: normalized.columns,
      totalRows: normalized.rows.length,
      offset,
      limit,
      rows: paginatedRows,
      coverage: normalized.coverage,
      missingColumns: normalized.missingColumns,
      unmappedSourceColumns: normalized.unmappedSourceColumns,
      columnMapping: Object.fromEntries(normalized.columnMapping),
    });
  })
);

// GET /api/standardization/normalization-status - Get normalization status for all datasets
standardizationRouter.get(
  "/normalization-status",
  wrap(async (_req, res) => {
    const datasets = await listDatasets();

    const statuses = await Promise.all(
      datasets.map(async (d) => {
        const summary = await getNormalizationSummary(d.id);
        return {
          fileName: d.file_name,
          sourceType: d.source_type,
          datasetId: summary?.datasetId ?? d.id,
          masterType: summary?.masterType ?? null,
          coverage: summary?.coverage ?? 0,
          mappedColumns: summary?.mappedColumns ?? 0,
          missingColumns: summary?.missingColumns ?? 0,
          unmappedSourceColumns: summary?.unmappedSourceColumns ?? 0,
          totalExpectedColumns: summary?.totalExpectedColumns ?? 0,
          canNormalize: summary?.canNormalize ?? false,
        };
      })
    );

    // Summary statistics
    const normalizable = statuses.filter((s) => s.canNormalize);
    const avgCoverage = normalizable.length
      ? normalizable.reduce((sum, s) => sum + s.coverage, 0) / normalizable.length
      : 0;

    res.json({
      datasets: statuses,
      summary: {
        totalDatasets: datasets.length,
        normalizableDatasets: normalizable.length,
        averageCoverage: Number(avgCoverage.toFixed(3)),
        fullyMapped: statuses.filter((s) => s.coverage === 1).length,
        partiallyMapped: statuses.filter((s) => s.coverage > 0 && s.coverage < 1).length,
        unmapped: statuses.filter((s) => !s.masterType).length,
      },
    });
  })
);
