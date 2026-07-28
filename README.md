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

### Stage 4 — Enterprise Context Model *(implemented)*
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

### Stage 5 — Data Trust & Standardization Engine *(implemented)*
The platform standardizes and validates enterprise data across all datasets.

**Canonical Schema Derivation:**
- Analyzes all datasets grouped by source type
- Derives canonical schemas based on semantic role frequency
- Marks columns as "required" if present in 80%+ of datasets of that type

**Quality Issue Detection:**
- `missing_value` — High null percentage (>50%)
- `duplicate` — Duplicate rows based on key columns
- `invalid_reference` — Entity not found in knowledge graph
- `invalid_currency` — Invalid ISO 4217 currency codes
- `invalid_date` — Unparseable date formats
- `outlier` — Values >3 standard deviations from mean
- `schema_mismatch` — Column type differs from canonical schema

**AI-Powered Corrections:**
- GPT-4o-mini generates correction suggestions (with heuristic fallback)
- Approval workflow: `pending` → `approved` → `applied`
- Safe mode: Creates new corrected file, never modifies original
- Supported corrections: date normalization, currency standardization, entity matching, whitespace trimming

**TBM Readiness Scoring:**
- Four dimensions weighted:
  - Completeness (25%): Required columns present vs canonical schema
  - Validity (30%): % values passing validation
  - Consistency (25%): Cross-dataset reference integrity
  - Uniqueness (20%): Duplicate ratio
- Generates prioritized recommendations per dataset

The platform generates:
- Data Quality Report with issue breakdown
- TBM Readiness Score per dataset
- Recommended Corrections with confidence scores

### Stage 6 — AI-Assisted ATUM Mapping *(implemented)*
Using the Enterprise Context Model, embeddings, Retrieval-Augmented Generation (RAG), the ATUM Knowledge Base, and business rules, the platform automatically maps client-specific terminology into standardized ATUM categories.

**Taxonomy knowledge base:** the official `TBM-Taxonomy-v5.0.1-Data-Table.xlsx`
is imported once into `atum_taxonomy_items` (three layers — Cost Pools,
Resource Towers, Technology Solutions) and each category is embedded, so
retrieval is semantic rather than keyword-only.

**Declared columns short-circuit retrieval.** Some workbooks state their own
classification (`IT Resource Tower`, `IT Resource Sub-Tower`, `Cost Pool`,
`Cost Sub Pool`). Measured against the bundled sample set, 153 of 171 distinct
declared values (89.5%) match a real taxonomy entry on exact normalized
comparison, so those are resolved deterministically — `method:
"declared_column"`, confidence 1.0, auto-approved, no embedding and no vector
search. The ~10% that miss ("Other", "LAN/WAN", "Platform") fall through to the
retrieval path below, as do the 12 of 19 workbooks that declare nothing. The
mapping's *anchor* column is unchanged either way, so the Stage 4 alias join
still resolves and approved mappings still become graph edges.

**Retrieval + scoring (the RAG loop):** each candidate's context text is
embedded and used to pull the 20 nearest taxonomy categories via pgvector.
Those candidates are then re-ranked by a blended score —
`0.6 × vector similarity + 0.2 × lexical overlap + 0.2 × deterministic rule`
— and, optionally, an LLM picks from the top 5 *retrieved* categories only
(it cannot invent one). Below 0.35 the candidate is stored as `unresolved`
rather than guessed at; at or above 0.85 it is auto-approved.

**How it links to Stages 3 and 4:** each row's mapping is keyed on one
*anchor column*. Stage 3 embeds only `EMBEDDABLE_ROLES` columns, so only those
have a `context_entity_aliases` row — which means an embeddable-role column
always outranks a free-text hint column when choosing the anchor
(`displayPriority`). Free-text columns still feed the context text used for
retrieval; they just cannot anchor. The anchor value is resolved against
Stage 4 up front, so every mapping carries the canonical entity it belongs to
and approved mappings become `maps_to_atum` edges in the knowledge graph.

If a dataset's source file is missing, the distinct values Stage 3 already
persisted in `entity_embeddings` are used instead of skipping the dataset.

Generated output includes Tower / Sub-Tower / Service Domain, a confidence
score, explainable reasoning, supporting evidence (vector similarity, lexical
score, matched rule, occurrence count, and the resolved graph entity), and
ranked alternatives. Low-confidence mappings are routed to consultants for
review, and approve / reject / override each update the knowledge graph.

