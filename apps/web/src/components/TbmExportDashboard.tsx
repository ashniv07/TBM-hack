import { useState, useEffect } from "react";
import {
  TbmExportSummary,
  TbmExportType,
  TbmExportFormat,
  TbmDataModel,
  TbmExport,
  fetchTbmExportSummary,
  generateTbmExport,
  fetchTbmExports,
  downloadTbmExport,
} from "../api";

export function TbmExportDashboard() {
  const [summary, setSummary] = useState<TbmExportSummary | null>(null);
  const [exports, setExports] = useState<TbmExport[]>([]);
  const [model, setModel] = useState<TbmDataModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Export options
  const [exportType, setExportType] = useState<TbmExportType>("full");
  const [format, setFormat] = useState<TbmExportFormat>("xlsx");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [includeLowConfidence, setIncludeLowConfidence] = useState(false);

  // Active tab
  const [tab, setTab] = useState<"preview" | "generate" | "history">("preview");

  useEffect(() => {
    loadSummary();
    loadExports();
  }, []);

  async function loadSummary() {
    try {
      const data = await fetchTbmExportSummary();
      setSummary(data);
    } catch (err) {
      console.error("Failed to load summary:", err);
    }
  }

  async function loadExports() {
    try {
      const data = await fetchTbmExports();
      setExports(data);
    } catch (err) {
      console.error("Failed to load exports:", err);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await generateTbmExport({
        exportType,
        format,
        confidenceThreshold,
        includeLowConfidence,
        saveFile: true,
      });
      setModel(result.model);
      setMessage(`Export generated: ${result.recordCount} records`);
      await loadExports();
      setTab("generate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(exportId: string, fmt: TbmExportFormat) {
    setBusy(true);
    try {
      await downloadTbmExport(exportId, fmt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tbm-export-dashboard">
      <div className="dq-tabs">
        <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
          Preview
        </button>
        <button className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}>
          Generate Export
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          Export History
        </button>
      </div>

      {error && <p className="dq-error">{error}</p>}
      {message && <p className="atum-success">{message}</p>}

      {tab === "preview" && (
        <div className="tbm-preview">
          <h4>TBM Data Model Preview</h4>
          <p className="section-hint">
            Preview what will be exported from your enterprise knowledge graph.
          </p>

          {summary ? (
            <>
              <div className="dq-summary-cards">
                <div className="dq-card">
                  <div className="dq-card-value">{summary.costCenters}</div>
                  <div className="dq-card-label">Cost Centers</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{summary.applications}</div>
                  <div className="dq-card-label">Applications</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{summary.vendors}</div>
                  <div className="dq-card-label">Vendors</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{summary.cloudResources}</div>
                  <div className="dq-card-label">Cloud Resources</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{summary.atumMappedEntities}</div>
                  <div className="dq-card-label">ATUM Mapped</div>
                </div>
              </div>

              <div className="tbm-readiness">
                {summary.readyForExport ? (
                  <p className="atum-success">
                    Ready for export: {summary.totalEntities} entities with {summary.totalEdges} relationships
                  </p>
                ) : (
                  <p className="dq-error">
                    No data available for export. Please complete Stages 1-6 first.
                  </p>
                )}
              </div>

              <div className="tbm-breakdown">
                <h5>Entity Breakdown</h5>
                <table>
                  <tbody>
                    <tr>
                      <td>Business Units</td>
                      <td>{summary.businessUnits}</td>
                    </tr>
                    <tr>
                      <td>Departments</td>
                      <td>{summary.departments}</td>
                    </tr>
                    <tr>
                      <td>Total Entities</td>
                      <td>{summary.totalEntities}</td>
                    </tr>
                    <tr>
                      <td>Total Relationships</td>
                      <td>{summary.totalEdges}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="empty-state">Loading summary...</p>
          )}
        </div>
      )}

      {tab === "generate" && (
        <div className="tbm-generate">
          <h4>Generate TBM Export</h4>
          <p className="section-hint">
            Configure and generate an Apptio-ready TBM data model export.
          </p>

          <div className="tbm-export-options">
            <div className="option-group">
              <label>Export Type</label>
              <select value={exportType} onChange={(e) => setExportType(e.target.value as TbmExportType)}>
                <option value="full">Full Export (All Dimensions)</option>
                <option value="cost_centers">Cost Centers Only</option>
                <option value="applications">Applications Only</option>
                <option value="vendors">Vendors Only</option>
                <option value="cloud_resources">Cloud Resources Only</option>
              </select>
            </div>

            <div className="option-group">
              <label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as TbmExportFormat)}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
            </div>

            <div className="option-group">
              <label>Confidence Threshold: {Math.round(confidenceThreshold * 100)}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={confidenceThreshold * 100}
                onChange={(e) => setConfidenceThreshold(Number(e.target.value) / 100)}
              />
            </div>

            <div className="option-group">
              <label>
                <input
                  type="checkbox"
                  checked={includeLowConfidence}
                  onChange={(e) => setIncludeLowConfidence(e.target.checked)}
                />
                Include low-confidence mappings
              </label>
            </div>
          </div>

          <div className="tbm-export-actions">
            <button onClick={handleGenerate} disabled={busy || !summary?.readyForExport}>
              {busy ? "Generating..." : "Generate Export"}
            </button>
          </div>

          {model && (
            <div className="tbm-export-result">
              <h5>Generated Model</h5>
              <div className="dq-summary-cards">
                <div className="dq-card">
                  <div className="dq-card-value">{model.costCenters.length}</div>
                  <div className="dq-card-label">Cost Centers</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{model.applications.length}</div>
                  <div className="dq-card-label">Applications</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{model.vendors.length}</div>
                  <div className="dq-card-label">Vendors</div>
                </div>
                <div className="dq-card">
                  <div className="dq-card-value">{model.cloudResources.length}</div>
                  <div className="dq-card-label">Cloud Resources</div>
                </div>
              </div>

              {model.applications.length > 0 && (
                <details>
                  <summary>Applications Preview ({model.applications.length})</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>ATUM Tower</th>
                        <th>Sub-Tower</th>
                        <th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.applications.slice(0, 10).map((app, i) => (
                        <tr key={i}>
                          <td>{app.application_name}</td>
                          <td>{app.atum_tower || "-"}</td>
                          <td>{app.atum_sub_tower || "-"}</td>
                          <td>{app.atum_confidence ? `${Math.round(app.atum_confidence * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {model.applications.length > 10 && (
                    <p className="section-hint">...and {model.applications.length - 10} more</p>
                  )}
                </details>
              )}

              {model.vendors.length > 0 && (
                <details>
                  <summary>Vendors Preview ({model.vendors.length})</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>ATUM Cost Pool</th>
                        <th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.vendors.slice(0, 10).map((vendor, i) => (
                        <tr key={i}>
                          <td>{vendor.vendor_name}</td>
                          <td>{vendor.vendor_type || "-"}</td>
                          <td>{vendor.atum_cost_pool || "-"}</td>
                          <td>{vendor.atum_confidence ? `${Math.round(vendor.atum_confidence * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="tbm-history">
          <h4>Export History</h4>
          {exports.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Format</th>
                  <th>Records</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((exp) => (
                  <tr key={exp.id}>
                    <td>{new Date(exp.created_at).toLocaleString()}</td>
                    <td>{exp.export_type}</td>
                    <td>{exp.format.toUpperCase()}</td>
                    <td>{exp.record_count ?? "-"}</td>
                    <td>
                      <span className={`status-badge status-${exp.status}`}>{exp.status}</span>
                    </td>
                    <td>
                      {exp.status === "completed" && (
                        <>
                          <button onClick={() => handleDownload(exp.id, "xlsx")} disabled={busy}>
                            XLSX
                          </button>{" "}
                          <button onClick={() => handleDownload(exp.id, "json")} disabled={busy}>
                            JSON
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No exports yet. Generate your first TBM export above.</p>
          )}
        </div>
      )}
    </div>
  );
}
