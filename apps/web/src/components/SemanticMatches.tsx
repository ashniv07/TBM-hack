import { useEffect, useState } from "react";
import { fetchSemanticMatches, SemanticMatch } from "../api";

export function SemanticMatches() {
  const [matches, setMatches] = useState<SemanticMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSemanticMatches()
      .then(setMatches)
      // Without this, a failed request left matches empty and rendered the
      // "no matches yet, upload more datasets" hint — telling the user to fix
      // their data when the request is what broke.
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load semantic matches"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  if (error) return <p className="dq-error">Could not load semantic matches: {error}</p>;

  if (matches.length === 0) {
    return (
      <p className="empty-state">
        No cross-dataset semantic matches yet. Upload two datasets that share business entities (e.g. an AWS billing
        file with "Amazon EC2" and a CMDB file with "AWS EC2") to see them matched here.
      </p>
    );
  }

  return (
    <table className="matches-table">
      <thead>
        <tr>
          <th>Value A</th>
          <th>Source A</th>
          <th>Value B</th>
          <th>Source B</th>
          <th>Similarity</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((m, i) => (
          <tr key={i}>
            <td>{m.value_a}</td>
            <td className="samples">
              {m.dataset_a_name} · {m.column_a_name}
            </td>
            <td>{m.value_b}</td>
            <td className="samples">
              {m.dataset_b_name} · {m.column_b_name}
            </td>
            <td>{Math.round((1 - m.distance) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
