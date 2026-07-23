import { getDatasetColumns, getOtherDatasetColumns } from "@tbm/db";
import { RelationshipCandidate, UnderstandingState } from "./state";

const SKIP_ROLES = new Set(["cost_amount", "description", "other"]);
const CONFIDENCE_THRESHOLD = 0.4;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.65;
  return 0;
}

function valueOverlap(a: unknown[] | null, b: unknown[] | null): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((v) => String(v).toLowerCase().trim()));
  const setB = new Set(b.map((v) => String(v).toLowerCase().trim()));
  let intersection = 0;
  for (const v of setA) if (setB.has(v)) intersection++;
  return intersection / Math.min(setA.size, setB.size);
}

export async function detectRelationshipsNode(state: UnderstandingState): Promise<Partial<UnderstandingState>> {
  const [currentColumns, otherColumns] = await Promise.all([
    getDatasetColumns(state.datasetId),
    getOtherDatasetColumns(state.datasetId),
  ]);

  const candidates: RelationshipCandidate[] = [];

  for (const current of currentColumns) {
    if (current.is_technical || (current.semantic_role && SKIP_ROLES.has(current.semantic_role))) continue;

    for (const other of otherColumns) {
      if (other.is_technical || (other.semantic_role && SKIP_ROLES.has(other.semantic_role))) continue;

      const nameScore = nameSimilarity(current.column_name, other.column_name);
      const valueScore = valueOverlap(current.sample_values, other.sample_values);
      const sameRole = current.semantic_role && current.semantic_role === other.semantic_role ? 0.2 : 0;
      const confidence = Math.min(0.5 * nameScore + 0.4 * valueScore + sameRole, 0.98);

      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const relationshipType = valueScore >= 0.5 ? "candidate_key_match" : "semantic_match";
      const reasons: string[] = [];
      if (nameScore > 0) reasons.push(`column names "${current.column_name}" / "${other.column_name}" are similar`);
      if (valueScore > 0) reasons.push(`${Math.round(valueScore * 100)}% overlap in sample values`);
      if (sameRole > 0) reasons.push(`both classified as "${current.semantic_role}"`);

      candidates.push({
        fromColumnId: current.id,
        toColumnId: other.id,
        relationshipType,
        confidence: Number(confidence.toFixed(2)),
        reasoning: reasons.join("; ") || "Heuristic match",
      });
    }
  }

  return { relationships: candidates };
}
