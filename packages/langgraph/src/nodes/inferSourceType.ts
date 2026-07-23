import { IngestionState } from "../state";

const KNOWN_SOURCE_TYPES = [
  "General Ledger",
  "ERP",
  "AWS Billing",
  "Azure Billing",
  "GCP Billing",
  "CMDB",
  "Cost Center Master",
  "Application Inventory",
  "HR Systems",
  "Business Unit Mapping",
  "Unknown",
] as const;

const KEYWORD_HINTS: Record<string, string[]> = {
  "General Ledger": ["gl_account", "ledger", "journal", "debit", "credit"],
  ERP: ["po_number", "purchase_order", "vendor_id", "erp"],
  "AWS Billing": ["aws", "ec2", "s3", "usagetype", "linkedaccountid"],
  "Azure Billing": ["azure", "subscriptionid", "resourcegroup"],
  "GCP Billing": ["gcp", "project_id", "sku_id", "billing_account"],
  CMDB: ["cmdb", "configuration_item", "ci_id", "asset_tag"],
  "Cost Center Master": ["cost_center", "costcenter", "cc_code"],
  "Application Inventory": ["application_name", "app_id", "app_owner"],
  "HR Systems": ["employee_id", "hire_date", "department", "manager_id"],
  "Business Unit Mapping": ["business_unit", "bu_code", "bu_name"],
};

function heuristicClassify(headers: string[]): { sourceType: string; confidence: number } {
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  let bestMatch = { sourceType: "Unknown", score: 0 };

  for (const [sourceType, keywords] of Object.entries(KEYWORD_HINTS)) {
    const score = keywords.filter((kw) => normalized.some((h) => h.includes(kw))).length;
    if (score > bestMatch.score) {
      bestMatch = { sourceType, score };
    }
  }

  const confidence = bestMatch.score === 0 ? 0.2 : Math.min(0.5 + bestMatch.score * 0.15, 0.95);
  return { sourceType: bestMatch.sourceType, confidence };
}

/**
 * Uses an LLM to classify source type when OPENAI_API_KEY is set; otherwise
 * falls back to keyword heuristics so the pipeline runs without a key.
 */
export async function inferSourceTypeNode(state: IngestionState): Promise<Partial<IngestionState>> {
  if (!state.sheet) return { error: "No sheet data to classify" };
  const { headers, rows } = state.sheet;

  if (!process.env.OPENAI_API_KEY) {
    const { sourceType, confidence } = heuristicClassify(headers);
    return { sourceType, sourceTypeConfidence: confidence };
  }

  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

    const sample = rows.slice(0, 5);
    const prompt = `You are classifying an uploaded enterprise dataset for a TBM (Technology Business Management) platform.
Given the column headers and sample rows, classify the dataset into exactly one of:
${KNOWN_SOURCE_TYPES.join(", ")}

Headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sample)}

Respond ONLY with JSON: {"sourceType": "<one of the categories>", "confidence": <0-1 number>, "reasoning": "<one sentence>"}`;

    const response = await model.invoke(prompt);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      sourceType: parsed.sourceType ?? "Unknown",
      sourceTypeConfidence: parsed.confidence ?? 0.5,
    };
  } catch (err) {
    const { sourceType, confidence } = heuristicClassify(headers);
    return { sourceType, sourceTypeConfidence: confidence * 0.8 };
  }
}
