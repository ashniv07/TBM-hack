// Column-name similarity: exact match = 1, substring containment = 0.65, else 0.
// Shared by Stage 2 relationship detection and Stage 4 structural key discovery
// so both stages judge "is this the same column" identically.
export function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.65;
  return 0;
}
