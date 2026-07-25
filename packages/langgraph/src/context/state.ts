export interface ResolvedEntity {
  tempId: string;
  entityType: string;
  canonicalName: string;
  /**
   * 1 = every alias in this cluster was an exact (case/whitespace-insensitive)
   * string match — no judgment call was made. Lower values mean the cluster
   * includes at least one pair merged only because their embeddings were
   * close (1 - the weakest/most-distant pairwise similarity in the cluster),
   * so it's a real inference, not a certainty.
   */
  confidence: number;
}

export interface DatasetNode {
  tempId: string;
  datasetId: string;
  canonicalName: string;
}

export interface EntityAlias {
  entityTempId: string;
  datasetId: string;
  columnId: string;
  entityValue: string;
}

export interface GraphEdgeCandidate {
  fromTempId: string;
  toTempId: string;
  /**
   * foreign_key: dataset -> dataset structural link, discovered from real
   *   shared key values (e.g. matching "Storage Device ID" values) — this is
   *   enterprise data lineage and should be treated as higher-confidence
   *   evidence than the two semantic edge types below.
   * contains_reference: dataset -> business entity (vendor, business_unit, ...).
   * co_occurs_with: business entity <-> business entity, same-row evidence.
   */
  edgeType: "foreign_key" | "contains_reference" | "co_occurs_with";
  weight: number;
  confidence: number;
  evidenceDatasetId?: string;
  label?: string;
}

export interface ContextStats {
  entityCount: number;
  aliasCount: number;
  edgeCount: number;
  datasetsProcessed: number;
  datasetsSkipped: string[];
  hashFallbackRatio: number;
}

export interface ContextState {
  similarityThreshold?: number;
  uploadsDir?: string;
  entities?: ResolvedEntity[];
  aliases?: EntityAlias[];
  datasetNodes?: DatasetNode[];
  valueToEntity?: Record<string, string>;
  edges?: GraphEdgeCandidate[];
  warnings?: string[];
  stats?: ContextStats;
  error?: string;
}
