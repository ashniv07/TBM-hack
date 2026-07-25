import path from "path";
import { getDataset, getEmbeddableColumns, recordRun, updateDatasetStatus, upsertEntityEmbedding } from "@tbm/db";
import { embedTexts } from "./embedText";
import { readWorkbookRows } from "../shared/readWorkbookRows";
import { partitionPairedIdColumns } from "../shared/pairedIdColumns";
import { EmbeddingState } from "./state";

// Bounds embedding API cost/latency for a high-cardinality column. Still a
// huge improvement over the previous behavior (which was capped at whatever
// 5 values Stage 1's profiling happened to sample), without risking an
// unbounded embedding bill on a column that turns out to have thousands of
// distinct values.
const MAX_DISTINCT_VALUES_PER_COLUMN = 500;

async function getFullDistinctValuesByColumn(
  datasetId: string,
  columns: { id: string; column_name: string }[],
  uploadsDir?: string
): Promise<Map<string, string[]> | null> {
  const dataset = await getDataset(datasetId);
  if (!dataset) return null;

  const candidatePaths = [dataset.storage_path];
  if (uploadsDir) {
    candidatePaths.push(path.join(uploadsDir, path.basename(dataset.storage_path)));
  }

  let rows: Record<string, unknown>[] | null = null;
  for (const candidate of candidatePaths) {
    try {
      rows = (await readWorkbookRows(candidate)).rows;
      break;
    } catch {
      // try next candidate path, or fall through to null below
    }
  }
  if (!rows) return null;

  const byColumn = new Map<string, string[]>();
  for (const col of columns) {
    const distinct = new Set<string>();
    for (const row of rows) {
      if (distinct.size >= MAX_DISTINCT_VALUES_PER_COLUMN) break;
      const raw = row[col.column_name];
      if (typeof raw === "string" && raw.trim()) distinct.add(raw.trim());
    }
    byColumn.set(col.id, Array.from(distinct));
  }
  return byColumn;
}

export async function embedEntitiesNode(state: EmbeddingState): Promise<Partial<EmbeddingState>> {
  await recordRun(state.datasetId, "embedding", "running");
  await updateDatasetStatus(state.datasetId, "embedding");

  // Suppress ID-style siblings of a Name column for the same business role
  // (e.g. skip embedding "Vendor ID" when "Vendor Name" exists in the same
  // dataset) — the Name column already represents the real entity, so the
  // ID would otherwise become its own set of meaningless duplicate entities.
  const { embeddable: columns } = partitionPairedIdColumns(await getEmbeddableColumns(state.datasetId));

  // Prefer re-reading the source file for full column cardinality; fall back
  // to the 5-value profiling sample (Stage 1) only if the file can't be read
  // (e.g. moved/deleted, or genuinely unreachable from this machine).
  const fullValuesByColumn = await getFullDistinctValuesByColumn(state.datasetId, columns, state.uploadsDir);

  const pairs: { columnId: string; value: string }[] = [];
  for (const col of columns) {
    const values =
      fullValuesByColumn?.get(col.id) ??
      (col.sample_values ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    for (const value of new Set(values)) {
      pairs.push({ columnId: col.id, value });
    }
  }

  if (pairs.length === 0) {
    await updateDatasetStatus(state.datasetId, "embedded");
    await recordRun(state.datasetId, "embedding", "succeeded");
    return { embeddedCount: 0 };
  }

  const { vectors, source } = await embedTexts(pairs.map((p) => p.value));

  for (let i = 0; i < pairs.length; i++) {
    await upsertEntityEmbedding({
      datasetId: state.datasetId,
      columnId: pairs[i].columnId,
      entityValue: pairs[i].value,
      embedding: vectors[i],
      embeddingSource: source,
    });
  }

  await updateDatasetStatus(state.datasetId, "embedded");
  await recordRun(state.datasetId, "embedding", "succeeded");

  return { embeddedCount: pairs.length };
}
