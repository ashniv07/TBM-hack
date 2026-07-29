import { Router } from "express";
import {
  listDatasets,
  getQualityIssues,
  getReadinessScores,
  listAtumMappings,
  getKnowledgeGraphForExport,
} from "@tbm/db";

export const analyticsRouter = Router();

/**
 * GET /api/analytics/overview
 * Get overall platform analytics.
 */
analyticsRouter.get("/overview", async (_req, res) => {
  try {
    const [datasets, issues, readinessScores, mappings, graph] = await Promise.all([
      listDatasets(),
      getQualityIssues(),
      getReadinessScores(),
      listAtumMappings(),
      getKnowledgeGraphForExport(),
    ]);

    // Calculate key metrics
    const totalDatasets = datasets.length;
    const totalRows = datasets.reduce((sum, d) => sum + (d.row_count || 0), 0);

    // Issues breakdown
    const issuesByType: Record<string, number> = {};
    const issuesBySeverity: Record<string, number> = {};
    const issuesByDataset: Record<string, number> = {};
    for (const issue of issues) {
      issuesByType[issue.issue_type] = (issuesByType[issue.issue_type] || 0) + 1;
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
      issuesByDataset[issue.dataset_id] = (issuesByDataset[issue.dataset_id] || 0) + 1;
    }

    // Readiness breakdown
    const avgReadiness = readinessScores.length > 0
      ? readinessScores.reduce((sum, s) => sum + Number(s.overall_score), 0) / readinessScores.length
      : 0;
    const readinessDistribution = {
      excellent: readinessScores.filter(s => Number(s.overall_score) >= 0.9).length,
      good: readinessScores.filter(s => Number(s.overall_score) >= 0.7 && Number(s.overall_score) < 0.9).length,
      fair: readinessScores.filter(s => Number(s.overall_score) >= 0.5 && Number(s.overall_score) < 0.7).length,
      poor: readinessScores.filter(s => Number(s.overall_score) < 0.5).length,
    };

    // ATUM mapping breakdown
    const mappingsByStatus: Record<string, number> = {};
    const mappingsByLayer: Record<string, number> = {};
    const mappingsByTower: Record<string, number> = {};
    for (const mapping of mappings) {
      mappingsByStatus[mapping.status] = (mappingsByStatus[mapping.status] || 0) + 1;
      mappingsByLayer[mapping.layer] = (mappingsByLayer[mapping.layer] || 0) + 1;
      if (mapping.level_1) {
        mappingsByTower[mapping.level_1] = (mappingsByTower[mapping.level_1] || 0) + 1;
      }
    }

    const atumCoverage = mappings.length > 0
      ? mappings.filter(m => m.status === "approved" || m.status === "overridden").length / mappings.length
      : 0;

    // Knowledge graph stats
    const entityTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};
    for (const entity of graph.entities) {
      entityTypes[entity.entity_type] = (entityTypes[entity.entity_type] || 0) + 1;
    }
    for (const edge of graph.edges) {
      edgeTypes[edge.edge_type] = (edgeTypes[edge.edge_type] || 0) + 1;
    }

    // Source type distribution
    const sourceTypes: Record<string, number> = {};
    for (const dataset of datasets) {
      const type = dataset.source_type || "unknown";
      sourceTypes[type] = (sourceTypes[type] || 0) + 1;
    }

    res.json({
      summary: {
        totalDatasets,
        totalRows,
        totalEntities: graph.entities.length,
        totalEdges: graph.edges.length,
        totalIssues: issues.length,
        openIssues: issues.filter(i => i.status === "open").length,
        totalMappings: mappings.length,
        approvedMappings: mappings.filter(m => m.status === "approved" || m.status === "overridden").length,
        avgReadiness,
        atumCoverage,
      },
      dataQuality: {
        issuesByType,
        issuesBySeverity,
        readinessDistribution,
        avgScores: {
          completeness: readinessScores.length > 0 ? readinessScores.reduce((s, r) => s + Number(r.completeness_score), 0) / readinessScores.length : 0,
          validity: readinessScores.length > 0 ? readinessScores.reduce((s, r) => s + Number(r.validity_score), 0) / readinessScores.length : 0,
          consistency: readinessScores.length > 0 ? readinessScores.reduce((s, r) => s + Number(r.consistency_score), 0) / readinessScores.length : 0,
          uniqueness: readinessScores.length > 0 ? readinessScores.reduce((s, r) => s + Number(r.uniqueness_score), 0) / readinessScores.length : 0,
        },
      },
      atumMapping: {
        mappingsByStatus,
        mappingsByLayer,
        mappingsByTower,
        coverage: atumCoverage,
      },
      knowledgeGraph: {
        entityTypes,
        edgeTypes,
      },
      datasets: {
        sourceTypes,
        byStatus: datasets.reduce((acc, d) => {
          acc[d.status] = (acc[d.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get analytics" });
  }
});

/**
 * GET /api/analytics/datasets
 * Get per-dataset analytics.
 */
analyticsRouter.get("/datasets", async (_req, res) => {
  try {
    const [datasets, readinessScores, issues] = await Promise.all([
      listDatasets(),
      getReadinessScores(),
      getQualityIssues(),
    ]);

    const readinessMap = new Map(readinessScores.map(s => [s.dataset_id, s]));
    const issuesMap = new Map<string, typeof issues>();
    for (const issue of issues) {
      if (!issuesMap.has(issue.dataset_id)) issuesMap.set(issue.dataset_id, []);
      issuesMap.get(issue.dataset_id)!.push(issue);
    }

    const datasetAnalytics = datasets.map(d => {
      const readiness = readinessMap.get(d.id);
      const dsIssues = issuesMap.get(d.id) || [];
      return {
        id: d.id,
        fileName: d.file_name,
        sourceType: d.source_type,
        status: d.status,
        rowCount: d.row_count,
        uploadedAt: d.uploaded_at,
        readiness: readiness ? {
          overall: Number(readiness.overall_score),
          completeness: Number(readiness.completeness_score),
          validity: Number(readiness.validity_score),
          consistency: Number(readiness.consistency_score),
          uniqueness: Number(readiness.uniqueness_score),
        } : null,
        issues: {
          total: dsIssues.length,
          critical: dsIssues.filter(i => i.severity === "critical").length,
          open: dsIssues.filter(i => i.status === "open").length,
        },
      };
    });

    res.json({ datasets: datasetAnalytics });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get dataset analytics" });
  }
});
