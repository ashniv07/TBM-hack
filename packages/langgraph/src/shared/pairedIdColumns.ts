import { DatasetColumn } from "@tbm/db";

// Business roles where a dataset commonly carries both a human-readable Name
// column and a separate ID/code column for the same real-world entity (e.g.
// "Vendor Name" = Slalom Consulting, "Vendor ID" = V3109 on the same row).
// Roles like infrastructure_asset are deliberately excluded here — there, the
// ID *is* the canonical entity (e.g. Storage Device ID), with no separate
// name column to prefer instead, and it must keep producing nodes so
// cross-dataset FK linking still works.
const PAIRABLE_ROLES = new Set(["vendor", "application", "project", "business_unit", "department", "cost_center"]);

function isIdLikeColumnName(name: string): boolean {
  const trimmed = name.trim();
  return /(?:^|[\s_-])id$/i.test(trimmed) || /[a-z]ID$/.test(trimmed);
}

// Fallback for datasets that name their code column with no "ID" suffix at
// all — e.g. "Cost Center" holds codes like "CC-210" while "Cost Center Name"
// holds the real name "Apps - Mfg & Dist". Column-name matching alone can't
// tell these apart (neither ends in "ID"), so when exactly two same-role
// columns are otherwise ambiguous, break the tie by looking at what the
// values actually look like: short and containing a digit (a code) vs. a
// longer, wordy label (a name).
function looksLikeCode(sampleValues: unknown[] | null | undefined): boolean {
  const strings = (sampleValues ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (strings.length === 0) return false;
  const codeLike = strings.filter((v) => {
    const trimmed = v.trim();
    return trimmed.length <= 10 && /^[A-Za-z]{0,6}[-_ ]?\d+[A-Za-z0-9-]*$/.test(trimmed);
  });
  return codeLike.length / strings.length >= 0.6;
}

export interface IdPropertyPairing {
  idColumn: DatasetColumn;
  nameColumn: DatasetColumn;
}

export interface PairedColumnPartition {
  /** Columns that should still be embedded / turned into graph nodes. */
  embeddable: DatasetColumn[];
  /** ID-style columns suppressed in favor of a same-role Name column, each paired with that Name column. */
  suppressedIdPairs: IdPropertyPairing[];
}

/**
 * Splits a dataset's embeddable columns so an ID-style column (e.g. "Vendor
 * ID") is suppressed from node/embedding creation when exactly one Name-style
 * column of the same business role (e.g. "Vendor Name") exists in the same
 * dataset — the Name column is treated as the real entity, and the ID becomes
 * a property of it (see buildEdges.ts) instead of a duplicate node for the
 * same real-world vendor/application/project/etc.
 *
 * If a role has no Name-style column (ID-only dataset) or more than one
 * (ambiguous — we don't guess which is canonical), nothing is suppressed for
 * that role: the ID stays a normal embeddable column, same as before.
 */
export function partitionPairedIdColumns(columns: DatasetColumn[]): PairedColumnPartition {
  const byRole = new Map<string, DatasetColumn[]>();
  for (const col of columns) {
    const role = col.semantic_role ?? "";
    if (!PAIRABLE_ROLES.has(role)) continue;
    const list = byRole.get(role) ?? [];
    list.push(col);
    byRole.set(role, list);
  }

  const suppressedIds = new Set<string>();
  const suppressedIdPairs: IdPropertyPairing[] = [];

  for (const roleColumns of byRole.values()) {
    if (roleColumns.length < 2) continue;
    let idCols = roleColumns.filter((c) => isIdLikeColumnName(c.column_name));
    let nameCols = roleColumns.filter((c) => !isIdLikeColumnName(c.column_name));

    if (idCols.length === 0 && nameCols.length === 2) {
      const [a, b] = nameCols;
      const aIsCode = looksLikeCode(a.sample_values);
      const bIsCode = looksLikeCode(b.sample_values);
      if (aIsCode && !bIsCode) {
        idCols = [a];
        nameCols = [b];
      } else if (bIsCode && !aIsCode) {
        idCols = [b];
        nameCols = [a];
      }
    }

    if (nameCols.length !== 1 || idCols.length === 0) continue;
    for (const idColumn of idCols) {
      suppressedIds.add(idColumn.id);
      suppressedIdPairs.push({ idColumn, nameColumn: nameCols[0] });
    }
  }

  return {
    embeddable: columns.filter((c) => !suppressedIds.has(c.id)),
    suppressedIdPairs,
  };
}
