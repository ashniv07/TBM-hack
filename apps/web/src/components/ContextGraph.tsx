import { useMemo, useState } from "react";
import {
  ContextGraphResponse,
  ContextRebuildResult,
  ContextTraceResult,
  fetchContextGraph,
  fetchContextTrace,
  rebuildContextModel,
} from "../api";
import { GraphVisualization } from "./GraphVisualization";

const ENTITY_TYPE_ORDER = [
  "dataset",
  "attribute_group",
  "vendor",
  "application",
  "service",
  "business_unit",
  "department",
  "cost_center",
  "cloud_resource",
  "cloud_provider",
  "infrastructure_asset",
  "project",
];

// Best-effort, keyword-based grouping purely for the "Domain" filter — not a
// persisted concept, just a lightweight way to reduce clutter by clicking
// through a handful of datasets at a time instead of the whole graph.
const DOMAIN_KEYWORDS: [RegExp, string][] = [
  [/storage/i, "Storage Domain"],
  [/cost|finance|gl|ledger|account/i, "Finance Domain"],
  [/hr|employee|payroll/i, "HR Domain"],
  [/aws|azure|gcp|cloud/i, "Cloud Domain"],
  [/app/i, "Application Domain"],
];

function deriveDomain(fileName: string): string {
  for (const [pattern, domain] of DOMAIN_KEYWORDS) {
    if (pattern.test(fileName)) return domain;
  }
  return "General Domain";
}

