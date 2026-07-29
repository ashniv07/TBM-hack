import { getDatasetColumns, listDatasets } from "@tbm/db";
import { findMasterTemplate } from "../templates/masterTemplates";
import { StandardizationState, DerivedSchema } from "./state";

/**
 * The canonical schema for a dataset is its Apptio master template — full stop.
 *
 * This used to be *derived* from the data: group datasets by source type, count
 * semantic roles, and keep whichever column happened to be seen first as the
 * definition for that role. That produced nonsense, because "other" is a
 * catch-all holding dozens of unrelated columns and an all-empty column defines
 * the role's type as "unknown". On the sample set it generated 323 of 447
 * quality issues, including the uselessly circular "convert column values to
 * unknown type".
 *
 * There is no need to infer a target when the target is a published template.
 * A column is required if the template expects it; the "gap" is simply the
 * template columns the source did not supply, which the mapping stage already
 * records.
 */
export async function deriveSchemasNode(state: StandardizationState): Promise<Partial<StandardizationState>> {
  try {
    const datasets = await listDatasets();
    const schemas: DerivedSchema[] = [];
    const seen = new Set<string>();

    for (const dataset of datasets) {
      if (!dataset.master_type) continue;
      const template = findMasterTemplate(dataset.master_type);
      if (!template) continue;

      // One canonical schema per master type, not per dataset — several source
      // files can target the same template.
      if (seen.has(template.masterType)) continue;
      seen.add(template.masterType);

      const columns = await getDatasetColumns(dataset.id);
      const typeByName = new Map(columns.map((c) => [c.column_name.toLowerCase(), c.inferred_type ?? "string"]));

      for (const expected of template.expectedColumns) {
        schemas.push({
          sourceType: template.masterType,
          semanticRole: expected,
          columnName: expected,
          // Only meaningful where a source actually supplied the column;
          // otherwise there is nothing to compare a type against and claiming
          // one invents a constraint.
          inferredType: typeByName.get(expected.toLowerCase()) ?? "unknown",
          // Every template column is expected by definition. Whether a given
          // file supplies it is the coverage metric, not a schema property.
          isRequired: true,
          frequencyScore: 1,
        });
      }
    }

    return { schemas };
  } catch (err) {
    return { error: `Failed to derive schemas: ${err instanceof Error ? err.message : String(err)}` };
  }
}
