import { IngestionState } from "../state";

const KNOWN_SOURCE_TYPES = [
  "General Ledger",
  "ERP",
  "AWS Billing",
  "Azure Billing",
  "GCP Billing",
  "Cloud Billing",
  "CMDB",
  "Cost Center Master",
  "Chart of Accounts",
  "Application Inventory",
  "Business Service Catalog",
  "HR Systems",
  "Business Unit Mapping",
  "Vendor Master",
  "Resource Tower Master",
  "Fixed Asset Register",
  "Labor Master",
  "Server Inventory",
  "Storage Inventory",
  "Network Inventory",
  "End User Device Inventory",
  "Data Center Inventory",
  "Project Portfolio",
  "ITSM Tickets",
  "Unknown",
] as const;

// Deterministic file-name -> source type, applied AFTER classification and
// overriding whatever the LLM or the keyword heuristic guessed. Same rationale
// as DETERMINISTIC_ROLE_OVERRIDES in understanding/classifyColumns.ts: the LLM
// is not reliable enough here, and it fails *confidently*. Observed live:
// Servers_Master_Data classified "AWS Billing" at 95% (one row's Server ID
// literally reads "Amazon Web Services, Inc. - Instance Hours"), and
// IT_Resource_Towers_Master_Data classified "Application Inventory" at 90%.
//
// This is not cosmetic. Stage 5 derives one canonical schema per source_type,
// so a wrong label pools unrelated datasets into a meaningless schema; and
// Stage 6 puts "Dataset type: <source_type>" into the text it embeds for
// taxonomy retrieval, so a wrong label actively steers the mapping.
//
// Matched against the lowercased file name, first hit wins — order matters:
// "storage_devices" must be tested before "storage".
const FILENAME_SOURCE_TYPES: [RegExp, (typeof KNOWN_SOURCE_TYPES)[number]][] = [
  [/it_resource_tower|resource_tower/i, "Resource Tower Master"],
  [/chart_of_accounts/i, "Chart of Accounts"],
  [/cost_source/i, "General Ledger"],
  [/fixed_asset/i, "Fixed Asset Register"],
  [/labor/i, "Labor Master"],
  [/vendor/i, "Vendor Master"],
  [/cloud_service_provider|csp_/i, "Cloud Billing"],
  [/storage_device/i, "CMDB"],
  [/storage/i, "Storage Inventory"],
  [/server|mainframe/i, "Server Inventory"],
  [/network_device/i, "Network Inventory"],
  [/end_user_device/i, "End User Device Inventory"],
  [/data_center/i, "Data Center Inventory"],
  [/project/i, "Project Portfolio"],
  [/ticket/i, "ITSM Tickets"],
  [/business_service/i, "Business Service Catalog"],
  [/application/i, "Application Inventory"],
  [/cost_center/i, "Cost Center Master"],
];

export function sourceTypeFromFileName(fileName: string): (typeof KNOWN_SOURCE_TYPES)[number] | null {
  for (const [pattern, sourceType] of FILENAME_SOURCE_TYPES) {
    if (pattern.test(fileName)) return sourceType;
  }
  return null;
}

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

  // A self-describing file name beats any inference, and skips an LLM call.
  const declared = sourceTypeFromFileName(state.fileName);
  if (declared) return { sourceType: declared, sourceTypeConfidence: 1 };

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
