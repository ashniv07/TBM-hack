import { DatasetColumn, getDataset, getDatasetColumns } from "@tbm/db";
import { ColumnClassification, UnderstandingState } from "./state";

// Fixed semantic taxonomy the platform reasons about. Entity-like roles are the
// ones Stage 3 will embed for cross-dataset similarity matching.
export const SEMANTIC_ROLES = [
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
  "person",
  "cost_amount",
  "identifier",
  "date",
  "description",
  "other",
] as const;

const TECHNICAL_NAME_PATTERN = /(^id$|_id$|uuid|guid|surrogate|_key$|^key$|row_hash|etl_)/i;
const TIMESTAMP_NAME_PATTERN = /(created_at|updated_at|_ts$|timestamp|load_date|etl_date)/i;
const UUID_VALUE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only strips whitespace/underscore/hyphen (common word-separator variants),
// so "Vendor Name" / "VendorName" / "vendor_name" all normalize identically —
// but NOT all punctuation. Stripping everything (including "+") previously
// collapsed "Cost Center Name" and "Cost Center + Name" to the same key,
// silently force-classifying a derived, concatenated display column
// ("Apps - Mfg & Dist (CC-210)") as its own cost_center entity, duplicating
// every real cost center in the graph.
function normalizeForRoleOverride(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, "");
}

// Deterministic column-name -> role overrides, checked AFTER classification
// (LLM or heuristic) and applied unconditionally, overriding whatever role
// was guessed. This exists because the LLM is not reliable enough on its
// own for business-critical roles: it has been observed live to classify
// "Vendor Name" and "Manufacturer" as "description"/"other" on some runs,
// which silently drops real vendor entities (Microsoft, SAP, EMC, ...) from
// the Stage 4 graph. Matched against the normalized (lowercased,
// punctuation/whitespace-stripped) column name so "Vendor Name", "VendorName",
// and "vendor_name" all match the same key. Exact-match (not substring regex)
// on purpose, to avoid false positives like "Vendor Contact Email" being
// forced to role "vendor".
const DETERMINISTIC_ROLE_OVERRIDES: Record<string, (typeof SEMANTIC_ROLES)[number]> = {
  // Vendor / supplier
  vendorname: "vendor",
  vendor: "vendor",
  vendorid: "vendor",
  supplier: "vendor",
  suppliername: "vendor",
  supplierid: "vendor",
  manufacturer: "vendor",

  // Cost center
  costcenter: "cost_center",
  costcentre: "cost_center",
  costcentername: "cost_center",

  // Business unit
  businessunit: "business_unit",
  bu: "business_unit",
  buname: "business_unit",

  // Department
  department: "department",
  departmentname: "department",
  departmentdescription: "department",

  // Application
  application: "application",
  applicationname: "application",
  app: "application",
  appconsumer: "application",

  // Cloud provider
  cloudprovider: "cloud_provider",
  cloudvendor: "cloud_provider",
  csp: "cloud_provider",

  // Infrastructure asset
  storagedeviceid: "infrastructure_asset",
  serverid: "infrastructure_asset",
  assetid: "infrastructure_asset",

  // Project
  projectid: "project",
  projectname: "project",

  // Person / metadata — kept out of EMBEDDABLE_ROLES, so forcing this role
  // guarantees these never become graph nodes regardless of LLM opinion.
  owner: "person",
  costcenterowner: "person",
  manager: "person",
  contact: "person",
  contactname: "person",
  createdby: "person",
  updatedby: "person",

  // Transactional identifiers — technical, excluded from the graph the same way.
  journalid: "identifier",
  voucherid: "identifier",
  invoicenumber: "identifier",
  ponumber: "identifier",
};

