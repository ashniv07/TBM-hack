import { useRef, useState } from "react";
import {
  Dataset, DatasetColumn, DatasetRelationship,
  uploadDatasets, UploadResult,
  fetchDatasetDetail, fetchRelationships,
  rerunUnderstanding, rerunEmbedding,
} from "../../api";

interface Props {
  datasets: Dataset[];
  onDatasetsChanged: () => void;
}

function statusClass(s: string) {
  const m: Record<string, string> = {
    embedded:   "badge-status-embedded",
    understood: "badge-status-understood",
    profiled:   "badge-status-profiled",
    uploaded:   "badge-status-uploaded",
    error:      "badge-status-error",
  };
  return `badge ${m[s] ?? "badge-status-uploaded"}`;
}

export function ImportPhase({ datasets, onDatasetsChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag,    setDrag]    = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  /* Drawer */
  const [open,      setOpen]      = useState(false);
  const [selId,     setSelId]     = useState<string>();
  const [ds,        setDs]        = useState<Dataset | null>(null);
  const [cols,      setCols]      = useState<DatasetColumn[]>([]);
  const [rels,      setRels]      = useState<DatasetRelationship[]>([]);
  const [dsrBusy,   setDsrBusy]  = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []).filter(f => /\.(xlsx|xls)$/i.test(f.name));
    if (!list.length) return;
    setBusy(true); setResults([]);
    try {
      const res = await uploadDatasets(list);
      setResults(res);
      onDatasetsChanged();
    } catch (e) {
      setResults([{ fileName: "batch", error: e instanceof Error ? e.message : "Upload failed" }]);
    } finally { setBusy(false); }
  }

  async function openDrawer(d: Dataset) {
    setSelId(d.id); setDs(d); setOpen(true);
    try {
      const [detail, r] = await Promise.all([fetchDatasetDetail(d.id), fetchRelationships(d.id)]);
      setDs(detail.dataset); setCols(detail.columns); setRels(r);
    } catch { /* silent */ }
  }

  async function rerun(action: "understand" | "embed") {
    if (!ds) return;
    setDsrBusy(action);
    try {
      if (action === "understand") await rerunUnderstanding(ds.id);
      else await rerunEmbedding(ds.id);
      await openDrawer(ds);
      onDatasetsChanged();
    } finally { setDsrBusy(null); }
  }

  const ready  = datasets.filter(d => d.status === "embedded").length;
  const errors = datasets.filter(d => d.status === "error").length;
  const rows   = datasets.reduce((s, d) => s + (d.row_count ?? 0), 0);

  return (
    <div className="phase-panel">
      {/* ── Left: Upload + Summary ── */}
      <div className="phase-left">
        <div className="phase-header">
          <div>
            <p className="phase-subtitle">Step 1</p>
            <h2 className="phase-title">Import Data</h2>
          </div>
        </div>

        <div className="phase-scroll">
          {/* Upload zone */}
          <div
            className={`upload-zone ${drag ? "drag-active" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          >
            <div className="upload-zone-icon">↑</div>
            <div className="upload-zone-text">
              {busy ? "Uploading…" : "Drop Excel files or click to browse"}
            </div>
            <div className="upload-zone-hint">.xlsx / .xls — auto-runs all ingestion stages</div>
            {busy && <div className="spinner" style={{ margin: "12px auto 0" }} />}
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple hidden onChange={e => handleFiles(e.target.files)} />

          {results.length > 0 && (
            <ul className="upload-result-list">
              {results.map((r, i) => (
                <li key={i}>
                  <span className={r.error ? "err" : "ok"}>{r.error ? "✗" : "✓"}</span>
                  <span className="text-muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                    {r.fileName}
                  </span>
                  <span className={r.error ? "err" : "ok"} style={{ fontSize: 10 }}>{r.error ?? r.stage ?? "ingested"}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="divider" />
          <p className="section-eyebrow">Summary</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="stat-chip accent">
              <div className="stat-chip-value">{datasets.length}</div>
              <div className="stat-chip-label">Datasets</div>
            </div>
            <div className="stat-chip success">
              <div className="stat-chip-value">{ready}</div>
              <div className="stat-chip-label">Ready</div>
            </div>
            <div className="stat-chip">
              <div className="stat-chip-value">{rows.toLocaleString()}</div>
              <div className="stat-chip-label">Total Rows</div>
            </div>
            <div className={`stat-chip ${errors > 0 ? "danger" : ""}`}>
              <div className="stat-chip-value">{errors}</div>
              <div className="stat-chip-label">Errors</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Dataset Catalog ── */}
      <div className="phase-right">
        <div className="phase-header">
          <h2 className="phase-title">Dataset Catalog</h2>
          <span className="text-muted" style={{ fontSize: 11, marginLeft: "auto" }}>Click a row to inspect</span>
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          {datasets.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📂</div>
              <div>No datasets yet — upload Excel files to get started</div>
            </div>
          ) : (
            <table className="athena-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Source Type</th>
                  <th>Rows</th>
                  <th>Status</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map(d => (
                  <tr key={d.id} className={`clickable ${d.id === selId ? "selected" : ""}`} onClick={() => openDrawer(d)}>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {d.file_name}
                    </td>
                    <td>
                      {d.source_type
                        ? <span className="source-badge">{d.source_type}</span>
                        : <span className="text-dim">—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{d.row_count?.toLocaleString() ?? "—"}</td>
                    <td><span className={statusClass(d.status)}>{d.status}</span></td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span className="text-muted" style={{ fontSize: 11 }}>{d.business_purpose ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Dataset Detail Drawer ── */}
      {open && <div className="drawer-overlay" onClick={() => setOpen(false)} />}
      <div className={`detail-drawer ${open ? "open" : ""}`}>
        {ds && (
          <>
            <div className="drawer-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">{ds.file_name}</div>
                <div className="card-meta">
                  {ds.source_type ?? "Unclassified"} · {ds.row_count?.toLocaleString() ?? 0} rows · {cols.length} cols
                  {" "}<span className={statusClass(ds.status)}>{ds.status}</span>
                </div>
              </div>
              <button className="drawer-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="drawer-body">
              {ds.business_purpose && (
                <div className="info-bar" style={{ marginTop: 0 }}>{ds.business_purpose}</div>
              )}

              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => rerun("understand")} disabled={dsrBusy !== null}>
                  {dsrBusy === "understand" ? <span className="spinner" /> : null} Re-run Understanding
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => rerun("embed")} disabled={dsrBusy !== null}>
                  {dsrBusy === "embed" ? <span className="spinner" /> : null} Re-run Embedding
                </button>
              </div>

              {cols.length > 0 && (
                <>
                  <p className="section-eyebrow">Columns ({cols.length})</p>
                  <table className="athena-table">
                    <thead>
                      <tr><th>Column</th><th>Type</th><th>Role</th><th>Null %</th><th>Key</th></tr>
                    </thead>
                    <tbody>
                      {cols.map(c => (
                        <tr key={c.id} style={{ opacity: c.is_technical ? 0.45 : 1 }}>
                          <td style={{ fontWeight: 500 }}>{c.column_name}</td>
                          <td><span className="text-muted" style={{ fontSize: 11 }}>{c.inferred_type}</span></td>
                          <td>
                            {c.semantic_role
                              ? <span className="source-badge" style={{ fontSize: "8px" }}>{c.semantic_role}</span>
                              : <span className="text-dim">—</span>}
                          </td>
                          <td><span className="text-muted" style={{ fontSize: 11 }}>{c.null_pct != null ? `${Math.round(c.null_pct * 100)}%` : "—"}</span></td>
                          <td>{c.is_candidate_key ? <span className="text-accent" style={{ fontSize: 14 }}>⚿</span> : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {rels.length > 0 && (
                <>
                  <div className="divider" style={{ margin: "16px 0" }} />
                  <p className="section-eyebrow">Relationships ({rels.length})</p>
                  {rels.map(r => (
                    <div key={r.id} className="card" style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>
                        <span className="text-muted">{r.from_column_name}</span>
                        {" "}<span className="text-dim">→</span>{" "}
                        <span className="text-accent">{r.to_dataset_name}</span>
                        <span className="text-muted"> · {r.to_column_name}</span>
                      </div>
                      <div className="card-meta">{r.relationship_type} · {Math.round(r.confidence * 100)}% confidence</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
