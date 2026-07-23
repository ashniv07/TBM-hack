import { ColumnProfile, IngestionState } from "../state";

const ID_LIKE_PATTERN = /(^id$|_id$|uuid|guid|surrogate)/i;

function inferType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "unknown";

  const isDate = nonNull.every((v) => !isNaN(Date.parse(String(v))) && String(v).length >= 8);
  if (isDate) return "date";

  const isNumber = nonNull.every((v) => typeof v === "number" || (!isNaN(Number(v)) && String(v).trim() !== ""));
  if (isNumber) return "number";

  return "string";
}

export async function profileDatasetNode(state: IngestionState): Promise<Partial<IngestionState>> {
  if (!state.sheet) return { error: "No sheet data to profile" };
  const { headers, rows } = state.sheet;

  const profile: ColumnProfile[] = headers.map((header, ordinal) => {
    const values = rows.map((r) => r[header]);
    const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
    const distinctValues = new Set(values.map((v) => JSON.stringify(v)));
    const inferredType = inferType(values);

    const distinctCount = distinctValues.size;
    const isCandidateKey =
      distinctCount === rows.length && rows.length > 0 && (ID_LIKE_PATTERN.test(header) || distinctCount === rows.length);

    return {
      column_name: header,
      ordinal,
      inferred_type: inferredType,
      null_pct: rows.length ? Number((nullCount / rows.length).toFixed(4)) : 0,
      distinct_count: distinctCount,
      sample_values: Array.from(distinctValues)
        .slice(0, 5)
        .map((v) => JSON.parse(v)),
      is_candidate_key: isCandidateKey,
    };
  });

  return { profile };
}
