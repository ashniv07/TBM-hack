import * as XLSX from "xlsx";
import { TbmDataModel, TbmCostCenter, TbmApplication, TbmVendor, TbmCloudResource } from "@tbm/db";

/**
 * Formats TBM data model as JSON string.
 */
export function formatAsJson(model: TbmDataModel): string {
  return JSON.stringify(model, null, 2);
}

/**
 * Formats TBM data model as CSV (multiple files zipped or concatenated).
 * Returns an object with CSV content for each dimension.
 */
export function formatAsCsv(model: TbmDataModel): Record<string, string> {
  const csvFiles: Record<string, string> = {};

  // Cost Centers CSV
  if (model.costCenters.length > 0) {
    const headers = ["cost_center_code", "cost_center_name", "parent_cost_center_code", "business_unit_code", "business_unit_name", "department_code", "department_name", "confidence"];
    const rows = model.costCenters.map((cc) => [
      cc.cost_center_code,
      cc.cost_center_name,
      cc.parent_cost_center_code || "",
      cc.business_unit_code || "",
      cc.business_unit_name || "",
      cc.department_code || "",
      cc.department_name || "",
      cc.confidence.toString(),
    ]);
    csvFiles["cost_centers.csv"] = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  }

  // Applications CSV
  if (model.applications.length > 0) {
    const headers = ["application_id", "application_name", "vendor_name", "business_unit_code", "cost_center_code", "atum_tower", "atum_sub_tower", "atum_service_domain", "atum_confidence", "confidence"];
    const rows = model.applications.map((app) => [
      app.application_id,
      app.application_name,
      app.vendor_name || "",
      app.business_unit_code || "",
      app.cost_center_code || "",
      app.atum_tower || "",
      app.atum_sub_tower || "",
      app.atum_service_domain || "",
      app.atum_confidence?.toString() || "",
      app.confidence.toString(),
    ]);
    csvFiles["applications.csv"] = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  }

  // Vendors CSV
  if (model.vendors.length > 0) {
    const headers = ["vendor_id", "vendor_name", "vendor_type", "atum_cost_pool", "atum_confidence", "confidence"];
    const rows = model.vendors.map((v) => [
      v.vendor_id,
      v.vendor_name,
      v.vendor_type || "",
      v.atum_cost_pool || "",
      v.atum_confidence?.toString() || "",
      v.confidence.toString(),
    ]);
    csvFiles["vendors.csv"] = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  }

  // Cloud Resources CSV
  if (model.cloudResources.length > 0) {
    const headers = ["resource_id", "resource_name", "resource_type", "cloud_provider", "region", "account_id", "atum_tower", "atum_sub_tower", "atum_confidence", "application_id", "confidence"];
    const rows = model.cloudResources.map((cr) => [
      cr.resource_id,
      cr.resource_name,
      cr.resource_type || "",
      cr.cloud_provider || "",
      cr.region || "",
      cr.account_id || "",
      cr.atum_tower || "",
      cr.atum_sub_tower || "",
      cr.atum_confidence?.toString() || "",
      cr.application_id || "",
      cr.confidence.toString(),
    ]);
    csvFiles["cloud_resources.csv"] = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  }

  return csvFiles;
}

/**
 * Formats TBM data model as XLSX workbook buffer.
 */
export function formatAsXlsx(model: TbmDataModel): Buffer {
  const workbook = XLSX.utils.book_new();

  // Cost Centers sheet
  if (model.costCenters.length > 0) {
    const data = model.costCenters.map((cc) => ({
      "Cost Center Code": cc.cost_center_code,
      "Cost Center Name": cc.cost_center_name,
      "Parent Cost Center": cc.parent_cost_center_code || "",
      "Business Unit Code": cc.business_unit_code || "",
      "Business Unit Name": cc.business_unit_name || "",
      "Department Code": cc.department_code || "",
      "Department Name": cc.department_name || "",
      "Confidence": cc.confidence,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Cost Centers");
  }

  // Applications sheet
  if (model.applications.length > 0) {
    const data = model.applications.map((app) => ({
      "Application ID": app.application_id,
      "Application Name": app.application_name,
      "Vendor": app.vendor_name || "",
      "Business Unit": app.business_unit_code || "",
      "Cost Center": app.cost_center_code || "",
      "ATUM Tower": app.atum_tower || "",
      "ATUM Sub-Tower": app.atum_sub_tower || "",
      "ATUM Service Domain": app.atum_service_domain || "",
      "ATUM Confidence": app.atum_confidence || "",
      "Confidence": app.confidence,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Applications");
  }

  // Vendors sheet
  if (model.vendors.length > 0) {
    const data = model.vendors.map((v) => ({
      "Vendor ID": v.vendor_id,
      "Vendor Name": v.vendor_name,
      "Vendor Type": v.vendor_type || "",
      "ATUM Cost Pool": v.atum_cost_pool || "",
      "ATUM Confidence": v.atum_confidence || "",
      "Confidence": v.confidence,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Vendors");
  }

  // Cloud Resources sheet
  if (model.cloudResources.length > 0) {
    const data = model.cloudResources.map((cr) => ({
      "Resource ID": cr.resource_id,
      "Resource Name": cr.resource_name,
      "Resource Type": cr.resource_type || "",
      "Cloud Provider": cr.cloud_provider || "",
      "Region": cr.region || "",
      "Account ID": cr.account_id || "",
      "ATUM Tower": cr.atum_tower || "",
      "ATUM Sub-Tower": cr.atum_sub_tower || "",
      "ATUM Confidence": cr.atum_confidence || "",
      "Application": cr.application_id || "",
      "Confidence": cr.confidence,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Cloud Resources");
  }

  // Summary sheet
  const summaryData = [
    { Dimension: "Cost Centers", Count: model.costCenters.length },
    { Dimension: "Applications", Count: model.applications.length },
    { Dimension: "Vendors", Count: model.vendors.length },
    { Dimension: "Cloud Resources", Count: model.cloudResources.length },
    { Dimension: "Total Records", Count: model.metadata.totalRecords },
  ];
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  // Metadata sheet
  const metaData = [
    { Field: "Export ID", Value: model.metadata.exportId },
    { Field: "Exported At", Value: model.metadata.exportedAt },
    { Field: "Taxonomy Version", Value: model.metadata.taxonomyVersion },
    { Field: "Total Records", Value: model.metadata.totalRecords },
  ];
  const metaSheet = XLSX.utils.json_to_sheet(metaData);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Metadata");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