**Implemented with TBM Taxonomy v5.0.1:**
- Imports the official Cost Pool, Technology Resource Tower, and Technology Solution worksheets
- Excludes retired taxonomy entries from candidate retrieval while retaining them for auditability
- Builds deduplicated row context from vendor, description, application, account, product, resource, and asset fields
- Retrieves only real taxonomy categories with pgvector; the model cannot invent category names
- Combines embedding similarity, lexical evidence, semantic role, and optional GPT-4o-mini selection
- Auto-approves mappings at 85%+ confidence and routes lower-confidence suggestions for review
- Supports approve, reject, and manual override actions with reviewer timestamps
- Stores alternatives, evidence, method, confidence, and taxonomy version for every result

### Stage 7 — TBM Data Model Generation *(implemented)*
The validated and standardized datasets are transformed into an Apptio-ready TBM data model. Relationships between cost centers, business units, applications, cloud resources, vendors, and financial transactions are preserved, enabling accurate financial modeling within IBM Apptio.

**Derived, never stored.** There is no Stage 7 table and no "generate" step to
re-run: the model is assembled on request from what Stages 4-6 already
persisted (context graph, approved/overridden ATUM mappings, readiness
scores), so the export can never disagree with the graph it describes.

**What the model contains:**
- **Business objects** — every Stage 4 canonical entity, minus the platform's
  own modelling nodes (`dataset`, `attribute_group`, `atum_category`). Each
  object carries its ATUM Cost Pool / Resource Tower / Technology Solution
  (one classification per layer, highest confidence wins), mapping confidence,
  resolution confidence, and the source datasets that evidenced it.
- **Relationships** — dataset↔dataset `foreign_key` lineage plus labeled
  entity↔entity business links (`USES_VENDOR`, `HOSTED_BY`, ...). Internal
  `contains_reference` and `maps_to_atum` edges are dropped: the first is
  already expressed as each object's source-dataset list, the second as its
  ATUM columns.
- **Source datasets** — file, source type, row count, readiness score, issue
  counts, and a `tbmReady` flag (readiness ≥ 0.7).
- **Warnings** — unallocated objects, datasets below the readiness threshold,
  and a missing graph or missing relationships, so a consultant sees the
  blockers before loading anything into Apptio.

- **Cost facts** — the fact table Apptio actually allocates. Amounts never
  reach Postgres (Stage 1 persists column statistics only, and Stage 3
  deliberately excludes `cost_amount` from `EMBEDDABLE_ROLES`), so Stage 7
  re-reads the source workbooks, the same way Stages 4 and 6 already do, and
  aggregates by cost centre x account x cost pool x tower x vendor x period.
  Seven of the 19 sample workbooks carry an amount column; `Cost_Source`
  alone totals ~$15.1M across 1,177 GL lines.

**Export:** `GET /api/tbm/export.xlsx` produces an Apptio-shaped workbook —
`Model Summary`, one object table per entity type (`Vendors`,
`Applications`, `Cost Centers`, ...), `Relationships`, `Cost Facts`, and
`Source Datasets`.
The UI's **TBM Data Model** panel previews the same model and links the
download.

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

### Starting from a clean database

One command does the whole thing — build, drop, re-migrate, then load every
sample workbook through Stages 1-6 and map all three ATUM layers:

```bash
npm run db:refresh      # DESTRUCTIVE: wipes the database and reloads it end to end
```

The individual steps, if you need them separately:

```bash
npm run db:reset        # DESTRUCTIVE: drops every table in the public schema,
                        # then re-applies all migrations from scratch.
                        # The pgvector/pgcrypto extensions are preserved.
npm run db:seed         # copies all 19 sample workbooks from
                        # packages/langgraph/data into the uploads dir, then
                        # runs Stages 1-3 per workbook, then Stages 4, 5 and 6.
                        # Defaults to the resource_tower layer only; add
                        # -- --layers=cost_pool,resource_tower,solution for all three.
```

`db:refresh` maps all three ATUM layers because a partial reload is what
produces a near-empty Stage 7 export — with only `resource_tower` mapped,
every object's Cost Pool and Solution column comes out blank.

Both take a while — every distinct business value is re-embedded through the
OpenAI embeddings API, and one sample workbook is ~52MB. Expect `db:refresh`
to run for several minutes.

### Run

