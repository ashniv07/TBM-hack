import { useState, useEffect } from "react";
import { AnalyticsOverview, DatasetAnalytics, fetchAnalyticsOverview, fetchDatasetAnalytics } from "../api";

function pct(v: number): number {
  if (v > 1) return Math.min(Math.round(v), 100);
  return Math.min(Math.round(v * 100), 100);
}

function scoreColor(v: number): string {
  if (v >= 80) return "var(--success)";
  if (v >= 60) return "var(--warning)";
  return "var(--magenta)";
}

function scoreBg(v: number): string {
  if (v >= 80) return "var(--success-bg)";
  if (v >= 60) return "rgba(255,187,28,.08)";
  return "rgba(115,26,66,.12)";
}

function cleanName(name: string): string {
  return name
    .replace(/^\d{10,}-\d+-/, "")
    .replace(/_corrected_\d{4}-\d{2}-\d{2}T[\d.Z-]+/i, " ✓")
    .replace(/\.(xlsx|csv|json)$/i, "")
    .replace(/_/g, " ")
    .replace(/-07-21-2026$/, "")
    .trim();
}

interface ActionItem {
  severity: "critical" | "warning" | "info";
  label: string;
  detail: string;
  phase: string;
}

export function DashboardTab() {
  const [overview,  setOverview]  = useState<AnalyticsOverview | null>(null);
  const [datasets,  setDatasets]  = useState<DatasetAnalytics[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAnalyticsOverview(), fetchDatasetAnalytics()])
      .then(([ov, ds]) => { setOverview(ov); setDatasets(ds); })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-overlay"><span className="spinner" /> Loading dashboard…</div>;
  if (error)   return <div className="error-bar" style={{ margin: 24 }}>{error}</div>;
  if (!overview) return <div className="empty-state"><div>No analytics data</div></div>;

  const s        = overview.summary;
  const dq       = overview.dataQuality;
  const atum     = overview.atumMapping;
  const byStatus = atum.mappingsByStatus ?? {};
  const byLayer  = atum.mappingsByLayer  ?? {};
  const byTower  = atum.mappingsByTower  ?? {};

  const readiness   = pct(s.avgReadiness);
  const atumCov     = pct(s.atumCoverage);
  const completeness = pct(dq.avgScores.completeness);
  const validity     = pct(dq.avgScores.validity);
  const consistency  = pct(dq.avgScores.consistency);
  const uniqueness   = pct(dq.avgScores.uniqueness);

  // TBM Readiness Score: weighted composite
  const tbmScore = Math.round(
    readiness   * 0.30 +
    atumCov     * 0.35 +
    completeness * 0.20 +
    Math.max(0, 100 - (s.openIssues / Math.max(s.totalIssues, 1)) * 100) * 0.15
  );

  // Derive action items
  const actions: ActionItem[] = [];
  const criticalIssues = dq.issuesBySeverity["critical"] ?? 0;
  if (criticalIssues > 0)
    actions.push({ severity: "critical", label: `${criticalIssues} critical quality issue${criticalIssues > 1 ? "s" : ""}`, detail: "Require immediate attention before export", phase: "Data Quality" });

  const unresolved = byStatus["unresolved"] ?? 0;
  if (unresolved > 0)
    actions.push({ severity: "warning", label: `${unresolved} unresolved ATUM mapping${unresolved > 1 ? "s" : ""}`, detail: "Entities with no taxonomy classification", phase: "ATUM Mapping" });

  const needsReview = byStatus["suggested"] ?? 0;
  if (needsReview > 0)
    actions.push({ severity: "warning", label: `${needsReview} mapping${needsReview > 1 ? "s" : ""} need review`, detail: "AI suggestions awaiting approval or rejection", phase: "ATUM Mapping" });

  const lowReadiness = datasets.filter(d => d.readiness && d.readiness.overall < 0.7);
  if (lowReadiness.length > 0)
    actions.push({ severity: "warning", label: `${lowReadiness.length} dataset${lowReadiness.length > 1 ? "s" : ""} below 70% readiness`, detail: lowReadiness.map(d => cleanName(d.fileName)).slice(0, 3).join(", "), phase: "Data Quality" });

  const notEmbedded = datasets.filter(d => d.status !== "embedded" && d.status !== "error");
  if (notEmbedded.length > 0)
    actions.push({ severity: "info", label: `${notEmbedded.length} dataset${notEmbedded.length > 1 ? "s" : ""} not fully processed`, detail: "Run the Relationships phase to build graph", phase: "Relationships" });

  if (actions.length === 0)
    actions.push({ severity: "info", label: "All checks passing", detail: "Your TBM data model is in good shape", phase: "" });

  // ATUM by layer with totals
  const layerLabels: Record<string, string> = { resource_tower: "Resource Towers", cost_pool: "Cost Pools", solution: "Technology Solutions" };
  const approved   = byStatus["approved"] ?? 0 + (byStatus["overridden"] ?? 0);
  const totalMapped = s.totalMappings;

  // Top ATUM towers
  const topTowers = Object.entries(byTower).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxTower  = Math.max(...topTowers.map(t => t[1]), 1);

  // Dataset table sorted by readiness asc (worst first)
  const sortedDatasets = [...datasets].sort((a, b) => (a.readiness?.overall ?? 1) - (b.readiness?.overall ?? 1));

  const sevColor = (sev: ActionItem["severity"]) =>
    sev === "critical" ? "var(--magenta)" : sev === "warning" ? "var(--warning)" : "var(--turquoise-3)";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, overflow: "auto" }}>

      {/* ── Hero row ── */}
      <div style={{ display: "flex", gap: 10, padding: "14px 20px 0", flexShrink: 0 }}>
        {/* TBM Readiness Score */}
        <div style={{ background: "var(--card)", border: `1px solid var(--border)`, borderTop: `3px solid ${scoreColor(tbmScore)}`, borderRadius: 3, padding: "14px 20px", minWidth: 170, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 4 }}>TBM Readiness Score</div>
          <div style={{ fontSize: 44, fontWeight: 800, fontFamily: "var(--font-heading)", color: scoreColor(tbmScore), lineHeight: 1 }}>{tbmScore}<span style={{ fontSize: 20 }}>%</span></div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>{tbmScore >= 80 ? "Export ready" : tbmScore >= 60 ? "Needs attention" : "Not ready for export"}</div>
        </div>
        {/* KPI chips */}
        <div style={{ display: "flex", flex: 1, gap: 8 }}>
          {([
            { label: "Datasets",       value: s.totalDatasets,              note: `${s.totalRows.toLocaleString()} rows`, col: "" },
            { label: "Graph Entities", value: s.totalEntities,              note: `${s.totalEdges} relationships`,        col: "var(--turquoise-3)" },
            { label: "Avg Readiness",  value: `${readiness}%`,              note: readiness >= 80 ? "All good" : "Issues found", col: scoreColor(readiness) },
            { label: "ATUM Coverage",  value: `${atumCov}%`,                note: `${s.approvedMappings} approved`,       col: scoreColor(atumCov) },
            { label: "Open Issues",    value: s.openIssues,                 note: `of ${s.totalIssues} total`,            col: s.openIssues > 0 ? "var(--warning)" : "var(--success)" },
          ] as { label: string; value: string | number; note: string; col: string }[]).map(({ label, value, note, col }) => (
            <div key={label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "12px 16px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--font-heading)", color: col || "var(--text-primary)", lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginTop: 3 }}>{label}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "auto auto", gap: 10, padding: "10px 20px 14px" }}>

        {/* Action Items */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "14px 16px", gridColumn: "1", gridRow: "1" }}>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Action Items</div>
          {actions.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: i < actions.length - 1 ? "1px solid var(--border-soft)" : "none", alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor(a.severity), flexShrink: 0, marginTop: 4 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{a.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{a.detail}</div>
              </div>
              {a.phase && <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "1px", flexShrink: 0, marginTop: 2 }}>{a.phase}</div>}
            </div>
          ))}
        </div>

        {/* Data Quality Dimensions */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "14px 16px", gridColumn: "2", gridRow: "1" }}>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Data Quality Dimensions</div>
          {([
            ["Completeness", completeness],
            ["Validity",     validity],
            ["Consistency",  consistency],
            ["Uniqueness",   uniqueness],
          ] as [string, number][]).map(([dim, val]) => (
            <div key={dim} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-primary)" }}>{dim}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(val) }}>{val}%</span>
              </div>
              <div style={{ height: 5, background: "var(--surface)", borderRadius: 99 }}>
                <div style={{ height: "100%", width: `${val}%`, background: scoreColor(val), borderRadius: 99, transition: "width .4s" }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {([
              { label: "Excellent (>=90%)", value: dq.readinessDistribution.excellent, col: "var(--success)" },
              { label: "Good (70–90%)",    value: dq.readinessDistribution.good,      col: "var(--turquoise-3)" },
              { label: "Fair (50–70%)",    value: dq.readinessDistribution.fair,      col: "var(--warning)" },
              { label: "Poor (<50%)",      value: dq.readinessDistribution.poor,      col: "var(--magenta)" },
            ]).map(({ label, value, col }) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 2, padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)", color: col }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ATUM Coverage */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "14px 16px", gridColumn: "3", gridRow: "1" }}>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>ATUM Taxonomy Coverage</div>
          {/* Layer breakdown */}
          <div style={{ marginBottom: 12 }}>
            {Object.entries(layerLabels).map(([key, label]) => {
              const count = byLayer[key] ?? 0;
              const layerPct = totalMapped > 0 ? Math.round((count / totalMapped) * 100) : 0;
              return (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: "var(--text-primary)" }}>{label}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{count} mappings</span>
                  </div>
                  <div style={{ height: 5, background: "var(--surface)", borderRadius: 99 }}>
                    <div style={{ height: "100%", width: `${layerPct}%`, background: "var(--accent)", borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Status badges */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.entries(byStatus).map(([status, count]) => (
              <div key={status} style={{ background: "var(--surface)", border: `1px solid ${status === "approved" || status === "overridden" ? "var(--success)" : status === "suggested" ? "var(--warning)" : status === "rejected" ? "var(--magenta)" : "var(--border)"}`, borderRadius: 2, padding: "3px 8px", fontSize: 10 }}>
                <span style={{ color: status === "approved" || status === "overridden" ? "var(--success)" : status === "suggested" ? "var(--warning)" : status === "rejected" ? "var(--magenta)" : "var(--text-muted)" }}>{status}</span>
                <span style={{ color: "var(--text-primary)", marginLeft: 5, fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
          {/* Top ATUM towers */}
          {topTowers.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 6 }}>Top Classified Towers</div>
              {topTowers.map(([tower, count]) => (
                <div key={tower} className="bar-chart-row">
                  <span className="bar-chart-label" style={{ fontSize: 10, maxWidth: 130 }}>{tower}</span>
                  <div className="bar-chart-bar"><div className="bar-chart-fill" style={{ width: `${(count / maxTower) * 100}%`, background: "var(--accent)" }} /></div>
                  <span className="bar-chart-value">{count}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Dataset Health Table */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "14px 16px", gridColumn: "1 / 3", gridRow: "2" }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Dataset Health</div>
          <div>
            <table className="athena-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Type</th>
                  <th style={{ width: 70, textAlign: "center" }}>Rows</th>
                  <th style={{ width: 110 }}>Readiness</th>
                  <th style={{ width: 55, textAlign: "center" }}>Complete</th>
                  <th style={{ width: 55, textAlign: "center" }}>Valid</th>
                  <th style={{ width: 55, textAlign: "center" }}>Issues</th>
                  <th style={{ width: 70, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedDatasets.map(d => {
                  const r = d.readiness;
                  const overallPct = r ? pct(r.overall) : null;
                  return (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.fileName}>
                        {cleanName(d.fileName)}
                      </td>
                      <td><span className="source-badge" style={{ fontSize: 9 }}>{d.sourceType ?? "unknown"}</span></td>
                      <td style={{ textAlign: "center", color: "var(--text-muted)" }}>{d.rowCount?.toLocaleString() ?? "—"}</td>
                      <td>
                        {overallPct !== null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 4, background: "var(--surface)", borderRadius: 99 }}>
                              <div style={{ height: "100%", width: `${overallPct}%`, background: scoreColor(overallPct), borderRadius: 99 }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(overallPct), width: 32 }}>{overallPct}%</span>
                          </div>
                        ) : <span className="text-dim">—</span>}
                      </td>
                      <td style={{ textAlign: "center", color: r ? scoreColor(pct(r.completeness)) : "var(--text-dim)", fontWeight: 700 }}>{r ? `${pct(r.completeness)}%` : "—"}</td>
                      <td style={{ textAlign: "center", color: r ? scoreColor(pct(r.validity)) : "var(--text-dim)", fontWeight: 700 }}>{r ? `${pct(r.validity)}%` : "—"}</td>
                      <td style={{ textAlign: "center" }}>
                        {d.issues.total > 0 ? (
                          <span style={{ color: d.issues.critical > 0 ? "var(--magenta)" : "var(--warning)", fontWeight: 700 }}>
                            {d.issues.open}{d.issues.critical > 0 ? ` (${d.issues.critical}!)` : ""}
                          </span>
                        ) : <span className="text-dim">—</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: ".5px", padding: "2px 6px", borderRadius: 2, textTransform: "uppercase",
                          background: d.status === "embedded" ? "var(--success-bg)" : "rgba(255,187,28,.1)",
                          color: d.status === "embedded" ? "var(--success)" : "var(--warning)",
                          border: `1px solid ${d.status === "embedded" ? "var(--success)" : "var(--warning)"}`,
                        }}>{d.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Knowledge Graph + Issue Types */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: "14px 16px", gridColumn: "3", gridRow: "2", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Knowledge Graph Mix</div>
            {Object.entries(overview.knowledgeGraph.entityTypes).filter(([t]) => t !== "atum_category").sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => {
              const total = Object.values(overview.knowledgeGraph.entityTypes).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={type} className="bar-chart-row">
                  <span className="bar-chart-label" style={{ fontSize: 10 }}>{type.replace(/_/g, " ")}</span>
                  <div className="bar-chart-bar"><div className="bar-chart-fill" style={{ width: `${(count / total) * 100}%`, background: "var(--turquoise-3)" }} /></div>
                  <span className="bar-chart-value">{count}</span>
                </div>
              );
            })}
          </div>
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Issue Types</div>
            {Object.entries(overview.dataQuality.issuesByType).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([type, count]) => {
              const total = Object.values(overview.dataQuality.issuesByType).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={type} className="bar-chart-row">
                  <span className="bar-chart-label" style={{ fontSize: 10 }}>{type.replace(/_/g, " ")}</span>
                  <div className="bar-chart-bar"><div className="bar-chart-fill" style={{ width: `${(count / total) * 100}%`, background: "var(--warning)" }} /></div>
                  <span className="bar-chart-value">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
