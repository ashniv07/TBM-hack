import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

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
  atum_category: "#f2c14e",
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
  atum_category: "ATUM category",
  attribute_group: "attribute (column)",
};

const LOW_CONFIDENCE_THRESHOLD = 0.7;

const zoomBtnStyle: CSSProperties = {
  width: 32, height: 32, border: "none", background: "transparent", color: "var(--text-muted)",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  borderRadius: 4,
};

function MoveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}
function ZoomOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}
function ZoomInIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}
function FitIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

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
  maps_to_atum: 1.4,
};

const EDGE_COLOR: Record<string, string> = {
  foreign_key: "#f0a020",
  co_occurs_with: "#7fb0f5",
  contains_reference: "#4a4f5c",
  maps_to_atum: "#c084fc",
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
//
// `nodeType` adds a same-type clustering bias on top of that: vendors drift
// toward other vendors, infra assets toward other infra assets, etc.
// Without it, a graph with hundreds of edges (most of them the same
// business-relationship type) reads as one undifferentiated mass — nothing
// visually distinguishes "the vendor neighborhood" from "the cost-center
// neighborhood" even though the colors are already there to see it, because
// same-type nodes end up scattered randomly by pure repulsion.
function forceDirectedLayout(
  nodeIds: string[],
  edges: WeightedEdge[],
  width: number,
  height: number,
  nodeType?: Map<string, string>
) {
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
        const sameType = nodeType && nodeType.get(a) === nodeType.get(b);
        // Same-type pairs repel far more weakly and get a small extra pull
        // toward each other — enough to cluster loosely by color without
        // collapsing into an unreadable clump of their own.
        const force = sameType ? (k * k * 0.22) / dist - k * 0.12 : (k * k) / dist;
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

    // Mild pull toward the canvas center. Pure repulsion has no counterforce
    // for nodes with no edges (or a graph with no edges at all) — they just
    // keep pushing outward every iteration until they pile up against the
    // clamped boundary, which is what produced the "everything pinned to one
    // edge" layout for disconnected / edge-less node sets. This keeps a
    // sparse or edge-less graph settled into a filled cloud instead.
    const centerX = width / 2;
    const centerY = height / 2;
    const GRAVITY = 0.03;
    for (const id of nodeIds) {
      const d = disp.get(id)!;
      const p = positions.get(id)!;
      d.x += (centerX - p.x) * GRAVITY;
      d.y += (centerY - p.y) * GRAVITY;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
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

// Deterministic fallback for node sets with no edges at all. Force-directed
// physics has nothing to organize around in that case — pure mutual repulsion
// with no counterforce reliably piles nodes up against the canvas boundary
// instead of filling it (verified: true regardless of gravity/iteration
// tuning) — so a plain grid, grouped by type, reads far better than fake
// physics for what is really just a browsable list.
//
// The grid sizes itself directly to the container's aspect ratio (rather
// than reusing the force-layout canvas formula) and uses a fixed, generous
// cell size — there's no crowding risk in a regular grid the way there is in
// a force layout, so there's no reason to render it small. Fitting a
// mismatched-aspect grid into an aspect-matched viewport was the previous
// bug: it left the whole grid looking tiny and lost in the middle of the frame.
// Grid nodes render as labeled chips (name inside), not small dots with text
// beside them — a bare 8px dot next to 9pt text is what read as "tiny and
// disconnected" for a set with no edges to visually tie it together. Cells
// are wider than they are tall since a chip needs horizontal room for text
// far more than vertical room.
const CELL_W = 210;
const CELL_H = 78;
const CHIP_W = 188;
const CHIP_H = 54;

function gridLayout(sortedNodes: VizNode[], targetAspect: number) {
  const positions = new Map<string, { x: number; y: number }>();
  const n = sortedNodes.length;
  if (n === 0) return positions;

  const cols = Math.max(1, Math.round(Math.sqrt(n * targetAspect * (CELL_H / CELL_W))));
  const rows = Math.ceil(n / cols);

  sortedNodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(node.id, { x: CELL_W * (col + 0.5), y: CELL_H * (row + 0.5) });
  });

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
  // Attribute-group parent nodes start collapsed — lazy init from edges so the
  // first render shows only the focal entity + its group headings, not every value.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const s = new Set<string>();
    edges.forEach(e => { if (e.edge_type === "contains_reference") s.add(e.from_entity_id); });
    return s;
  });

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

  // Dynamic coordinate space — give each node ~70×55 px of room, capped at a
  // reasonable maximum so very large graphs don't allocate gigantic SVGs.
  const width  = Math.max(900,  Math.min(2400, visibleNodes.length * 70));
  const height = Math.max(600,  Math.min(1600, visibleNodes.length * 55));

  // The viewBox is fit to the container's actual pixel aspect ratio, not just
  // the content's own bounding box — the graph area is typically very wide
  // and short (sidebar + drawer squeeze it), while a handful of nodes settle
  // into a roughly square cluster. Fitting only the content's own aspect left
  // huge black letterboxing on both sides, which is what made even a
  // "properly fit" graph look tiny and zoomed-out.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerAspect, setContainerAspect] = useState(1.6);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (w > 0 && h > 0) setContainerAspect(w / h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeIdsKey = visibleNodes.map((n) => n.id).join(",");
  const positions = useMemo(() => {
    if (visibleEdges.length === 0) {
      const sorted = [...visibleNodes].sort((a, b) =>
        a.entity_type === b.entity_type
          ? a.canonical_name.localeCompare(b.canonical_name)
          : a.entity_type.localeCompare(b.entity_type)
      );
      return gridLayout(sorted, containerAspect);
    }
    const ids = visibleNodes.map((n) => n.id);
    const edgePairs: WeightedEdge[] = visibleEdges.map((e) => ({
      a: e.from_entity_id,
      b: e.to_entity_id,
      strength: EDGE_STRENGTH[e.edge_type] ?? 1,
    }));
    const nodeType = new Map(visibleNodes.map((n) => [n.id, n.entity_type]));
    return forceDirectedLayout(ids, edgePairs, width, height, nodeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, width, height, containerAspect]);

  // Matching the container's aspect ratio exactly eliminates letterboxing,
  // but for a small, roughly-square cluster (e.g. the ~10-node category
  // overview) inside a very wide container, "exactly" means stretching the
  // view to several times the content's own size — the nodes stay the same
  // absolute size while the frame balloons around them, which reads as
  // "zoomed out" even though there's technically no letterboxing. Capping how
  // far the aspect correction is allowed to expand beyond the content's own
  // padded size trades a little (much less severe) letterboxing for keeping
  // the actual content — the part anyone is looking at — bigger on screen.
  const MAX_ASPECT_EXPAND = 1.12;
  function fitToAspect(minX: number, maxX: number, minY: number, maxY: number, pad: number, minW: number, minH: number) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let w = Math.max(minW, maxX - minX + pad * 2);
    let h = Math.max(minH, maxY - minY + pad * 2);
    if (w / h < containerAspect) w = Math.min(h * containerAspect, w * MAX_ASPECT_EXPAND);
    else h = Math.min(w / containerAspect, h * MAX_ASPECT_EXPAND);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  // "Fit everything" has to mean the actual bounding box of where nodes ended
  // up, not the full nominal width×height canvas. The layout allocates that
  // whole canvas up front, but real content (especially a handful of small,
  // far-flung disconnected components) usually only fills a fraction of it —
  // fitting the raw canvas left the real cluster tiny in a corner.
  //
  // The result is also capped at a multiple of the nominal canvas size: a
  // couple of weakly-connected outlier nodes sitting far from the main mass
  // (real, but rare) would otherwise force the *entire* view to zoom out to
  // include them, shrinking everything else in the process. Better to let
  // the default view frame the main cluster at a readable size and leave
  // outliers reachable by panning/zooming out, same as any map view does.
  const contentBounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: width, h: height };
    let fitted = fitToAspect(minX, maxX, minY, maxY, 70, 240, 180);
    if (visibleEdges.length === 0) {
      // A grid fills its frame edge-to-edge (that's the point — see the grid
      // sizing comment above), which means its top-right node can end up
      // rendered directly under the pan/zoom toolbar overlay, hiding its
      // label behind the toolbar's opaque background. The toolbar is a fixed
      // screen overlay regardless of zoom, so the fix is a standing reserve
      // in that corner rather than anything content-dependent: re-fit with
      // extra empty margin added only to the top and right.
      const reserveTop = fitted.h * 0.12;
      const reserveRight = fitted.w * 0.14;
      fitted = fitToAspect(fitted.x, fitted.x + fitted.w + reserveRight, fitted.y - reserveTop, fitted.y + fitted.h, 0, 240, 180);
    }
    const capW = width * 1.7, capH = height * 1.7;
    if (fitted.w > capW || fitted.h > capH) {
      const scale = Math.min(capW / fitted.w, capH / fitted.h);
      const cx = fitted.x + fitted.w / 2, cy = fitted.y + fitted.h / 2;
      const w = fitted.w * scale, h = fitted.h * scale;
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    }
    return fitted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, visibleNodes, width, height, containerAspect]);

  // Pan/zoom is a plain SVG viewBox rectangle (vbX, vbY, vbW, vbH) rather than
  // a CSS transform — cheaper to reason about (all math stays in the same
  // coordinate space as `positions`) and it's what makes native browser
  // scrollbars unnecessary, which is what made the old fixed-pixel-size SVG
  // hard to move around.
  const [view, setView] = useState(contentBounds);
  const dragRef = useRef<{ x: number; y: number; vbX: number; vbY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Off by default: dragging the canvas and dragging a node to reposition it
  // read as the same gesture, so an accidental drag while trying to click a
  // node would pan the whole view instead of selecting it. The move tool has
  // to be deliberately switched on, same as the hand tool in a design app.
  const [panEnabled, setPanEnabled] = useState(false);

  // Reset to "fit everything" whenever the underlying node set changes (a
  // filter toggle, a rebuild, switching entities) — otherwise the user can be
  // left panned/zoomed into empty space after the graph under them changes.
  //
  // containerAspect has to be in this list too: it starts at a rough guess
  // (1.6) and gets corrected to the real measured value by the ResizeObserver
  // shortly after mount. contentBounds recomputes when that happens, but
  // without containerAspect here, `view` itself never re-adopts the
  // corrected value — it silently stays fit to the wrong, first-guess aspect
  // forever, which is what made the zoom level look frozen regardless of any
  // tuning to the fit math itself.
  useEffect(() => {
    setView(contentBounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, width, height, containerAspect]);

  // Clicking a node commits to it (unlike hover, which is just a preview) —
  // pan/zoom to frame that node and its direct neighbors so their labels
  // actually have room to not overlap, instead of leaving the camera at
  // whatever overview zoom level it happened to be at.
  useEffect(() => {
    if (!selectedId) return;
    const neighborIds = new Set<string>([selectedId]);
    for (const e of visibleEdges) {
      if (e.from_entity_id === selectedId) neighborIds.add(e.to_entity_id);
      else if (e.to_entity_id === selectedId) neighborIds.add(e.from_entity_id);
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of neighborIds) {
      const p = positions.get(id);
      if (!p) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (!isFinite(minX)) return;
    setView(fitToAspect(minX, maxX, minY, maxY, 140, 320, 240));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const ZOOM_MIN = width / 6000; // deepest zoom-in: ~6000px of virtual space visible
  const ZOOM_MAX = 2.5; // furthest zoom-out: 2.5x the fitted view

  function zoomBy(factor: number, centerScreen?: { x: number; y: number }) {
    setView((v) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = centerScreen && rect ? v.x + ((centerScreen.x - rect.left) / rect.width) * v.w : v.x + v.w / 2;
      const cy = centerScreen && rect ? v.y + ((centerScreen.y - rect.top) / rect.height) * v.h : v.y + v.h / 2;
      const newW = Math.min(width * ZOOM_MAX, Math.max(width * ZOOM_MIN, v.w / factor));
      const newH = newW * (v.h / v.w);
      return {
        w: newW,
        h: newH,
        x: cx - ((cx - v.x) / v.w) * newW,
        y: cy - ((cy - v.y) / v.h) * newH,
      };
    });
  }

  function resetView() {
    setView(contentBounds);
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (!panEnabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, vbX: view.x, vbY: view.y };
  }
  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!panEnabled || !drag || !rect) return;
    const dxScreen = e.clientX - drag.x;
    const dyScreen = e.clientY - drag.y;
    setView((v) => ({
      ...v,
      x: drag.vbX - (dxScreen / rect.width) * v.w,
      y: drag.vbY - (dyScreen / rect.height) * v.h,
    }));
  }
  function handlePointerUp() {
    dragRef.current = null;
  }
  function handleWheel(e: ReactWheelEvent<SVGSVGElement>) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX, y: e.clientY });
  }

  const [hoverId, setHoverId] = useState<string | null>(null);

  // Focus mode: hovering previews a node's connections without disturbing an
  // active selection; moving away falls back to whatever is actually
  // selected. With hundreds of edges on screen at once (a dense TBM graph
  // easily has 900+), rendering everything at full strength all the time is
  // unreadable — dimming everything not touching the focused node turns that
  // hairball into a legible ego-network on demand.
  const focusId = hoverId ?? selectedId ?? null;
  const focusNeighbors = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const e of visibleEdges) {
      if (e.from_entity_id === focusId) s.add(e.to_entity_id);
      else if (e.to_entity_id === focusId) s.add(e.from_entity_id);
    }
    return s;
  }, [focusId, visibleEdges]);

  if (visibleNodes.length === 0) return null;

  const groupIdsWithChildren = new Set(
    edges.filter((e) => e.edge_type === "contains_reference").map((e) => e.from_entity_id)
  );

  const zoomFactor = width / view.w;
  const denseGraph = visibleNodes.length > 40;
  const isGridLayout = visibleEdges.length === 0;
  // Chips (bigger, name inside) render whenever there's room for them to not
  // collide: always for a grid (positions are regular and non-overlapping by
  // construction), and also for any small force-directed graph — a
  // 10-category overview or a lightly-connected entity's ego view doesn't
  // have the crowding problem that justified small dots in the first place,
  // so there's no reason to render it that way.
  const useChips = isGridLayout || visibleNodes.length <= 20;

  return (
    <div ref={wrapperRef} className="graph-viz-wrapper" style={{ overflow: "hidden", flex: 1, position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ display: "block", width: "100%", height: "100%", cursor: panEnabled ? "grab" : "default", touchAction: "none" }}
        className="graph-viz"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        {visibleEdges.map((e, i) => {
          const a = positions.get(e.from_entity_id);
          const b = positions.get(e.to_entity_id);
          if (!a || !b) return null;
          const isStructural = e.edge_type === "foreign_key";
          const color = EDGE_COLOR[e.edge_type] ?? "#4a4f5c";
          const isFocused = focusNeighbors !== null;
          const touchesFocus = !focusNeighbors || (focusNeighbors.has(e.from_entity_id) && focusNeighbors.has(e.to_entity_id) && (e.from_entity_id === focusId || e.to_entity_id === focusId));
          const dimmed = isFocused && !touchesFocus;
          // Most co-occurrence edges carry a business label (USES_VENDOR,
          // CONTRACTED_WITH, ...) — treating "has a label" as "render at full
          // strength" meant nearly every edge in a dense graph rendered at 90%
          // opacity, producing one solid wall of lines. Full strength is now
          // reserved for real structural (foreign-key) edges and for whatever
          // is actually focused; everything else in the unfocused overview
          // fades toward a soft density texture instead.
          const baseOpacity = isStructural ? 0.9 : isFocused && touchesFocus ? 0.9 : 0.12 + e.confidence * 0.22;
          const maxWidth = isFocused || !denseGraph ? 6 : 3;
          return (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={isStructural ? Math.min(2 + Math.log2(e.weight + 1), 8) : Math.min(1 + Math.log2(e.weight + 1), maxWidth)}
                strokeOpacity={dimmed ? 0.04 : baseOpacity}
              >
                <title>
                  {e.edge_type}
                  {e.label ? ` (${e.label})` : ""} — confidence {Math.round(e.confidence * 100)}%, weight {e.weight}
                </title>
              </line>
              {e.label && touchesFocus && (zoomFactor > 1.3 || !denseGraph) && (
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
          const inFocus = !focusNeighbors || focusNeighbors.has(n.id);
          const isFocalNode = n.id === focusId;
          // A click commits to a node and auto-frames it + its neighbors (see
          // the selectedId effect above), so there's room for every neighbor's
          // label. A hover is just a quick preview at whatever zoom level the
          // user was already at — forcing every neighbor's label on for a
          // highly-connected node is exactly what produced illegible
          // overlapping text, so hover only guarantees the focal node's own label.
          const isClickFocus = !hoverId && selectedId !== undefined && focusId === selectedId;
          const showLabel = inFocus && (isFocalNode || isClickFocus || !denseGraph || zoomFactor > 1.3 || useChips);
          const color = TYPE_COLORS[n.entity_type] ?? "#9aa2ad";
          const titleText = (
            <title>
              {n.canonical_name} ({TYPE_LABELS[n.entity_type] ?? n.entity_type})
              {n.resolution_confidence !== undefined ? ` — resolution confidence ${Math.round(confidence * 100)}%` : ""}
              {canCollapse ? (isCollapsed ? " — click to expand" : " — click to collapse") : ""}
            </title>
          );

          if (useChips) {
            // A bare dot with text beside it is what read as "tiny" for any
            // small-enough node set — there's room for something much more
            // legible, whether that's a no-edge browsable index or a compact
            // overview/ego-graph that still has real connections to draw.
            const truncated = n.canonical_name.length > 24 ? `${n.canonical_name.slice(0, 22)}…` : n.canonical_name;
            return (
              <g
                key={n.id}
                onClick={() => onSelectNode?.(n.id)}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                style={{ cursor: onSelectNode ? "pointer" : "default", opacity: inFocus ? 1 : 0.15 }}
              >
                <rect
                  x={p.x - CHIP_W / 2}
                  y={p.y - CHIP_H / 2}
                  width={CHIP_W}
                  height={CHIP_H}
                  rx={8}
                  fill={n.id === selectedId ? `${color}33` : "var(--card, #14161a)"}
                  stroke={n.id === selectedId ? "#cdde33" : lowConfidence ? "#ef6f6f" : color}
                  strokeWidth={n.id === selectedId ? 3 : lowConfidence ? 2.5 : 1.5}
                >
                  {titleText}
                </rect>
                <circle cx={p.x - CHIP_W / 2 + 18} cy={p.y} r={6} fill={color} />
                <text x={p.x - CHIP_W / 2 + 34} y={p.y + 5} fontSize={13.5} fill="#eef1f4">
                  {truncated}
                </text>
              </g>
            );
          }

          return (
            <g
              key={n.id}
              onClick={() => (canCollapse ? toggleCollapse(n.id) : onSelectNode?.(n.id))}
              onPointerEnter={() => setHoverId(n.id)}
              onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              style={{ cursor: canCollapse || onSelectNode ? "pointer" : "default", opacity: inFocus ? 1 : 0.15 }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={n.id === selectedId ? 13 : isGroup ? 9 : 8}
                fill={color}
                stroke={n.id === selectedId ? "#cdde33" : lowConfidence ? "#ef6f6f" : isGroup ? "#c9cdd4" : "#0f1115"}
                strokeWidth={n.id === selectedId ? 3 : lowConfidence ? 2.5 : isGroup ? 2 : 1.5}
                strokeDasharray={isCollapsed ? "3,2" : undefined}
              >
                {titleText}
              </circle>
              {canCollapse && (
                <text x={p.x} y={p.y + 3} fontSize={9} fill="#0f1115" textAnchor="middle">
                  {isCollapsed ? "+" : "−"}
                </text>
              )}
              {showLabel && (
                <text x={p.x + 12} y={p.y + 4} fontSize={10} fill="#c9cdd4">
                  {n.canonical_name.length > 22 ? `${n.canonical_name.slice(0, 20)}…` : n.canonical_name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div style={{
        position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 2,
        background: "rgba(20,22,27,0.92)", border: "1px solid var(--border)", borderRadius: 6, padding: 3,
      }}>
        <button
          type="button"
          onClick={() => setPanEnabled((p) => !p)}
          title={panEnabled ? "Move tool on — drag to pan" : "Move tool off — click a node to select it"}
          style={{ ...zoomBtnStyle, background: panEnabled ? "var(--accent-dim)" : "transparent", color: panEnabled ? "var(--accent)" : "var(--text-muted)" }}
        ><MoveIcon /></button>
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Zoom out" style={zoomBtnStyle}><ZoomOutIcon /></button>
        <button type="button" onClick={() => zoomBy(1.3)} title="Zoom in" style={zoomBtnStyle}><ZoomInIcon /></button>
        <button type="button" onClick={resetView} title="Fit to view" style={zoomBtnStyle}><FitIcon /></button>
      </div>

      {!focusId && edges.length > 0 && (
        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(15,17,21,0.85)", border: "1px solid var(--border)", borderRadius: 2, padding: "5px 10px", fontSize: 10.5, color: "var(--text-muted)" }}>
          {panEnabled ? "Drag to pan" : "Click the move icon to drag-pan"} · scroll to zoom · hover or click a node to focus its connections
        </div>
      )}

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
          <span className="legend-line" style={{ background: "#c084fc" }} /> ATUM mapping
        </span>
        <span>
          <span className="legend-dot legend-ring" /> red ring = confidence &lt; {LOW_CONFIDENCE_THRESHOLD * 100}%
        </span>
        <span>gray-ringed node = attribute group, click to collapse/expand</span>
      </div>
    </div>
  );
}
