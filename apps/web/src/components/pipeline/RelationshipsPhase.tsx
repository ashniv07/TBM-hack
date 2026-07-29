import { useState, useMemo, useEffect } from "react";
import {
  ContextGraphResponse, ContextRebuildResult, ContextTraceResult,
  rebuildContextModel, fetchContextGraph, fetchContextTrace,
} from "../../api";
import { GraphVisualization } from "../GraphVisualization";
import type { VizNode, VizEdge } from "../GraphVisualization";

const TYPE_COLORS: Record<string, string> = {
  dataset:              "#5b8def",
  vendor:               "#e0c460",
  application:          "#6fd694",
  service:              "#6fb8ef",
  business_unit:        "#cf7fe0",
  department:           "#e08f7f",
  cost_center:          "#7fe0c9",
  cloud_resource:       "#e0a37f",
  cloud_provider:       "#c98f4a",
  infrastructure_asset: "#8fb4e0",
  project:              "#b3e07f",
  atum_category:        "#f2c14e",
  attribute_group:      "#9aa2ad",
};

const TYPE_LABELS: Record<string, string> = {
  dataset:              "Datasets",
  vendor:               "Vendors",
  application:          "Applications",
  service:              "Services",
  business_unit:        "Business Units",
  department:           "Departments",
  cost_center:           "Cost Centers",
  cloud_resource:        "Cloud Resources",
  cloud_provider:        "Cloud Providers",
  infrastructure_asset:  "Infra Assets",
  project:               "Projects",
  atum_category:         "ATUM Categories",
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  foreign_key: "Foreign Key",
  co_occurs_with: "Co-occurs",
  maps_to_atum: "ATUM Mapping",
};

type Tab = "graph" | "browse";

interface Props {
  datasets: { id: string; file_name: string }[];
}

function typeColor(t: string) { return TYPE_COLORS[t] ?? "#888"; }
function typeLabel(t: string) { return TYPE_LABELS[t] ?? t; }

