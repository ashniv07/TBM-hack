import { useMemo, useState } from "react";

export interface VizNode {
  id: string;
  entity_type: string;
  canonical_name: string;
  resolution_confidence?: number;
}

export interface VizEdge {
  from_entity_id: string;
  to_entity_id: string;
  edge_type: string;
  weight: number;
  confidence: number;
  label?: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  dataset: "#5b8def",
  vendor: "#e0c460",
  application: "#6fd694",
  service: "#6fb8ef",
  business_unit: "#cf7fe0",
  department: "#e08f7f",
  cost_center: "#7fe0c9",
  cloud_resource: "#e0a37f",
  cloud_provider: "#c98f4a",
  infrastructure_asset: "#8fb4e0",
  project: "#b3e07f",
  attribute_group: "#9aa2ad",
};

const TYPE_LABELS: Record<string, string> = {
  dataset: "dataset",
  vendor: "vendor",
  application: "application",
  service: "service",
  business_unit: "business unit",
  department: "department",
  cost_center: "cost center",
  cloud_resource: "cloud resource",
  cloud_provider: "cloud provider",
  infrastructure_asset: "infrastructure asset",
  project: "project",
  attribute_group: "attribute (column)",
};

const LOW_CONFIDENCE_THRESHOLD = 0.7;

// Structural (foreign_key) edges represent real enterprise data lineage —
// discovered from actual shared key values, not inference from co-occurring
// business-entity mentions — so they get pulled closer together in the
// layout than semantic edges. Dataset -> attribute-group edges get a modest
// boost too, so each dataset's hierarchy stays visually grouped rather than
// its attributes drifting to wherever repulsion happens to push them.
const EDGE_STRENGTH: Record<string, number> = {
  foreign_key: 2.2,
  contains_reference: 1.3,
  co_occurs_with: 1,
};

const EDGE_COLOR: Record<string, string> = {
  foreign_key: "#f0a020",
  co_occurs_with: "#7fb0f5",
  contains_reference: "#4a4f5c",
};

interface WeightedEdge {
  a: string;
  b: string;
  strength: number;
}

// Simplified Fruchterman-Reingold force-directed layout. Runs once
// (synchronously) over the given node/edge set and returns final positions —
// no animation loop needed for a static "understand the shape of the graph"
// view. Edge `strength` scales the attractive force for that edge, so
// structurally-linked nodes end up visually closer than semantically-linked ones.
function forceDirectedLayout(nodeIds: string[], edges: WeightedEdge[], width: number, height: number) {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodeIds.length === 0) return positions;

  const area = width * height;
  const k = Math.sqrt(area / nodeIds.length);
  const iterations = Math.min(300, Math.max(50, Math.round(6000 / nodeIds.length)));

  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / nodeIds.length;
    positions.set(id, {
      x: width / 2 + Math.cos(angle) * width * 0.3,
      y: height / 2 + Math.sin(angle) * height * 0.3,
    });
  });

  let temperature = width / 10;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { x: number; y: number }>();
    nodeIds.forEach((id) => disp.set(id, { x: 0, y: 0 }));

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        disp.get(a)!.x += dx;
        disp.get(a)!.y += dy;
        disp.get(b)!.x -= dx;
        disp.get(b)!.y -= dy;
      }
    }

    for (const { a, b, strength } of edges) {
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) continue;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = ((dist * dist) / k) * strength;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      disp.get(a)!.x -= dx;
      disp.get(a)!.y -= dy;
      disp.get(b)!.x += dx;
      disp.get(b)!.y += dy;
    }

    for (const id of nodeIds) {
      const d = disp.get(id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const p = positions.get(id)!;
      const move = Math.min(dist, temperature);
      p.x += (d.x / dist) * move;
      p.y += (d.y / dist) * move;
      p.x = Math.max(24, Math.min(width - 24, p.x));
      p.y = Math.max(24, Math.min(height - 24, p.y));
    }

    temperature *= 0.97;
  }

  return positions;
}

