import { ChatOpenAI } from "@langchain/openai";
import { StandardizationState, DetectedIssue, ProposedCorrection } from "./state";

// Correction types mapped to issue types
const ISSUE_TO_CORRECTION: Record<string, string> = {
  invalid_date: "normalize_date",
  invalid_currency: "normalize_currency",
  invalid_reference: "fuzzy_match_entity",
  missing_value: "fill_missing",
  duplicate: "remove_duplicate",
};

// Currency code normalizations
const CURRENCY_NORMALIZATIONS: Record<string, string> = {
  "$": "USD",
  "dollar": "USD",
  "dollars": "USD",
  "us": "USD",
  "euro": "EUR",
  "euros": "EUR",
  "pound": "GBP",
  "pounds": "GBP",
  "yen": "JPY",
  "yuan": "CNY",
  "rupee": "INR",
  "rupees": "INR",
};

/**
 * Generates AI-proposed corrections for detected issues.
 * Uses GPT-4o-mini when available, falls back to heuristic corrections.
 */
export async function generateCorrectionsNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  if (state.error) return {};

  const corrections: ProposedCorrection[] = [];
  const issues = state.issues ?? [];

  // Check if OpenAI is available
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  for (const issue of issues) {
    const correctionType = ISSUE_TO_CORRECTION[issue.issueType];
    if (!correctionType) continue;

    // Skip issues that don't have sample values to correct
    if (!issue.sampleValues || issue.sampleValues.length === 0) {
      // For duplicates, we can still propose actions
      if (issue.issueType === "duplicate") {
        corrections.push({
          datasetId: issue.datasetId,
          columnId: issue.columnId,
          correctionType: "remove_duplicate",
          affectedRows: issue.affectedRows,
          confidence: 0.7,
          reasoning: "Duplicate rows should be reviewed and removed to ensure data integrity",
        });
      }
      // For missing values without samples, suggest fill action
      if (issue.issueType === "missing_value") {
        corrections.push({
          datasetId: issue.datasetId,
          columnId: issue.columnId,
          correctionType: "fill_missing",
          affectedRows: issue.affectedRows,
          confidence: 0.5,
          reasoning: "Missing values should be filled with appropriate defaults or removed",
        });
      }
      continue;
    }

    // Try AI-powered corrections for all supported issue types
    if (hasOpenAI) {
      const aiCorrections = await generateAICorrections(issue);
      if (aiCorrections.length > 0) {
        corrections.push(...aiCorrections);
      } else {
        // AI didn't produce corrections, fall back to heuristics
        const heuristicCorrections = generateHeuristicCorrections(issue);
        corrections.push(...heuristicCorrections);
      }
    } else {
      // No OpenAI, use heuristic corrections
      const heuristicCorrections = generateHeuristicCorrections(issue);
      corrections.push(...heuristicCorrections);
    }
  }

  return { corrections };
}