export function RelationshipsPhase({ datasets }: Props) {
  const [graph,         setGraph]         = useState<ContextGraphResponse | null>(null);
  const [rebuilding,    setRebuilding]    = useState(false);
  const [rebuildResult, setRebuildResult] = useState<ContextRebuildResult | null>(null);
  const [error,         setError]         = useState("");

  const [tab,             setTab]             = useState<Tab>("browse");
  const [activeTypes,     setActiveTypes]     = useState<Set<string> | null>(null); // null = all
  const [browseType,      setBrowseType]      = useState<string | null>(null);
  const [showIsolated,    setShowIsolated]    = useState(false);
  const [search,          setSearch]          = useState("");
  const [selectedEntityId,setSelectedEntityId]= useState<string | null>(null);
  const [detail,          setDetail]          = useState<ContextTraceResult | null>(null);
  const [detailLoading,   setDetailLoading]   = useState(false);

  useEffect(() => { fetchContextGraph().then(setGraph).catch(() => {}); }, []);

  // Once the graph actually has relationships, default to showing them.
  useEffect(() => {
    if (graph && graph.edges.some(e => e.edge_type !== "contains_reference")) setTab("graph");
  }, [graph]);

  async function handleRebuild() {
    setRebuilding(true); setError(""); setRebuildResult(null);
    setSelectedEntityId(null); setDetail(null);
    try {
      const r = await rebuildContextModel();
      setRebuildResult(r);
      setGraph(await fetchContextGraph());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rebuild failed");
    } finally { setRebuilding(false); }
  }

  async function selectEntity(id: string) {
    setSelectedEntityId(id); setDetail(null); setDetailLoading(true);
    try { setDetail(await fetchContextTrace(id)); }
    catch { /* silent — drawer just shows what it has */ }
    finally { setDetailLoading(false); }
  }

  function closeDetail() { setSelectedEntityId(null); setDetail(null); }

  const businessNodes = useMemo(
    () => graph?.nodes.filter(n => n.entity_type !== "attribute_group") ?? [],
    [graph]
  );

  const meaningfulEdges = useMemo(
    () => graph?.edges.filter(e => e.edge_type !== "contains_reference") ?? [],
    [graph]
  );

  const typeCounts = useMemo(() => {
    return businessNodes.reduce((acc, n) => {
      acc[n.entity_type] = (acc[n.entity_type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [businessNodes]);

  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    meaningfulEdges.forEach(e => { s.add(e.from_entity_id); s.add(e.to_entity_id); });
    return s;
  }, [meaningfulEdges]);

  const visibleTypes = activeTypes ?? new Set(Object.keys(typeCounts));

  function toggleType(type: string) {
    setActiveTypes(prev => {
      const base = new Set(prev ?? Object.keys(typeCounts));
      if (base.has(type)) base.delete(type); else base.add(type);
      return base;
    });
  }

  // "Connected" has to be judged against the edges that survive the current
  // type filter, not the whole graph — otherwise a node whose only edge leads
  // to a type the user just filtered out reads as "connected" (it globally
  // is) but renders with no visible edge at all, i.e. it looks exactly like
  // the isolated nodes "show unconnected entities too" is supposed to hide.
  const typeFilteredNodes = useMemo(
    () => businessNodes.filter(n => visibleTypes.has(n.entity_type)),
    [businessNodes, visibleTypes]
  );

  const typeFilteredEdges = useMemo(() => {
    const ids = new Set(typeFilteredNodes.map(n => n.id));
    return meaningfulEdges.filter(e => ids.has(e.from_entity_id) && ids.has(e.to_entity_id));
  }, [meaningfulEdges, typeFilteredNodes]);

  const graphNodes = useMemo((): VizNode[] => {
    if (showIsolated) {
      return typeFilteredNodes.map(n => ({ id: n.id, entity_type: n.entity_type, canonical_name: n.canonical_name, resolution_confidence: n.resolution_confidence }));
    }
    const locallyConnected = new Set<string>();
    typeFilteredEdges.forEach(e => { locallyConnected.add(e.from_entity_id); locallyConnected.add(e.to_entity_id); });
    return typeFilteredNodes
      .filter(n => locallyConnected.has(n.id))
      .map(n => ({ id: n.id, entity_type: n.entity_type, canonical_name: n.canonical_name, resolution_confidence: n.resolution_confidence }));
  }, [typeFilteredNodes, typeFilteredEdges, showIsolated]);

  const graphEdges = useMemo((): VizEdge[] => {
    const ids = new Set(graphNodes.map(n => n.id));
    return typeFilteredEdges
      .filter(e => ids.has(e.from_entity_id) && ids.has(e.to_entity_id))
      .map(e => ({ from_entity_id: e.from_entity_id, to_entity_id: e.to_entity_id, edge_type: e.edge_type, weight: e.weight, confidence: e.confidence, label: e.label }));
  }, [typeFilteredEdges, graphNodes]);

  const browseResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = businessNodes;
    if (browseType) list = list.filter(n => n.entity_type === browseType);
    if (q) list = list.filter(n => n.canonical_name.toLowerCase().includes(q));
    return list.slice(0, 400);
  }, [businessNodes, browseType, search]);

  const selectedEntity = businessNodes.find(n => n.id === selectedEntityId) ?? null;

  const detailConnections = useMemo(() => {
    if (!detail || !selectedEntityId) return [];
    return detail.edges
      .filter(e => e.edge_type !== "contains_reference" && (e.from_entity_id === selectedEntityId || e.to_entity_id === selectedEntityId))
      .map(e => {
        const otherId = e.from_entity_id === selectedEntityId ? e.to_entity_id : e.from_entity_id;
        const other = detail.nodes.find(n => n.id === otherId);
        return other ? { edge: e, other } : null;
      })
      .filter((x): x is { edge: typeof detail.edges[number]; other: typeof detail.nodes[number] } => x !== null);
  }, [detail, selectedEntityId]);

  const detailDatasets = useMemo(() => {
    if (!detail) return [];
    return detail.nodes.filter(n => n.entity_type === "dataset" && n.id !== selectedEntityId);
  }, [detail, selectedEntityId]);

  const totalEntities = businessNodes.filter(n => n.entity_type !== "dataset").length;
  const totalEdges    = meaningfulEdges.length;
  const hasGraph       = totalEdges > 0;

  return (
    <div className="phase-panel column">
      {/* Top bar */}
      <div className="phase-header">
        <div>
          <p className="phase-subtitle">Phase 1</p>
          <h2 className="phase-title">Relationships & Knowledge Graph</h2>
        </div>
        <div className="stat-chips" style={{ marginLeft: "auto" }}>
          <div className="stat-chip accent"><div className="stat-chip-value">{totalEntities}</div><div className="stat-chip-label">Entities</div></div>
          <div className="stat-chip">      <div className="stat-chip-value">{totalEdges}</div>   <div className="stat-chip-label">Relationships</div></div>
          <div className="stat-chip">      <div className="stat-chip-value">{datasets.length}</div><div className="stat-chip-label">Datasets</div></div>
        </div>
        <button className="btn btn-primary" onClick={handleRebuild} disabled={rebuilding}>
          {rebuilding ? <><span className="spinner" /> Rebuilding…</> : (graph && graph.nodes.length > 0) ? "Rebuild Again" : "Rebuild Model"}
        </button>
      </div>

      {error && <div className="error-bar" style={{ margin: "0 22px" }}>{error}</div>}
      {rebuildResult?.ok && graph && (() => {
        const structuralCount = graph.edges.length - totalEdges;
        return (
          <div className="success-bar" style={{ margin: "0 22px" }}>
            Model rebuilt — {totalEntities} entities · {totalEdges} cross-entity relationships
            {structuralCount > 0 && <span className="text-muted normal-case"> (+{structuralCount} dataset/column containment links)</span>}
            {" "}· {rebuildResult.stats.aliasCount} aliases
          </div>
        );
      })()}

      {/* Tabs */}
      {graph && graph.nodes.length > 0 && (
        <div className="dq-tabs">
          <button className={`dq-tab ${tab === "graph" ? "active" : ""}`} onClick={() => setTab("graph")}>Graph View</button>
          <button className={`dq-tab ${tab === "browse" ? "active" : ""}`} onClick={() => setTab("browse")}>Browse Entities</button>
          {!hasGraph && (
            <span className="text-dim" style={{ fontSize: 10, marginLeft: 8 }}>
              No relationships detected yet — browsing entities only
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="graph-area">
        {!graph && !rebuilding && (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <div>No knowledge graph yet — click "Rebuild Model" to build it</div>
          </div>
        )}

        {rebuilding && (
          <div className="loading-overlay"><span className="spinner" /> Building enterprise context model…</div>
        )}

        {graph && graph.nodes.length === 0 && !rebuilding && (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <div>No entities detected — import datasets and click "Rebuild Model"</div>
          </div>
        )}

        {graph && graph.nodes.length > 0 && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* Sidebar */}
            <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search entities…"
                  style={{ width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 2, padding: "6px 9px", color: "var(--text-primary)", fontFamily: "var(--font-body)", fontSize: 12, boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "10px 10px" }}>
                <p className="section-eyebrow" style={{ padding: "0 2px", marginBottom: 8 }}>
                  {tab === "graph" ? "Filter by type" : "Entity types"}
                </p>
                {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const color = typeColor(type);
                  const active = tab === "graph" ? visibleTypes.has(type) : browseType === type;
                  return (
                    <button
                      key={type}
                      onClick={() => tab === "graph" ? toggleType(type) : setBrowseType(p => p === type ? null : type)}
                      style={{
                        display: "flex", alignItems: "center", width: "100%", gap: 8,
                        background: active ? `${color}18` : "transparent",
                        border: `1px solid ${active ? color : "transparent"}`,
                        borderRadius: 2, padding: "6px 8px", marginBottom: 2, cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, opacity: active ? 1 : 0.4 }} />
                      <span style={{ flex: 1, fontSize: 11.5, color: active ? "var(--text-primary)" : "var(--text-muted)" }}>{typeLabel(type)}</span>
                      <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{count}</span>
                    </button>
                  );
                })}
                {tab === "graph" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, padding: "0 2px", fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
                    <input type="checkbox" checked={showIsolated} onChange={e => setShowIsolated(e.target.checked)} />
                    Show unconnected entities too
                  </label>
                )}
              </div>
            </div>

            {/* Main */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {!hasGraph && tab === "graph" && (
                <div style={{ padding: "10px 22px", background: "rgba(205,222,51,0.05)", borderBottom: "1px solid rgba(205,222,51,0.15)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span style={{ color: "var(--accent)", fontSize: 14 }}>ℹ</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--text-primary)" }}>{totalEntities} entities detected</strong> across {datasets.length} datasets, but no cross-dataset relationships have been built yet.
                    Relationships are discovered when entities share foreign-key columns or co-occur in the same row, or when
                    <strong style={{ color: "var(--accent)" }}> Sync to Graph</strong> in the ATUM Mapping phase links entities to taxonomy categories.
                    Try <strong style={{ color: "var(--accent)" }}>Rebuild Again</strong>, or switch to <strong style={{ color: "var(--accent)" }}>Browse Entities</strong> to explore what was detected.
                  </span>
                </div>
              )}

              {tab === "graph" ? (
                graphNodes.length === 0 ? (
                  <div className="empty-state">
                    <div>No relationships to show for the current filters.</div>
                    {!showIsolated && <div style={{ fontSize: 11 }}>Try enabling "Show unconnected entities too".</div>}
                  </div>
                ) : (
                  <GraphVisualization
                    nodes={graphNodes}
                    edges={graphEdges}
                    selectedId={selectedEntityId ?? undefined}
                    onSelectNode={selectEntity}
                  />
                )
              ) : (
                <div style={{ flex: 1, overflow: "auto", padding: "14px 22px" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                    {browseResults.length} of {businessNodes.length} entities
                    {browseType && <> in <strong style={{ color: "var(--text-primary)" }}>{typeLabel(browseType)}</strong></>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                    {browseResults.map(n => {
                      const color = typeColor(n.entity_type);
                      const conf = n.resolution_confidence ?? 1;
                      const lowConf = conf < 0.7;
                      const connected = connectedIds.has(n.id);
                      return (
                        <button
                          key={n.id}
                          onClick={() => selectEntity(n.id)}
                          style={{
                            background: n.id === selectedEntityId ? `${color}18` : "var(--card)",
                            border: `1px solid ${n.id === selectedEntityId ? color : `${color}44`}`,
                            borderLeft: `3px solid ${color}`, borderRadius: 2,
                            padding: "9px 12px", cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {n.canonical_name}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: lowConf ? "#ef6f6f" : "var(--text-muted)" }}>
                            <span>{typeLabel(n.entity_type)}{connected && <span style={{ color: "var(--accent)" }}> · linked</span>}</span>
                            <span>{Math.round(conf * 100)}% conf</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Detail drawer */}
            {selectedEntity && (
              <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border)", overflow: "auto", background: "var(--surface)" }}>
                <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-soft)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: typeColor(selectedEntity.entity_type), textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700, marginBottom: 4 }}>
                        {typeLabel(selectedEntity.entity_type)}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text-primary)", lineHeight: 1.2 }}>
                        {selectedEntity.canonical_name}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={closeDetail}>✕</button>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {(() => {
                      const conf = selectedEntity.resolution_confidence ?? 1;
                      return (
                        <span style={{ padding: "3px 9px", borderRadius: 2, fontSize: 11, fontWeight: 700, background: conf >= 0.8 ? "var(--success-bg)" : "rgba(255,187,28,.1)", color: conf >= 0.8 ? "var(--success)" : "var(--warning)", border: `1px solid ${conf >= 0.8 ? "var(--success)" : "var(--warning)"}` }}>
                          {Math.round(conf * 100)}% resolution confidence
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {detailLoading ? (
                  <div style={{ padding: 18, fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="spinner" /> Loading…
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-soft)" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 8 }}>Connections ({detailConnections.length})</p>
                      {detailConnections.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {detailConnections.map(({ edge, other }, i) => (
                            <button
                              key={`${other.id}-${i}`}
                              onClick={() => other.entity_type !== "attribute_group" && selectEntity(other.id)}
                              style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                            >
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: typeColor(other.entity_type), flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{other.canonical_name}</div>
                                <div style={{ fontSize: 9.5, color: "var(--text-dim)" }}>{EDGE_TYPE_LABELS[edge.edge_type] ?? edge.edge_type}{edge.label ? ` · ${edge.label}` : ""}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                          No relationships detected for this entity yet.
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "14px 18px" }}>
                      <p className="section-eyebrow" style={{ marginBottom: 8 }}>Found In Datasets</p>
                      {detailDatasets.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {detailDatasets.map(d => (
                            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-primary)" }}>
                              <span style={{ color: typeColor("dataset"), fontSize: 8 }}>●</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.canonical_name}>{d.canonical_name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No dataset provenance available.</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <div key={type} className="legend-item">
            <span className="legend-dot" style={{ background: TYPE_COLORS[type] ?? "#888" }} />
            {label}
          </div>
        ))}
        <div className="legend-item"><span style={{ width: 16, height: 2, background: "#f0a020", display: "inline-block" }} /> foreign key</div>
        <div className="legend-item"><span style={{ width: 16, height: 2, background: "#7fb0f5", display: "inline-block" }} /> co-occurs</div>
        <div className="legend-item"><span style={{ width: 16, height: 2, background: "#c084fc", display: "inline-block" }} /> ATUM mapping</div>
      </div>
    </div>
  );
}