export function GraphVisualization({
  nodes,
  edges,
  onSelectNode,
  selectedId,
}: {
  nodes: VizNode[];
  edges: VizEdge[];
  onSelectNode?: (id: string) => void;
  selectedId?: string;
}) {
  const width = 640;
  const height = 420;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleCollapse(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { visibleNodes, visibleEdges } = useMemo(() => {
    let filteredNodes = nodes;

    if (collapsedGroups.size > 0) {
      const hiddenChildIds = new Set<string>();
      for (const e of edges) {
        if (e.edge_type === "contains_reference" && collapsedGroups.has(e.from_entity_id)) {
          hiddenChildIds.add(e.to_entity_id);
        }
      }
      filteredNodes = filteredNodes.filter((n) => !hiddenChildIds.has(n.id));
    }

    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => visibleIds.has(e.from_entity_id) && visibleIds.has(e.to_entity_id));
    return { visibleNodes: filteredNodes, visibleEdges: filteredEdges };
  }, [nodes, edges, collapsedGroups]);

  const nodeIdsKey = visibleNodes.map((n) => n.id).join(",");
  const positions = useMemo(() => {
    const ids = visibleNodes.map((n) => n.id);
    const edgePairs: WeightedEdge[] = visibleEdges.map((e) => ({
      a: e.from_entity_id,
      b: e.to_entity_id,
      strength: EDGE_STRENGTH[e.edge_type] ?? 1,
    }));
    return forceDirectedLayout(ids, edgePairs, width, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, visibleEdges.length]);

  if (visibleNodes.length === 0) return null;

  const groupIdsWithChildren = new Set(
    edges.filter((e) => e.edge_type === "contains_reference").map((e) => e.from_entity_id)
  );

  return (
    <div className="graph-viz-wrapper">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="graph-viz">
        {visibleEdges.map((e, i) => {
          const a = positions.get(e.from_entity_id);
          const b = positions.get(e.to_entity_id);
          if (!a || !b) return null;
          const isStructural = e.edge_type === "foreign_key";
          const color = EDGE_COLOR[e.edge_type] ?? "#4a4f5c";
          return (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={isStructural ? Math.min(2 + Math.log2(e.weight + 1), 8) : Math.min(1 + Math.log2(e.weight + 1), 6)}
                strokeOpacity={isStructural || e.label ? 0.9 : 0.25 + e.confidence * 0.5}
              >
                <title>
                  {e.edge_type}
                  {e.label ? ` (${e.label})` : ""} — confidence {Math.round(e.confidence * 100)}%, weight {e.weight}
                </title>
              </line>
              {e.label && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize={9} fill={color} textAnchor="middle">
                  {isStructural ? `FK(${e.label}, ${Math.round(e.confidence * 100)}%)` : e.label}
                </text>
              )}
            </g>
          );
        })}
        {visibleNodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const confidence = n.resolution_confidence ?? 1;
          const lowConfidence = confidence < LOW_CONFIDENCE_THRESHOLD;
          const isGroup = n.entity_type === "attribute_group";
          const isCollapsed = collapsedGroups.has(n.id);
          const canCollapse = isGroup && groupIdsWithChildren.has(n.id);
          return (
            <g
              key={n.id}
              onClick={() => (canCollapse ? toggleCollapse(n.id) : onSelectNode?.(n.id))}
              style={{ cursor: canCollapse || onSelectNode ? "pointer" : "default" }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={n.id === selectedId ? 12 : isGroup ? 9 : 8}
                fill={TYPE_COLORS[n.entity_type] ?? "#9aa2ad"}
                stroke={lowConfidence ? "#ef6f6f" : isGroup ? "#c9cdd4" : "#0f1115"}
                strokeWidth={lowConfidence ? 2.5 : isGroup ? 2 : 1.5}
                strokeDasharray={isCollapsed ? "3,2" : undefined}
              >
                <title>
                  {n.canonical_name} ({TYPE_LABELS[n.entity_type] ?? n.entity_type})
                  {n.resolution_confidence !== undefined ? ` — resolution confidence ${Math.round(confidence * 100)}%` : ""}
                  {canCollapse ? (isCollapsed ? " — click to expand" : " — click to collapse") : ""}
                </title>
              </circle>
              {canCollapse && (
                <text x={p.x} y={p.y + 3} fontSize={9} fill="#0f1115" textAnchor="middle">
                  {isCollapsed ? "+" : "−"}
                </text>
              )}
              <text x={p.x + 12} y={p.y + 4} fontSize={10} fill="#c9cdd4">
                {n.canonical_name.length > 22 ? `${n.canonical_name.slice(0, 20)}…` : n.canonical_name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="graph-viz-legend">
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <span key={type}>
            <span className="legend-dot" style={{ background: TYPE_COLORS[type] }} /> {label}
          </span>
        ))}
        <span>
          <span className="legend-line" style={{ background: "#f0a020" }} /> foreign key (structural)
        </span>
        <span>
          <span className="legend-line" style={{ background: "#7fb0f5" }} /> co-occurs (semantic)
        </span>
        <span>
          <span className="legend-dot legend-ring" /> red ring = confidence &lt; {LOW_CONFIDENCE_THRESHOLD * 100}%
        </span>
        <span>gray-ringed node = attribute group, click to collapse/expand</span>
      </div>
    </div>
  );
}