async function generateAICorrections(issue: DetectedIssue): Promise<ProposedCorrection[]> {
  const corrections: ProposedCorrection[] = [];

  try {
    const llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
    });

    const sampleValues = (issue.sampleValues ?? []).slice(0, 5);

    if (issue.issueType === "invalid_date") {
      const prompt = `You are a data quality assistant. For each of the following date values, provide the corrected ISO 8601 date format (YYYY-MM-DD).
If you cannot determine the correct date, respond with "UNKNOWN".

Values to correct:
${sampleValues.map((v, i) => `${i + 1}. "${v}"`).join("\n")}

Respond with only the corrections in JSON format:
{"corrections": [{"original": "value", "corrected": "YYYY-MM-DD or UNKNOWN", "confidence": 0.0-1.0}]}`;

      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const c of parsed.corrections || []) {
            if (c.corrected && c.corrected !== "UNKNOWN") {
              corrections.push({
                datasetId: issue.datasetId,
                columnId: issue.columnId,
                correctionType: "normalize_date",
                originalValue: c.original,
                correctedValue: c.corrected,
                confidence: c.confidence ?? 0.8,
                reasoning: `AI-suggested date normalization from "${c.original}" to ISO 8601 format`,
              });
            }
          }
        }
      } catch {
        // Failed to parse AI response, fall back to heuristics
        return generateHeuristicCorrections(issue);
      }
    } else if (issue.issueType === "invalid_reference") {
      const prompt = `You are a data quality assistant analyzing enterprise data. The following values were not found in the knowledge graph for ${issue.columnId ? "this column" : "the dataset"}.

Suggest possible corrections or canonical names these values might be referring to:

Values:
${sampleValues.map((v, i) => `${i + 1}. "${v}"`).join("\n")}

Consider common variations like:
- Typos or spelling errors
- Abbreviations vs full names
- Different naming conventions

Respond in JSON format:
{"corrections": [{"original": "value", "suggestion": "corrected value or null if unclear", "confidence": 0.0-1.0, "reasoning": "brief explanation"}]}`;

      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const c of parsed.corrections || []) {
            if (c.suggestion) {
              corrections.push({
                datasetId: issue.datasetId,
                columnId: issue.columnId,
                correctionType: "fuzzy_match_entity",
                originalValue: c.original,
                correctedValue: c.suggestion,
                confidence: c.confidence ?? 0.6,
                reasoning: c.reasoning || "AI-suggested entity name correction",
              });
            }
          }
        }
      } catch {
        // Failed to parse AI response, fall back to heuristics
        return generateHeuristicCorrections(issue);
      }
    } else if (issue.issueType === "invalid_currency") {
      const prompt = `You are a data quality assistant. For each of the following currency values, provide the correct ISO 4217 currency code (e.g., USD, EUR, GBP).
If you cannot determine the currency, respond with "UNKNOWN".

Values to correct:
${sampleValues.map((v, i) => `${i + 1}. "${v}"`).join("\n")}

Respond in JSON format:
{"corrections": [{"original": "value", "code": "ISO 4217 code or UNKNOWN", "confidence": 0.0-1.0}]}`;

      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const c of parsed.corrections || []) {
            if (c.code && c.code !== "UNKNOWN") {
              corrections.push({
                datasetId: issue.datasetId,
                columnId: issue.columnId,
                correctionType: "normalize_currency",
                originalValue: c.original,
                correctedValue: c.code.toUpperCase(),
                confidence: c.confidence ?? 0.85,
                reasoning: `AI-suggested currency normalization to ISO 4217 code`,
              });
            }
          }
        }
      } catch {
        return generateHeuristicCorrections(issue);
      }
    } else if (issue.issueType === "outlier") {
      // For outliers, AI can suggest whether to cap, remove, or keep with flag
      const prompt = `You are a data quality assistant analyzing numeric outliers. The following values are statistical outliers (>3 standard deviations from mean).

Issue: ${issue.title}
Description: ${issue.description}
Sample outlier values:
${sampleValues.map((v, i) => `${i + 1}. ${v}`).join("\n")}

For each value, suggest an action:
- "cap" - Replace with a reasonable boundary value
- "flag" - Keep but flag for review
- "remove" - Likely data entry error, remove

Respond in JSON format:
{"corrections": [{"original": "value", "action": "cap|flag|remove", "suggestedValue": "capped value if action is cap, null otherwise", "confidence": 0.0-1.0, "reasoning": "brief explanation"}]}`;

      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const c of parsed.corrections || []) {
            if (c.action === "cap" && c.suggestedValue) {
              corrections.push({
                datasetId: issue.datasetId,
                columnId: issue.columnId,
                correctionType: "normalize_outlier",
                originalValue: String(c.original),
                correctedValue: String(c.suggestedValue),
                confidence: c.confidence ?? 0.6,
                reasoning: c.reasoning || "AI-suggested outlier capping",
              });
            } else if (c.action === "remove") {
              corrections.push({
                datasetId: issue.datasetId,
                columnId: issue.columnId,
                correctionType: "remove_outlier",
                originalValue: String(c.original),
                confidence: c.confidence ?? 0.5,
                reasoning: c.reasoning || "AI-suggested outlier removal",
              });
            }
          }
        }
      } catch {
        // No heuristic fallback for outliers - requires human review
      }
    }
  } catch {
    // AI call failed, fall back to heuristics
    return generateHeuristicCorrections(issue);
  }

  return corrections;
}

function generateHeuristicCorrections(issue: DetectedIssue): ProposedCorrection[] {
  const corrections: ProposedCorrection[] = [];
  const sampleValues = (issue.sampleValues ?? []).slice(0, 10);

  if (issue.issueType === "invalid_date") {
    for (const value of sampleValues) {
      const strValue = String(value);
      const corrected = normalizeDateHeuristic(strValue);
      if (corrected) {
        corrections.push({
          datasetId: issue.datasetId,
          columnId: issue.columnId,
          correctionType: "normalize_date",
          originalValue: strValue,
          correctedValue: corrected,
          confidence: 0.7,
          reasoning: "Heuristic date format normalization to ISO 8601",
        });
      }
    }
  } else if (issue.issueType === "invalid_currency") {
    for (const value of sampleValues) {
      const strValue = String(value).toLowerCase().trim();
      const corrected = CURRENCY_NORMALIZATIONS[strValue];
      if (corrected) {
        corrections.push({
          datasetId: issue.datasetId,
          columnId: issue.columnId,
          correctionType: "normalize_currency",
          originalValue: String(value),
          correctedValue: corrected,
          confidence: 0.9,
          reasoning: "Currency code normalization to ISO 4217",
        });
      }
    }
  } else if (issue.issueType === "invalid_reference") {
    // For invalid references, suggest trimming whitespace as a basic fix
    for (const value of sampleValues) {
      const strValue = String(value);
      const trimmed = strValue.trim();
      if (trimmed !== strValue) {
        corrections.push({
          datasetId: issue.datasetId,
          columnId: issue.columnId,
          correctionType: "trim_whitespace",
          originalValue: strValue,
          correctedValue: trimmed,
          confidence: 0.95,
          reasoning: "Remove leading/trailing whitespace that may prevent entity matching",
        });
      }
    }
  }

  return corrections;
}

function normalizeDateHeuristic(value: string): string | null {
  // Try common date patterns
  const trimmed = value.trim();

  // MM/DD/YYYY or M/D/YYYY
  const usFormat = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usFormat) {
    const month = usFormat[1].padStart(2, "0");
    const day = usFormat[2].padStart(2, "0");
    return `${usFormat[3]}-${month}-${day}`;
  }

  // DD-MM-YYYY or DD.MM.YYYY
  const euFormat = trimmed.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
  if (euFormat) {
    const day = euFormat[1].padStart(2, "0");
    const month = euFormat[2].padStart(2, "0");
    return `${euFormat[3]}-${month}-${day}`;
  }

  // YYYY/MM/DD
  const isoSlash = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlash) {
    const month = isoSlash[2].padStart(2, "0");
    const day = isoSlash[3].padStart(2, "0");
    return `${isoSlash[1]}-${month}-${day}`;
  }

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