// The sample workbooks are Apptio *templates*, so roughly a quarter of every
// file (272 of 1,133 column instances across the 19 samples) is scaffolding
// rather than business data: join keys ("Server_App Key", "Vendor_ITRT Key
// Metafield"), the template's own QA helpers ("Validity_Cost Center",
// "Completeness_Total"), benchmark reference values, Excel lookup columns, and
// UID/OID metafields.
//
// These must be forced technical rather than left to the classifier. The
// heuristic TECHNICAL_NAME_PATTERN above only runs when there is no LLM, and
// its `_key$` does not match "Server_App Key" anyway (space, not underscore).
// With a key configured the LLM decides, and it does not flag them — which is
// how ~24% of columns ended up in canonical schemas and produced hundreds of
// meaningless "type mismatch" issues.
//
// Real client extracts will not follow the template exactly, so this is a
// filter, not a schema: anything that does not match is still classified
// normally, and a file missing these columns entirely is unaffected.
const TEMPLATE_SCAFFOLDING_PATTERNS: RegExp[] = [
  /(^|[ _])key( metafield)?$/i,   // Server_App Key, Vendor_ITRT Key Metafield
  /metafield/i,                   // UID Metafield, OID Metafield
  /benchmark/i,                   // Benchmark Amount / Cost Pool / Tower — reference, not actuals
  /^data dimensions_/i,           // Data Dimensions_Duplicate Count
  /^(uid|oid)$/i,
  /^(validity|completeness)_/i,   // the template's own data-quality helper columns
  /lookup$/i,                     // Service Name Lookup, Instance Type Lookup
  /^source table$/i,
];

export function isTemplateScaffolding(columnName: string): boolean {
  const name = columnName.trim();
  return TEMPLATE_SCAFFOLDING_PATTERNS.some((pattern) => pattern.test(name));
}

// A "+" in a column name (e.g. "Cost Center + Name") is a strong, low-false-
// positive signal that the column is a derived/concatenated display label
// built from other, more atomic columns that are already classified (and
// embedded) on their own — e.g. "Cost Center Name" and "Cost Center" already
// capture the real entity. Embedding the concatenation too would just
// duplicate every real entity under a second, differently-formatted name.
const CONCATENATED_COLUMN_PATTERN = /\+/;

export function applyDeterministicRoleOverrides(classifications: ColumnClassification[]): ColumnClassification[] {
  return classifications.map((c) => {
    // Checked first: scaffolding is technical no matter what it is named after
    // ("Benchmark Cost Pool" must not become a cost_center entity).
    if (isTemplateScaffolding(c.columnName)) {
      return { ...c, semanticRole: "identifier", semanticRoleConfidence: 1, isTechnical: true };
    }
    if (CONCATENATED_COLUMN_PATTERN.test(c.columnName)) {
      return { ...c, semanticRole: "description", semanticRoleConfidence: 1, isTechnical: false };
    }
    const override = DETERMINISTIC_ROLE_OVERRIDES[normalizeForRoleOverride(c.columnName)];
    if (!override) return c;
    return {
      ...c,
      semanticRole: override,
      semanticRoleConfidence: 1,
      isTechnical: override === "identifier",
    };
  });
}

const KEYWORD_ROLE_MAP: [RegExp, (typeof SEMANTIC_ROLES)[number]][] = [
  [/vendor|supplier/i, "vendor"],
  [/application|app_name|app_id/i, "application"],
  [/service_name|service/i, "service"],
  [/business_unit|bu_name|bu_code/i, "business_unit"],
  [/department|dept/i, "department"],
  [/cost_center|costcenter|cc_code/i, "cost_center"],
  [/resource|instance|ec2|compute/i, "cloud_resource"],
  [/owner|manager|employee_name|contact_name|approver/i, "person"],
  [/debit|credit|amount|cost|price|spend/i, "cost_amount"],
  [/date|_dt$/i, "date"],
  [/description|desc$/i, "description"],
  [/(^|_)(account|number|code|name)$/i, "identifier"],
];

