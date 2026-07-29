import { useMemo, useState, useEffect } from "react";
import {
  AtumLayer, AtumMapping, AtumReport, AtumTaxonomyItem,
  fetchAtumMappings, fetchAtumReport, fetchAtumTaxonomy,
  importAtumTaxonomy, reviewAtumMapping, runAtumMapping, syncAtumGraph,
} from "../../api";

export function AtumPhase() {
  const [layer,       setLayer]       = useState<AtumLayer>("resource_tower");
  const [mappings,    setMappings]    = useState<AtumMapping[]>([]);
  const [taxonomy,    setTaxonomy]    = useState<AtumTaxonomyItem[]>([]);
  const [report,      setReport]      = useState<AtumReport | null>(null);
  const [statusFilter,setStatusFilter]= useState("all");
  const [useLlm,      setUseLlm]      = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [message,     setMessage]     = useState("");
  const [runDetails,  setRunDetails]  = useState("");
  const [error,       setError]       = useState("");
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());

  async function refresh(l = layer) {
    const [m, t, r] = await Promise.all([fetchAtumMappings(l), fetchAtumTaxonomy(l), fetchAtumReport()]);
    setMappings(m); setTaxonomy(t); setReport(r);
  }

  // Auto-load on mount so data from previous runs shows immediately
  useEffect(() => {
    setBusy(true);
    refresh().finally(() => setBusy(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function exec(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); await refresh(); setMessage(ok); }
    catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  }

  async function changeLayer(next: AtumLayer) {
    setLayer(next); setBusy(true); setError("");
    try { await refresh(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setBusy(false); }
  }

  function toggleRow(id: string) {
    setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const visible = useMemo(
    () => statusFilter === "all" ? mappings : mappings.filter(m => m.status === statusFilter),
    [mappings, statusFilter]
  );

  function confClass(c: number) {
    return c >= 0.8 ? "badge-confidence-high" : c >= 0.6 ? "badge-confidence-medium" : "badge-confidence-low";
  }

  return (
    <div className="phase-panel column">
      {/* Top bar */}
      <div className="phase-header">
        <div>
          <p className="phase-subtitle">Phase 3</p>
          <h2 className="phase-title">ATUM Mapping</h2>
        </div>
        {report && (
          <div className="stat-chips" style={{ margin: "0 8px" }}>
            <div className="stat-chip accent"> <div className="stat-chip-value">{report.total}</div>                                   <div className="stat-chip-label">Candidates</div></div>
            <div className="stat-chip success"><div className="stat-chip-value">{Math.round(report.coverage * 100)}%</div>            <div className="stat-chip-label">Coverage</div></div>
            <div className="stat-chip">        <div className="stat-chip-value">{Math.round(report.averageConfidence * 100)}%</div>   <div className="stat-chip-label">Avg Confidence</div></div>
            <div className="stat-chip warning"><div className="stat-chip-value">{report.byStatus?.["suggested"] ?? 0}</div>           <div className="stat-chip-label">Need Review</div></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => exec(importAtumTaxonomy, "Taxonomy imported.")}>Import Taxonomy</button>
          <button className="btn btn-primary   btn-sm" disabled={busy}
            onClick={() => exec(async () => {
              const ALL_LAYERS: AtumLayer[] = ["resource_tower", "cost_pool", "solution"];
              let totalMapped = 0, totalCandidates = 0;
              for (const l of ALL_LAYERS) {
                const { stats } = await runAtumMapping(l, useLlm);
                totalMapped     += stats.mapped;
                totalCandidates += stats.candidates;
              }
              setRunDetails(`Mapped ${totalMapped}/${totalCandidates} across all 3 layers.`);
              await refresh(layer);
            }, "Mapping complete.")}>
            {busy ? <><span className="spinner" /> Running…</> : mappings.length > 0 ? "Run Again" : "Run Mapping"}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={() => exec(async () => {
              const ALL_LAYERS: AtumLayer[] = ["resource_tower", "cost_pool", "solution"];
              let totalEdges = 0, totalCategories = 0;
              for (const l of ALL_LAYERS) {
                const r = await syncAtumGraph(l);
                totalEdges     += r.edges;
                totalCategories+= r.categories;
              }
              setRunDetails(`${totalEdges} ATUM edges written across ${totalCategories} categories (all 3 layers) — go to the Relationships phase to explore updated connections.`);
            }, "Graph synced.")}>
            Sync to Graph
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => exec(() => refresh(), "Refreshed.")}>Refresh</button>
        </div>
      </div>

      {/* Layer tabs + filters */}
      <div className="dq-tabs" style={{ gap: 0 }}>
        {([["resource_tower", "Resource Towers"], ["cost_pool", "Cost Pools"], ["solution", "Technology Solutions"]] as [AtumLayer, string][]).map(([l, label]) => (
          <button key={l} className={`dq-tab ${layer === l ? "active" : ""}`} onClick={() => changeLayer(l)}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingRight: 4 }}>
          <label className="toggle">
            <input type="checkbox" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />
            AI refinement
          </label>
          <select className="athena-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="suggested">Needs review</option>
            <option value="approved">Approved</option>
            <option value="overridden">Overridden</option>
            <option value="unresolved">Unresolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {message && (
        <div className="success-bar" style={{ margin: "0 22px" }}>
          {message}{runDetails && <span className="text-muted normal-case" style={{ fontSize: 11 }}> — {runDetails}</span>}
        </div>
      )}
      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}

      {/* Mappings table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗂</div>
            <div style={{ textAlign: "center" }}>
              {busy
                ? "Loading…"
                : mappings.length === 0 && (report?.total ?? 0) === 0
                ? "Import taxonomy then click Run Mapping to generate ATUM classifications"
                : mappings.length === 0
                ? `No mappings for this layer yet — click “Run Mapping” to classify ${layer.replace(/_/g, " ")}s`
                : "No mappings match the current filter"}
            </div>
          </div>
        ) : (
          <table className="athena-table">
            <thead>
              <tr>
                <th>Source Value</th>
                <th>Dataset / Role</th>
                <th>ATUM Classification</th>
                <th>Confidence</th>
                <th>Evidence</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.source_value}</td>
                  <td style={{ fontSize: 11 }}>
                    <div className="text-muted">{m.dataset_file_name}</div>
                    {m.semantic_role && <span className="source-badge" style={{ fontSize: "8px", marginTop: 2, display: "inline-block" }}>{m.semantic_role}</span>}
                  </td>
                  <td>
                    {m.category_path
                      ? <span style={{ fontSize: 12 }}>{m.category_path.replace(/>/g, " › ")}</span>
                      : <span className="text-dim">—</span>}
                    <div style={{ marginTop: 3 }}>
                      <span className={`badge badge-atum-${m.status}`}>{m.status}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${confClass(m.confidence)}`}>{Math.round(m.confidence * 100)}%</span>
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <button className="evidence-toggle" onClick={() => toggleRow(m.id)}>
                      {expanded.has(m.id) ? "▾" : "▸"} Evidence
                    </button>
                    {expanded.has(m.id) && (
                      <div className="evidence-panel">
                        {m.evidence?.canonicalEntityName && (
                          <div>Graph entity: <span className="evidence-entity">{m.evidence.canonicalEntityName}</span></div>
                        )}
                        {m.evidence?.rule && <div>Rule: {m.evidence.rule}</div>}
                        {m.evidence?.vectorSimilarity != null && <div>Vector similarity: {Math.round(m.evidence.vectorSimilarity * 100)}%</div>}
                        {m.evidence?.lexicalScore != null && <div>Keyword score: {Math.round(m.evidence.lexicalScore * 100)}%</div>}
                        {m.source_context && Object.keys(m.source_context).length > 0 && (
                          <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border-soft)" }}>
                            {Object.entries(m.source_context).slice(0, 3).map(([k, v]) => (
                              <div key={k}><span className="text-dim">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 160 }}>
                    {(m.status === "suggested" || m.status === "unresolved") && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-approve btn-sm" onClick={() => exec(() => reviewAtumMapping(m.id, "approve"), "Approved.")}>Approve</button>
                          <button className="btn btn-reject  btn-sm" onClick={() => exec(() => reviewAtumMapping(m.id, "reject"),  "Rejected.")}>Reject</button>
                        </div>
                        <select
                          className="override-select"
                          defaultValue=""
                          onChange={e => { if (e.target.value) exec(() => reviewAtumMapping(m.id, "approve", e.target.value), "Overridden."); }}
                        >
                          <option value="">Override…</option>
                          {taxonomy.slice(0, 60).map(t => (
                            <option key={t.id} value={t.id}>{t.path}</option>
                          ))}
                        </select>
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
  );
}
