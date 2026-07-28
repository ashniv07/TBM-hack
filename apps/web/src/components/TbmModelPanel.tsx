import { useMemo, useState } from "react";
import { TBM_EXPORT_URL, TbmDataModel, fetchTbmModel } from "../api";

type Tab = "objects" | "relationships" | "datasets";

const PREVIEW_ROWS = 50;

export function TbmModelPanel() {
  const [model, setModel] = useState<TbmDataModel | null>(null);
  const [tab, setTab] = useState<Tab>("objects");
  const [typeFilter, setTypeFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setModel(await fetchTbmModel());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build TBM data model");
    } finally {
      setBusy(false);
    }
  }

  const objects = useMemo(
    () => (!model ? [] : typeFilter === "all" ? model.objects : model.objects.filter((o) => o.objectType === typeFilter)),
    [model, typeFilter]
  );

  return (
    <div className="tbm-panel">
      <div className="tbm-actions">
        <button disabled={busy} onClick={generate}>
          {model ? "Regenerate Model" : "Generate TBM Data Model"}
        </button>
        <a
          className={`tbm-download${model ? "" : " disabled"}`}
          href={model ? TBM_EXPORT_URL : undefined}
          aria-disabled={!model}
        >
          Download Apptio Workbook (.xlsx)
        </a>
        {model && <span className="tbm-stamp">Generated {new Date(model.generatedAt).toLocaleString()} · ATUM v{model.taxonomyVersion}</span>}
      </div>

      {busy && <p>Assembling model…</p>}
      {error && <p className="dq-error">{error}</p>}

      {model && (
        <>
          <div className="atum-summary">
            <span><strong>{model.summary.objects}</strong> business objects</span>
            <span><strong>{Math.round(model.summary.classificationCoverage * 100)}%</strong> ATUM coverage</span>
            <span><strong>{model.summary.relationships}</strong> relationships preserved</span>
            <span><strong>{model.summary.tbmReadyDatasets}/{model.summary.sourceDatasets}</strong> datasets TBM-ready</span>
            <span><strong>{Math.round(model.summary.averageReadiness * 100)}%</strong> average readiness</span>
          </div>

          {model.warnings.length > 0 && (
            <ul className="tbm-warnings">
              {model.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}

          <div className="tbm-tabs">
            <button className={tab === "objects" ? "" : "secondary"} onClick={() => setTab("objects")}>Objects ({model.objects.length})</button>
            <button className={tab === "relationships" ? "" : "secondary"} onClick={() => setTab("relationships")}>Relationships ({model.relationships.length})</button>
            <button className={tab === "datasets" ? "" : "secondary"} onClick={() => setTab("datasets")}>Source Datasets ({model.sourceDatasets.length})</button>
            {tab === "objects" && (
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All object types</option>
                {Object.entries(model.summary.objectsByType).map(([type, count]) => (
                  <option key={type} value={type}>{type} ({count})</option>
                ))}
              </select>
            )}
          </div>

          {tab === "objects" && (
            <table className="atum-table">
              <thead><tr><th>Object</th><th>Type</th><th>Cost Pool</th><th>Resource Tower</th><th>Solution</th><th>Confidence</th><th>Source Datasets</th></tr></thead>
              <tbody>
                {objects.slice(0, PREVIEW_ROWS).map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{o.objectType}</td>
                    <td>{o.costPool ?? <span className="atum-unlinked">unallocated</span>}</td>
                    <td>{o.resourceTower ?? <span className="atum-unlinked">unallocated</span>}</td>
                    <td>{o.solution ?? "—"}</td>
                    <td>{o.atumConfidence === null ? "—" : `${Math.round(o.atumConfidence * 100)}%`}</td>
                    <td className="samples">{o.sourceDatasets.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "relationships" && (
            <table className="atum-table">
              <thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Confidence</th><th>Evidence</th></tr></thead>
              <tbody>
                {model.relationships.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={i}>
                    <td>{r.fromName}<br /><span className="samples">{r.fromType}</span></td>
                    <td>{r.relationship}</td>
                    <td>{r.toName}<br /><span className="samples">{r.toType}</span></td>
                    <td>{Math.round(r.confidence * 100)}%</td>
                    <td className="samples">{r.evidenceDataset ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "datasets" && (
            <table className="atum-table">
              <thead><tr><th>File</th><th>Source Type</th><th>Rows</th><th>Readiness</th><th>Issues</th><th>TBM Ready</th></tr></thead>
              <tbody>
                {model.sourceDatasets.map((d) => (
                  <tr key={d.datasetId}>
                    <td>{d.fileName}</td>
                    <td>{d.sourceType ?? "—"}</td>
                    <td>{d.rowCount ?? "—"}</td>
                    <td>{d.readinessScore === null ? "not scored" : `${Math.round(d.readinessScore * 100)}%`}</td>
                    <td>{d.issueCount ?? "—"}{d.criticalIssueCount ? ` (${d.criticalIssueCount} critical)` : ""}</td>
                    <td><span className={d.tbmReady ? "atum-linked" : "atum-unlinked"}>{d.tbmReady ? "yes" : "no"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab !== "datasets" && (tab === "objects" ? objects.length : model.relationships.length) > PREVIEW_ROWS && (
            <p className="section-hint">
              Showing the first {PREVIEW_ROWS} rows — the full model is in the downloadable workbook.
            </p>
          )}
        </>
      )}

      {!model && !busy && (
        <p className="empty-state">
          Generate the model once Stages 4-6 have run: it is assembled from the knowledge graph, approved ATUM
          mappings, and readiness scores.
        </p>
      )}
    </div>
  );
}
