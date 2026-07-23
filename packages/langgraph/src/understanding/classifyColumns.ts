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
  "cost_amount",
  "identifier",
  "date",
  "description",
  "other",
] as const;

const TECHNICAL_NAME_PATTERN = /(^id$|_id$|uuid|guid|surrogate|_key$|^key$|row_hash|etl_)/i;
const TIMESTAMP_NAME_PATTERN = /(created_at|updated_at|_ts$|timestamp|load_date|etl_date)/i;
const UUID_VALUE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KEYWORD_ROLE_MAP: [RegExp, (typeof SEMANTIC_ROLES)[number]][] = [
  [/vendor|supplier/i, "vendor"],
  [/application|app_name|app_id/i, "application"],
  [/service_name|service/i, "service"],
  [/business_unit|bu_name|bu_code/i, "business_unit"],
  [/department|dept/i, "department"],
  [/cost_center|costcenter|cc_code/i, "cost_center"],
  [/resource|instance|ec2|compute/i, "cloud_resource"],
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
      return { businessPurpose: llmResult.businessPurpose, classifications: llmResult.classifications };
    }
  }

  return {
    businessPurpose: `${dataset.source_type ?? "Enterprise"} dataset with ${columns.length} columns (heuristic classification, no LLM available).`,
    classifications: columns.map(heuristicClassifyColumn),
  };
}
