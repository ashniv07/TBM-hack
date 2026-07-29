import path from "path";
import fs from "fs";
import {
  AtumLayer,
  DatasetColumn,
  getAtumMappingInputs,
  getContextEntityAliasMap,
  getDatasetColumns,
  listDatasets,
} from "@tbm/db";
import { readWorkbookRows } from "../shared/readWorkbookRows";
import { findDeclaredColumn } from "./declaredCategory";

export interface ContextualMappingInput {
  datasetId: string;
  columnId: string;
  sourceValue: string;
  contextText: string;
  context: Record<string, string | number>;
  occurrences: number;
  /** Stage 4 entity this value resolved to, when the anchor column was embedded. */
  contextEntityId?: string;
  canonicalEntityName?: string;
  /**
   * The row's own stated classification for this layer (an `IT Resource Tower`
   * or `Cost Pool` cell), when the dataset has such a column. Taken from the
   * first row that produced this mapping — one business entity carries one
   * tower in practice. mapToAtum resolves it against the taxonomy and skips
   * retrieval entirely on a hit.
   */
  declaredValue?: string;
}

const MAX_CONTEXTS_PER_DATASET = 150;

// Per the client: only two ATUM layers are standardisable, and each is fed by
// specific files. Technology Solutions is deliberately absent — it varies by
// organisation and cannot be automated.
//
//   Cost Pool      <- Chart of Accounts (Account -> Cost Pool / Cost Sub Pool)
//   Resource Tower <- Labor, Fixed Assets (depreciation), Vendors (by vendor
//                     function), and the department / cost-centre hierarchy
//
// Without this gate every dataset was mapped, which is how applications ended
// up classified as Resource Tower "Storage" — an application consumes a tower,
// it is not one. Matched against dataset.source_type.
const LAYER_SOURCE_TYPES: Record<AtumLayer, RegExp[]> = {
  cost_pool: [/^chart of accounts$/i],
  resource_tower: [
    /^labor master$/i,
    /^fixed asset register$/i,
    /^vendor master$/i,
    /cost cent(er|re) master|department hierarchy/i, // not yet supplied by the client
  ],
  solution: [],
};

export function isLayerSource(sourceType: string | null, layer: AtumLayer): boolean {
  if (!sourceType) return false;
  return LAYER_SOURCE_TYPES[layer].some((pattern) => pattern.test(sourceType.trim()));
}
const COMMON_COLUMN_HINT = /(description|product|service|application|app|vendor|supplier|manufacturer|account|resource|asset|device|platform|technology|category|type|project)/i;

// Anchor preference among embeddable roles. MUST stay a permutation of
// EMBEDDABLE_ROLES in packages/db/src/repository.ts — anchorRoles.test.ts
// enforces that, because a role missing here silently loses its graph edge.
const ANCHOR_ROLE_ORDER = [
  "service",
  "application",
  "cloud_resource",
  "infrastructure_asset",
  "vendor",
  "cloud_provider",
  "project",
  "business_unit",
  "department",
  "cost_center",
] as const;

const NOT_AN_ANCHOR = 100;

