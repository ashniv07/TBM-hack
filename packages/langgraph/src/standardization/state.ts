import { CanonicalSchema, QualityIssue, Correction, ReadinessScore } from "@tbm/db";

export interface DerivedSchema {
  sourceType: string;
  semanticRole: string;
  columnName: string;
  inferredType: string;
  isRequired: boolean;
  frequencyScore: number;
}

export interface DetectedIssue {
  datasetId: string;
  columnId?: string;
  issueType: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  description: string;
  affectedRows?: number;
  sampleValues?: unknown[];
  suggestedFix?: string;
}

export interface ProposedCorrection {
  issueId?: string;
  datasetId: string;
  columnId?: string;
  correctionType: string;
  originalValue?: string;
  correctedValue?: string;
  affectedRows?: number;
  confidence: number;
  reasoning?: string;
}

export interface DatasetReadiness {
  datasetId: string;
  overallScore: number;
  completenessScore: number;
  validityScore: number;
  consistencyScore: number;
  uniquenessScore: number;
  issueCount: number;
  criticalIssueCount: number;
  recommendations: string[];
}

export interface StandardizationStats {
  schemasCount: number;
  issuesCount: number;
  correctionsCount: number;
  datasetsScored: number;
  averageReadinessScore: number;
}

export interface StandardizationState {
  uploadsDir?: string;
  schemas?: DerivedSchema[];
  issues?: DetectedIssue[];
  corrections?: ProposedCorrection[];
  readinessScores?: DatasetReadiness[];
  persistedSchemas?: CanonicalSchema[];
  persistedIssues?: QualityIssue[];
  persistedCorrections?: Correction[];
  persistedReadinessScores?: ReadinessScore[];
  stats?: StandardizationStats;
  error?: string;
}
