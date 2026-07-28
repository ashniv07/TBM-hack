import {
  createTbmExport,
  updateTbmExportStatus,
  buildTbmCostCenters,
  buildTbmApplications,
  buildTbmVendors,
  buildTbmCloudResources,
  getTbmDataModel,
  clearTbmExportData,
  TbmExportType,
  TbmExportFormat,
  TbmDataModel,
} from "@tbm/db";
import { TAXONOMY_VERSION } from "../atum/importTaxonomy";

export interface TbmExportOptions {
  exportType?: TbmExportType;
  format?: TbmExportFormat;
  includeUnmapped?: boolean;
  includeLowConfidence?: boolean;
  confidenceThreshold?: number;
  createdBy?: string;
}

export interface TbmExportResult {
  exportId: string;
  status: "completed" | "failed";
  model?: TbmDataModel;
  recordCount: number;
  error?: string;
}

/**
 * Generates a TBM Data Model from the knowledge graph and ATUM mappings.
 * This transforms enterprise data into Apptio-ready format.
 */
export async function generateTbmDataModel(options: TbmExportOptions = {}): Promise<TbmExportResult> {
  const {
    exportType = "full",
    format = "json",
    includeUnmapped = false,
    includeLowConfidence = false,
    confidenceThreshold = 0.7,
    createdBy,
  } = options;

  // Create export record
  const tbmExport = await createTbmExport({
    exportType,
    format,
    includeUnmapped,
    includeLowConfidence,
    confidenceThreshold,
    createdBy,
  });

  try {
    await updateTbmExportStatus(tbmExport.id, "running");

    // Clear any existing data for this export
    await clearTbmExportData(tbmExport.id);

    // Build TBM dimensions from knowledge graph
    const threshold = includeLowConfidence ? 0 : confidenceThreshold;

    let costCenters: Awaited<ReturnType<typeof buildTbmCostCenters>> = [];
    let applications: Awaited<ReturnType<typeof buildTbmApplications>> = [];
    let vendors: Awaited<ReturnType<typeof buildTbmVendors>> = [];
    let cloudResources: Awaited<ReturnType<typeof buildTbmCloudResources>> = [];

    if (exportType === "full" || exportType === "cost_centers") {
      costCenters = await buildTbmCostCenters(tbmExport.id);
    }

    if (exportType === "full" || exportType === "applications") {
      applications = await buildTbmApplications(tbmExport.id, threshold);
    }

    if (exportType === "full" || exportType === "vendors") {
      vendors = await buildTbmVendors(tbmExport.id, threshold);
    }

    if (exportType === "full" || exportType === "cloud_resources") {
      cloudResources = await buildTbmCloudResources(tbmExport.id, threshold);
    }

    const recordCount = costCenters.length + applications.length + vendors.length + cloudResources.length;

    const model: TbmDataModel = {
      costCenters,
      applications,
      vendors,
      cloudResources,
      allocations: [], // TODO: Build from transaction data when available
      metadata: {
        exportId: tbmExport.id,
        exportedAt: new Date().toISOString(),
        totalRecords: recordCount,
        taxonomyVersion: TAXONOMY_VERSION,
      },
    };

    await updateTbmExportStatus(tbmExport.id, "completed", undefined, recordCount);

    return {
      exportId: tbmExport.id,
      status: "completed",
      model,
      recordCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateTbmExportStatus(tbmExport.id, "failed", undefined, undefined, errorMessage);
    return {
      exportId: tbmExport.id,
      status: "failed",
      recordCount: 0,
      error: errorMessage,
    };
  }
}

/**
 * Retrieves a previously generated TBM Data Model.
 */
export async function retrieveTbmDataModel(exportId: string): Promise<TbmDataModel | null> {
  const data = await getTbmDataModel(exportId);
  if (!data.costCenters.length && !data.applications.length && !data.vendors.length && !data.cloudResources.length) {
    return null;
  }

  return {
    ...data,
    allocations: [],
    metadata: {
      exportId,
      exportedAt: new Date().toISOString(),
      totalRecords: data.costCenters.length + data.applications.length + data.vendors.length + data.cloudResources.length,
      taxonomyVersion: TAXONOMY_VERSION,
    },
  };
}
