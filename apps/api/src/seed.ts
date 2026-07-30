import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.join(__dirname, "..", "..", "..", ".env") });

import {
  importAtumTaxonomy,
  runAtumMapping,
  runContextModel,
  runEmbedding,
  runIngestion,
  runStandardization,
  runUnderstanding,
} from "@tbm/langgraph";
import { AtumLayer, getColumnMappings, getDataset, syncAtumEdgesToGraph } from "@tbm/db";
import { mapDatasetToTemplate } from "@tbm/langgraph";
import { UPLOAD_DIR } from "./routes/datasets";

const DATA_DIR = path.join(__dirname, "..", "..", "..", "packages", "langgraph", "data");
// Customer SOURCE data — the only thing that gets ingested. The master
// workbooks in data/templates/ are the Apptio target schema, not input; they
// are compiled into src/templates/masterTemplates.ts and never uploaded.
const SOURCE_DIR = path.join(DATA_DIR, "source");
const TAXONOMY_FILE = path.join(DATA_DIR, "TBM-Taxonomy-v5.0.1-Data-Table.xlsx");
// Matches the upload route's batch size, which is sized for the pg pool.
const CONCURRENCY = 3;

function parseLayers(): AtumLayer[] {
  const arg = process.argv.find((a) => a.startsWith("--layers="));
  const valid: AtumLayer[] = ["cost_pool", "resource_tower"];
  if (!arg) return ["resource_tower"];
  const requested = arg.slice("--layers=".length).split(",").map((s) => s.trim());
  const bad = requested.filter((r) => !valid.includes(r as AtumLayer));
  if (bad.length) throw new Error(`Unknown layer(s): ${bad.join(", ")}`);
  return requested as AtumLayer[];
}

function since(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(0)}s`;
}

async function seed() {
  const layers = parseLayers();
  const started = Date.now();

  // Copy into UPLOAD_DIR the way multer does, rather than ingesting from
  // packages/langgraph/data directly: Stage 5 writes corrected files next to
  // the source, and that directory is the pristine sample set.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  const workbooks = fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => /\.xlsx?$/i.test(name))
    .sort();
  if (workbooks.length === 0) {
    throw new Error(
      `No source workbooks in ${SOURCE_DIR}.\n` +
        `Put the customer's raw exports there — NOT the master workbooks in data/templates/, ` +
        `which are the Apptio target schema rather than input.`
    );
  }
  console.log(`Seeding ${workbooks.length} source workbook(s) -> ${UPLOAD_DIR}`);

  // ---- Stages 1-3, per workbook ----
  const failures: { fileName: string; stage: string; error: string }[] = [];
  const ingestedDatasets: { datasetId: string; fileName: string }[] = [];
  let ingested = 0;
  for (let i = 0; i < workbooks.length; i += CONCURRENCY) {
    await Promise.all(
      workbooks.slice(i, i + CONCURRENCY).map(async (fileName) => {
        const stepStart = Date.now();
        const destination = path.join(UPLOAD_DIR, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${fileName}`);
        try {
          fs.copyFileSync(path.join(SOURCE_DIR, fileName), destination);
          const result = await runIngestion({ filePath: destination, fileName, uploadedBy: "seed" });
          if (result.error || !result.datasetId) {
            failures.push({ fileName, stage: "ingestion", error: result.error ?? "no datasetId" });
            return;
          }
          await mapDatasetToTemplate(result.datasetId, { uploadsDir: UPLOAD_DIR });
          await runUnderstanding(result.datasetId);
          await runEmbedding(result.datasetId, { uploadsDir: UPLOAD_DIR, rows: result.sheet?.rows });
          ingested++;
          ingestedDatasets.push({ datasetId: result.datasetId, fileName });
          console.log(`  [1-3] ${fileName} (${since(stepStart)})`);
        } catch (err) {
          failures.push({ fileName, stage: "understanding/embedding", error: err instanceof Error ? err.message : String(err) });
        }
      })
    );
  }
  console.log(`Stages 1-3 complete: ${ingested}/${workbooks.length} datasets (${since(started)})`);

  // ---- Stage 4: knowledge graph across every dataset ----
  // ---- Column coverage against the master templates ----
  // The client's headline metric: of the columns the Apptio template expects,
  // how many does the customer's file actually supply?
  console.log("\nColumn coverage vs master templates:");
  for (const { datasetId, fileName } of ingestedDatasets) {
    const dataset = await getDataset(datasetId);
    if (!dataset?.master_type) {
      console.log(`  ${fileName}: no master template recognised`);
      continue;
    }
    const unmapped = (await getColumnMappings(datasetId)).filter((m) => !m.template_column).length;
    console.log(
      `  ${fileName}\n` +
        `     -> ${dataset.master_type}\n` +
        `        supplies ${dataset.template_matched_count}/${dataset.template_expected_count} expected columns` +
        ` = ${Math.round(Number(dataset.template_coverage ?? 0) * 100)}% coverage\n` +
        `        ${unmapped} source column(s) map to nothing in the template`
    );
  }

  const context = await runContextModel({ uploadsDir: UPLOAD_DIR });
  if (context.error) throw new Error(`Stage 4 failed: ${context.error}`);
  console.log(`Stage 4 complete: ${JSON.stringify(context.stats)} (${since(started)})`);

  // ---- Stage 5: standardization + readiness ----
  const standardization = await runStandardization({ uploadsDir: UPLOAD_DIR });
  if (standardization.error) throw new Error(`Stage 5 failed: ${standardization.error}`);
  console.log(`Stage 5 complete: ${JSON.stringify(standardization.stats)} (${since(started)})`);

  // ---- Stage 6: taxonomy + mapping per layer, then graph edges ----
  const taxonomy = await importAtumTaxonomy(TAXONOMY_FILE);
  console.log(`Taxonomy imported: ${JSON.stringify(taxonomy)} (${since(started)})`);

  for (const layer of layers) {
    const stats = await runAtumMapping({ layer, uploadsDir: UPLOAD_DIR });
    const graph = await syncAtumEdgesToGraph({ layer });
    console.log(
      `Stage 6 [${layer}]: ${stats.mapped}/${stats.candidates} mapped, ` +
        `${stats.linkedToContext} linked to graph, ${stats.unresolved} unresolved, ` +
        `${graph.edges} edges (${since(started)})`
    );
  }

  if (failures.length) {
    console.log(`\n${failures.length} workbook(s) failed:`);
    for (const f of failures) console.log(`  ${f.fileName} [${f.stage}]: ${f.error}`);
  }
  console.log(`\nSeed finished in ${since(started)}.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
