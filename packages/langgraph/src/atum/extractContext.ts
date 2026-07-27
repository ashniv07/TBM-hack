import path from "path";
import fs from "fs";
import { AtumLayer, DatasetColumn, getDatasetColumns, listDatasets } from "@tbm/db";
import { readWorkbookRows } from "../shared/readWorkbookRows";

export interface ContextualMappingInput {
  datasetId: string;
  columnId: string;
  sourceValue: string;
  contextText: string;
  context: Record<string, string | number>;
  occurrences: number;
}

const MAX_CONTEXTS_PER_DATASET = 150;
const COMMON_COLUMN_HINT = /(description|product|service|application|app|vendor|supplier|manufacturer|account|resource|asset|device|platform|technology|category|type|project)/i;

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

function displayPriority(column: DatasetColumn): number {
  const roleOrder: Record<string, number> = { description: 0, service: 1, application: 2, cloud_resource: 3, infrastructure_asset: 4, vendor: 5 };
  if (/description|product|service|application|resource|asset|device/i.test(column.column_name)) return -1;
  return roleOrder[column.semantic_role ?? ""] ?? 10;
}

export async function extractContextualMappingInputs(options: {
  layer: AtumLayer;
  uploadsDir?: string;
}): Promise<{ inputs: ContextualMappingInput[]; skippedDatasets: string[] }> {
  const datasets = await listDatasets();
  const inputs: ContextualMappingInput[] = [];
  const skippedDatasets: string[] = [];

  for (const dataset of datasets) {
    const columns = (await getDatasetColumns(dataset.id)).filter((column) => isUsefulColumn(column, options.layer));
    if (columns.length === 0) continue;
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
      } catch { /* handled as a skipped dataset below */ }
    }

    let rows: Record<string, unknown>[] | null = null;
    for (const candidate of candidatePaths) {
      try { rows = (await readWorkbookRows(candidate)).rows; break; } catch { /* try the local upload fallback */ }
    }
    if (!rows) { skippedDatasets.push(dataset.file_name); continue; }

    const sortedColumns = [...columns].sort((a, b) => displayPriority(a) - displayPriority(b));
    const grouped = new Map<string, ContextualMappingInput>();
    for (const row of rows) {
      const values = sortedColumns
        .map((column) => ({ column, value: cellText(row[column.column_name]) }))
        .filter((entry) => entry.value && entry.value.length <= 500);
      if (values.length === 0) continue;

      const context = Object.fromEntries(values.map(({ column, value }) => [column.column_name, value]));
      const contextText = [
        dataset.source_type ? `Dataset type: ${dataset.source_type}` : "",
        dataset.business_purpose ? `Purpose: ${dataset.business_purpose}` : "",
        ...values.map(({ column, value }) => `${column.column_name}: ${value}`),
      ].filter(Boolean).join(". ");
      const primary = values[0];
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
      });
      if (grouped.size >= MAX_CONTEXTS_PER_DATASET) break;
    }
    inputs.push(...grouped.values());
  }
  return { inputs, skippedDatasets };
}