```bash
npm run dev:api          # starts the API on http://localhost:4000
npm run dev:web          # starts the React app on http://localhost:5173 (proxies /api → 4000)
```

Open http://localhost:5173, drag in one or more `.xlsx` files. Each upload automatically runs
through ingestion → understanding → embedding, and results appear in the Dataset Catalog, the
per-dataset detail view (columns, semantic roles, discovered relationships), and the Semantic
Matches panel.

### Using Stage 6 — ATUM Mapping

1. Complete Stages 1-5 and rebuild the Enterprise Context Model.
2. Open **ATUM Mapping** and click **Import Taxonomy** once. This imports
   `packages/langgraph/data/TBM-Taxonomy-v5.0.1-Data-Table.xlsx`.
3. Select Resource Towers, Cost Pools, or Technology Solutions.
4. Click **Run ATUM Mapping**.
5. Review suggested and unresolved mappings; approve, reject, or override them with an official category.

With `OPENAI_API_KEY`, GPT-4o-mini chooses only among the five retrieved official categories. Without a key,
the pipeline remains functional using deterministic embeddings and keyword scoring, but semantic accuracy is limited.

### Using Stage 5 — Data Quality & Standardization

After uploading datasets and running Stages 1-4:

1. Scroll to **"Data Quality & TBM Readiness"** section
2. Click **"Run Data Quality Analysis"** to analyze all datasets
3. Review the four tabs:
   - **Overview**: Summary cards, issues by type/severity, datasets needing attention
   - **Issues**: Detected quality problems with status workflow (Open → Acknowledged → Resolved)
   - **Corrections**: AI-proposed fixes with approval workflow
   - **Readiness**: TBM readiness scores per dataset with 4-dimension breakdown

4. To apply corrections:
   - Review proposed corrections in the Corrections tab
   - Approve corrections individually or use bulk approve
   - Click **"Apply All Approved Corrections"**
   - A new corrected file is created (original file is never modified)
   - View summary of changes applied

### API Endpoints

**Stages 1-4:**
- `POST /api/datasets/upload` — Batch Excel upload (runs Stages 1-3)
- `POST /api/context/rebuild` — Rebuild knowledge graph (Stage 4)
- `GET /api/context/graph` — Fetch full knowledge graph
- `GET /api/entities/matches` — Semantic entity matches

**Stage 5 — Standardization:**
- `POST /api/standardization/run` — Run full Stage 5 pipeline
- `GET /api/standardization/schemas` — List canonical schemas
- `GET /api/standardization/issues` — List quality issues (filterable)
- `PATCH /api/standardization/issues/:id/status` — Update issue status
- `GET /api/standardization/corrections` — List corrections (filterable)
- `POST /api/standardization/corrections/:id/approve` — Approve correction
- `POST /api/standardization/corrections/:id/reject` — Reject correction
- `POST /api/standardization/corrections/bulk-approve` — Batch approve
- `POST /api/standardization/apply/:datasetId` — Apply corrections to dataset (safe mode)
- `POST /api/standardization/apply-all` — Apply all approved corrections
- `GET /api/standardization/readiness` — List all readiness scores
- `GET /api/standardization/readiness/:datasetId` — Single dataset score
- `GET /api/standardization/report` — Full data quality report

**Stage 6 — ATUM Mapping:**
- `POST /api/atum/taxonomy/import` — Import + embed the official TBM Taxonomy v5.0.1
- `GET /api/atum/taxonomy?layer=` — List taxonomy categories for a layer
- `POST /api/atum/run` — Run mapping for a layer (`{ layer, useLlm }`), then sync approved edges to the graph
- `GET /api/atum/mappings?layer=&status=&datasetId=` — List mappings
- `POST /api/atum/mappings/:id/approve` — Approve; creates the `maps_to_atum` edge
- `POST /api/atum/mappings/:id/reject` — Reject; removes the edge
- `POST /api/atum/mappings/:id/override` — Override the category; re-points the edge
- `POST /api/atum/sync-graph` — Re-materialise approved mappings as graph edges
- `GET /api/atum/report` — Coverage, average confidence, counts by status and tower

**Stage 7 — TBM Data Model:**
- `GET /api/tbm/model` — The full Apptio-ready model as JSON (objects, relationships, source datasets, summary, warnings)
- `GET /api/tbm/export.xlsx` — The same model as a multi-sheet Apptio-shaped workbook
