import { useState } from "react";
import {
  DataQualityReport,
  QualityIssue,
  Correction,
  ReadinessScore,
  runStandardization,
  fetchDataQualityReport,
  fetchQualityIssues,
  fetchCorrections,
  fetchReadinessScores,
  updateIssueStatus,
  approveCorrection,
  rejectCorrection,
  bulkApproveCorrections,
  applyAllCorrections,
  processCorrectedDataset,
  StandardizationStats,
  ApplyAllCorrectionsResult,
  ProcessCorrectedResult,
  CorrectedDatasetInfo,
} from "../api";

type TabView = "overview" | "issues" | "corrections" | "readiness";

export function DataQualityDashboard() {
  const [busy, setBusy] = useState(false);
  const [runStats, setRunStats] = useState<StandardizationStats | null>(null);
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [readinessScores, setReadinessScores] = useState<ReadinessScore[]>([]);
  const [activeTab, setActiveTab] = useState<TabView>("overview");
  const [issueFilter, setIssueFilter] = useState({ status: "all", severity: "all" });
  const [correctionFilter, setCorrectionFilter] = useState("all");
  const [selectedCorrections, setSelectedCorrections] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyAllCorrectionsResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [processingDatasets, setProcessingDatasets] = useState<Set<string>>(new Set());
  const [processedResults, setProcessedResults] = useState<Map<string, ProcessCorrectedResult>>(new Map());

  async function handleRunStandardization() {
    setBusy(true);
    setError(null);
    try {
      const result = await runStandardization();
      setRunStats(result.stats);
      // Refresh all data after run
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run standardization");
    } finally {
      setBusy(false);
    }
  }

  async function refreshData() {
    try {
      const [reportData, issuesData, correctionsData, scoresData] = await Promise.all([
        fetchDataQualityReport(),
        fetchQualityIssues(),
        fetchCorrections(),
        fetchReadinessScores(),
      ]);
      setReport(reportData);
      setIssues(issuesData);
      setCorrections(correctionsData);
      setReadinessScores(scoresData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    }
  }

  async function handleUpdateIssueStatus(id: string, status: string) {
    try {
      await updateIssueStatus(id, status);
      setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status: status as QualityIssue["status"] } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update issue");
    }
  }

  async function handleApproveCorrection(id: string) {
    try {
      const updated = await approveCorrection(id);
      setCorrections((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve correction");
    }
  }

  async function handleRejectCorrection(id: string) {
    try {
      const updated = await rejectCorrection(id);
      setCorrections((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject correction");
    }
  }

  async function handleBulkApprove() {
    const ids = Array.from(selectedCorrections);
    if (ids.length === 0) return;
    try {
      await bulkApproveCorrections(ids);
      setCorrections((prev) =>
        prev.map((c) => (selectedCorrections.has(c.id) ? { ...c, status: "approved" as const } : c))
      );
      setSelectedCorrections(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to bulk approve");
    }
  }

  async function handleApplyAllCorrections() {
    setApplying(true);
    setError(null);
    setApplyResult(null);
    setProcessedResults(new Map());
    try {
      const result = await applyAllCorrections();
      setApplyResult(result);
      // Refresh corrections to show updated status
      const updatedCorrections = await fetchCorrections();
      setCorrections(updatedCorrections);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply corrections");
    } finally {
      setApplying(false);
    }
  }

  async function handleProcessCorrectedDataset(datasetId: string) {
    setProcessingDatasets((prev) => new Set([...prev, datasetId]));
    setError(null);
    try {
      const result = await processCorrectedDataset(datasetId);
      setProcessedResults((prev) => new Map(prev).set(datasetId, result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process corrected dataset");
    } finally {
      setProcessingDatasets((prev) => {
        const next = new Set(prev);
        next.delete(datasetId);
        return next;
      });
    }
  }

  async function handleProcessAllCorrectedDatasets() {
    if (!applyResult) return;
    const datasets = applyResult.results
      .map((r) => r.correctedDataset)
      .filter((d): d is CorrectedDatasetInfo => d !== null);

    for (const dataset of datasets) {
      await handleProcessCorrectedDataset(dataset.id);
    }
  }

  function toggleCorrectionSelection(id: string) {
    setSelectedCorrections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredIssues = issues.filter((i) => {
    if (issueFilter.status !== "all" && i.status !== issueFilter.status) return false;
    if (issueFilter.severity !== "all" && i.severity !== issueFilter.severity) return false;
    return true;
  });

  const filteredCorrections = corrections.filter((c) => {
    if (correctionFilter !== "all" && c.status !== correctionFilter) return false;
    return true;
  });

  const pendingCorrections = corrections.filter((c) => c.status === "pending");

  return (
    <div className="data-quality-dashboard">
      <div className="dq-header">
        <button onClick={handleRunStandardization} disabled={busy}>
          {busy ? "Analyzing..." : "Run Data Quality Analysis"}
        </button>
        {report && (
          <button onClick={refreshData} disabled={busy} className="secondary">
            Refresh
          </button>
        )}
      </div>

      {error && <div className="dq-error">{error}</div>}

      {runStats && (
        <div className="dq-run-stats">
          <p>
            Analysis complete: {runStats.schemasCount} schemas · {runStats.issuesCount} issues ·{" "}
            {runStats.correctionsCount} corrections · {runStats.datasetsScored} datasets scored ·{" "}
            {Math.round(runStats.averageReadinessScore * 100)}% avg readiness
          </p>
        </div>
      )}

      {report && (
        <>
          <div className="dq-tabs">
            <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>
              Overview
            </button>
            <button className={activeTab === "issues" ? "active" : ""} onClick={() => setActiveTab("issues")}>
              Issues ({report.summary.openIssues} open)
            </button>
            <button className={activeTab === "corrections" ? "active" : ""} onClick={() => setActiveTab("corrections")}>
              Corrections ({report.summary.pendingCorrections} pending)
            </button>
            <button className={activeTab === "readiness" ? "active" : ""} onClick={() => setActiveTab("readiness")}>
              Readiness Scores
            </button>
          </div>

          {activeTab === "overview" && (
            <div className="dq-overview">
              <div className="dq-summary-cards">
                <div className="dq-card">
                  <div className="dq-card-value">{Math.round(report.summary.averageReadinessScore * 100)}%</div>
                  <div className="dq-card-label">Avg Readiness</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{report.summary.totalIssues}</div>
                  <div className="dq-card-label">Total Issues</div>
                </div>
                <div className="dq-card critical">
                  <div className="dq-card-value">{report.summary.criticalIssues}</div>
                  <div className="dq-card-label">Critical/Error</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{report.summary.pendingCorrections}</div>
                  <div className="dq-card-label">Pending Fixes</div>
                </div>
              </div>

              <h4>Issues by Type</h4>
              <div className="dq-breakdown">
                {Object.entries(report.issuesByType).map(([type, count]) => (
                  <div key={type} className="dq-breakdown-item">
                    <span className="dq-breakdown-label">{type.replace(/_/g, " ")}</span>
                    <span className="dq-breakdown-value">{count}</span>
                  </div>
                ))}
              </div>

              <h4>Issues by Severity</h4>
              <div className="dq-breakdown">
                {["critical", "error", "warning", "info"].map((sev) => (
                  <div key={sev} className={`dq-breakdown-item severity-${sev}`}>
                    <span className="dq-breakdown-label">{sev}</span>
                    <span className="dq-breakdown-value">{report.issuesBySeverity[sev] ?? 0}</span>
                  </div>
                ))}
              </div>

              {report.datasetsNeedingAttention.length > 0 && (
                <>
                  <h4>Datasets Needing Attention</h4>
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Dataset</th>
                        <th>Readiness</th>
                        <th>Top Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.datasetsNeedingAttention.map((d) => (
                        <tr key={d.datasetId}>
                          <td>{d.fileName}</td>
                          <td className={d.overallScore < 0.5 ? "low-confidence" : ""}>
                            {Math.round(d.overallScore * 100)}%
                          </td>
                          <td className="samples">{d.recommendations?.[0] ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {activeTab === "issues" && (
            <div className="dq-issues">
              <div className="dq-filters">
                <label>
                  Status:{" "}
                  <select
                    value={issueFilter.status}
                    onChange={(e) => setIssueFilter((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                    <option value="ignored">Ignored</option>
                  </select>
                </label>
                <label>
                  Severity:{" "}
                  <select
                    value={issueFilter.severity}
                    onChange={(e) => setIssueFilter((f) => ({ ...f, severity: e.target.value }))}
                  >
                    <option value="all">All</option>
                    <option value="critical">Critical</option>
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </label>
              </div>

              {filteredIssues.length === 0 ? (
                <p className="empty-state">No issues match the current filters.</p>
              ) : (
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Dataset</th>
                      <th>Issue</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.map((issue) => (
                      <tr key={issue.id}>
                        <td>
                          <span className={`severity-badge severity-${issue.severity}`}>{issue.severity}</span>
                        </td>
                        <td>
                          {issue.dataset_file_name}
                          {issue.column_name && <span className="samples"> / {issue.column_name}</span>}
                        </td>
                        <td>
                          <div className="issue-title">{issue.title}</div>
                          <div className="issue-desc samples">{issue.description}</div>
                          {issue.suggested_fix && (
                            <div className="issue-fix">
                              <strong>Fix:</strong> {issue.suggested_fix}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge status-${issue.status}`}>{issue.status}</span>
                        </td>
                        <td>
                          {issue.status === "open" && (
                            <>
                              <button onClick={() => handleUpdateIssueStatus(issue.id, "acknowledged")}>Ack</button>
                              <button onClick={() => handleUpdateIssueStatus(issue.id, "ignored")}>Ignore</button>
                            </>
                          )}
                          {issue.status === "acknowledged" && (
                            <button onClick={() => handleUpdateIssueStatus(issue.id, "resolved")}>Resolve</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === "corrections" && (
            <div className="dq-corrections">
              <div className="dq-filters">
                <label>
                  Status:{" "}
                  <select value={correctionFilter} onChange={(e) => setCorrectionFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="applied">Applied</option>
                  </select>
                </label>
                {pendingCorrections.length > 0 && (
                  <button onClick={handleBulkApprove} disabled={selectedCorrections.size === 0}>
                    Approve Selected ({selectedCorrections.size})
                  </button>
                )}
                {corrections.filter((c) => c.status === "approved").length > 0 && (
                  <button
                    onClick={handleApplyAllCorrections}
                    disabled={applying}
                    className="apply-btn"
                  >
                    {applying ? "Applying..." : "Apply All Approved Corrections"}
                  </button>
                )}
              </div>

              {applyResult && (
                <div className={`dq-apply-result ${applyResult.ok ? "success" : "partial"}`}>
                  <h4>Corrections Applied - New Corrected Files Created</h4>
                  <p className="dq-apply-info">
                    The corrected files are registered as new datasets. Process them through Stages 2-3 to integrate
                    the cleaned data into the knowledge graph for ATUM mapping and TBM export.
                  </p>
                  {applyResult.results.some((r) => r.correctedDataset) && (
                    <div className="dq-process-all">
                      <button
                        onClick={handleProcessAllCorrectedDatasets}
                        disabled={processingDatasets.size > 0}
                        className="process-all-btn"
                      >
                        {processingDatasets.size > 0
                          ? `Processing ${processingDatasets.size} dataset(s)...`
                          : "Process All Corrected Datasets for TBM"}
                      </button>
                    </div>
                  )}
                  {applyResult.results.map((r, idx) => (
                    <div key={idx} className="apply-result-item">
                      <div className="apply-result-header">
                        <p>
                          <strong>Created:</strong> {r.correctedFile.split("/").pop()}
                        </p>
                        {r.correctedDataset && (
                          <div className="corrected-dataset-actions">
                            {processedResults.has(r.correctedDataset.id) ? (
                              <span className="process-success">
                                Processed: {processedResults.get(r.correctedDataset.id)!.stages.embedding.entitiesEmbedded} entities embedded
                              </span>
                            ) : (
                              <button
                                onClick={() => handleProcessCorrectedDataset(r.correctedDataset!.id)}
                                disabled={processingDatasets.has(r.correctedDataset.id)}
                                className="process-btn"
                              >
                                {processingDatasets.has(r.correctedDataset.id) ? "Processing..." : "Process for TBM"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="samples">
                        {r.correctionsApplied} correction(s) applied, {r.changes.reduce((sum, c) => sum + c.rowsAffected, 0)} rows modified
                      </p>
                      {r.correctedDataset && (
                        <div className="corrected-dataset-info">
                          <span className="dataset-id">Dataset ID: {r.correctedDataset.id.slice(0, 8)}...</span>
                          <span className="source-type">{r.correctedDataset.sourceType ?? "Unknown type"}</span>
                          <span className={`status-badge status-${r.correctedDataset.status}`}>{r.correctedDataset.status}</span>
                        </div>
                      )}
                      {r.changes.length > 0 && (
                        <ul className="change-list">
                          {r.changes.map((change, i) => (
                            <li key={i}>
                              <strong>{change.columnName}:</strong> "{change.originalValue}" → "{change.correctedValue}"
                              <span className="samples"> ({change.rowsAffected} rows)</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {applyResult.errors.length > 0 && (
                    <div className="apply-errors">
                      <p>Some datasets had errors:</p>
                      <ul>
                        {applyResult.errors.map((e, i) => (
                          <li key={i}>{e.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {filteredCorrections.length === 0 ? (
                <p className="empty-state">No corrections match the current filters.</p>
              ) : (
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>
                        {correctionFilter === "pending" && (
                          <input
                            type="checkbox"
                            checked={
                              pendingCorrections.length > 0 &&
                              pendingCorrections.every((c) => selectedCorrections.has(c.id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCorrections(new Set(pendingCorrections.map((c) => c.id)));
                              } else {
                                setSelectedCorrections(new Set());
                              }
                            }}
                          />
                        )}
                      </th>
                      <th>Type</th>
                      <th>Dataset</th>
                      <th>Original → Corrected</th>
                      <th>Confidence</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCorrections.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.status === "pending" && (
                            <input
                              type="checkbox"
                              checked={selectedCorrections.has(c.id)}
                              onChange={() => toggleCorrectionSelection(c.id)}
                            />
                          )}
                        </td>
                        <td>
                          <span className="correction-type">{c.correction_type.replace(/_/g, " ")}</span>
                        </td>
                        <td>
                          {c.dataset_file_name}
                          {c.column_name && <span className="samples"> / {c.column_name}</span>}
                        </td>
                        <td>
                          <code>{c.original_value ?? "—"}</code> → <code>{c.corrected_value ?? "—"}</code>
                          {c.reasoning && <div className="samples">{c.reasoning}</div>}
                        </td>
                        <td>{Math.round(c.confidence * 100)}%</td>
                        <td>
                          <span className={`status-badge correction-status-${c.status}`}>{c.status}</span>
                        </td>
                        <td>
                          {c.status === "pending" && (
                            <>
                              <button onClick={() => handleApproveCorrection(c.id)}>Approve</button>
                              <button onClick={() => handleRejectCorrection(c.id)}>Reject</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === "readiness" && (
            <div className="dq-readiness">
              {readinessScores.length === 0 ? (
                <p className="empty-state">No readiness scores available. Run the analysis first.</p>
              ) : (
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Source Type</th>
                      <th>Overall</th>
                      <th>Completeness</th>
                      <th>Validity</th>
                      <th>Consistency</th>
                      <th>Uniqueness</th>
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readinessScores.map((score) => (
                      <tr key={score.id}>
                        <td>{score.dataset_file_name}</td>
                        <td>{score.source_type ?? "—"}</td>
                        <td className={score.overall_score < 0.7 ? "low-confidence" : ""}>
                          <strong>{Math.round(score.overall_score * 100)}%</strong>
                        </td>
                        <td>{Math.round(score.completeness_score * 100)}%</td>
                        <td>{Math.round(score.validity_score * 100)}%</td>
                        <td>{Math.round(score.consistency_score * 100)}%</td>
                        <td>{Math.round(score.uniqueness_score * 100)}%</td>
                        <td>
                          {score.issue_count}
                          {score.critical_issue_count > 0 && (
                            <span className="critical-badge"> ({score.critical_issue_count} critical)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {!report && !busy && (
        <p className="empty-state">
          Click "Run Data Quality Analysis" to analyze all datasets for quality issues, generate corrections, and
          calculate TBM readiness scores.
        </p>
      )}
    </div>
  );
}
