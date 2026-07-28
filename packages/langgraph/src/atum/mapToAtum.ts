import {
  AtumLayer,
  AtumMappingInput,
  AtumTaxonomyItem,
  clearAtumMappingsForLayer,
  findNearestAtumItems,
  listAtumTaxonomyItems,
  upsertAtumMappings,
} from "@tbm/db";
import { TAXONOMY_VERSION } from "./importTaxonomy";
import { embedTexts } from "../embedding/embedText";
import { extractContextualMappingInputs } from "./extractContext";
import { buildDeclaredCategoryIndex, normalizeTaxonomyKey } from "./declaredCategory";

export interface AtumRunStats {
  candidates: number;
  mapped: number;
  autoMapped: number;
  needsReview: number;
  unresolved: number;
  layer: AtumLayer;
  taxonomyVersion: string;
  skippedDatasets: string[];
  /** Datasets mapped from Stage 3 embeddings because their source file was unreadable. */
  fallbackDatasets: string[];
  /** Candidates that resolved to a Stage 4 canonical entity (and so can reach the graph). */
  linkedToContext: number;
  /** Candidates classified straight from a declared column, with no embedding or retrieval. */
  declaredMapped: number;
  embeddingSource: string;
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "service", "services", "system", "data"]);

export function lexicalScore(source: string, category: Pick<AtumTaxonomyItem, "path" | "search_text">): number {
  const tokens = source.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  if (tokens.length === 0) return 0;
  const haystack = `${category.path} ${category.search_text}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

const RESOURCE_RULES: { pattern: RegExp; tower: RegExp; label: string }[] = [
  { pattern: /\b(server|virtual machine|\bvm\b|ec2|compute|mainframe)\b/i, tower: /compute/i, label: "compute technology" },
  { pattern: /\b(storage|san|nas|disk|backup|archive)\b/i, tower: /storage/i, label: "storage technology" },
  { pattern: /\b(router|switch|lan|wan|wifi|wireless|network|telecom)\b/i, tower: /network/i, label: "network technology" },
  { pattern: /\b(laptop|desktop|workstation|printer|mobile device|end user)\b/i, tower: /end.?user/i, label: "end-user technology" },
  { pattern: /\b(firewall|cyber|security|identity|iam|antivirus|vulnerability)\b/i, tower: /security|risk/i, label: "security technology" },
  { pattern: /\b(database|middleware|container|kubernetes|runtime|blockchain|ai model)\b/i, tower: /application|platform|data/i, label: "application/platform technology" },
  { pattern: /\b(data center|datacenter|cooling|colocation|facility)\b/i, tower: /data center/i, label: "data-center facility" },
  { pattern: /\b(service desk|help desk|itsm|monitoring|operations support)\b/i, tower: /delivery|management/i, label: "technology delivery activity" },
];

export function ruleBoost(context: string, category: Pick<AtumTaxonomyItem, "path">, layer: AtumLayer): { score: number; label?: string } {
  if (layer !== "resource_tower") return { score: 0 };
  for (const rule of RESOURCE_RULES) {
    if (rule.pattern.test(context) && rule.tower.test(category.path)) return { score: 1, label: rule.label };
  }
  return { score: 0 };
}

async function llmChoose(
  value: string,
  candidates: (AtumTaxonomyItem & { distance: number })[]
): Promise<{ categoryId: string; confidence: number; reasoning: string } | null> {
  if (!process.env.OPENAI_API_KEY || candidates.length === 0) return null;
  try {
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
    const choices = candidates.map((c, i) => `${i + 1}. ${c.path}: ${c.search_text.slice(0, 500)}`).join("\n");
    const response = await model.invoke(`Map the enterprise value to exactly one supplied TBM Taxonomy category.
Value: ${JSON.stringify(value)}
Allowed categories:\n${choices}
Do not invent a category. Return JSON only: {"choice":1,"confidence":0.0,"reasoning":"one sentence"}`);
    const content = typeof response.content === "string" ? response.content : "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const selected = candidates[Number(parsed.choice) - 1];
    if (!selected) return null;
    return {
      categoryId: selected.id,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || "AI selected the closest allowed taxonomy category."),
    };
  } catch {
    return null;
  }
}

export async function runAtumMapping(options?: { layer?: AtumLayer; useLlm?: boolean; uploadsDir?: string }): Promise<AtumRunStats> {
  const layer = options?.layer ?? "resource_tower";
  const extracted = await extractContextualMappingInputs({ layer, uploadsDir: options?.uploadsDir });
  const inputs = extracted.inputs;
  let mapped = 0, autoMapped = 0, needsReview = 0, unresolved = 0, declaredMapped = 0;

  await clearAtumMappingsForLayer(layer);
  let embeddingSource = "none";
  const writes: AtumMappingInput[] = [];

  function baseRow(input: (typeof inputs)[number]) {
    return {
      datasetId: input.datasetId, columnId: input.columnId, sourceValue: input.sourceValue,
      taxonomyVersion: TAXONOMY_VERSION, layer,
      sourceContext: { ...input.context, occurrences: input.occurrences, contextEntityId: input.contextEntityId ?? null },
    };
  }

  // ---- Pass 1: values the source workbook already classified ----
  // Exact match against the taxonomy, so there is nothing to embed, retrieve or
  // rank. These skip the OpenAI round-trip entirely, which is most of what a
  // mapping run used to cost on this data.
  const declaredIndex = buildDeclaredCategoryIndex(await listAtumTaxonomyItems({ layer }));
  const needsRetrieval: typeof inputs = [];
  for (const input of inputs) {
    const category = input.declaredValue ? declaredIndex.get(normalizeTaxonomyKey(input.declaredValue)) : undefined;
    if (!category) {
      needsRetrieval.push(input);
      continue;
    }
    mapped++; autoMapped++; declaredMapped++;
    writes.push({
      ...baseRow(input), categoryId: category.id, status: "approved", confidence: 1, method: "declared_column",
      reasoning: `The source dataset states this classification directly ("${input.declaredValue}"), matched to the official taxonomy entry ${category.path}${input.canonicalEntityName ? `, anchored on knowledge-graph entity "${input.canonicalEntityName}"` : ""}.`,
      evidence: {
        declaredValue: input.declaredValue, occurrences: input.occurrences,
        contextEntityId: input.contextEntityId ?? null, canonicalEntityName: input.canonicalEntityName ?? null,
      },
      alternatives: [],
    });
  }

  // ---- Pass 2: everything else goes through the existing RAG path ----
  const embeddedInputs: ((typeof needsRetrieval)[number] & { embedding: number[] })[] = [];
  for (let i = 0; i < needsRetrieval.length; i += 100) {
    const batch = needsRetrieval.slice(i, i + 100);
    const embedded = await embedTexts(batch.map((input) => input.contextText));
    embeddingSource = embedded.source;
    embeddedInputs.push(...batch.map((input, index) => ({ ...input, embedding: embedded.vectors[index] })));
  }

  async function mapInput(input: (typeof embeddedInputs)[number]): Promise<void> {
    // Retrieve broadly enough for deterministic rules to rescue a category
    // that pure semantic similarity did not place in the first five.
    const nearest = await findNearestAtumItems(input.embedding, layer, 20);
    const ranked = nearest.map((category) => {
      const semanticSimilarity = Math.max(0, 1 - Number(category.distance));
      const lexical = lexicalScore(input.contextText, category);
      const rule = ruleBoost(input.contextText, category, layer);
      const score = Number((semanticSimilarity * 0.6 + lexical * 0.2 + rule.score * 0.2).toFixed(3));
      return { category, semanticSimilarity, lexical, rule, score };
    }).sort((a, b) => b.score - a.score);

    const ai = options?.useLlm === true ? await llmChoose(input.contextText, ranked.slice(0, 5).map((r) => r.category)) : null;
    let best = ranked[0];
    if (ai) best = ranked.find((r) => r.category.id === ai.categoryId) ?? best;

    if (!best || best.score < 0.35) {
      unresolved++;
      writes.push({
        ...baseRow(input), status: "unresolved", confidence: best?.score ?? 0,
        method: "unresolved", reasoning: "No taxonomy candidate reached the minimum confidence threshold.",
        alternatives: ranked.map((r) => ({ categoryId: r.category.id, path: r.category.path, confidence: r.score })),
      });
      return;
    }

    const finalConfidence = ai ? Number((best.score * 0.65 + ai.confidence * 0.35).toFixed(3)) : best.score;
    const status = finalConfidence >= 0.85 ? "approved" : "suggested";
    mapped++;
    if (status === "approved") autoMapped++; else needsReview++;
    writes.push({
      ...baseRow(input), categoryId: best.category.id, status,
      confidence: finalConfidence, method: ai ? "hybrid_llm" : "hybrid",
      reasoning: ai?.reasoning ?? `Selected from contextual similarity (${Math.round(best.semanticSimilarity * 100)}%), keyword evidence (${Math.round(best.lexical * 100)}%)${best.rule.label ? `, and a ${best.rule.label} rule` : ""}${input.canonicalEntityName ? `, anchored on knowledge-graph entity "${input.canonicalEntityName}"` : ""}.`,
      evidence: {
        vectorSimilarity: best.semanticSimilarity, lexicalScore: best.lexical, rule: best.rule.label,
        occurrences: input.occurrences,
        // Stage 4 provenance: which canonical entity this mapping resolved to.
        // Absent means the mapping cannot become a maps_to_atum graph edge.
        contextEntityId: input.contextEntityId ?? null,
        canonicalEntityName: input.canonicalEntityName ?? null,
      },
      alternatives: ranked.slice(1).map((r) => ({ categoryId: r.category.id, path: r.category.path, confidence: r.score })),
    });
  }

  // Bound concurrency to the default pg pool size — each mapInput issues one
  // pgvector query. The writes they queue are flushed in batches below.
  for (let i = 0; i < embeddedInputs.length; i += 10) {
    await Promise.all(embeddedInputs.slice(i, i + 10).map(mapInput));
  }

  await upsertAtumMappings(writes);

  return { candidates: inputs.length, mapped, autoMapped, needsReview, unresolved, layer,
    taxonomyVersion: TAXONOMY_VERSION, skippedDatasets: extracted.skippedDatasets,
    fallbackDatasets: extracted.fallbackDatasets,
    linkedToContext: inputs.filter((input) => input.contextEntityId).length,
    declaredMapped, embeddingSource };
}
