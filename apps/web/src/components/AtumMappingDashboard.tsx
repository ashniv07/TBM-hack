import { useMemo, useState } from "react";
import {
  AtumLayer, AtumMapping, AtumReport, AtumTaxonomyItem, fetchAtumMappings,
  fetchAtumReport, fetchAtumTaxonomy, importAtumTaxonomy, reviewAtumMapping, runAtumMapping,
} from "../api";

export function AtumMappingDashboard() {
  const [layer, setLayer] = useState<AtumLayer>("resource_tower");
  const [mappings, setMappings] = useState<AtumMapping[]>([]);
  const [taxonomy, setTaxonomy] = useState<AtumTaxonomyItem[]>([]);
  const [report, setReport] = useState<AtumReport | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [runDetails, setRunDetails] = useState("");

  async function refresh(selectedLayer = layer) {
    const [nextMappings, nextTaxonomy, nextReport] = await Promise.all([
      fetchAtumMappings(selectedLayer), fetchAtumTaxonomy(selectedLayer), fetchAtumReport(),
    ]);
    setMappings(nextMappings); setTaxonomy(nextTaxonomy); setReport(nextReport);
  }

  async function execute(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await refresh(); setMessage(success); }
    catch (err) { setError(err instanceof Error ? err.message : "Operation failed"); }
    finally { setBusy(false); }
  }

  async function changeLayer(next: AtumLayer) {
    setLayer(next); setBusy(true); setError("");
    try { await refresh(next); } catch (err) { setError(err instanceof Error ? err.message : "Failed to load mappings"); }
    finally { setBusy(false); }
  }

  const visible = useMemo(
    () => statusFilter === "all" ? mappings : mappings.filter((m) => m.status === statusFilter),
    [mappings, statusFilter]
  );

  async function override(mapping: AtumMapping, categoryId: string) {
    if (!categoryId) return;
    await execute(() => reviewAtumMapping(mapping.id, "approve", categoryId), "Mapping overridden.");
  }

  return <div className="atum-dashboard">
    <div className="atum-actions">
      <button disabled={busy} onClick={() => execute(importAtumTaxonomy, "Official TBM Taxonomy v5.0.1 imported.")}>Import Taxonomy</button>
      <button disabled={busy} onClick={() => execute(async () => {
        const result = await runAtumMapping(layer, useLlm);
        const skipped = result.stats.skippedDatasets.length;
        setRunDetails(`Mapped ${result.stats.mapped}/${result.stats.candidates} contextual candidates${skipped ? `; ${skipped} source files were unavailable` : ""}. Embeddings: ${result.stats.embeddingSource}.`);
      }, "ATUM mapping completed.")}>Run ATUM Mapping</button>
      <button className="secondary" disabled={busy} onClick={() => execute(() => refresh(), "Mappings refreshed.")}>Refresh</button>
      <select value={layer} onChange={(e) => changeLayer(e.target.value as AtumLayer)}>
        <option value="resource_tower">Resource Towers</option>
        <option value="cost_pool">Cost Pools</option>
        <option value="solution">Technology Solutions</option>
      </select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="all">All statuses</option><option value="suggested">Needs review</option>
        <option value="approved">Approved</option><option value="overridden">Overridden</option>
        <option value="unresolved">Unresolved</option><option value="rejected">Rejected</option>
      </select>
      <label><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> AI refinement (slower)</label>
    </div>
    {busy && <p>Working…</p>}{message && <p className="atum-success">{message}</p>}{runDetails && <p>{runDetails}</p>}{error && <p className="dq-error">{error}</p>}
    {report && <div className="atum-summary">
      <span><strong>{report.total}</strong> candidates</span><span><strong>{Math.round(report.coverage * 100)}%</strong> coverage</span>
      <span><strong>{Math.round(report.averageConfidence * 100)}%</strong> average confidence</span>
      <span><strong>{report.byStatus.suggested ?? 0}</strong> needing review</span>
    </div>}
    {visible.length > 0 ? <table className="atum-table"><thead><tr>
      <th>Source value</th><th>Dataset / role</th><th>ATUM classification</th><th>Confidence</th><th>Evidence</th><th>Review</th>
    </tr></thead><tbody>{visible.map((mapping) => <tr key={mapping.id}>
      <td>{mapping.source_value}</td><td className="samples">{mapping.dataset_file_name}<br />{mapping.column_name} · {mapping.semantic_role}</td>
      <td>{mapping.category_path ?? "Unresolved"}</td><td>{Math.round(Number(mapping.confidence) * 100)}%<br /><span className={`status-badge status-${mapping.status}`}>{mapping.status}</span></td>
      <td className="reasoning">{mapping.reasoning}
        {mapping.source_context && <details><summary>Row context</summary>
          {Object.entries(mapping.source_context).slice(0, 8).map(([key, value]) => <div key={key}><strong>{key}:</strong> {String(value)}</div>)}
        </details>}
      </td><td>
        {mapping.status === "suggested" && <><button onClick={() => execute(() => reviewAtumMapping(mapping.id, "approve"), "Mapping approved.")}>Approve</button>{" "}
          <button className="danger" onClick={() => execute(() => reviewAtumMapping(mapping.id, "reject"), "Mapping rejected.")}>Reject</button></>}
        <select defaultValue="" onChange={(e) => override(mapping, e.target.value)}><option value="">Override…</option>
          {taxonomy.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select>
      </td>
    </tr>)}</tbody></table> : !busy && <p className="empty-state">Import the taxonomy, then run ATUM mapping to generate classifications.</p>}
  </div>;
}
