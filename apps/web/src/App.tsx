import { useEffect, useState } from "react";
import { Dataset, fetchDatasets } from "./api";
import { UploadPanel } from "./components/UploadPanel";
import { DatasetCatalog } from "./components/DatasetCatalog";
import { DatasetDetail } from "./components/DatasetDetail";
import { SemanticMatches } from "./components/SemanticMatches";
import { ContextGraph } from "./components/ContextGraph";
import { DataQualityDashboard } from "./components/DataQualityDashboard";

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
        <p className="subtitle">Stages 1-5 — Ingestion · Understanding · Embeddings · Knowledge Graph · Data Quality</p>
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
      </main>
    </div>
  );
}
