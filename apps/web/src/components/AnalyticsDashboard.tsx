import { useState, useEffect } from "react";
import {
  AnalyticsOverview,
  DatasetAnalytics,
  fetchAnalyticsOverview,
  fetchDatasetAnalytics,
} from "../api";

export function AnalyticsDashboard() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [datasets, setDatasets] = useState<DatasetAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "quality" | "atum" | "datasets">("overview");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [overviewData, datasetsData] = await Promise.all([
        fetchAnalyticsOverview(),
        fetchDatasetAnalytics(),
      ]);
      setOverview(overviewData);
      setDatasets(datasetsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="empty-state">Loading analytics...</div>;
  }

  if (error) {
    return <div className="dq-error">{error}</div>;
  }

  if (!overview) {
    return <div className="empty-state">No analytics data available.</div>;
  }

  return (
    <div className="analytics-dashboard">
      <div className="dq-tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}>
          Data Quality
        </button>
        <button className={tab === "atum" ? "active" : ""} onClick={() => setTab("atum")}>
          ATUM Coverage
        </button>
        <button className={tab === "datasets" ? "active" : ""} onClick={() => setTab("datasets")}>
          Datasets
        </button>
      </div>

      {tab === "overview" && (
        <div className="analytics-overview">
          <div className="dq-summary-cards">
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalDatasets}</div>
              <div className="dq-card-label">Datasets</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalRows.toLocaleString()}</div>
              <div className="dq-card-label">Total Rows</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalEntities}</div>
              <div className="dq-card-label">Entities</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalEdges}</div>
              <div className="dq-card-label">Relationships</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{Math.round(overview.summary.avgReadiness * 100)}%</div>
              <div className="dq-card-label">Avg Readiness</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{Math.round(overview.summary.atumCoverage * 100)}%</div>
              <div className="dq-card-label">ATUM Coverage</div>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="analytics-section">
              <h4>Source Types</h4>
              <div className="bar-chart">
                {Object.entries(overview.datasets.sourceTypes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="bar-row">
                      <span className="bar-label">{type}</span>
                      <div className="bar-container">
                        <div
                          className="bar"
                          style={{
                            width: `${(count / overview.summary.totalDatasets) * 100}%`,
                            background: "#5b8def",
                          }}
                        />
                      </div>
                      <span className="bar-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="analytics-section">
              <h4>Knowledge Graph Entities</h4>
              <div className="bar-chart">
                {Object.entries(overview.knowledgeGraph.entityTypes)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([type, count]) => (
                    <div key={type} className="bar-row">
                      <span className="bar-label">{type}</span>
                      <div className="bar-container">
                        <div
                          className="bar"
                          style={{
                            width: `${(count / overview.summary.totalEntities) * 100}%`,
                            background: "#6fd694",
                          }}
                        />
                      </div>
                      <span className="bar-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "quality" && (
        <div className="analytics-quality">
          <div className="dq-summary-cards">
            <div className={`dq-card ${overview.summary.openIssues > 0 ? "critical" : ""}`}>
              <div className="dq-card-value">{overview.summary.openIssues}</div>
              <div className="dq-card-label">Open Issues</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalIssues}</div>
              <div className="dq-card-label">Total Issues</div>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="analytics-section">
              <h4>Issues by Severity</h4>
              <div className="severity-breakdown">
                {["critical", "error", "warning", "info"].map((severity) => {
                  const count = overview.dataQuality.issuesBySeverity[severity] || 0;
                  const pct = overview.summary.totalIssues > 0
                    ? (count / overview.summary.totalIssues) * 100
                    : 0;
                  return (
                    <div key={severity} className={`severity-item severity-${severity}`}>
                      <span className="severity-label">{severity}</span>
                      <div className="severity-bar-container">
                        <div className="severity-bar" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="severity-count">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="analytics-section">
              <h4>Issues by Type</h4>
              <div className="bar-chart">
                {Object.entries(overview.dataQuality.issuesByType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="bar-row">
                      <span className="bar-label">{type.replace(/_/g, " ")}</span>
                      <div className="bar-container">
                        <div
                          className="bar"
                          style={{
                            width: `${(count / overview.summary.totalIssues) * 100}%`,
                            background: "#e0c460",
                          }}
                        />
                      </div>
                      <span className="bar-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="analytics-section">
              <h4>Readiness Distribution</h4>
              <div className="readiness-grid">
                <div className="readiness-item excellent">
                  <div className="readiness-value">{overview.dataQuality.readinessDistribution.excellent}</div>
                  <div className="readiness-label">Excellent (90%+)</div>
                </div>
                <div className="readiness-item good">
                  <div className="readiness-value">{overview.dataQuality.readinessDistribution.good}</div>
                  <div className="readiness-label">Good (70-90%)</div>
                </div>
                <div className="readiness-item fair">
                  <div className="readiness-value">{overview.dataQuality.readinessDistribution.fair}</div>
                  <div className="readiness-label">Fair (50-70%)</div>
                </div>
                <div className="readiness-item poor">
                  <div className="readiness-value">{overview.dataQuality.readinessDistribution.poor}</div>
                  <div className="readiness-label">Poor (&lt;50%)</div>
                </div>
              </div>
            </div>

            <div className="analytics-section">
              <h4>Quality Dimension Scores</h4>
              <div className="dimension-scores">
                {Object.entries(overview.dataQuality.avgScores).map(([dimension, score]) => (
                  <div key={dimension} className="dimension-item">
                    <div className="dimension-header">
                      <span className="dimension-label">{dimension}</span>
                      <span className="dimension-value">{Math.round(score * 100)}%</span>
                    </div>
                    <div className="dimension-bar-container">
                      <div
                        className="dimension-bar"
                        style={{
                          width: `${score * 100}%`,
                          background: score >= 0.7 ? "#6fd694" : score >= 0.5 ? "#e0c460" : "#ef6f6f",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "atum" && (
        <div className="analytics-atum">
          <div className="dq-summary-cards">
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.approvedMappings}</div>
              <div className="dq-card-label">Approved Mappings</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{overview.summary.totalMappings}</div>
              <div className="dq-card-label">Total Mappings</div>
            </div>
            <div className="dq-card">
              <div className="dq-card-value">{Math.round(overview.summary.atumCoverage * 100)}%</div>
              <div className="dq-card-label">Coverage</div>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="analytics-section">
              <h4>Mappings by Status</h4>
              <div className="status-breakdown">
                {Object.entries(overview.atumMapping.mappingsByStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <div key={status} className={`status-item status-${status}`}>
                      <span className="status-label">{status}</span>
                      <span className="status-count">{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="analytics-section">
              <h4>Mappings by Layer</h4>
              <div className="bar-chart">
                {Object.entries(overview.atumMapping.mappingsByLayer)
                  .sort((a, b) => b[1] - a[1])
                  .map(([layer, count]) => (
                    <div key={layer} className="bar-row">
                      <span className="bar-label">{layer.replace(/_/g, " ")}</span>
                      <div className="bar-container">
                        <div
                          className="bar"
                          style={{
                            width: `${(count / overview.summary.totalMappings) * 100}%`,
                            background: "#6fb8ef",
                          }}
                        />
                      </div>
                      <span className="bar-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="analytics-section full-width">
              <h4>Top Towers</h4>
              <div className="bar-chart">
                {Object.entries(overview.atumMapping.mappingsByTower)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([tower, count]) => (
                    <div key={tower} className="bar-row">
                      <span className="bar-label">{tower}</span>
                      <div className="bar-container">
                        <div
                          className="bar"
                          style={{
                            width: `${(count / overview.summary.totalMappings) * 100}%`,
                            background: "#b79aef",
                          }}
                        />
                      </div>
                      <span className="bar-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "datasets" && (
        <div className="analytics-datasets">
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Source Type</th>
                <th>Rows</th>
                <th>Readiness</th>
                <th>Issues</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {datasets
                .sort((a, b) => (a.readiness?.overall || 0) - (b.readiness?.overall || 0))
                .map((ds) => (
                  <tr key={ds.id}>
                    <td>{ds.fileName}</td>
                    <td>{ds.sourceType || "-"}</td>
                    <td>{ds.rowCount?.toLocaleString() || "-"}</td>
                    <td>
                      {ds.readiness ? (
                        <div className="mini-readiness">
                          <div
                            className="mini-readiness-bar"
                            style={{
                              width: `${ds.readiness.overall * 100}%`,
                              background:
                                ds.readiness.overall >= 0.7
                                  ? "#6fd694"
                                  : ds.readiness.overall >= 0.5
                                  ? "#e0c460"
                                  : "#ef6f6f",
                            }}
                          />
                          <span>{Math.round(ds.readiness.overall * 100)}%</span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {ds.issues.total > 0 ? (
                        <span className={ds.issues.critical > 0 ? "critical-badge" : ""}>
                          {ds.issues.total}
                          {ds.issues.critical > 0 && ` (${ds.issues.critical} critical)`}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${ds.status}`}>{ds.status}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
