import { useEffect, useState } from "react";
import {
  Dataset,
  DatasetColumn,
  DatasetRelationship,
  fetchDatasetDetail,
  fetchRelationships,
  rerunEmbedding,
  rerunUnderstanding,
} from "../api";

export function DatasetDetail({ datasetId }: { datasetId: string }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  const [relationships, setRelationships] = useState<DatasetRelationship[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [{ dataset, columns }, relationships] = await Promise.all([
      fetchDatasetDetail(datasetId),
      fetchRelationships(datasetId),
    ]);
    setDataset(dataset);
    setColumns(columns);
    setRelationships(relationships);
  }

  useEffect(() => {
    load();
  }, [datasetId]);

  if (!dataset) return <p>Loading...</p>;

  async function handleUnderstand() {
    setBusy("understand");
    try {
      await rerunUnderstanding(datasetId);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function handleEmbed() {
    setBusy("embed");
    try {
      await rerunEmbedding(datasetId);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dataset-detail">
      <h3>{dataset.file_name}</h3>
      <p className="meta">
        {dataset.source_type ?? "Unclassified"} · {dataset.row_count ?? 0} rows · {columns.length} columns · status:{" "}
        {dataset.status}
      </p>
      {dataset.business_purpose && <p className="business-purpose">{dataset.business_purpose}</p>}

      <div className="stage-actions">
        <button onClick={handleUnderstand} disabled={busy !== null}>
          {busy === "understand" ? "Running..." : "Re-run Understanding (Stage 2)"}
        </button>
        <button onClick={handleEmbed} disabled={busy !== null}>
          {busy === "embed" ? "Running..." : "Re-run Embedding (Stage 3)"}
        </button>
      </div>

      <table className="columns-table">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Semantic Role</th>
            <th>Null %</th>
            <th>Distinct</th>
            <th>Flags</th>
            <th>Sample Values</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.id} className={c.is_technical ? "technical-row" : ""}>
              <td>{c.column_name}</td>
              <td>{c.inferred_type}</td>
              <td>
                {c.semantic_role ? (
                  <span className="role-badge">
                    {c.semantic_role}
                    {c.semantic_role_confidence != null ? ` (${Math.round(c.semantic_role_confidence * 100)}%)` : ""}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>{c.null_pct != null ? `${Math.round(c.null_pct * 100)}%` : "—"}</td>
              <td>{c.distinct_count ?? "—"}</td>
              <td>
                {c.is_candidate_key && <span className="flag-badge">key</span>}
                {c.is_technical && <span className="flag-badge technical">technical</span>}
              </td>
              <td className="samples">{(c.sample_values ?? []).slice(0, 3).map(String).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Discovered Relationships</h4>
      {relationships.length === 0 ? (
        <p className="empty-state">
          No relationships found yet. Upload a related dataset (e.g. a Cost Center Master file if this is a GL file)
          and re-run Understanding.
        </p>
      ) : (
        <table className="relationships-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Type</th>
              <th>Confidence</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {relationships.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.from_dataset_name} · {r.from_column_name}
                </td>
                <td>
                  {r.to_dataset_name} · {r.to_column_name}
                </td>
                <td>{r.relationship_type}</td>
                <td>{Math.round(r.confidence * 100)}%</td>
                <td className="reasoning">{r.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
