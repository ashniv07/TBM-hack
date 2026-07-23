# TBM Data Trust & Intelligence Platform

An AI-powered preprocessing layer that sits in front of IBM Apptio TBM. Instead of treating
uploaded enterprise datasets (GL, ERP, cloud billing, CMDB, HR, cost centers, etc.) as isolated
tables, the platform first understands their business meaning, discovers relationships between
them, builds an Enterprise Context Model, validates and standardizes the data, and then performs
AI-assisted, explainable ATUM mapping — so only trusted, TBM-ready data reaches Apptio.

## End-to-End Workflow

### Stage 1 — Enterprise Data Ingestion *(implemented)*
The platform accepts structured and semi-structured enterprise datasets from multiple sources.

Supported sources include:
- General Ledger (GL)
- ERP
- AWS Billing
- Azure Billing
- GCP Billing
- CMDB
- Cost Center Master
- Application Inventory
- HR Systems
- Business Unit Mapping
- CSV
- Excel
- APIs
- SQL Databases

Each dataset is profiled to extract metadata, schema information, and representative sample records.

### Stage 2 — Intelligent Data Understanding *(implemented)*
Rather than immediately cleaning the data, the platform first understands it.

AI automatically:
- Classifies each uploaded file.
- Identifies the business purpose of every dataset.
- Understands the semantic meaning of columns.
- Detects primary and foreign keys.
- Discovers relationships between datasets.
- Filters out irrelevant technical columns such as UUIDs, timestamps, and surrogate IDs.
- Generates a canonical enterprise schema.

This stage creates a semantic understanding of enterprise data instead of relying solely on column names.

### Stage 3 — Semantic Representation *(implemented)*
Business entities are converted into embeddings.

Examples include:
- Applications
- Services
- Vendors
- Business Units
- Departments
- Cost Centers
- Cloud Resources

Embeddings allow the platform to identify semantically similar entities across different systems, even when naming conventions differ.

Example: `Amazon EC2`, `AWS EC2`, `Elastic Compute` are recognized as representing the same business concept.

### Stage 4 — Enterprise Context Model
Using the discovered relationships and semantic similarity, the platform builds an Enterprise Context Model (Knowledge Graph).

Instead of isolated tables, the system understands connected business entities.

```
General Ledger
      ↓
Cost Center
      ↓
Business Unit
      ↓
Application
      ↓
Cloud Resource
      ↓
Invoice
```

This contextual understanding enables more accurate reasoning throughout the pipeline.

### Stage 5 — Data Trust & Standardization Engine
The platform standardizes and validates enterprise data.

Capabilities include:
- **Schema Standardization** — column normalization, canonical schema generation
- **Value Standardization** — vendor names, service names, department names, cost center names
- **Data Cleaning** — missing values, duplicate records, invalid references, orphan records, inconsistent hierarchies, invalid currencies, invalid dates, outlier detection

AI recommends possible fixes for detected issues.

The platform generates:
- Data Quality Report
- TBM Readiness Score
- Recommended Corrections

### Stage 6 — AI-Assisted ATUM Mapping
Using the Enterprise Context Model, embeddings, Retrieval-Augmented Generation (RAG), the ATUM Knowledge Base, and business rules, the platform automatically maps client-specific terminology into standardized ATUM categories.

Generated output includes:
- Tower
- Sub-Tower
- Service Domain
- Confidence Score
- Explainable Reasoning
- Supporting Evidence

Low-confidence mappings are routed to consultants for review.

### Stage 7 — TBM Data Model Generation
The validated and standardized datasets are transformed into an Apptio-ready TBM data model. Relationships between cost centers, business units, applications, cloud resources, vendors, and financial transactions are preserved, enabling accurate financial modeling within IBM Apptio.

### Stage 8 — AI Assistant
An AI assistant enables consultants and business users to interact with the platform using natural language.

Example queries include:
- Why was this mapped to Cloud Compute?
- Which datasets contain quality issues?
- Why is the readiness score low?
- Show unmapped services.
- Explain this allocation.
- Recommend fixes.

The assistant leverages the Enterprise Context Model, historical mappings, and RAG to provide explainable responses.

### Stage 9 — Analytics Dashboard
The platform provides interactive dashboards for:
- **Data Quality** — TBM Readiness Score, missing values, duplicate records, relationship quality, mapping coverage
- **Financial Insights** — cost by tower, business unit, application, cloud provider
- **Trend Analysis** — month-over-month spending, cost spikes, outlier detection, new service identification
- **AI Insights** — mapping confidence, high-risk datasets, recommended fixes, explainability reports

## Steps to Run

### Prerequisites
- Node.js 20+
- A Postgres database (Supabase recommended — Stage 3 uses its built-in `pgvector` extension for embeddings)

### Setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL (use the Supabase connection pooler URI, not the direct host)
                        # OPENAI_API_KEY enables LLM classification/understanding/embeddings;
                        # without it, Stage 1-2 fall back to heuristics
npm run build           # builds packages/db and packages/langgraph
npm run db:migrate      # applies packages/db/migrations
```

### Run

```bash
npm run dev:api          # starts the API on http://localhost:4000
npm run dev:web          # starts the React app on http://localhost:5173 (proxies /api → 4000)
```

Open http://localhost:5173, drag in one or more `.xlsx` files. Each upload automatically runs
through ingestion → understanding → embedding, and results appear in the Dataset Catalog, the
per-dataset detail view (columns, semantic roles, discovered relationships), and the Semantic
Matches panel.
