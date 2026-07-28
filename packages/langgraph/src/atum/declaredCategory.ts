import { AtumLayer, AtumTaxonomyItem, DatasetColumn } from "@tbm/db";

/**
 * Some source workbooks state their ATUM classification outright. Measured
 * against the bundled sample set, 153 of 171 distinct declared values (89.5%)
 * match a real taxonomy entry on exact normalized comparison:
 *
 *   IT Resource Tower      37/39
 *   IT Resource Sub-Tower  52/61
 *   Cost Pool              25/29
 *   Cost Sub Pool          39/42
 *
 * Reading that beats inferring it — it is exact, free, and explainable. The
 * ~10% that miss ("Other", "LAN/WAN", "Platform", ...) fall through to the
 * existing embedding + lexical + rule retrieval in mapToAtum.ts, which is where
 * the AI path still earns its place: 12 of 19 sample workbooks declare nothing.
 *
 * The mapping's *anchor* column is deliberately unchanged by any of this — it
 * stays the embeddable-role column, so the Stage 4 alias join in
 * getApprovedAtumMappingsForGraph() still resolves and the approved mapping
 * still becomes a maps_to_atum edge.
 */

// Per layer, the columns that may state the answer, most specific first.
// Stage 6's `solution` layer has no declared equivalent in this data.
const DECLARED_COLUMNS: Record<AtumLayer, RegExp[]> = {
  resource_tower: [/^it resource sub-?tower$/i, /^it resource tower$/i],
  cost_pool: [/^cost sub-? ?pool$/i, /^cost pool$/i],
  solution: [],
};

export function normalizeTaxonomyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findDeclaredColumn(columns: DatasetColumn[], layer: AtumLayer): DatasetColumn | null {
  for (const pattern of DECLARED_COLUMNS[layer]) {
    const match = columns.find((column) => pattern.test(column.column_name.trim()));
    if (match) return match;
  }
  return null;
}

/**
 * Normalized value -> taxonomy item, indexed at all three levels so a declared
 * value resolves whatever depth it was written at. Deepest level wins the key,
 * which is what makes the observed level mismatches resolve correctly: Labor's
 * `Cost Pool` column contains "Internal Labor", which is a *sub*-pool, and
 * still lands on the right entry.
 *
 * Where several entries share a key (many sub-towers sit under one tower), the
 * shallowest entry wins, so a declared tower maps to the tower rather than to
 * an arbitrary one of its children.
 */
export function buildDeclaredCategoryIndex(items: AtumTaxonomyItem[]): Map<string, AtumTaxonomyItem> {
  const index = new Map<string, AtumTaxonomyItem>();
  const depth = (item: AtumTaxonomyItem) => (item.level_3 ? 3 : item.level_2 ? 2 : 1);

  for (const level of [3, 2, 1] as const) {
    for (const item of items) {
      const value = level === 3 ? item.level_3 : level === 2 ? item.level_2 : item.level_1;
      if (!value) continue;
      const key = normalizeTaxonomyKey(value);
      if (!key) continue;
      const existing = index.get(key);
      // A deeper level already claimed this key, or an equally-specific but
      // shallower entry is a better representative of it.
      if (existing && (existing.level_3 ? 3 : existing.level_2 ? 2 : 1) !== level) continue;
      if (!existing || depth(item) < depth(existing)) index.set(key, item);
    }
  }
  return index;
}
