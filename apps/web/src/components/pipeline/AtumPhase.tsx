import { useMemo, useState, useEffect } from "react";
import {
  AtumLayer, AtumMapping, AtumReport, AtumTaxonomyItem, Dataset,
  fetchAtumMappings, fetchAtumReport, fetchAtumTaxonomy, fetchDatasets,
  importAtumTaxonomy, reviewAtumMapping, runAtumMapping, syncAtumGraph,
  bulkApproveAtumMappings, bulkAcceptAtumSuggestions, refinedExportUrl,
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
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [showCaution, setShowCaution] = useState(false);
  const [datasets,    setDatasets]    = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [showExportModal, setShowExportModal] = useState(false);

  async function refresh(l = layer) {
    const [m, t, r, d] = await Promise.all([
      fetchAtumMappings(l), fetchAtumTaxonomy(l), fetchAtumReport(), fetchDatasets()
    ]);
    setMappings(m); setTaxonomy(t); setReport(r); setDatasets(d);
    setSelected(new Set()); // Clear selection on refresh
    // Auto-select first exportable dataset if none selected
    const exportable = d.filter(ds => ds.master_type && ds.refined_path);
    if (!selectedDataset && exportable.length > 0) {
      setSelectedDataset(exportable[0].id);
    }
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

  function toggleSelect(id: string) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    const selectableIds = visible.filter(m => m.status === "suggested" || m.status === "unresolved").map(m => m.id);
    if (selectableIds.every(id => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await bulkApproveAtumMappings(Array.from(selected));
      await refresh();
      setMessage(`Approved ${result.approved} mapping(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk approval failed");
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(
    () => statusFilter === "all" ? mappings : mappings.filter(m => m.status === statusFilter),
    [mappings, statusFilter]
  );

  // Count unreviewed mappings (suggested or unresolved)
  const unreviewedCount = useMemo(
    () => mappings.filter(m => m.status === "suggested" || m.status === "unresolved").length,
    [mappings]
  );

  // Count approved mappings
  const approvedCount = useMemo(
    () => mappings.filter(m => m.status === "approved" || m.status === "overridden").length,
    [mappings]
  );

  // Count mappings without category (have suggestions but not applied)
  const uncategorizedCount = useMemo(
    () => mappings.filter(m => !m.category_id && m.alternatives && m.alternatives.length > 0).length,
    [mappings]
  );

  // Count classified mappings (have category_id)
  const classifiedCount = useMemo(
    () => mappings.filter(m => m.category_id).length,
    [mappings]
  );

  async function acceptAllSuggestions() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await bulkAcceptAtumSuggestions(layer);
      await refresh();
      setMessage(`Applied ${result.applied} of ${result.total} suggestions.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept suggestions");
    } finally {
      setBusy(false);
    }
  }

  const selectableInView = visible.filter(m => m.status === "suggested" || m.status === "unresolved");
  const allSelected = selectableInView.length > 0 && selectableInView.every(m => selected.has(m.id));

  function handleExport() {
    if (unreviewedCount > 0) {
      setShowCaution(true);
      return;
    }
    setShowExportModal(true);
  }

  function triggerExport() {
    setShowCaution(false);
    setShowExportModal(true);
  }

  function downloadRefinedExport() {
    if (!selectedDataset) {
      setError("Please select a dataset to export");
      return;
    }
    setShowExportModal(false);
    window.location.href = refinedExportUrl(selectedDataset);
  }

  function confClass(c: number) {
    return c >= 0.8 ? "badge-confidence-high" : c >= 0.6 ? "badge-confidence-medium" : "badge-confidence-low";
  }

  const selectedDatasetName = datasets.find(d => d.id === selectedDataset)?.file_name || "Select dataset";

  return (
    <div className="phase-panel column">
      {/* Caution Modal */}
      {showCaution && (
        <div className="modal-overlay" onClick={() => setShowCaution(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 32 }}>⚠️</span>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>Unreviewed Mappings</h3>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                  {unreviewedCount} mapping(s) have not been approved or rejected
                </p>
              </div>
            </div>
            <p style={{ fontSize: 13, marginBottom: 16 }}>
              Exporting now will only include <strong>approved</strong> mappings ({approvedCount} approved).
              Unreviewed items will be excluded from the export.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setShowCaution(false)}>
                Review First
              </button>
              <button className="btn btn-primary" onClick={triggerExport}>
                Export Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Dataset Selection Modal */}
      {showExportModal && (() => {
        const exportableDatasets = datasets.filter(d => d.master_type && d.refined_path);
        return (
          <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Export Refined Dataset</h3>
              {exportableDatasets.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                    No datasets ready for export.
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    Complete the Relationships phase to generate refined datasets with template mappings.
                  </p>
                  <button className="btn btn-secondary" onClick={() => setShowExportModal(false)} style={{ marginTop: 16 }}>
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
                    Select the dataset to export. The export will include:
                  </p>
                  <ul style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px", paddingLeft: 20 }}>
                    <li>Refined data (mapped columns with template names)</li>
                    <li>Column mapping details</li>
                    <li>Data quality issues</li>
                    <li>Approved ATUM classifications ({approvedCount} approved)</li>
                  </ul>
                  <select
                    className="athena-select"
                    value={selectedDataset}
                    onChange={e => setSelectedDataset(e.target.value)}
                    style={{ width: "100%", marginBottom: 16, padding: "8px 12px" }}
                  >
                    <option value="">Select a dataset...</option>
                    {exportableDatasets.map(d => (
                      <option key={d.id} value={d.id}>{d.file_name} ({d.master_type})</option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn btn-secondary" onClick={() => setShowExportModal(false)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={downloadRefinedExport}
                      disabled={!selectedDataset}
                    >
                      ⬇ Download .xlsx
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Top bar */}
      <div className="phase-header">
        <div>
          <p className="phase-subtitle">Phase 4</p>
          <h2 className="phase-title">ATUM Mapping & Export</h2>
        </div>
        {report && (
          <div className="stat-chips" style={{ margin: "0 8px" }}>
            <div className="stat-chip accent"> <div className="stat-chip-value">{report.total}</div>                                   <div className="stat-chip-label">Candidates</div></div>
            <div className="stat-chip success"><div className="stat-chip-value">{classifiedCount}</div>                               <div className="stat-chip-label">Classified</div></div>
            <div className="stat-chip">        <div className="stat-chip-value">{Math.round(report.averageConfidence * 100)}%</div>   <div className="stat-chip-label">Avg Confidence</div></div>
            <div className="stat-chip warning"><div className="stat-chip-value">{uncategorizedCount}</div>                            <div className="stat-chip-label">Need Category</div></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => exec(importAtumTaxonomy, "Taxonomy imported.")}>Import Taxonomy</button>
          <button className="btn btn-primary   btn-sm" disabled={busy}
            onClick={() => exec(async () => {
              const ALL_LAYERS: AtumLayer[] = ["resource_tower", "cost_pool"];
              let totalMapped = 0, totalCandidates = 0;
              for (const l of ALL_LAYERS) {
                const { stats } = await runAtumMapping(l, useLlm);
                totalMapped     += stats.mapped;
                totalCandidates += stats.candidates;
              }
              setRunDetails(`Mapped ${totalMapped}/${totalCandidates} across all layers.`);
              await refresh(layer);
            }, "Mapping complete.")}>
            {busy ? <><span className="spinner" /> Running…</> : mappings.length > 0 ? "Run Again" : "Run Mapping"}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={() => exec(async () => {
              const ALL_LAYERS: AtumLayer[] = ["resource_tower", "cost_pool"];
              let totalEdges = 0, totalCategories = 0;
              for (const l of ALL_LAYERS) {
                const r = await syncAtumGraph(l);
                totalEdges     += r.edges;
                totalCategories+= r.categories;
              }
              setRunDetails(`${totalEdges} ATUM edges written across ${totalCategories} categories.`);
            }, "Graph synced.")}>
            Sync to Graph
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => exec(() => refresh(), "Refreshed.")}>Refresh</button>
          {uncategorizedCount > 0 && (
            <button
              className="btn btn-warning btn-sm"
              disabled={busy}
              onClick={acceptAllSuggestions}
              title={`Apply best suggestion to ${uncategorizedCount} uncategorized mappings`}
            >
              ⚡ Accept All Suggestions ({uncategorizedCount})
            </button>
          )}
          <div style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
          <button
            className="btn btn-accent btn-sm"
            disabled={busy || mappings.length === 0}
            onClick={handleExport}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            📦 Export Refined Data
          </button>
        </div>
      </div>

      {/* Layer tabs + filters */}
      <div className="dq-tabs" style={{ gap: 0 }}>
        {([["resource_tower", "Resource Towers"], ["cost_pool", "Cost Pools"]] as [AtumLayer, string][]).map(([l, label]) => (
          <button key={l} className={`dq-tab ${layer === l ? "active" : ""}`} onClick={() => changeLayer(l)}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingRight: 4 }}>
          {selected.size > 0 && (
            <button
              className="btn btn-approve btn-sm"
              onClick={bulkApprove}
              disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              ✓ Approve Selected ({selected.size})
            </button>
          )}
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
                ? `No mappings for this layer yet — click "Run Mapping" to classify ${layer.replace(/_/g, " ")}s`
                : "No mappings match the current filter"}
            </div>
          </div>
        ) : (
          <table className="athena-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  {selectableInView.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      title="Select all for bulk approval"
                    />
                  )}
                </th>
                <th>Source Value</th>
                <th>Dataset / Role</th>
                <th>ATUM Classification</th>
                <th>Confidence</th>
                <th>Evidence</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => {
                const isSelectable = m.status === "suggested" || m.status === "unresolved";
                return (
                  <tr key={m.id}>
                    <td>
                      {isSelectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                        />
                      )}
                    </td>
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
                      {isSelectable && (
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