export function ContextGraph() {
  const [graph, setGraph] = useState<ContextGraphResponse | null>(null);
  const [rebuildResult, setRebuildResult] = useState<ContextRebuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [traceEntityId, setTraceEntityId] = useState<string>("");
  const [trace, setTrace] = useState<ContextTraceResult | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [datasetFilter, setDatasetFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  async function handleRebuild() {
    setBusy(true);
    setRebuildResult(null);
    setTrace(null);
    try {
      const result = await rebuildContextModel();
      setRebuildResult(result);
      setGraph(await fetchContextGraph());
    } catch (err) {
      setRebuildResult({
        ok: false,
        stats: { entityCount: 0, aliasCount: 0, edgeCount: 0, datasetsProcessed: 0, datasetsSkipped: [], hashFallbackRatio: 0 },
        warnings: [err instanceof Error ? err.message : "Rebuild failed"],
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleTrace(id: string) {
    setTraceEntityId(id);
    const result = await fetchContextTrace(id);
    setTrace(result);
  }

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const datasetNodes = useMemo(() => graph?.nodes.filter((n) => n.entity_type === "dataset") ?? [], [graph]);
  const domainByDatasetId = useMemo(
    () => new Map(datasetNodes.map((n) => [n.id, deriveDomain(n.canonical_name)])),
    [datasetNodes]
  );
  const domains = useMemo(
    () => Array.from(new Set(datasetNodes.map((n) => domainByDatasetId.get(n.id)!))).sort(),
    [datasetNodes, domainByDatasetId]
  );

  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!graph) return { filteredNodes: [], filteredEdges: [] };

    let allowedDatasetIds: Set<string> | null = null;
    if (datasetFilter !== "all") {
      allowedDatasetIds = new Set([datasetFilter]);
    } else if (domainFilter !== "all") {
      allowedDatasetIds = new Set(
        datasetNodes.filter((n) => domainByDatasetId.get(n.id) === domainFilter).map((n) => n.id)
      );
    }

    let nodes = graph.nodes;
    if (allowedDatasetIds) {
      // Two-hop expansion (dataset -> group/FK-partner -> value) over
      // structural edges only, so co-occurrence links don't pull in
      // unrelated parts of the graph when filtering to "just this dataset".
      const structuralEdges = graph.edges.filter((e) => e.edge_type !== "co_occurs_with");
      let frontier = new Set(allowedDatasetIds);
      const connected = new Set(frontier);
      for (let hop = 0; hop < 2; hop++) {
        const next = new Set<string>();
        for (const e of structuralEdges) {
          if (frontier.has(e.from_entity_id) && !connected.has(e.to_entity_id)) next.add(e.to_entity_id);
          if (frontier.has(e.to_entity_id) && !connected.has(e.from_entity_id)) next.add(e.from_entity_id);
        }
        next.forEach((id) => connected.add(id));
        frontier = next;
      }
      nodes = nodes.filter((n) => connected.has(n.id));
    }

    if (hiddenTypes.size > 0) {
      nodes = nodes.filter((n) => !hiddenTypes.has(n.entity_type));
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => nodeIds.has(e.from_entity_id) && nodeIds.has(e.to_entity_id));
    return { filteredNodes: nodes, filteredEdges: edges };
  }, [graph, hiddenTypes, datasetFilter, domainFilter, datasetNodes, domainByDatasetId]);

  const presentTypes = useMemo(
    () => ENTITY_TYPE_ORDER.filter((t) => graph?.nodes.some((n) => n.entity_type === t)),
    [graph]
  );

  return (
    <div className="context-graph">
      <button onClick={handleRebuild} disabled={busy}>
        {busy ? "Building..." : "Rebuild Enterprise Context Model"}
      </button>

      {rebuildResult && (
        <div className="context-summary">
          <p>
            {rebuildResult.stats.entityCount} entities · {rebuildResult.stats.edgeCount} relationships ·{" "}
            {rebuildResult.stats.datasetsProcessed} datasets processed
          </p>
          {rebuildResult.warnings.length > 0 && (
            <ul className="warnings">
              {rebuildResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <>
          <div className="graph-filters">
            <label>
              Dataset:{" "}
              <select value={datasetFilter} onChange={(e) => setDatasetFilter(e.target.value)}>
                <option value="all">All datasets</option>
                {datasetNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.canonical_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Domain:{" "}
              <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
                <option value="all">All domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div className="type-toggles">
              {presentTypes.map((t) => (
                <label key={t} className="type-toggle">
                  <input type="checkbox" checked={!hiddenTypes.has(t)} onChange={() => toggleType(t)} />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <h4>Graph</h4>
          <p className="section-hint">
            Click a business entity to trace its connections; click a gray-ringed attribute node to collapse/expand
            its values. Red ring = low-confidence entity merge.
          </p>
          <GraphVisualization
            nodes={filteredNodes}
            edges={filteredEdges}
            onSelectNode={handleTrace}
            selectedId={traceEntityId}
          />

          <h4>Entities</h4>
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Canonical Name</th>
                <th>Aliases</th>
                <th>Confidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredNodes
                .filter((n) => n.entity_type !== "attribute_group" && n.entity_type !== "dataset")
                .map((n) => (
                  <tr key={n.id} className={n.id === traceEntityId ? "selected" : ""}>
                    <td>{n.entity_type}</td>
                    <td>{n.canonical_name}</td>
                    <td>{n.alias_count}</td>
                    <td className={n.resolution_confidence < 0.7 ? "low-confidence" : ""}>
                      {Math.round(n.resolution_confidence * 100)}%
                    </td>
                    <td>
                      <button onClick={() => handleTrace(n.id)}>Trace</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          <h4>Relationships</h4>
          <p className="section-hint">
            Structural (foreign key) relationships are listed first — these come from real shared key values, not
            inference from co-occurring mentions.
          </p>
          <table className="relationships-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Type</th>
                <th>Label</th>
                <th>Weight</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredEdges.map((e) => (
                <tr key={e.id} className={e.edge_type === "foreign_key" ? "structural" : ""}>
                  <td>
                    {e.from_name} <span className="samples">({e.from_type})</span>
                  </td>
                  <td>
                    {e.to_name} <span className="samples">({e.to_type})</span>
                  </td>
                  <td>{e.edge_type}</td>
                  <td>{e.label ?? "—"}</td>
                  <td>{e.weight}</td>
                  <td>{Math.round(e.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {trace && (
        <div className="trace-panel">
          <h4>Trace from {graph?.nodes.find((n) => n.id === traceEntityId)?.canonical_name}</h4>
          {trace.nodes.length === 0 ? (
            <p className="empty-state">No connections found for this entity.</p>
          ) : (
            <>
              <GraphVisualization nodes={trace.nodes} edges={trace.edges} selectedId={traceEntityId} />
              <ul>
                {[...trace.nodes]
                  .sort((a, b) => a.depth - b.depth)
                  .map((n) => (
                    <li key={n.id}>
                      depth {n.depth} — {n.canonical_name} <span className="samples">({n.entity_type})</span>
                      {n.resolution_confidence < 0.7 && (
                        <span className="samples"> · confidence {Math.round(n.resolution_confidence * 100)}%</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}

      {graph && graph.nodes.length === 0 && !busy && (
        <p className="empty-state">
          No context model yet. Upload and embed at least two related datasets (e.g. a Cost Center Master and a
          General Ledger file), then click "Rebuild Enterprise Context Model".
        </p>
      )}
    </div>
  );
}
