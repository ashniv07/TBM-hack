import { useState, useEffect } from "react";
import {
  DataQualityReport, QualityIssue, Correction,
  StandardizationStats, ApplyAllCorrectionsResult, PreviewResult,
  runStandardization, fetchDataQualityReport, fetchQualityIssues,
  fetchCorrections, applyAllCorrections, acknowledgeIssue, rejectIssue,
  fetchStandardizationPreview, standardizationExportUrl, standardizationExportAllUrl,
  downloadCorrectedDatasetUrl,
} from "../../api";

type DQTab = "overview" | "issues" | "corrections" | "preview";

interface Props {
  datasets: { id: string; file_name: string; status: string; source_type: string | null }[];
  onDatasetsChanged: () => void;
}

/** Guard against backend returning readiness as 0–100 already (vs 0–1). */
function pct(v: number): number {
  if (v > 1) return Math.min(Math.round(v), 100);
  return Math.min(Math.round(v * 100), 100);
}

export function DataQualityPhase({ datasets: _datasets, onDatasetsChanged }: Props) {
  const [tab, setTab] = useState<DQTab>("overview");
  const [busy, setBusy] = useState(false);
  const [runStats, setRunStats] = useState<StandardizationStats | null>(null);
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [issFilter, setIssFilter] = useState({ status: "all", severity: "all", type: "all" });
  const [corrFilter, setCorrFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyAllCorrectionsResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [processingIssue, setProcessingIssue] = useState<Set<string>>(new Set());
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<string>("all");

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    try {
      const [r, i, c, p] = await Promise.all([
        fetchDataQualityReport(),
        fetchQualityIssues(),
        fetchCorrections(),
        fetchStandardizationPreview(),
      ]);
      setReport(r);
      setIssues(i);
      setCorrections(c);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  async function runAnalysis() {
    setBusy(true);
    setError(null);
    try {
      const r = await runStandardization();
      setRunStats(r.stats);
      await loadAll();
      setTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcknowledge(issueId: string) {
    setProcessingIssue(p => new Set(p).add(issueId));
    setError(null);
    try {
      const result = await acknowledgeIssue(issueId);
      // Update issue in list
      setIssues(p => p.map(i => i.id === issueId ? result.issue : i));
      // Add new corrections to list
      if (result.corrections.length > 0) {
        setCorrections(p => [...result.corrections, ...p]);
      }
      // Refresh preview
      const newPreview = await fetchStandardizationPreview();
      setPreview(newPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge issue");
    } finally {
      setProcessingIssue(p => { const n = new Set(p); n.delete(issueId); return n; });
    }
  }

  async function handleReject(issueId: string) {
    setProcessingIssue(p => new Set(p).add(issueId));
    setError(null);
    try {
      const result = await rejectIssue(issueId);
      setIssues(p => p.map(i => i.id === issueId ? result.issue : i));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject issue");
    } finally {
      setProcessingIssue(p => { const n = new Set(p); n.delete(issueId); return n; });
    }
  }

  async function applyAll() {
    setApplying(true);
    setError(null);
    try {
      const r = await applyAllCorrections();
      setApplyResult(r);
      // Show errors if any
      if (r.errors && r.errors.length > 0) {
        setError(`Some corrections failed: ${r.errors.map(e => e.error).join(", ")}`);
      }
      setCorrections(await fetchCorrections());
      const newPreview = await fetchStandardizationPreview();
      setPreview(newPreview);
      onDatasetsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  // Filter issues
  const visIssues = issues.filter(i => {
    if (issFilter.status !== "all" && i.status !== issFilter.status) return false;
    if (issFilter.severity !== "all" && i.severity !== issFilter.severity) return false;
    if (issFilter.type !== "all" && i.issue_type !== issFilter.type) return false;
    if (selectedDataset !== "all" && i.dataset_id !== selectedDataset) return false;
    return true;
  });

  // Filter corrections
  const visCorr = corrections.filter(c => {
    if (corrFilter !== "all" && c.status !== corrFilter) return false;
    if (selectedDataset !== "all" && c.dataset_id !== selectedDataset) return false;
    return true;
  });

  const pendingN = corrections.filter(c => c.status === "pending").length;
  const approvedN = corrections.filter(c => c.status === "approved").length;
  const appliedN = corrections.filter(c => c.status === "applied").length;
  const openIssues = issues.filter(i => i.status === "open").length;

  // Get unique datasets for filter dropdown
  const datasetOptions = Array.from(new Set(issues.map(i => i.dataset_id)))
    .map(id => {
      const issue = issues.find(i => i.dataset_id === id);
      return { id, name: issue?.dataset_file_name ?? id };
    });

  // Get unique issue types for filter
  const issueTypes = Array.from(new Set(issues.map(i => i.issue_type)));

  // Get detailed fix description for an issue
  function getDetailedFix(issue: QualityIssue): { action: string; details: string; examples: string[] } {
    const type = issue.issue_type;
    const samples = issue.sample_values ?? [];

    switch (type) {
      case "duplicate":
        return {
          action: "Remove Duplicates",
          details: `${issue.affected_rows ?? "Multiple"} duplicate rows detected. AI will identify and remove redundant entries while preserving unique records.`,
          examples: samples.slice(0, 3).map(s => String(s)),
        };
      case "missing_value":
        return {
          action: "Fill Missing Values",
          details: `Column has ${issue.affected_rows ?? "many"} missing values. AI will infer appropriate values based on patterns in the data or mark as explicit nulls.`,
          examples: ["Empty cells will be filled based on column type and context"],
        };
      case "invalid_date":
        return {
          action: "Normalize Dates",
          details: "Convert all date values to ISO 8601 format (YYYY-MM-DD) for consistency.",
          examples: samples.slice(0, 3).map(s => `"${s}" → "${normalizeDate(String(s))}"`),
        };
      case "invalid_currency":
        return {
          action: "Standardize Currency Codes",
          details: "Convert currency values to ISO 4217 codes (USD, EUR, GBP, etc.).",
          examples: samples.slice(0, 3).map(s => `"${s}" → "${normalizeCurrency(String(s))}"`),
        };
      case "invalid_reference":
        return {
          action: "Resolve Entity References",
          details: "Match unrecognized values to known entities in the knowledge graph using fuzzy matching.",
          examples: samples.slice(0, 3).map(s => String(s)),
        };
      case "outlier":
        return {
          action: "Handle Outliers",
          details: "Values that are statistically abnormal (>3σ from mean) will be flagged for review or capped to reasonable bounds.",
          examples: samples.slice(0, 3).map(s => String(s)),
        };
      case "schema_mismatch":
        return {
          action: "Convert Data Types",
          details: "Convert column values to match the expected data type in the canonical schema.",
          examples: samples.slice(0, 3).map(s => String(s)),
        };
      default:
        return {
          action: "Apply Standardization",
          details: issue.suggested_fix ?? "Apply AI-recommended corrections to standardize the data.",
          examples: samples.slice(0, 3).map(s => String(s)),
        };
    }
  }

  function normalizeDate(v: string): string {
    const usFormat = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usFormat) return `${usFormat[3]}-${usFormat[1].padStart(2, "0")}-${usFormat[2].padStart(2, "0")}`;
    return "YYYY-MM-DD";
  }

  function normalizeCurrency(v: string): string {
    const lower = v.toLowerCase().trim();
    if (lower.includes("dollar") || lower === "$" || lower === "us") return "USD";
    if (lower.includes("euro")) return "EUR";
    if (lower.includes("pound")) return "GBP";
    return "ISO_CODE";
  }

  function tabAndLoad(t: DQTab) {
    setTab(t);
    if (!report && !issues.length && !corrections.length) loadAll();
  }

  return (
    <div className="phase-panel column">
      {/* Top bar */}
      <div className="phase-header">
        <div>
          <p className="phase-subtitle">Phase 2</p>
          <h2 className="phase-title">Data Quality & Standardization</h2>
        </div>
        {(runStats || report) && (
          <div className="stat-chips" style={{ marginLeft: 8 }}>
            <div className="stat-chip warning">
              <div className="stat-chip-value">{openIssues}</div>
              <div className="stat-chip-label">Open Issues</div>
            </div>
            <div className="stat-chip">
              <div className="stat-chip-value">{approvedN + appliedN}</div>
              <div className="stat-chip-label">Fixes Ready</div>
            </div>
            <div className="stat-chip success">
              <div className="stat-chip-value">{appliedN}</div>
              <div className="stat-chip-label">Applied</div>
            </div>
            <div className="stat-chip">
              <div className="stat-chip-value">{preview?.totalChanges ?? 0}</div>
              <div className="stat-chip-label">Total Changes</div>
            </div>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <a
            href={standardizationExportAllUrl()}
            className="btn btn-secondary"
            download
            style={{ textDecoration: "none" }}
          >
            Export Report
          </a>
          <button className="btn btn-secondary" onClick={loadAll} disabled={busy}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={runAnalysis} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> Analyzing…
              </>
            ) : report !== null || issues.length > 0 ? (
              "Run Again"
            ) : (
              "Run Analysis"
            )}
          </button>
        </div>
      </div>

      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}

      {/* Tabs */}
      <div className="dq-tabs">
        <button className={`dq-tab ${tab === "overview" ? "active" : ""}`} onClick={() => tabAndLoad("overview")}>
          Overview
        </button>
        <button className={`dq-tab ${tab === "issues" ? "active" : ""}`} onClick={() => tabAndLoad("issues")}>
          Issues {openIssues > 0 ? `(${openIssues})` : ""}
        </button>
        <button className={`dq-tab ${tab === "corrections" ? "active" : ""}`} onClick={() => tabAndLoad("corrections")}>
          Corrections {approvedN + appliedN > 0 ? `(${approvedN + appliedN})` : ""}
        </button>
        <button className={`dq-tab ${tab === "preview" ? "active" : ""}`} onClick={() => tabAndLoad("preview")}>
          Preview
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* ── Overview ── */}
        {tab === "overview" && (
          <div style={{ flex: 1, overflow: "auto", padding: "16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            {!report ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div>Click "Run Analysis" to detect quality issues and generate AI-powered fixes</div>
              </div>
            ) : (
              <>
                {/* KPI strip */}
                <div style={{ display: "flex", gap: 10 }}>
                  {[
                    { label: "Total Issues", value: report.summary.totalIssues, color: report.summary.totalIssues > 0 ? "var(--warning)" : "var(--success)" },
                    { label: "Critical", value: report.summary.criticalIssues, color: report.summary.criticalIssues > 0 ? "var(--magenta)" : "var(--text-muted)" },
                    { label: "Open", value: report.summary.openIssues, color: report.summary.openIssues > 0 ? "var(--warning)" : "var(--success)" },
                    { label: "Pending Fixes", value: pendingN, color: pendingN > 0 ? "var(--accent)" : "var(--text-muted)" },
                    { label: "Applied Fixes", value: appliedN, color: appliedN > 0 ? "var(--success)" : "var(--text-muted)" },
                    { label: "Avg Readiness", value: `${pct(report.summary.averageReadinessScore)}%`, color: pct(report.summary.averageReadinessScore) >= 80 ? "var(--success)" : "var(--warning)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "10px 12px", minWidth: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "var(--font-heading)", lineHeight: 1 }}>{value}</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.2px", marginTop: 4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Two-column analysis */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>
                  {/* Left: issue analysis */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 10 }}>Issues by Type</p>
                      {Object.entries(report.issuesByType).length === 0 ? (
                        <div className="text-muted" style={{ fontSize: 11 }}>No issues detected</div>
                      ) : (
                        Object.entries(report.issuesByType)
                          .sort((a, b) => b[1] - a[1])
                          .map(([type, count]) => (
                            <div key={type} className="bar-chart-row">
                              <span className="bar-chart-label">{type.replace(/_/g, " ")}</span>
                              <div className="bar-chart-bar">
                                <div className="bar-chart-fill" style={{ width: `${(count / (report.summary.totalIssues || 1)) * 100}%`, background: "var(--warning)" }} />
                              </div>
                              <span className="bar-chart-value">{count}</span>
                            </div>
                          ))
                      )}
                    </div>

                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 10 }}>Issues by Severity</p>
                      {Object.entries(report.issuesBySeverity).length === 0 ? (
                        <div className="text-muted" style={{ fontSize: 11 }}>No severity data</div>
                      ) : (
                        Object.entries(report.issuesBySeverity)
                          .sort((a, b) => b[1] - a[1])
                          .map(([sev, count]) => {
                            const sevColor = sev === "critical" || sev === "error" ? "var(--magenta)" : sev === "warning" ? "var(--warning)" : "var(--turquoise-3)";
                            return (
                              <div key={sev} className="bar-chart-row">
                                <span className="bar-chart-label" style={{ textTransform: "capitalize" }}>{sev}</span>
                                <div className="bar-chart-bar">
                                  <div className="bar-chart-fill" style={{ width: `${(count / (report.summary.totalIssues || 1)) * 100}%`, background: sevColor }} />
                                </div>
                                <span className="bar-chart-value">{count}</span>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>

                  {/* Right: standardization actions */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 10 }}>Standardization Actions</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { icon: "🔄", label: "Normalization", desc: "Date formats, currency codes, text casing" },
                          { icon: "🗑️", label: "Duplicate Removal", desc: "Identify and remove redundant records" },
                          { icon: "📊", label: "Outlier Detection", desc: "Flag statistical anomalies for review" },
                          { icon: "🔗", label: "Reference Validation", desc: "Match values to master data" },
                          { icon: "✨", label: "Type Conversion", desc: "Ensure column types match schema" },
                        ].map(({ icon, label, desc }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: "var(--surface)", borderRadius: 2 }}>
                            <span style={{ fontSize: 16 }}>{icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {openIssues > 0 && (
                      <div style={{ background: "var(--accent)", borderRadius: 2, padding: "14px 16px", color: "white" }}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                          {openIssues} issues require attention
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 10 }}>
                          Review and acknowledge issues in the Issues tab to generate AI fixes
                        </div>
                        <button
                          className="btn"
                          style={{ background: "white", color: "var(--accent)", fontWeight: 600 }}
                          onClick={() => setTab("issues")}
                        >
                          Review Issues
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Issues ── */}
        {tab === "issues" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "9px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", flexShrink: 0, flexWrap: "wrap" }}>
              <select className="athena-select" value={selectedDataset} onChange={e => setSelectedDataset(e.target.value)}>
                <option value="all">All Datasets</option>
                {datasetOptions.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select className="athena-select" value={issFilter.status} onChange={e => setIssFilter(f => ({ ...f, status: e.target.value }))}>
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
                <option value="ignored">Ignored</option>
              </select>
              <select className="athena-select" value={issFilter.severity} onChange={e => setIssFilter(f => ({ ...f, severity: e.target.value }))}>
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
              <select className="athena-select" value={issFilter.type} onChange={e => setIssFilter(f => ({ ...f, type: e.target.value }))}>
                <option value="all">All types</option>
                {issueTypes.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
              <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>{visIssues.length} issues</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 22px" }}>
              {visIssues.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">✓</div>
                  <div>No issues match the filters</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {visIssues.map(issue => {
                    const isExpanded = expandedIssue === issue.id;
                    const isProcessing = processingIssue.has(issue.id);
                    const fix = getDetailedFix(issue);
                    const isOpen = issue.status === "open";

                    return (
                      <div
                        key={issue.id}
                        style={{
                          background: "var(--card)",
                          border: `1px solid ${isOpen ? "var(--warning)" : "var(--border)"}`,
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        {/* Issue header */}
                        <div
                          style={{
                            padding: "12px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            cursor: "pointer",
                            background: isOpen ? "rgba(255, 193, 7, 0.05)" : "transparent",
                          }}
                          onClick={() => setExpandedIssue(isExpanded ? null : issue.id)}
                        >
                          <span className={`badge badge-severity-${issue.severity}`}>{issue.severity}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 600, fontSize: 13 }}>{issue.title}</span>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", padding: "2px 6px", borderRadius: 2 }}>
                                {issue.issue_type.replace(/_/g, " ")}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {issue.dataset_file_name} {issue.column_name && `• ${issue.column_name}`}
                            </div>
                          </div>
                          <span className={`badge ${issue.status === "acknowledged" ? "badge-atum-approved" : issue.status === "ignored" ? "badge-atum-rejected" : "badge-atum-suggested"}`}>
                            {issue.status}
                          </span>
                          <span style={{ fontSize: 16, color: "var(--text-muted)" }}>{isExpanded ? "▼" : "▶"}</span>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid var(--border)", padding: "16px", background: "var(--surface)" }}>
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Description</div>
                              <div style={{ fontSize: 12 }}>{issue.description}</div>
                            </div>

                            {issue.affected_rows && (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Affected Rows</div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>{issue.affected_rows.toLocaleString()}</div>
                              </div>
                            )}

                            {/* AI Fix Suggestion */}
                            <div style={{ background: "var(--card)", border: "1px solid var(--accent)", borderRadius: 4, padding: "12px 16px", marginBottom: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 14 }}>🤖</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>AI Suggested Fix</span>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{fix.action}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{fix.details}</div>
                              {fix.examples.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Examples:</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {fix.examples.map((ex, i) => (
                                      <code key={i} style={{ fontSize: 10, background: "var(--surface)", padding: "4px 8px", borderRadius: 2, fontFamily: "var(--font-mono)" }}>
                                        {ex}
                                      </code>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            {isOpen && (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  className="btn btn-primary"
                                  onClick={() => handleAcknowledge(issue.id)}
                                  disabled={isProcessing}
                                  style={{ flex: 1 }}
                                >
                                  {isProcessing ? (
                                    <>
                                      <span className="spinner" /> Generating Fix...
                                    </>
                                  ) : (
                                    <>✓ Acknowledge & Apply Fix</>
                                  )}
                                </button>
                                <button
                                  className="btn btn-ghost"
                                  onClick={() => handleReject(issue.id)}
                                  disabled={isProcessing}
                                >
                                  ✕ Reject
                                </button>
                              </div>
                            )}

                            {issue.status === "acknowledged" && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--success)" }}>
                                <span>✓</span>
                                <span style={{ fontSize: 12 }}>Issue acknowledged - corrections have been generated</span>
                              </div>
                            )}

                            {issue.status === "ignored" && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                                <span>—</span>
                                <span style={{ fontSize: 12 }}>Issue rejected - no action taken</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Corrections ── */}
        {tab === "corrections" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "9px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", flexShrink: 0, flexWrap: "wrap" }}>
              <select className="athena-select" value={selectedDataset} onChange={e => setSelectedDataset(e.target.value)}>
                <option value="all">All Datasets</option>
                {datasetOptions.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select className="athena-select" value={corrFilter} onChange={e => setCorrFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="applied">Applied</option>
              </select>
              {approvedN > 0 && (
                <button className="btn btn-primary btn-sm" onClick={applyAll} disabled={applying}>
                  {applying ? <span className="spinner" /> : null} Apply All ({approvedN})
                </button>
              )}
              {selectedDataset !== "all" && (
                <a
                  href={standardizationExportUrl(selectedDataset)}
                  className="btn btn-secondary btn-sm"
                  download
                  style={{ textDecoration: "none" }}
                >
                  Export Dataset Report
                </a>
              )}
              <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>{visCorr.length} corrections</span>
            </div>
            {applyResult && (
              <div style={{ margin: "0 22px", padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--success)", borderRadius: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: applyResult.results.length > 0 ? 12 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "var(--success)", fontSize: 16 }}>✓</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {applyResult.results.reduce((s, r) => s + r.correctionsApplied, 0) > 0 ? (
                        <>Applied {applyResult.results.reduce((s, r) => s + r.correctionsApplied, 0)} corrections to {applyResult.results.length} dataset(s)</>
                      ) : (
                        <>Processed {applyResult.results.length} dataset(s) - {applyResult.results.reduce((s, r) => s + r.changes.length, 0)} changes tracked</>
                      )}
                    </span>
                  </div>
                </div>
                {applyResult.results.filter(r => r.correctedDataset).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Download corrected datasets:</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {applyResult.results.filter(r => r.correctedDataset).map(r => (
                        <a
                          key={r.correctedDataset!.id}
                          href={downloadCorrectedDatasetUrl(r.correctedDataset!.id)}
                          download
                          className="btn btn-primary btn-sm"
                          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                          <span>⬇</span> {r.correctedDataset!.fileName}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto" }}>
              {visCorr.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">✓</div>
                  <div>No corrections — acknowledge issues to generate fixes</div>
                </div>
              ) : (
                <table className="athena-table">
                  <thead>
                    <tr>
                      <th>Dataset / Column</th>
                      <th>Type</th>
                      <th>Change</th>
                      <th>Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visCorr.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontSize: 11 }}>
                          <div style={{ fontWeight: 500 }}>{c.dataset_file_name}</div>
                          <div className="text-dim">{c.column_name ?? "General"}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: 10, background: "var(--surface)", padding: "2px 6px", borderRadius: 2 }}>
                            {c.correction_type.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          <div className="diff-row">
                            {c.original_value && <span className="diff-old">{c.original_value}</span>}
                            {c.original_value && c.corrected_value && <span className="diff-arrow">→</span>}
                            {c.corrected_value && <span className="diff-new">{c.corrected_value}</span>}
                          </div>
                          {c.reasoning && (
                            <div className="text-dim" style={{ fontSize: 10, marginTop: 2 }}>{c.reasoning}</div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${c.confidence >= 0.8 ? "badge-confidence-high" : c.confidence >= 0.6 ? "badge-confidence-medium" : "badge-confidence-low"}`}>
                            {Math.round(c.confidence * 100)}%
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${c.status === "approved" || c.status === "applied" ? "badge-atum-approved" : c.status === "rejected" ? "badge-atum-rejected" : "badge-atum-suggested"}`}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Preview ── */}
        {tab === "preview" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "9px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", flexShrink: 0 }}>
              <select className="athena-select" value={selectedDataset} onChange={e => setSelectedDataset(e.target.value)}>
                <option value="all">All Datasets</option>
                {datasetOptions.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                {preview?.totalChanges ?? 0} changes across {preview?.totalDatasets ?? 0} datasets
              </span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "16px 22px" }}>
              {!preview || preview.datasets.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👁️</div>
                  <div>No changes to preview — acknowledge issues to generate fixes</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {preview.datasets
                    .filter(d => selectedDataset === "all" || d.datasetId === selectedDataset)
                    .map(dataset => (
                      <div key={dataset.datasetId} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
                        {/* Dataset Header */}
                        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{dataset.fileName}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {dataset.totalChanges} correction{dataset.totalChanges !== 1 ? "s" : ""} • {dataset.columns.length} column{dataset.columns.length !== 1 ? "s" : ""} affected
                            </div>
                          </div>
                          <a
                            href={standardizationExportUrl(dataset.datasetId)}
                            className="btn btn-secondary btn-sm"
                            download
                            style={{ textDecoration: "none" }}
                          >
                            Export Changes
                          </a>
                        </div>

                        {/* Changes Table */}
                        <div style={{ overflow: "auto" }}>
                          <table className="athena-table" style={{ width: "100%", marginBottom: 0 }}>
                            <thead>
                              <tr>
                                <th style={{ width: 140 }}>Column</th>
                                <th style={{ width: 100 }}>Type</th>
                                <th>Original Value</th>
                                <th>Corrected Value</th>
                                <th style={{ width: 80 }}>Confidence</th>
                                <th style={{ width: 200 }}>Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dataset.columns.flatMap((col, colIdx) =>
                                col.changes.map((change, changeIdx) => (
                                  <tr key={`${colIdx}-${changeIdx}`}>
                                    <td>
                                      <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}>
                                        <span style={{
                                          width: 3,
                                          height: 20,
                                          background: "var(--accent)",
                                          borderRadius: 2,
                                          flexShrink: 0,
                                        }} />
                                        <span style={{ fontWeight: 500, fontSize: 12 }}>{col.columnName}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <span style={{
                                        fontSize: 10,
                                        background: "var(--surface)",
                                        padding: "3px 8px",
                                        borderRadius: 3,
                                        textTransform: "capitalize",
                                      }}>
                                        {change.type.replace(/_/g, " ")}
                                      </span>
                                    </td>
                                    <td>
                                      <div style={{
                                        display: "inline-block",
                                        background: "rgba(239, 68, 68, 0.08)",
                                        border: "1px solid rgba(239, 68, 68, 0.2)",
                                        color: "var(--magenta)",
                                        padding: "4px 10px",
                                        borderRadius: 3,
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        maxWidth: 200,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        textDecoration: change.corrected ? "line-through" : "none",
                                      }}>
                                        {change.original || "(empty)"}
                                      </div>
                                    </td>
                                    <td>
                                      <div style={{
                                        display: "inline-block",
                                        background: "rgba(34, 197, 94, 0.08)",
                                        border: "1px solid rgba(34, 197, 94, 0.2)",
                                        color: "var(--success)",
                                        padding: "4px 10px",
                                        borderRadius: 3,
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        fontWeight: 600,
                                        maxWidth: 200,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}>
                                        {change.corrected || "(remove)"}
                                      </div>
                                    </td>
                                    <td>
                                      <span className={`badge ${change.confidence >= 0.8 ? "badge-confidence-high" : change.confidence >= 0.6 ? "badge-confidence-medium" : "badge-confidence-low"}`}>
                                        {Math.round(change.confidence * 100)}%
                                      </span>
                                    </td>
                                    <td>
                                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                        {change.reasoning || "AI-suggested correction"}
                                      </span>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Summary Footer */}
                        <div style={{
                          padding: "10px 18px",
                          background: "var(--surface)",
                          borderTop: "1px solid var(--border)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}>
                          <div style={{ display: "flex", gap: 16 }}>
                            {Object.entries(
                              dataset.columns.flatMap(c => c.changes).reduce((acc, change) => {
                                acc[change.type] = (acc[change.type] || 0) + 1;
                                return acc;
                              }, {} as Record<string, number>)
                            ).map(([type, count]) => (
                              <div key={type} style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                <span style={{ fontWeight: 600 }}>{count}</span> {type.replace(/_/g, " ")}
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Avg confidence: {Math.round(
                              dataset.columns.flatMap(c => c.changes).reduce((sum, c) => sum + c.confidence, 0) /
                              Math.max(dataset.columns.flatMap(c => c.changes).length, 1) * 100
                            )}%
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
