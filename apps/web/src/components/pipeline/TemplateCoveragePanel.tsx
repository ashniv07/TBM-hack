import { useEffect, useState } from "react";
import {
  CoverageDetail, DatasetCoverage,
  fetchCoverageDetail, fetchTemplateCoverage, overrideColumnMapping, refinedExportUrl,
} from "../../api";

/**
 * The metric the client asked for, per dataset: "the Apptio template expects N
 * columns — your file supplies M." Plus the two gaps that matter — template
 * columns nothing supplied, and source columns the template has no place for —
 * because the second is usually where a missed mapping is hiding.
 */
export function TemplateCoveragePanel() {
  const [rows, setRows] = useState<DatasetCoverage[]>([]);
  const [selected, setSelected] = useState<DatasetCoverage | null>(null);
  const [detail, setDetail] = useState<CoverageDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      setRows(await fetchTemplateCoverage());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load coverage");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function open(row: DatasetCoverage) {
    setSelected(row);
    setDetail(null);
    try {
      setDetail(await fetchCoverageDetail(row.dataset_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mapping");
    }
  }

  async function repoint(sourceColumn: string, templateColumn: string) {
    if (!selected) return;
    await overrideColumnMapping(selected.dataset_id, sourceColumn, templateColumn || null);
    setDetail(await fetchCoverageDetail(selected.dataset_id));
    await load();
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(Number(v) * 100)}%`);

  return (
    <div className="card" style={{ margin: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <p className="section-eyebrow" style={{ margin: 0, flex: 1 }}>Master Template Coverage</p>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={busy}>
          {busy ? <><span className="spinner" /> Loading…</> : "Refresh"}
        </button>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {rows.length === 0 && !busy && (
        <div className="empty-state" style={{ padding: "20px 0" }}>
          <div>No datasets yet. Upload a customer source file to see how much of its Apptio template it satisfies.</div>
        </div>
      )}

      {rows.length > 0 && (
        <table className="athena-table">
          <thead><tr><th>Source File</th><th>Master Template</th><th>Supplies</th><th>Coverage</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dataset_id}>
                <td style={{ fontWeight: 500 }}>{r.file_name}</td>
                <td style={{ fontSize: 11 }} className={r.master_type ? "" : "text-muted"}>
                  {r.master_type ?? "not recognised"}
                </td>
                <td style={{ fontSize: 11 }} className="text-muted">
                  {r.template_matched_count ?? 0} / {r.template_expected_count ?? 0} columns
                </td>
                <td>
                  <span className={`badge ${Number(r.template_coverage ?? 0) >= 0.7 ? "badge-confidence-high" : "badge-confidence-medium"}`}>
                    {pct(r.template_coverage)}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => open(r)}>Mapping</button>
                  <a className="btn btn-primary btn-sm" href={refinedExportUrl(r.dataset_id)}>Refined .xlsx</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p className="section-eyebrow" style={{ margin: 0, flex: 1 }}>
              {selected.file_name} → {selected.master_type ?? "no template"}
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setDetail(null); }}>Close</button>
          </div>

          {!detail && <p className="text-muted" style={{ fontSize: 12 }}>Loading mapping…</p>}

          {detail && (
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginTop: 10 }}>
              <div>
                <p className="text-muted" style={{ fontSize: 11 }}>Column mapping — edit a target to re-point it</p>
                <table className="athena-table">
                  <thead><tr><th>Source Column</th><th>→ Template Column</th><th>Conf.</th><th>Method</th></tr></thead>
                  <tbody>
                    {detail.mappings.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontSize: 11 }}>{m.source_column}</td>
                        <td>
                          <select
                            className="athena-select"
                            style={{ width: "100%", fontSize: 11 }}
                            value={m.template_column ?? ""}
                            onChange={(e) => repoint(m.source_column, e.target.value)}
                          >
                            <option value="">— unmapped —</option>
                            {m.template_column && <option value={m.template_column}>{m.template_column}</option>}
                            {detail.missingColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ fontSize: 11 }} className="text-muted">
                          {m.template_column ? `${Math.round(Number(m.confidence) * 100)}%` : "—"}
                        </td>
                        <td style={{ fontSize: 10 }} className={m.is_override ? "text-accent" : "text-muted"}>
                          {m.is_override ? "manual" : m.method}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="text-muted" style={{ fontSize: 11 }}>
                  Not supplied ({detail.missingColumns.length}) — blank but present in the export
                </p>
                <div style={{ maxHeight: 260, overflow: "auto", fontSize: 11 }}>
                  {detail.missingColumns.map((c) => (
                    <div key={c} className="text-warning" style={{ padding: "2px 0" }}>{c}</div>
                  ))}
                  {detail.missingColumns.length === 0 && <span className="text-success">Template fully satisfied</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
