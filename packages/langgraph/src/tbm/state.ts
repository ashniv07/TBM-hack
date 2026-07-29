import { AtumLayer } from "@tbm/db";

/**
 * Stage 7 — TBM Data Model Generation.
 *
 * The model is *derived*, not stored: everything below is computed from what
 * Stages 1-6 already persisted (context graph, approved ATUM mappings,
 * readiness scores), so there is no Stage 7 table and no way for the export to
 * drift out of sync with the graph it describes. Re-running is free.
 */

/** A business object Apptio would load as a row in one of its object tables. */
export interface TbmObject {
  id: string;
  name: string;
  /** Stage 4 entity type: vendor, application, cost_center, ... */
  objectType: string;
  resolutionConfidence: number;
  aliasCount: number;
  sourceDatasets: string[];
  /** ATUM layer -> classification, only for approved/overridden mappings. */
  costPool: string | null;
  resourceTower: string | null;
  solution: string | null;
  atumPaths: Partial<Record<AtumLayer, string>>;
  /** Mean confidence across whichever layers classified this object. */
  atumConfidence: number | null;
}

/** A preserved relationship: financial/structural lineage or a business link. */
export interface TbmRelationship {
  fromId: string;
  fromName: string;
  fromType: string;
  /** The labeled business relationship (USES_VENDOR, ...) or the raw edge type. */
  relationship: string;
  toId: string;
  toName: string;
  toType: string;
  confidence: number;
  evidenceDataset: string | null;
}

export interface TbmSourceDataset {
  datasetId: string;
  fileName: string;
  sourceType: string | null;
  rowCount: number | null;
  businessPurpose: string | null;
  readinessScore: number | null;
  issueCount: number | null;
  criticalIssueCount: number | null;
  /** readinessScore >= TBM_READY_THRESHOLD — safe to load into Apptio as-is. */
  tbmReady: boolean;
}

/** One aggregated spend row: the money Apptio actually allocates. */
export interface TbmCostFact {
  datasetFile: string;
  sourceType: string | null;
  costCenter: string;
  account: string;
  costPool: string;
  costSubPool: string;
  resourceTower: string;
  resourceSubTower: string;
  vendor: string;
  project: string;
  expenseType: string;
  period: string;
  amount: number;
  /** Source rows folded into this aggregate. */
  lineCount: number;
}

export interface TbmModelSummary {
  objects: number;
  classifiedObjects: number;
  classificationCoverage: number;
  relationships: number;
  sourceDatasets: number;
  tbmReadyDatasets: number;
  averageReadiness: number;
  averageMappingConfidence: number;
  objectsByType: Record<string, number>;
  objectsByTower: Record<string, number>;
  totalCost: number;
  costFactRows: number;
  costByPool: Record<string, number>;
  costByTower: Record<string, number>;
}

export interface TbmDataModel {
  generatedAt: string;
  taxonomyVersion: string;
  summary: TbmModelSummary;
  objects: TbmObject[];
  relationships: TbmRelationship[];
  costFacts: TbmCostFact[];
  sourceDatasets: TbmSourceDataset[];
  /** Blockers a consultant must see before loading this into Apptio. */
  warnings: string[];
}
