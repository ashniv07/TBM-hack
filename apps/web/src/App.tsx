import { useEffect, useState } from "react";
import { Dataset, fetchDatasets } from "./api";
import { UploadPanel } from "./components/UploadPanel";
import { DatasetCatalog } from "./components/DatasetCatalog";
import { DatasetDetail } from "./components/DatasetDetail";
import { SemanticMatches } from "./components/SemanticMatches";
import { ContextGraph } from "./components/ContextGraph";
import { DataQualityDashboard } from "./components/DataQualityDashboard";
import { AtumMappingDashboard } from "./components/AtumMappingDashboard";
import { TbmExportDashboard } from "./components/TbmExportDashboard";
import { AiAssistant } from "./components/AiAssistant";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [matchesKey, setMatchesKey] = useState(0);

  async function refresh() {
    const data = await fetchDatasets();
    setDatasets(data);
    setMatchesKey((k) => k + 1); // re-fetch semantic matches after every upload
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="app">
      <header>
        <h1>TBM Data Trust & Intelligence Platform</h1>
        <p className="subtitle">Stages 1-9 — Full Pipeline Complete</p>
      </header>

      <main>
        <section>
          <UploadPanel onUploaded={refresh} />
        </section>

        <section>
          <h2>Dataset Catalog</h2>
          <DatasetCatalog datasets={datasets} onSelect={setSelectedId} selectedId={selectedId} />
        </section>

        {selectedId && (
          <section>
            <h2>Dataset Detail</h2>
            <DatasetDetail datasetId={selectedId} />
          </section>
        )}

        <section>
          <h2>Semantic Matches Across Datasets</h2>
          <p className="section-hint">
            Entities recognized as the same business concept despite different naming (Stage 3 embeddings).
          </p>
          <SemanticMatches key={matchesKey} />
        </section>

        <section>
          <h2>Enterprise Context Model</h2>
          <p className="section-hint">
            Knowledge graph connecting datasets and business entities (Stage 4) — e.g. General Ledger → Cost Center →
            Business Unit → Application → Cloud Resource.
          </p>
          <ContextGraph />
        </section>

        <section>
          <h2>Data Quality & TBM Readiness</h2>
          <p className="section-hint">
            Standardization engine analyzing data quality, detecting issues, proposing corrections, and calculating TBM
            readiness scores (Stage 5).
          </p>
          <DataQualityDashboard />
        </section>

        <section>
          <h2>ATUM Mapping</h2>
          <p className="section-hint">Explainable mapping to the official TBM Taxonomy v5.0.1 with confidence scoring and consultant review.</p>
          <AtumMappingDashboard />
        </section>

        <section>
          <h2>TBM Data Model Export</h2>
          <p className="section-hint">
            Generate Apptio-ready TBM data model exports with cost centers, applications, vendors, and cloud resources (Stage 7).
          </p>
          <TbmExportDashboard />
        </section>

        <section>
          <h2>AI Assistant</h2>
          <p className="section-hint">
            Ask questions about your data, ATUM mappings, quality issues, and get recommendations (Stage 8).
          </p>
          <AiAssistant />
        </section>

        <section>
          <h2>Analytics Dashboard</h2>
          <p className="section-hint">
            Platform-wide analytics: data quality metrics, ATUM coverage, and dataset health overview (Stage 9).
          </p>
          <AnalyticsDashboard />
        </section>
      </main>
    </div>
  );
}
