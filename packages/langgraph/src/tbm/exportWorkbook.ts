import ExcelJS from "exceljs";
import { TbmDataModel, TbmObject } from "./state";

// Apptio TBM Studio loads one table per object type, plus a relationship table
// and the lineage/quality metadata a consultant needs to trust the load. That
// is exactly the sheet layout produced here.

function sheetName(objectType: string): string {
  const titled = objectType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  // Excel caps sheet names at 31 characters and rejects []*?/\:
  return `${titled}s`.replace(/[[\]*?/\\:]/g, " ").slice(0, 31);
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[]
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  return sheet;
}

function objectRow(object: TbmObject) {
  return {
    id: object.id,
    name: object.name,
    costPool: object.costPool ?? "",
    resourceTower: object.resourceTower ?? "",
    solution: object.solution ?? "",
    atumConfidence: object.atumConfidence ?? "",
    resolutionConfidence: object.resolutionConfidence,
    aliasCount: object.aliasCount,
    sourceDatasets: object.sourceDatasets.join("; "),
  };
}

const OBJECT_COLUMNS = [
  { header: "Object ID", key: "id", width: 38 },
  { header: "Name", key: "name", width: 40 },
  { header: "ATUM Cost Pool", key: "costPool", width: 26 },
  { header: "ATUM Resource Tower", key: "resourceTower", width: 26 },
  { header: "ATUM Solution", key: "solution", width: 26 },
  { header: "Mapping Confidence", key: "atumConfidence", width: 18 },
  { header: "Resolution Confidence", key: "resolutionConfidence", width: 20 },
  { header: "Alias Count", key: "aliasCount", width: 12 },
  { header: "Source Datasets", key: "sourceDatasets", width: 50 },
];

export async function buildTbmWorkbook(model: TbmDataModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TBM Data Trust & Intelligence Platform";
  workbook.created = new Date(model.generatedAt);

  const summary = addSheet(
    workbook,
    "Model Summary",
    [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 60 },
    ],
    [
      { metric: "Generated at", value: model.generatedAt },
      { metric: "ATUM taxonomy version", value: model.taxonomyVersion },
      { metric: "Business objects", value: model.summary.objects },
      { metric: "Classified objects", value: model.summary.classifiedObjects },
      { metric: "Classification coverage", value: model.summary.classificationCoverage },
      { metric: "Relationships preserved", value: model.summary.relationships },
      { metric: "Source datasets", value: model.summary.sourceDatasets },
      { metric: "TBM-ready datasets", value: model.summary.tbmReadyDatasets },
      { metric: "Average readiness", value: model.summary.averageReadiness },
      { metric: "Average mapping confidence", value: model.summary.averageMappingConfidence },
      ...Object.entries(model.summary.objectsByType).map(([type, count]) => ({
        metric: `Objects — ${type}`,
        value: count,
      })),
      ...Object.entries(model.summary.objectsByTower).map(([tower, count]) => ({
        metric: `Objects in tower — ${tower}`,
        value: count,
      })),
      ...model.warnings.map((warning, i) => ({ metric: `Warning ${i + 1}`, value: warning })),
    ]
  );
  summary.getColumn("value").alignment = { wrapText: true };

  // One object table per type, mirroring Apptio's object model. Types with no
  // rows produce no sheet — an empty tab is noise a consultant has to check.
  const byType = new Map<string, TbmObject[]>();
  for (const object of model.objects) {
    byType.set(object.objectType, [...(byType.get(object.objectType) ?? []), object]);
  }
  for (const [type, objects] of [...byType.entries()].sort()) {
    addSheet(workbook, sheetName(type), OBJECT_COLUMNS, objects.map(objectRow));
  }

  addSheet(
    workbook,
    "Relationships",
    [
      { header: "From ID", key: "fromId", width: 38 },
      { header: "From", key: "fromName", width: 34 },
      { header: "From Type", key: "fromType", width: 20 },
      { header: "Relationship", key: "relationship", width: 24 },
      { header: "To ID", key: "toId", width: 38 },
      { header: "To", key: "toName", width: 34 },
      { header: "To Type", key: "toType", width: 20 },
      { header: "Confidence", key: "confidence", width: 12 },
      { header: "Evidence Dataset", key: "evidenceDataset", width: 40 },
    ],
    model.relationships.map((r) => ({ ...r, evidenceDataset: r.evidenceDataset ?? "" }))
  );

  addSheet(
    workbook,
    "Source Datasets",
    [
      { header: "Dataset ID", key: "datasetId", width: 38 },
      { header: "File", key: "fileName", width: 44 },
      { header: "Source Type", key: "sourceType", width: 24 },
      { header: "Rows", key: "rowCount", width: 10 },
      { header: "Readiness", key: "readinessScore", width: 12 },
      { header: "Issues", key: "issueCount", width: 10 },
      { header: "Critical Issues", key: "criticalIssueCount", width: 14 },
      { header: "TBM Ready", key: "tbmReady", width: 12 },
      { header: "Business Purpose", key: "businessPurpose", width: 60 },
    ],
    model.sourceDatasets.map((d) => ({
      ...d,
      sourceType: d.sourceType ?? "",
      readinessScore: d.readinessScore ?? "",
      issueCount: d.issueCount ?? "",
      criticalIssueCount: d.criticalIssueCount ?? "",
      tbmReady: d.tbmReady ? "yes" : "no",
      businessPurpose: d.businessPurpose ?? "",
    }))
  );

  // exceljs returns its own Buffer-like type; Buffer.from normalizes it.
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
