import { useState, useEffect } from "react";
import {
  TbmExportSummary, TbmExportType, TbmExportFormat, TbmDataModel, TbmExport,
  fetchTbmExportSummary, generateTbmExport, fetchTbmExports, downloadTbmExport,
} from "../../api";

type Tab = "preview" | "generate" | "history";

export function ExportPhase() {
  const [summary, setSummary] = useState<TbmExportSummary | null>(null);
  const [exports, setExports] = useState<TbmExport[]>([]);
  const [model,   setModel]   = useState<TbmDataModel | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [message, setMessage] = useState("");
  const [tab,     setTab]     = useState<Tab>("preview");

  const [exportType,           setExportType]           = useState<TbmExportType>("full");
  const [format,               setFormat]               = useState<TbmExportFormat>("xlsx");
  const [confidenceThreshold,  setConfidenceThreshold]  = useState(0.7);
  const [includeLowConfidence, setIncludeLowConfidence] = useState(false);

  useEffect(() => {
    fetchTbmExportSummary().then(setSummary).catch(console.error);
    fetchTbmExports().then(setExports).catch(console.error);
  }, []);

  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await generateTbmExport({ exportType, format, confidenceThreshold, includeLowConfidence, saveFile: true });
      setModel(r.model);
      setMessage(`Export generated: ${r.recordCount} records`);
      setExports(await fetchTbmExports());
      setTab("generate");
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(false); }
  }

  async function download(id: string, fmt: TbmExportFormat) {
    try { await downloadTbmExport(id, fmt); }
    catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
  }

  return (
    <div className="phase-panel column">
      {/* Header */}
      <div className="phase-header">
        <div style={{ flex: 1 }}>
          <p className="phase-subtitle">Export</p>
          <h2 className="phase-title">TBM Data Model Export</h2>
        </div>
        {summary?.readyForExport && (
          <div className="success-bar" style={{ margin: 0, padding: "6px 12px", fontSize: 12 }}>
            Ready: {summary.totalEntities} entities · {summary.totalEdges} relationships
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="dq-tabs">
        <button className={`dq-tab ${tab === "preview"  ? "active" : ""}`} onClick={() => setTab("preview")}>Preview</button>
        <button className={`dq-tab ${tab === "generate" ? "active" : ""}`} onClick={() => setTab("generate")}>Generate Export</button>
        <button className={`dq-tab ${tab === "history"  ? "active" : ""}`} onClick={() => setTab("history")}>History ({exports.length})</button>
      </div>

      {error   && <div className="error-bar"   style={{ margin: "0 22px" }}>{error}</div>}
      {message && <div className="success-bar" style={{ margin: "0 22px" }}>{message}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>

        {/* ── Preview ── */}
        {tab === "preview" && summary && (
          <>
            <div className="export-preview-grid">
              {[
                { label: "Cost Centers", value: summary.costCenters },
                { label: "Applications", value: summary.applications },
                { label: "Vendors",      value: summary.vendors },
                { label: "Cloud Resources", value: summary.cloudResources },
              ].map(({ label, value }) => (
                <div key={label} className="export-preview-card">
                  <div className="export-preview-value">{value}</div>
                  <div className="export-preview-label">{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="card" style={{ margin: 0 }}>
                <p className="section-eyebrow">Entity Breakdown</p>
                {[
                  ["Business Units", summary.businessUnits],
                  ["Departments",    summary.departments],
                  ["Total Entities", summary.totalEntities],
                  ["Relationships",  summary.totalEdges],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 12 }}>
                    <span className="text-muted">{label}</span>
                    <span style={{ fontWeight: label === "Total Entities" ? 700 : 400, color: label === "Total Entities" ? "var(--accent)" : "var(--text-primary)" }}>{(value as number).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <div className="card" style={{ margin: 0 }}>
                <p className="section-eyebrow">Export Options</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>Export Type</div>
                    <select className="athena-select" style={{ width: "100%" }} value={exportType} onChange={e => setExportType(e.target.value as TbmExportType)}>
                      <option value="full">Full Export</option>
                      <option value="cost_centers">Cost Centers Only</option>
                      <option value="applications">Applications Only</option>
                      <option value="vendors">Vendors Only</option>
                      <option value="cloud_resources">Cloud Resources Only</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>Format</div>
                    <select className="athena-select" style={{ width: "100%" }} value={format} onChange={e => setFormat(e.target.value as TbmExportFormat)}>
                      <option value="xlsx">Excel (.xlsx)</option>
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>Confidence Threshold: {Math.round(confidenceThreshold * 100)}%</div>
                    <input type="range" min={0} max={100} value={Math.round(confidenceThreshold * 100)}
                      onChange={e => setConfidenceThreshold(+e.target.value / 100)}
                      style={{ width: "100%", accentColor: "var(--accent)" }} />
                  </div>
                  <label className="toggle">
                    <input type="checkbox" checked={includeLowConfidence} onChange={e => setIncludeLowConfidence(e.target.checked)} />
                    Include low-confidence records
                  </label>
                  <button className="btn btn-primary" onClick={generate} disabled={busy} style={{ width: "100%", marginTop: 4 }}>
                    {busy ? <><span className="spinner" /> Generating…</> : exports.length > 0 ? "Generate Again" : "Generate Export"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Generated Model ── */}
        {tab === "generate" && model && (
          <div>
            {model.costCenters.length > 0 && (
              <>
                <p className="section-eyebrow">Cost Centers ({model.costCenters.length})</p>
                <table className="athena-table" style={{ marginBottom: 20 }}>
                  <thead>
                    <tr><th>Code</th><th>Name</th><th>Parent</th><th>Business Unit</th><th>Confidence</th></tr>
                  </thead>
                  <tbody>
                    {model.costCenters.slice(0, 20).map((cc, i) => (
                      <tr key={i}>
                        <td><code style={{ fontSize: 11, color: "var(--accent)" }}>{cc.cost_center_code}</code></td>
                        <td style={{ fontWeight: 500 }}>{cc.cost_center_name}</td>
                        <td style={{ fontSize: 11 }} className="text-muted">{cc.parent_cost_center_code ?? "—"}</td>
                        <td style={{ fontSize: 11 }} className="text-muted">{cc.business_unit_name ?? "—"}</td>
                        <td><span className={`badge ${cc.confidence >= 0.8 ? "badge-confidence-high" : "badge-confidence-medium"}`}>{Math.round(cc.confidence * 100)}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {model.vendors.length > 0 && (
              <>
                <p className="section-eyebrow">Vendors ({model.vendors.length})</p>
                <table className="athena-table">
                  <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>ATUM Pool</th><th>Confidence</th></tr></thead>
                  <tbody>
                    {model.vendors.slice(0, 15).map((v, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 11 }} className="text-muted">{v.vendor_id}</td>
                        <td style={{ fontWeight: 500 }}>{v.vendor_name}</td>
                        <td style={{ fontSize: 11 }} className="text-muted">{v.vendor_type ?? "—"}</td>
                        <td style={{ fontSize: 11 }} className="text-muted">{v.atum_cost_pool ?? "—"}</td>
                        <td><span className={`badge ${v.confidence >= 0.8 ? "badge-confidence-high" : "badge-confidence-medium"}`}>{Math.round(v.confidence * 100)}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* ── History ── */}
        {tab === "history" && (
          <table className="athena-table">
            <thead>
              <tr><th>Type</th><th>Format</th><th>Status</th><th>Records</th><th>Created</th><th>Download</th></tr>
            </thead>
            <tbody>
              {exports.length === 0
                ? <tr><td colSpan={6}><div className="empty-state" style={{ padding: "24px 0" }}><div className="empty-icon">📋</div><div>No exports yet</div></div></td></tr>
                : exports.map(e => (
                  <tr key={e.id}>
                    <td><span className="source-badge" style={{ fontSize: "8px" }}>{e.export_type}</span></td>
                    <td style={{ fontSize: 11 }} className="text-muted">{e.format.toUpperCase()}</td>
                    <td><span className={`badge ${e.status === "completed" ? "badge-status-embedded" : e.status === "failed" ? "badge-status-error" : "badge-status-profiled"}`}>{e.status}</span></td>
                    <td style={{ fontSize: 12 }} className="text-muted">{e.record_count?.toLocaleString() ?? "—"}</td>
                    <td style={{ fontSize: 11 }} className="text-muted">{new Date(e.created_at).toLocaleDateString()}</td>
                    <td>
                      {e.status === "completed" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["xlsx", "csv", "json"] as TbmExportFormat[]).map(fmt => (
                            <button key={fmt} className="btn btn-secondary btn-sm" onClick={() => download(e.id, fmt)}>{fmt.toUpperCase()}</button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
