import { useState, useEffect } from "react";
import {
  DataQualityReport, QualityIssue, Correction, ReadinessScore,
  StandardizationStats, ApplyAllCorrectionsResult,
  runStandardization, fetchDataQualityReport, fetchQualityIssues,
  fetchCorrections, fetchReadinessScores,
  updateIssueStatus, approveCorrection, rejectCorrection,
  bulkApproveCorrections, applyAllCorrections,
} from "../../api";

type DQTab = "overview" | "issues" | "corrections" | "readiness";

interface Props {
  datasets: { id: string; file_name: string; status: string; source_type: string | null }[];
  onDatasetsChanged: () => void;
}

/** Guard against backend returning readiness as 0–100 already (vs 0–1). */
function pct(v: number): number {
  if (v > 1) return Math.min(Math.round(v), 100);
  return Math.min(Math.round(v * 100), 100);
}

function readinessClass(s: number) {
  return s >= 80 ? "high" : s >= 50 ? "medium" : "low";
}

export function DataQualityPhase({ datasets: _datasets, onDatasetsChanged }: Props) {
  const [tab,         setTab]         = useState<DQTab>("overview");
  const [busy,        setBusy]        = useState(false);
  const [runStats,    setRunStats]    = useState<StandardizationStats | null>(null);
  const [report,      setReport]      = useState<DataQualityReport | null>(null);
  const [issues,      setIssues]      = useState<QualityIssue[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [scores,      setScores]      = useState<ReadinessScore[]>([]);
  const [issFilter,   setIssFilter]   = useState({ status: "all", severity: "all" });
  const [corrFilter,  setCorrFilter]  = useState("all");
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [error,       setError]       = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyAllCorrectionsResult | null>(null);
  const [applying,    setApplying]    = useState(false);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    try {
      const [r, i, c, s] = await Promise.all([
        fetchDataQualityReport(), fetchQualityIssues(), fetchCorrections(), fetchReadinessScores(),
      ]);
      setReport(r); setIssues(i); setCorrections(c); setScores(s);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }

  async function runAnalysis() {
    setBusy(true); setError(null);
    try {
      const r = await runStandardization();
      setRunStats(r.stats);
      await loadAll();
      setTab("overview");
    } catch (e) { setError(e instanceof Error ? e.message : "Analysis failed"); }
    finally { setBusy(false); }
  }

  async function updateIssue(id: string, status: string) {
    try {
      await updateIssueStatus(id, status);
      setIssues(p => p.map(i => i.id === id ? { ...i, status: status as QualityIssue["status"] } : i));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function approveCorrn(id: string) {
    try { const u = await approveCorrection(id); setCorrections(p => p.map(c => c.id === id ? u : c)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function rejectCorrn(id: string) {
    try { const u = await rejectCorrection(id); setCorrections(p => p.map(c => c.id === id ? u : c)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function bulkApprove() {
    const ids = [...selected]; if (!ids.length) return;
    try {
      await bulkApproveCorrections(ids);
      setCorrections(p => p.map(c => selected.has(c.id) ? { ...c, status: "approved" as const } : c));
      setSelected(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function applyAll() {
    setApplying(true); setError(null);
    try {
      const r = await applyAllCorrections();
      setApplyResult(r);
      setCorrections(await fetchCorrections());
      onDatasetsChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Apply failed"); }
    finally { setApplying(false); }
  }

  const visIssues = issues.filter(i => {
    if (issFilter.status   !== "all" && i.status   !== issFilter.status)   return false;
    if (issFilter.severity !== "all" && i.severity !== issFilter.severity) return false;
    return true;
  });

  const visCorr   = corrections.filter(c => corrFilter === "all" || c.status === corrFilter);
  const pendingN  = corrections.filter(c => c.status === "pending").length;
  const approvedN = corrections.filter(c => c.status === "approved").length;

  function tabAndLoad(t: DQTab) {
    setTab(t);
    if (!report && !issues.length && !corrections.length && !scores.length) loadAll();
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
            <div className="stat-chip"><div className="stat-chip-value">{runStats?.schemasCount ?? report?.summary.totalSchemas ?? 0}</div><div className="stat-chip-label">Schemas</div></div>
            <div className="stat-chip warning"><div className="stat-chip-value">{runStats?.issuesCount ?? report?.summary.totalIssues ?? 0}</div><div className="stat-chip-label">Issues</div></div>
            <div className="stat-chip success"><div className="stat-chip-value">{pct(runStats?.averageReadinessScore ?? report?.summary.averageReadinessScore ?? 0)}%</div><div className="stat-chip-label">Avg Readiness</div></div>
            <div className="stat-chip"><div className="stat-chip-value">{report?.summary.datasetsScored ?? 0}</div><div className="stat-chip-label">Datasets Scored</div></div>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={loadAll} disabled={busy}>Refresh</button>
          <button className="btn btn-primary"   onClick={runAnalysis} disabled={busy}>
            {busy ? <><span className="spinner" /> Analyzing…</> : (report !== null || issues.length > 0) ? "Run Again" : "Run Analysis"}
          </button>
        </div>
      </div>

      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}

      {/* Tabs */}
      <div className="dq-tabs">
        <button className={`dq-tab ${tab === "overview"    ? "active" : ""}`} onClick={() => tabAndLoad("overview")}>Overview</button>
        <button className={`dq-tab ${tab === "issues"      ? "active" : ""}`} onClick={() => tabAndLoad("issues")}>
          Issues {issues.filter(i => i.status === "open").length > 0 ? `(${issues.filter(i => i.status === "open").length})` : ""}
        </button>
        <button className={`dq-tab ${tab === "corrections" ? "active" : ""}`} onClick={() => tabAndLoad("corrections")}>
          Corrections {pendingN > 0 ? `(${pendingN} pending)` : ""}
        </button>
        <button className={`dq-tab ${tab === "readiness"   ? "active" : ""}`} onClick={() => tabAndLoad("readiness")}>Readiness</button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* ── Overview ── */}
        {tab === "overview" && (
          <div style={{ flex: 1, overflow: "auto", padding: "16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            {!report && !scores.length ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div>Click "Run Analysis" to analyze data quality across all datasets</div>
              </div>
            ) : report ? (
              <>
                {/* ── Compact KPI strip ── */}
                <div style={{ display: "flex", gap: 10 }}>
                  {[
                    { label: "Avg Readiness",  value: `${pct(report.summary.averageReadinessScore)}%`, color: pct(report.summary.averageReadinessScore) >= 80 ? "var(--success)" : "var(--warning)" },
                    { label: "Total Issues",   value: report.summary.totalIssues,  color: report.summary.totalIssues   > 0 ? "var(--warning)" : "var(--success)" },
                    { label: "Critical",       value: report.summary.criticalIssues, color: report.summary.criticalIssues > 0 ? "var(--magenta)" : "var(--text-muted)" },
                    { label: "Pending Fixes",  value: report.summary.pendingCorrections, color: report.summary.pendingCorrections > 0 ? "var(--accent)" : "var(--text-muted)" },
                    { label: "Schemas",        value: report.summary.totalSchemas,  color: "var(--text-primary)" },
                    { label: "Datasets Scored",value: report.summary.datasetsScored, color: "var(--text-primary)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "10px 12px", minWidth: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "var(--font-heading)", lineHeight: 1 }}>{value}</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.2px", marginTop: 4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* ── Two-column analysis ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>

                  {/* Left: issue analysis */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 10 }}>Issues by Type</p>
                      {Object.entries(report.issuesByType).length === 0
                        ? <div className="text-muted" style={{ fontSize: 11 }}>No issues detected</div>
                        : Object.entries(report.issuesByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                          <div key={type} className="bar-chart-row">
                            <span className="bar-chart-label">{type.replace(/_/g, " ")}</span>
                            <div className="bar-chart-bar"><div className="bar-chart-fill" style={{ width: `${(count / (report.summary.totalIssues || 1)) * 100}%`, background: "var(--warning)" }} /></div>
                            <span className="bar-chart-value">{count}</span>
                          </div>
                        ))
                      }
                    </div>

                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 10 }}>Issues by Severity</p>
                      {Object.entries(report.issuesBySeverity).length === 0
                        ? <div className="text-muted" style={{ fontSize: 11 }}>No severity data</div>
                        : Object.entries(report.issuesBySeverity).sort((a, b) => b[1] - a[1]).map(([sev, count]) => {
                            const sevColor = sev === "critical" || sev === "error" ? "var(--magenta)" : sev === "warning" ? "var(--warning)" : "var(--turquoise-3)";
                            return (
                              <div key={sev} className="bar-chart-row">
                                <span className="bar-chart-label" style={{ textTransform: "capitalize" }}>{sev}</span>
                                <div className="bar-chart-bar"><div className="bar-chart-fill" style={{ width: `${(count / (report.summary.totalIssues || 1)) * 100}%`, background: sevColor }} /></div>
                                <span className="bar-chart-value">{count}</span>
                              </div>
                            );
                          })
                      }
                    </div>
                  </div>

                  {/* Right: dataset readiness */}
                  <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "14px 16px", overflow: "auto" }}>
                    <p className="section-eyebrow" style={{ marginBottom: 10 }}>Dataset Readiness</p>
                    {(() => {
                      const rows = scores.length > 0
                        ? [...scores].sort((a, b) => a.overall_score - b.overall_score).map(d => ({
                            key: d.id, name: d.dataset_file_name, score: pct(d.overall_score), issues: d.issue_count,
                          }))
                        : report.datasetsNeedingAttention.map(d => ({
                            key: d.datasetId, name: d.fileName, score: pct(d.overallScore), issues: null,
                          }));
                      if (!rows.length) return <div className="text-muted" style={{ fontSize: 11 }}>No dataset scores yet</div>;

                      function cleanName(raw: string) {
                        // strip leading UUID-style prefix (digits-digits-)
                        let s = raw.replace(/^\d{10,}-\d+-/, "");
                        // strip _corrected_TIMESTAMP suffix
                        s = s.replace(/_corrected_\d{4}-\d{2}-\d{2}T[\d-]+/, " ✓");
                        // strip extension
                        s = s.replace(/\.(xlsx|csv|json)$/i, "");
                        // underscores → spaces, collapse dashes
                        s = s.replace(/_/g, " ").replace(/-07-21-2026$/, "");
                        return s.trim();
                      }

                      return rows.map(d => {
                        const clean = cleanName(d.name);
                        const isCorrected = clean.includes("✓");
                        return (
                          <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 11 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isCorrected ? "var(--success)" : "var(--text-primary)", fontWeight: isCorrected ? 600 : 400 }} title={d.name}>
                                {clean}
                              </div>
                              {d.issues != null && (
                                <div style={{ fontSize: 10, color: d.issues > 0 ? "var(--warning)" : "var(--text-dim)", marginTop: 1 }}>
                                  {d.issues > 0 ? `${d.issues} issue${d.issues === 1 ? "" : "s"}` : "no issues"}
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <div style={{ width: 60, height: 4, background: "var(--surface)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ width: `${d.score}%`, height: "100%", background: d.score >= 80 ? "var(--success)" : d.score >= 50 ? "var(--warning)" : "var(--magenta)", borderRadius: 2 }} />
                              </div>
                              <span style={{ width: 36, textAlign: "right", fontWeight: 700, color: d.score >= 80 ? "var(--success)" : d.score >= 50 ? "var(--warning)" : "var(--magenta)" }}>{d.score}%</span>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* ── Issues ── */}
        {tab === "issues" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "9px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", flexShrink: 0 }}>
              <select className="athena-select" value={issFilter.status}   onChange={e => setIssFilter(f => ({ ...f, status: e.target.value }))}>
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
              <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>{visIssues.length} issues</span>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {visIssues.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">✓</div><div>No issues match the filters</div></div>
              ) : (
                <table className="athena-table">
                  <thead>
                    <tr><th>Severity</th><th>Dataset / Column</th><th>Issue</th><th>Suggested Fix</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {visIssues.map(i => (
                      <tr key={i.id}>
                        <td><span className={`badge badge-severity-${i.severity}`}>{i.severity}</span></td>
                        <td style={{ fontSize: 11 }}>
                          <div>{i.dataset_file_name}</div>
                          <div className="text-dim">{i.column_name}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{i.title}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{i.description}</div>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {i.suggested_fix ? <span className="text-success">{i.suggested_fix}</span> : <span className="text-dim">—</span>}
                        </td>
                        <td>
                          <span className={`badge ${i.status === "resolved" ? "badge-atum-approved" : i.status === "open" ? "badge-atum-suggested" : "badge-atum-overridden"}`}>
                            {i.status}
                          </span>
                        </td>
                        <td>
                          {i.status === "open" && (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="btn btn-approve btn-sm" onClick={() => updateIssue(i.id, "acknowledged")}>Ack</button>
                              <button className="btn btn-ghost   btn-sm" onClick={() => updateIssue(i.id, "ignored")}>Ignore</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Corrections ── */}
        {tab === "corrections" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "9px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", flexShrink: 0, flexWrap: "wrap" }}>
              <select className="athena-select" value={corrFilter} onChange={e => setCorrFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="applied">Applied</option>
              </select>
              {selected.size > 0 && (
                <button className="btn btn-approve btn-sm" onClick={bulkApprove}>Approve {selected.size} selected</button>
              )}
              {approvedN > 0 && (
                <button className="btn btn-primary btn-sm" onClick={applyAll} disabled={applying}>
                  {applying ? <span className="spinner" /> : null} Apply Approved ({approvedN})
                </button>
              )}
              <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>{visCorr.length} corrections</span>
            </div>
            {applyResult && (
              <div className="success-bar" style={{ margin: "0 22px 0" }}>
                Applied {applyResult.results.reduce((s, r) => s + r.correctionsApplied, 0)} corrections to {applyResult.results.length} datasets
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto" }}>
              {visCorr.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">✓</div><div>No corrections — run analysis first</div></div>
              ) : (
                <table className="athena-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(visCorr.filter(c => c.status === "pending").map(c => c.id)) : new Set())} /></th>
                      <th>Dataset / Column</th>
                      <th>Change</th>
                      <th>Confidence</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visCorr.map(c => (
                      <tr key={c.id}>
                        <td>
                          {c.status === "pending" && (
                            <input type="checkbox" checked={selected.has(c.id)}
                              onChange={e => setSelected(p => { const n = new Set(p); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} />
                          )}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          <div style={{ fontWeight: 500 }}>{c.dataset_file_name}</div>
                          <div className="text-dim">{c.column_name}</div>
                        </td>
                        <td>
                          <div className="diff-row">
                            {c.original_value  && <span className="diff-old">{c.original_value}</span>}
                            {c.original_value && c.corrected_value && <span className="diff-arrow">→</span>}
                            {c.corrected_value && <span className="diff-new">{c.corrected_value}</span>}
                          </div>
                          {c.reasoning && <div className="text-dim" style={{ fontSize: 10, marginTop: 2 }}>{c.reasoning}</div>}
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
                        <td>
                          {c.status === "pending" && (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="btn btn-approve btn-sm" onClick={() => approveCorrn(c.id)}>Approve</button>
                              <button className="btn btn-reject  btn-sm" onClick={() => rejectCorrn(c.id)}>Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Readiness ── */}
        {tab === "readiness" && (
          <div style={{ flex: 1, overflow: "auto" }}>
            {scores.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📈</div><div>Run analysis to see readiness scores</div></div>
            ) : (
              <table className="athena-table">
                <thead>
                  <tr><th>Dataset</th><th>Source</th><th>Overall</th><th>Completeness</th><th>Validity</th><th>Consistency</th><th>Uniqueness</th><th>Issues</th></tr>
                </thead>
                <tbody>
                  {scores.map(s => {
                    const overall = pct(s.overall_score);
                    return (
                      <tr key={s.id}>
                        <td style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{s.dataset_file_name}</td>
                        <td>{s.source_type ? <span className="source-badge">{s.source_type}</span> : <span className="text-dim">—</span>}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="readiness-bar"><div className={`readiness-fill ${readinessClass(overall)}`} style={{ width: `${overall}%` }} /></div>
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{overall}%</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>{pct(s.completeness_score)}%</td>
                        <td style={{ fontSize: 12 }}>{pct(s.validity_score)}%</td>
                        <td style={{ fontSize: 12 }}>{pct(s.consistency_score)}%</td>
                        <td style={{ fontSize: 12 }}>{pct(s.uniqueness_score)}%</td>
                        <td>
                          <span className={s.critical_issue_count > 0 ? "text-danger" : s.issue_count > 0 ? "text-warning" : "text-success"} style={{ fontWeight: 700, fontSize: 13 }}>
                            {s.issue_count}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