function isUsefulColumn(column: DatasetColumn, layer: AtumLayer): boolean {
  if (column.is_technical) return false;
  const role = column.semantic_role ?? "";
  const byLayer: Record<AtumLayer, Set<string>> = {
    resource_tower: new Set(["description", "vendor", "application", "service", "cloud_resource", "cloud_provider", "infrastructure_asset", "project"]),
    cost_pool: new Set(["description", "vendor", "service", "cloud_provider"]),
    solution: new Set(["description", "application", "service", "project", "business_unit", "department"]),
  };
  return byLayer[layer].has(role) || COMMON_COLUMN_HINT.test(column.column_name);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

/**
 * Rank for choosing the row's anchor column — the column the mapping is keyed
 * on. Stage 3 embeds only EMBEDDABLE_ROLES columns, so only those ever get a
 * `context_entity_aliases` row. If a free-text hint column (description,
 * product, ...) were allowed to anchor, `getApprovedAtumMappingsForGraph()`
 * would find nothing to join and the approved mapping would never become a
 * graph edge — with no error and no log. So an embeddable-role column always
 * outranks a free-text one. Free-text columns still feed `contextText` for
 * scoring signal; they just cannot anchor.
 */
export function displayPriority(column: DatasetColumn): number {
  const rank = ANCHOR_ROLE_ORDER.indexOf((column.semantic_role ?? "") as typeof ANCHOR_ROLE_ORDER[number]);
  return rank >= 0 ? rank : NOT_AN_ANCHOR;
}

export async function extractContextualMappingInputs(options: {
  layer: AtumLayer;
  uploadsDir?: string;
}): Promise<{ inputs: ContextualMappingInput[]; skippedDatasets: string[]; fallbackDatasets: string[] }> {
  const datasets = await listDatasets();
  const aliasMap = await getContextEntityAliasMap();
  const inputs: ContextualMappingInput[] = [];
  const skippedDatasets: string[] = [];
  const fallbackDatasets: string[] = [];

  // Stage 3 already persisted distinct values per embeddable column. Loaded
  // lazily and only used for datasets whose source file we cannot read.
  let embeddedFallback: Map<string, { column_id: string; source_value: string }[]> | null = null;
  async function fallbackRowsFor(datasetId: string) {
    if (!embeddedFallback) {
      const grouped = new Map<string, { column_id: string; source_value: string }[]>();
      for (const row of await getAtumMappingInputs()) {
        const list = grouped.get(row.dataset_id) ?? [];
        list.push({ column_id: row.column_id, source_value: row.source_value });
        grouped.set(row.dataset_id, list);
      }
      embeddedFallback = grouped;
    }
    return embeddedFallback.get(datasetId) ?? [];
  }

  function resolveEntity(columnId: string, value: string) {
    return aliasMap.get(`${columnId}::${value.toLowerCase()}`);
  }

  for (const dataset of datasets) {
    // Skip datasets this layer is not fed by, rather than mapping everything
    // and relying on a confidence threshold to discard the nonsense.
    if (!isLayerSource(dataset.source_type, options.layer)) continue;
    const allColumns = await getDatasetColumns(dataset.id);
    const columns = allColumns.filter((column) => isUsefulColumn(column, options.layer));
    if (columns.length === 0) continue;
    // Searched over every column, not the filtered set: "Cost Pool" carries no
    // hint keyword and would otherwise be dropped before it could be read.
    const declaredColumn = findDeclaredColumn(allColumns, options.layer);
    const candidatePaths = [dataset.storage_path];
    if (options.uploadsDir) {
      candidatePaths.push(path.join(options.uploadsDir, path.basename(dataset.storage_path)));
      // A shared database may contain the timestamped storage path produced
      // on a teammate's machine. Find this machine's timestamped copy by the
      // stable original filename instead of requiring that random prefix to match.
      try {
        const localMatch = fs.readdirSync(options.uploadsDir).find((name) =>
          name === dataset.file_name || name.endsWith(`-${dataset.file_name}`)
        );
        if (localMatch) candidatePaths.push(path.join(options.uploadsDir, localMatch));
      } catch { /* handled by the embedding fallback below */ }
    }

    let rows: Record<string, unknown>[] | null = null;
    for (const candidate of candidatePaths) {
      try { rows = (await readWorkbookRows(candidate)).rows; break; } catch { /* try the local upload fallback */ }
    }

    if (!rows) {
      // The file moved or was written by another machine. Stage 3's distinct
      // values are already in Postgres, so map those instead of dropping the
      // whole dataset — less context per value, but still a real mapping.
      const columnsById = new Map(columns.map((column) => [column.id, column]));
      const fallback = (await fallbackRowsFor(dataset.id)).filter((row) => columnsById.has(row.column_id));
      if (fallback.length === 0) { skippedDatasets.push(dataset.file_name); continue; }
      fallbackDatasets.push(dataset.file_name);
      for (const row of fallback.slice(0, MAX_CONTEXTS_PER_DATASET)) {
        const column = columnsById.get(row.column_id)!;
        const resolved = resolveEntity(column.id, row.source_value);
        inputs.push({
          datasetId: dataset.id,
          columnId: column.id,
          sourceValue: row.source_value,
          contextText: [
            dataset.source_type ? `Dataset type: ${dataset.source_type}` : "",
            dataset.business_purpose ? `Purpose: ${dataset.business_purpose}` : "",
            `${column.column_name}: ${row.source_value}`,
            resolved ? `Canonical entity: ${resolved.canonicalName}` : "",
          ].filter(Boolean).join(". "),
          context: { [column.column_name]: row.source_value },
          occurrences: 1,
          contextEntityId: resolved?.contextEntityId,
          canonicalEntityName: resolved?.canonicalName,
        });
      }
      continue;
    }

    const sortedColumns = [...columns].sort((a, b) => displayPriority(a) - displayPriority(b));
    const grouped = new Map<string, ContextualMappingInput>();
    for (const row of rows) {
      const values = sortedColumns
        .map((column) => ({ column, value: cellText(row[column.column_name]) }))
        .filter((entry) => entry.value && entry.value.length <= 500);
      if (values.length === 0) continue;

      const context = Object.fromEntries(values.map(({ column, value }) => [column.column_name, value]));
      const primary = values[0];
      const declaredValue = declaredColumn ? cellText(row[declaredColumn.column_name]) : "";
      const resolved = resolveEntity(primary.column.id, primary.value);
      const contextText = [
        dataset.source_type ? `Dataset type: ${dataset.source_type}` : "",
        dataset.business_purpose ? `Purpose: ${dataset.business_purpose}` : "",
        ...values.map(({ column, value }) => `${column.column_name}: ${value}`),
        // The Stage 4 canonical name folds every alias of this entity into the
        // retrieval text, so "AWS EC2" and "Elastic Compute" retrieve alike.
        resolved ? `Canonical entity: ${resolved.canonicalName}` : "",
      ].filter(Boolean).join(". ");
      // One mapping per business value and anchor column. Repeated rows become
      // evidence rather than conflicting mappings for the same value.
      const key = `${primary.column.id}::${primary.value.toLowerCase()}`;
      const existing = grouped.get(key);
      if (existing) { existing.occurrences++; continue; }
      grouped.set(key, {
        datasetId: dataset.id,
        columnId: primary.column.id,
        sourceValue: primary.value,
        contextText,
        context,
        occurrences: 1,
        contextEntityId: resolved?.contextEntityId,
        canonicalEntityName: resolved?.canonicalName,
        declaredValue: declaredValue || undefined,
      });
      if (grouped.size >= MAX_CONTEXTS_PER_DATASET) break;
    }
    inputs.push(...grouped.values());
  }
  return { inputs, skippedDatasets, fallbackDatasets };
}
