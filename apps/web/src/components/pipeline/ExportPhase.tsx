import { useEffect, useMemo, useState } from "react";
import { TBM_EXPORT_URL, TbmDataModel, fetchTbmModel } from "../../api";

// Backed by the derived Stage 7 model (GET /api/tbm), assembled on request from
// the context graph, approved ATUM mappings and readiness scores. There is no
// export job to queue and no history to list — regenerating just re-reads
// current state, so the export can never go stale against the graph.

type Tab = "objects" | "cost" | "relationships" | "datasets";

const PREVIEW_ROWS = 40;
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ExportPhase() {
  const [model, setModel] = useState<TbmDataModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("objects");
  const [typeFilter, setTypeFilter] = useState("all");

  async function load() {
    setBusy(true);
    setError("");
    try {
      setModel(await fetchTbmModel());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build TBM data model");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const objects = useMemo(
    () => (!model ? [] : typeFilter === "all" ? model.objects : model.objects.filter((o) => o.objectType === typeFilter)),
    [model, typeFilter]
  );

  const cards = model
    ? [
        { label: "Total Spend", value: money.format(model.summary.totalCost) },
        { label: "Business Objects", value: model.summary.objects.toLocaleString() },
        { label: "ATUM Coverage", value: `${Math.round(model.summary.classificationCoverage * 100)}%` },
        { label: "Relationships", value: model.summary.relationships.toLocaleString() },
      ]
    : [];

  const overflow =
    tab === "objects" ? objects.length : tab === "cost" ? model?.costFacts.length ?? 0 : model?.relationships.length ?? 0;

  return (
    <div className="phase-panel column">
      <div className="phase-header">
        <div style={{ flex: 1 }}>
          <p className="phase-subtitle">Export</p>
          <h2 className="phase-title">TBM Data Model</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={load} disabled={busy}>
            {busy ? <><span className="spinner" /> Building…</> : "Regenerate"}
          </button>
          <a className="btn btn-primary" href={model ? TBM_EXPORT_URL : undefined} aria-disabled={!model}>
            Download .xlsx
          </a>
        </div>
      </div>

      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
        {!model && !busy && (
          <div className="empty-state" style={{ padding: "40px 0" }}>
            <div className="empty-icon">📦</div>
            <div>Run Stages 4–6 first — the model is assembled from the knowledge graph and approved ATUM mappings.</div>
          </div>
        )}

        {model && (
          <>
            <div className="export-preview-grid">
              {cards.map(({ label, value }) => (
                <div key={label} className="export-preview-card">
                  <div className="export-preview-value">{value}</div>
                  <div className="export-preview-label">{label}</div>
                </div>
              ))}
            </div>

            {model.warnings.length > 0 && (
              <div className="card" style={{ margin: "0 0 16px" }}>
                <p className="section-eyebrow">Before loading into Apptio</p>
                {model.warnings.map((w) => (
                  <div key={w} className="text-warning" style={{ fontSize: 12, padding: "4px 0" }}>{w}</div>
                ))}
              </div>
            )}

            <div className="dq-tabs">
              <button className={`dq-tab ${tab === "objects" ? "active" : ""}`} onClick={() => setTab("objects")}>Objects ({model.objects.length})</button>
              <button className={`dq-tab ${tab === "cost" ? "active" : ""}`} onClick={() => setTab("cost")}>Cost Facts ({model.costFacts.length})</button>
              <button className={`dq-tab ${tab === "relationships" ? "active" : ""}`} onClick={() => setTab("relationships")}>Relationships ({model.relationships.length})</button>
              <button className={`dq-tab ${tab === "datasets" ? "active" : ""}`} onClick={() => setTab("datasets")}>Sources ({model.sourceDatasets.length})</button>
              {tab === "objects" && (
                <select className="athena-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ marginLeft: "auto" }}>
                  <option value="all">All types</option>
                  {Object.entries(model.summary.objectsByType).map(([t, n]) => (
                    <option key={t} value={t}>{t} ({n})</option>
                  ))}
                </select>
              )}
            </div>

            {tab === "objects" && (
              <table className="athena-table">
                <thead><tr><th>Object</th><th>Type</th><th>Cost Pool</th><th>Resource Tower</th><th>Solution</th><th>Confidence</th></tr></thead>
                <tbody>
                  {objects.slice(0, PREVIEW_ROWS).map((o) => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 500 }}>{o.name}</td>
                      <td><span className="source-badge" style={{ fontSize: "8px" }}>{o.objectType}</span></td>
                      <td style={{ fontSize: 11 }} className={o.costPool ? "" : "text-muted"}>{o.costPool ?? "unallocated"}</td>
                      <td style={{ fontSize: 11 }} className={o.resourceTower ? "" : "text-muted"}>{o.resourceTower ?? "unallocated"}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{o.solution ?? "—"}</td>
                      <td>{o.atumConfidence === null
                        ? <span className="text-muted">—</span>
                        : <span className={`badge ${o.atumConfidence >= 0.8 ? "badge-confidence-high" : "badge-confidence-medium"}`}>{Math.round(o.atumConfidence * 100)}%</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "cost" && (
              <table className="athena-table">
                <thead><tr><th>Cost Center</th><th>Account</th><th>Cost Pool</th><th>Resource Tower</th><th>Vendor</th><th>Amount</th><th>Lines</th></tr></thead>
                <tbody>
                  {model.costFacts.slice(0, PREVIEW_ROWS).map((f, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{f.costCenter || "—"}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{f.account || "—"}</td>
                      <td style={{ fontSize: 11 }} className={f.costPool ? "" : "text-muted"}>{f.costPool || "unallocated"}</td>
                      <td style={{ fontSize: 11 }} className={f.resourceTower ? "" : "text-muted"}>{f.resourceTower || "unallocated"}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{f.vendor || "—"}</td>
                      <td style={{ fontWeight: 600 }} className="text-accent">{money.format(f.amount)}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{f.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "relationships" && (
              <table className="athena-table">
                <thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Confidence</th><th>Evidence</th></tr></thead>
                <tbody>
                  {model.relationships.slice(0, PREVIEW_ROWS).map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{r.fromName}<br /><span className="text-muted" style={{ fontSize: 10 }}>{r.fromType}</span></td>
                      <td style={{ fontSize: 11 }} className="text-accent">{r.relationship}</td>
                      <td style={{ fontWeight: 500 }}>{r.toName}<br /><span className="text-muted" style={{ fontSize: 10 }}>{r.toType}</span></td>
                      <td><span className={`badge ${r.confidence >= 0.8 ? "badge-confidence-high" : "badge-confidence-medium"}`}>{Math.round(r.confidence * 100)}%</span></td>
                      <td style={{ fontSize: 11 }} className="text-muted">{r.evidenceDataset ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "datasets" && (
              <table className="athena-table">
                <thead><tr><th>File</th><th>Source Type</th><th>Rows</th><th>Readiness</th><th>Issues</th><th>TBM Ready</th></tr></thead>
                <tbody>
                  {model.sourceDatasets.map((d) => (
                    <tr key={d.datasetId}>
                      <td style={{ fontWeight: 500 }}>{d.fileName}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{d.sourceType ?? "—"}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{d.rowCount?.toLocaleString() ?? "—"}</td>
                      <td>{d.readinessScore === null
                        ? <span className="text-muted">not scored</span>
                        : <span className={`badge ${d.readinessScore >= 0.7 ? "badge-confidence-high" : "badge-confidence-medium"}`}>{Math.round(d.readinessScore * 100)}%</span>}</td>
                      <td style={{ fontSize: 11 }} className="text-muted">{d.issueCount ?? "—"}{d.criticalIssueCount ? ` (${d.criticalIssueCount} critical)` : ""}</td>
                      <td><span className={d.tbmReady ? "text-success" : "text-warning"}>{d.tbmReady ? "yes" : "no"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab !== "datasets" && overflow > PREVIEW_ROWS && (
              <p className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
                Showing the first {PREVIEW_ROWS} rows — the full model is in the downloadable workbook.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
