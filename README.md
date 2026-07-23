# TBM Data Trust & Intelligence Platform

An AI-powered preprocessing layer that sits in front of IBM Apptio TBM. Instead of treating
uploaded enterprise datasets (GL, ERP, cloud billing, CMDB, HR, cost centers, etc.) as isolated
tables, the platform first understands their business meaning, discovers relationships between
them, builds an Enterprise Context Model, validates and standardizes the data, and then performs
AI-assisted, explainable ATUM mapping — so only trusted, TBM-ready data reaches Apptio.

This repo currently implements **Layer 1: Enterprise Data Ingestion (Excel)**, the foundation the
rest of the pipeline (semantic understanding, embeddings, knowledge graph, trust/standardization,
ATUM mapping, TBM model generation, AI assistant, dashboards) builds on.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         React Frontend (TS)                         │
│  Upload UI · Dataset Catalog · Schema Viewer · Review Queue · Chat   │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ REST
┌───────────────────────────────▼─────────────────────────────────────┐
│                    API Layer (Node + Express, TS)                   │
│         Auth · Multipart upload handling · Route → graph triggers    │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │
┌───────────────────────────────▼─────────────────────────────────────┐
│                LangGraph Orchestration Layer (TS)                   │
│  StateGraph per pipeline stage: Ingestion → Understanding →          │
│  Embedding → Context Model → Trust/Standardize → ATUM Mapping →      │
│  TBM Model Generation. Nodes are LLM calls, deterministic            │
│  transforms, or human-in-the-loop checkpoints.                       │
└───────┬──────────────────────────┬───────────────────────┬──────────┘
        │                          │                       │
┌───────▼────────┐      ┌──────────▼─────────┐   ┌─────────▼─────────┐
│   Postgres      │      │  Vector DB          │   │ Object Storage    │
│  datasets,       │      │ (Qdrant/Weaviate/   │   │ raw uploaded       │
│  columns,        │      │  Chroma — TBD)      │   │ Excel files        │
│  relationships,  │      │ entity + column     │   └───────────────────┘
│  quality_issues, │      │ embeddings          │
│  atum_mappings   │      └─────────────────────┘
└──────────────────┘
```

**Why Postgres + a separate vector store:** all relational/queryable state (dataset metadata,
column profiles, discovered relationships, quality issues, ATUM mappings, audit trail) lives in
Postgres, where dashboards and the knowledge graph edges can be queried directly with SQL. Only
embeddings (for semantic similarity — e.g. recognizing "Amazon EC2" / "AWS EC2" / "Elastic
Compute" as the same concept) go into a dedicated vector store, since that access pattern (ANN
search) doesn't fit relational tables well.

## Monorepo layout

```
apps/
  api/            Express API — upload endpoint, dataset catalog endpoints
  web/             React (Vite) — upload UI, dataset catalog, column-level detail view
packages/
  db/              Postgres schema (SQL migrations), typed client, repository functions
  langgraph/       LangGraph StateGraph(s) — currently: the Layer 1 ingestion graph
```

## Layer 1: Ingestion workflow

```
User selects one or more Excel files in the React UI
        │
        ▼
POST /api/datasets/upload  (multipart, batched with a concurrency cap of 3)
        │
        ▼
Per file → Ingestion StateGraph run (packages/langgraph/src/graphs/ingestionGraph.ts)
        │
        ├─ parseExcel        → reads the first worksheet via exceljs (headers + rows)
        ├─ profileDataset    → per-column type inference, null %, distinct count,
        │                       sample values, candidate-key detection
        ├─ inferSourceType   → classifies the dataset (GL / ERP / AWS Billing / CMDB / ...).
        │                       Uses an LLM when OPENAI_API_KEY is set; otherwise falls back
        │                       to keyword heuristics so the pipeline runs with zero config.
        └─ persist           → writes to Postgres: datasets, dataset_columns, ingestion_runs
        │
        ▼
Dataset appears in the React catalog with status "profiled", source-type + confidence badge,
and a drill-down column view (type, null %, distinct count, sample values, candidate keys).
```

Each uploaded file runs through its own graph invocation; the API fans batches out with a
concurrency cap rather than running everything serially or unbounded in parallel (keeps LLM rate
limits and memory use in check for large multi-file uploads).

Stage 2 (semantic understanding — column-level business meaning, PK/FK detection across datasets,
canonical schema generation) is intentionally a **separate** graph that will run after ingestion
completes, so ingestion stays fast and the LLM-heavier understanding step can run async with
progress streamed to the UI.

## Data model (Layer 1)

```sql
datasets          -- one row per uploaded file: file_name, source_type (+confidence),
                   -- status, storage_path, row_count, uploaded_by/at
dataset_columns   -- one row per column per dataset: inferred_type, null_pct, distinct_count,
                   -- sample_values, is_candidate_key, semantic_role (filled in Stage 2)
ingestion_runs    -- audit trail per pipeline stage per dataset: status, error, timestamps
```

`semantic_role` / `semantic_role_confidence` on `dataset_columns` and `source_type` on `datasets`
are left nullable now and populated by the Stage 2 (Understanding) graph later, without a schema
migration.

## Getting started

### Prerequisites
- Node.js 20+
- A running Postgres instance

### Setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL; OPENAI_API_KEY is optional
npm run build           # builds packages/db and packages/langgraph
npm run db:migrate      # applies packages/db/migrations
```

### Run

```bash
npm run dev:api          # starts the API on http://localhost:4000
npm run dev:web          # starts the React app on http://localhost:5173 (proxies /api → 4000)
```

Open http://localhost:5173, drag in one or more `.xlsx` files, and watch them land in the
Dataset Catalog with inferred source type, row/column counts, and a per-column profile.

## Roadmap (next layers)

1. **Stage 2 — Understanding graph**: column semantic-role classification, primary/foreign key
   detection across datasets, canonical schema generation.
2. **Stage 3 — Embeddings**: entity/column embeddings into the vector store for cross-dataset
   semantic matching.
3. **Stage 4 — Enterprise Context Model**: relationship/knowledge-graph tables in Postgres linking
   GL → Cost Center → Business Unit → Application → Cloud Resource → Invoice.
4. **Stage 5 — Trust & Standardization**: rule-based + AI-recommended data quality fixes, TBM
   Readiness Score.
5. **Stage 6 — ATUM Mapping**: RAG over an ATUM knowledge base, confidence-scored mappings with
   explainable reasoning, human review queue for low-confidence cases.
6. **Stages 7-9**: TBM data model generation, AI assistant (chat over the Context Model), and the
   analytics dashboard.
