import { useState, useEffect, useCallback } from "react";
import { Dataset, fetchDatasets } from "./api";
import { ImportPhase } from "./components/pipeline/ImportPhase";
import { RelationshipsPhase } from "./components/pipeline/RelationshipsPhase";
import { DataQualityPhase } from "./components/pipeline/DataQualityPhase";
import { AtumPhase } from "./components/pipeline/AtumPhase";
import { ExportPhase } from "./components/pipeline/ExportPhase";
import { DashboardTab } from "./components/DashboardTab";
import { DukeAI } from "./components/DukeAI";

type MainTab = "pipeline" | "dashboard";
type PipelinePhase = "import" | "relationships" | "quality" | "atum" | "export";

const PHASES: { id: PipelinePhase; label: string; n: number }[] = [
  { id: "import",        label: "Import Data",   n: 1 },
  { id: "relationships", label: "Relationships", n: 2 },
  { id: "quality",       label: "Data Quality",  n: 3 },
  { id: "atum",          label: "ATUM Mapping",  n: 4 },
  { id: "export",        label: "Export",        n: 5 },
];

export default function App() {
  const [activeTab, setActiveTab]     = useState<MainTab>("pipeline");
  const [activePhase, setActivePhase] = useState<PipelinePhase>("import");
  const [maxPhaseIdx, setMaxPhaseIdx] = useState(0);
  const [datasets, setDatasets]       = useState<Dataset[]>([]);
  const [dukeOpen, setDukeOpen]       = useState(false);
  const [dukeContext, setDukeContext] = useState("");

  const refreshDatasets = useCallback(async () => {
    try { setDatasets(await fetchDatasets()); } catch { /* silent */ }
  }, []);

  useEffect(() => { refreshDatasets(); }, [refreshDatasets]);

  useEffect(() => {
    const phaseDesc: Record<PipelinePhase, string> = {
      import:        "Import Data — uploading and cataloging datasets",
      relationships: "Relationships & Knowledge Graph — enterprise context model",
      quality:       "Data Quality & Standardization — issues, corrections, readiness",
      atum:          "ATUM Mapping — TBM taxonomy classification review",
      export:        "TBM Export — Apptio-ready data model export",
    };
    setDukeContext(
      activeTab === "dashboard"
        ? `User is viewing the Analytics Dashboard.`
        : `User is on Pipeline › ${phaseDesc[activePhase]}. ${datasets.length} dataset(s) loaded.`
    );
  }, [activeTab, activePhase, datasets.length]);

  const activePhaseIdx = PHASES.findIndex(p => p.id === activePhase);

  function navigateToPhase(id: PipelinePhase) {
    const idx = PHASES.findIndex(p => p.id === id);
    setActivePhase(id);
    setMaxPhaseIdx(prev => Math.max(prev, idx));
  }

  return (
    <div className="athena-shell">
      {/* ── Header ── */}
      <header className="athena-header">
        <div className="header-brand">
          <span className="header-logo">⬡</span>
          <span className="header-name">ATHENA</span>
          <span className="header-tagline">TBM Intelligence Platform</span>
        </div>
        <nav className="header-tabs">
          <button className={`header-tab ${activeTab === "pipeline"  ? "active" : ""}`} onClick={() => setActiveTab("pipeline")}>Pipeline</button>
          <button className={`header-tab ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
        </nav>
      </header>

      {/* ── Phase Rail (pipeline only) ── */}
      {activeTab === "pipeline" && (
        <nav className="phase-rail">
          {PHASES.map((phase, idx) => {
            const isActive = activePhase === phase.id;
            const isDone   = !isActive && maxPhaseIdx >= idx;
            return (
              <button
                key={phase.id}
                className={`phase-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
                onClick={() => navigateToPhase(phase.id)}
              >
                <span className="phase-step-num">{isDone ? "✓" : phase.n}</span>
                <span>{phase.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Main Content ── */}
      <main className="athena-main">
        {activeTab === "pipeline" && (
          <>
            {activePhase === "import"        && <ImportPhase        datasets={datasets} onDatasetsChanged={refreshDatasets} />}
            {activePhase === "relationships" && <RelationshipsPhase datasets={datasets} />}
            {activePhase === "quality"       && <DataQualityPhase   datasets={datasets} onDatasetsChanged={refreshDatasets} />}
            {activePhase === "atum"          && <AtumPhase />}
            {activePhase === "export"        && <ExportPhase />}
          </>
        )}
        {activeTab === "dashboard" && <DashboardTab />}
      </main>

      {/* ── Duke AI ── */}
      <DukeAI isOpen={dukeOpen} onToggle={() => setDukeOpen(o => !o)} context={dukeContext} />
    </div>
  );
}