function heuristicClassifyColumn(col: DatasetColumn): ColumnClassification {
  const isUuidTechnical =
    TECHNICAL_NAME_PATTERN.test(col.column_name) ||
    (col.sample_values ?? []).every((v) => typeof v === "string" && UUID_VALUE_PATTERN.test(v));
  const isTimestampTechnical = TIMESTAMP_NAME_PATTERN.test(col.column_name);
  const isTechnical = isUuidTechnical || isTimestampTechnical;

  if (isTechnical) {
    return {
      columnId: col.id,
      columnName: col.column_name,
      semanticRole: "identifier",
      semanticRoleConfidence: 0.9,
      isTechnical: true,
    };
  }

  for (const [pattern, role] of KEYWORD_ROLE_MAP) {
    if (pattern.test(col.column_name)) {
      return { columnId: col.id, columnName: col.column_name, semanticRole: role, semanticRoleConfidence: 0.65, isTechnical: false };
    }
  }

  return { columnId: col.id, columnName: col.column_name, semanticRole: "other", semanticRoleConfidence: 0.3, isTechnical: false };
}

async function llmClassify(
  sourceType: string | null,
  columns: DatasetColumn[]
): Promise<{ businessPurpose: string; classifications: ColumnClassification[] } | null> {
  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

    const prompt = `You are analyzing an enterprise dataset for a TBM (Technology Business Management) platform.
Dataset classified as: ${sourceType ?? "Unknown"}

Columns (name, inferred type, sample values):
${columns.map((c) => `- ${c.column_name} (${c.inferred_type}): ${JSON.stringify(c.sample_values)}`).join("\n")}

Task:
1. Write a one-sentence business_purpose describing what this dataset is used for.
2. For EACH column, classify its semantic_role using ONLY one of these values:
   ${SEMANTIC_ROLES.join(", ")}
3. Mark is_technical=true for surrogate keys, UUIDs, row hashes, ETL timestamps, or other columns
   with no business meaning to a TBM consultant.

Respond ONLY with JSON in this exact shape:
{
  "business_purpose": "...",
  "columns": [
    { "column_name": "...", "semantic_role": "...", "confidence": 0.0, "is_technical": false }
  ]
}`;

    const response = await model.invoke(prompt);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const byName = new Map(columns.map((c) => [c.column_name, c]));
    const classifications: ColumnClassification[] = (parsed.columns ?? [])
      .filter((c: any) => byName.has(c.column_name))
      .map((c: any) => {
        const col = byName.get(c.column_name)!;
        return {
          columnId: col.id,
          columnName: col.column_name,
          semanticRole: SEMANTIC_ROLES.includes(c.semantic_role) ? c.semantic_role : "other",
          semanticRoleConfidence: typeof c.confidence === "number" ? c.confidence : 0.5,
          isTechnical: Boolean(c.is_technical),
        };
      });

    // Any column the LLM missed still gets a heuristic fallback classification.
    for (const col of columns) {
      if (!classifications.find((c) => c.columnId === col.id)) {
        classifications.push(heuristicClassifyColumn(col));
      }
    }

    return { businessPurpose: parsed.business_purpose ?? "Unknown", classifications };
  } catch {
    return null;
  }
}

export async function classifyColumnsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  const dataset = await getDataset(state.datasetId);
  if (!dataset) return { error: "Dataset not found" };

  const columns = await getDatasetColumns(state.datasetId);
  if (columns.length === 0) return { error: "Dataset has no profiled columns" };

  if (process.env.OPENAI_API_KEY) {
    const llmResult = await llmClassify(dataset.source_type, columns);
    if (llmResult) {
      return {
        businessPurpose: llmResult.businessPurpose,
        classifications: applyDeterministicRoleOverrides(llmResult.classifications),
      };
    }
  }

  return {
    businessPurpose: `${dataset.source_type ?? "Enterprise"} dataset with ${columns.length} columns (heuristic classification, no LLM available).`,
    classifications: applyDeterministicRoleOverrides(columns.map(heuristicClassifyColumn)),
  };
}
