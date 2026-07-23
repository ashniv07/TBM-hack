import { Dataset } from "../api";

export function DatasetCatalog({
  datasets,
  onSelect,
  selectedId,
}: {
  datasets: Dataset[];
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  if (datasets.length === 0) {
    return <p className="empty-state">No datasets ingested yet. Upload Excel files to get started.</p>;
  }

  return (
    <table className="catalog-table">
      <thead>
        <tr>
          <th>File</th>
          <th>Source Type</th>
          <th>Confidence</th>
          <th>Rows</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {datasets.map((d) => (
          <tr key={d.id} className={d.id === selectedId ? "selected" : ""} onClick={() => onSelect(d.id)}>
            <td>{d.file_name}</td>
            <td>{d.source_type ?? "—"}</td>
            <td>{d.source_type_confidence != null ? `${Math.round(d.source_type_confidence * 100)}%` : "—"}</td>
            <td>{d.row_count ?? "—"}</td>
            <td>
              <span className={`status-badge status-${d.status}`}>{d.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
