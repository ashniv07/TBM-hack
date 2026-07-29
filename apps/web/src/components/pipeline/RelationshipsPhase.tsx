import { useEffect, useMemo, useState } from "react";
import {
  Dataset,
  DatasetCoverage, CoverageDetail,
  fetchTemplateCoverage, fetchCoverageDetail, overrideColumnMapping, refinedExportUrl,
} from "../../api";
import { GraphVisualization } from "../GraphVisualization";
import type { VizNode, VizEdge } from "../GraphVisualization";

interface Props {
  datasets: Dataset[];
}

// This tab answers one question: "of what the master template expects, what
// did each source file actually supply, what maps to what, and what's
// missing on both sides." It's built entirely from the template-mapping
// data (Stage: mapDatasetToTemplate), not the Stage 4 knowledge graph — the
// graph here is literally source-column -> template-column, nothing else.
export function RelationshipsPhase({ datasets }: Props) {
  const [coverage, setCoverage] = useState<DatasetCoverage[]>([]);
  const [details, setDetails] = useState<Map<string, CoverageDetail>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchTemplateCoverage();
      setCoverage(rows);
      const pairs = await Promise.all(
        rows.map(async (r) => [r.dataset_id, await fetchCoverageDetail(r.dataset_id)] as const)
      );
      setDetails(new Map(pairs));
      setSelectedId((prev) => prev ?? rows.find((r) => r.master_type)?.dataset_id ?? rows[0]?.dataset_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load template mappings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = coverage.find((c) => c.dataset_id === selectedId) ?? null;
  const selectedDetail = selectedId ? details.get(selectedId) ?? null : null;

  async function repoint(sourceColumn: string, templateColumn: string) {
    if (!selectedId) return;
    await overrideColumnMapping(selectedId, sourceColumn, templateColumn || null);
    const detail = await fetchCoverageDetail(selectedId);
    setDetails((prev) => new Map(prev).set(selectedId, detail));
    setCoverage(await fetchTemplateCoverage());
  }

  // Cross-file rollup: which template columns are missing most often, and
  // which of your own columns never find a home anywhere — the "analytics of
  // what didn't match" the request asked for, not scoped to one file.
  const rollup = useMemo(() => {
    const missingFreq = new Map<string, number>();
    const unmatchedFreq = new Map<string, number>();
    let totalMatched = 0, totalUnmatched = 0, totalMissing = 0, withTemplate = 0, coverageSum = 0;

    for (const row of coverage) {
      if (row.master_type) { withTemplate++; coverageSum += Number(row.template_coverage ?? 0); }
      totalMatched += row.template_matched_count ?? 0;
      const detail = details.get(row.dataset_id);
      if (!detail) continue;
      totalUnmatched += detail.unmappedSourceColumns.length;
      totalMissing += detail.missingColumns.length;
      detail.missingColumns.forEach((c) => missingFreq.set(c, (missingFreq.get(c) ?? 0) + 1));
      detail.unmappedSourceColumns.forEach((c) => unmatchedFreq.set(c, (unmatchedFreq.get(c) ?? 0) + 1));
    }

    const topMissing = [...missingFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topUnmatched = [...unmatchedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      totalMatched, totalUnmatched, totalMissing,
      avgCoverage: withTemplate ? coverageSum / withTemplate : 0,
      topMissing, topUnmatched,
    };
  }, [coverage, details]);

  const graph = useMemo((): { nodes: VizNode[]; edges: VizEdge[] } => {
    if (!selected || !selectedDetail) return { nodes: [], edges: [] };
    const nodes = new Map<string, VizNode>();
    const edges: VizEdge[] = [];

    const dsId = `dataset:${selected.dataset_id}`;
    nodes.set(dsId, { id: dsId, entity_type: "dataset", canonical_name: selected.file_name });

    for (const m of selectedDetail.mappings) {
      const srcId = `src:${selected.dataset_id}:${m.source_column}`;
      nodes.set(srcId, { id: srcId, entity_type: m.template_column ? "attribute_group" : "unmatched_column", canonical_name: m.source_column });
      edges.push({ from_entity_id: dsId, to_entity_id: srcId, edge_type: "has_column", weight: 1, confidence: 1 });

      if (m.template_column) {
        const tplId = `tpl:${selected.master_type}:${m.template_column}`;
        if (!nodes.has(tplId)) {
          nodes.set(tplId, { id: tplId, entity_type: "template_column", canonical_name: m.template_column });
        }
        edges.push({
          from_entity_id: srcId, to_entity_id: tplId, edge_type: "template_mapped",
          weight: 1, confidence: Number(m.confidence), label: `${m.method} · ${Math.round(Number(m.confidence) * 100)}%`,
        });
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  }, [selected, selectedDetail]);

  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(Number(v) * 100)}%`);

  return (
    <div className="phase-panel column">
      <div className="phase-header">
        <div>
          <p className="phase-subtitle">Phase 1</p>
          <h2 className="phase-title">Template Mapping</h2>
        </div>
        <div className="stat-chips" style={{ marginLeft: "auto" }}>
          <div className="stat-chip accent"><div className="stat-chip-value">{Math.round(rollup.avgCoverage * 100)}%</div><div className="stat-chip-label">Avg Coverage</div></div>
          <div className="stat-chip success"><div className="stat-chip-value">{rollup.totalMatched}</div><div className="stat-chip-label">Matched</div></div>
          <div className="stat-chip"><div className="stat-chip-value">{rollup.totalUnmatched}</div><div className="stat-chip-label">Unmatched Source</div></div>
          <div className="stat-chip danger"><div className="stat-chip-value">{rollup.totalMissing}</div><div className="stat-chip-label">Missing Template</div></div>
        </div>
      </div>

      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}

      <div className="graph-area">
        {loading && <div className="loading-overlay"><span className="spinner" /> Loading template mappings…</div>}

        {!loading && coverage.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <div>No datasets yet — upload a source file under Import Data to see its template mapping</div>
          </div>
        )}

        {!loading && coverage.length > 0 && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* Sidebar: dataset picker */}
            <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", padding: 10 }}>
              <p className="section-eyebrow" style={{ padding: "0 2px", marginBottom: 8 }}>Datasets</p>
              {coverage.map((row) => (
                <button
                  key={row.dataset_id}
                  onClick={() => setSelectedId(row.dataset_id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: row.dataset_id === selectedId ? "rgba(205,222,51,0.08)" : "transparent",
                    border: `1px solid ${row.dataset_id === selectedId ? "var(--accent)" : "transparent"}`,
                    borderRadius: 2, padding: "8px 10px", marginBottom: 4, cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.file_name}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 10, color: "var(--text-muted)" }}>
                    <span>{row.master_type ?? "not recognised"}</span>
                    <span>{pct(row.template_coverage)}</span>
                  </div>
                </button>
              ))}

              {(rollup.topMissing.length > 0 || rollup.topUnmatched.length > 0) && (
                <>
                  <div className="divider" style={{ margin: "14px 0" }} />
                  <p className="section-eyebrow" style={{ padding: "0 2px", marginBottom: 6 }}>Most common gaps (all files)</p>
                  {rollup.topMissing.map(([col, n]) => (
                    <div key={col} style={{ fontSize: 10.5, color: "var(--warning)", padding: "2px 2px" }}>
                      {col} <span className="text-dim">· missing in {n}</span>
                    </div>
                  ))}
                  {rollup.topUnmatched.map(([col, n]) => (
                    <div key={col} style={{ fontSize: 10.5, color: "var(--danger-text)", padding: "2px 2px" }}>
                      {col} <span className="text-dim">· unmatched in {n}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Main: graph + per-dataset analytics */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
              {selected && (
                <>
                  <div style={{ padding: "10px 22px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                      {selected.file_name} <span className="text-dim">→</span> {selected.master_type ?? "no template matched"}
                    </div>
                    <span className="text-muted" style={{ fontSize: 11 }}>
                      {selected.template_matched_count ?? 0} / {selected.template_expected_count ?? 0} template columns supplied
                    </span>
                    {selected.master_type && (
                      <a className="btn btn-primary btn-sm" href={refinedExportUrl(selected.dataset_id)}>Refined .xlsx</a>
                    )}
                  </div>

                  {graph.nodes.length > 0 ? (
                    <div style={{ height: 340, display: "flex", flexShrink: 0, borderBottom: "1px solid var(--border-soft)" }}>
                      <GraphVisualization nodes={graph.nodes} edges={graph.edges} />
                    </div>
                  ) : (
                    <div className="empty-state" style={{ padding: "24px 0" }}>No columns to show for this dataset.</div>
                  )}

                  {selectedDetail && (
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 16, padding: "14px 22px" }}>
                      <div>
                        <p className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>Column mapping — edit to re-point</p>
                        <table className="athena-table">
                          <thead><tr><th>Source</th><th>→ Template</th><th>Conf.</th></tr></thead>
                          <tbody>
                            {selectedDetail.mappings.map((m) => (
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
                                    {selectedDetail.missingColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </td>
                                <td style={{ fontSize: 11 }} className="text-muted">
                                  {m.template_column ? `${Math.round(Number(m.confidence) * 100)}%` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div>
                        <p className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                          Unmatched in this file ({selectedDetail.unmappedSourceColumns.length})
                        </p>
                        <div style={{ maxHeight: 260, overflow: "auto", fontSize: 11 }}>
                          {selectedDetail.unmappedSourceColumns.map((c) => (
                            <div key={c} style={{ color: "var(--danger-text)", padding: "2px 0" }}>{c}</div>
                          ))}
                          {selectedDetail.unmappedSourceColumns.length === 0 && <span className="text-success">Every column matched</span>}
                        </div>
                      </div>

                      <div>
                        <p className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                          Not supplied ({selectedDetail.missingColumns.length})
                        </p>
                        <div style={{ maxHeight: 260, overflow: "auto", fontSize: 11 }}>
                          {selectedDetail.missingColumns.map((c) => (
                            <div key={c} style={{ color: "var(--warning)", padding: "2px 0" }}>{c}</div>
                          ))}
                          {selectedDetail.missingColumns.length === 0 && <span className="text-success">Template fully satisfied</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="graph-legend">
        <div className="legend-item"><span className="legend-dot" style={{ background: "#5b8def" }} /> dataset</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: "#9aa2ad" }} /> matched source column</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: "#e08f7f" }} /> unmatched source column</div>
        <div className="legend-item"><span className="legend-dot" style={{ background: "#c9a4f0" }} /> master template column</div>
        <div className="legend-item"><span style={{ width: 16, height: 2, background: "#4ecdc4", display: "inline-block" }} /> mapped</div>
      </div>
    </div>
  );
}
