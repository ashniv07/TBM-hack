export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnProfile {
  column_name: string;
  ordinal: number;
  inferred_type: string;
  null_pct: number;
  distinct_count: number;
  sample_values: unknown[];
  is_candidate_key: boolean;
}

export interface IngestionState {
  filePath: string;
  fileName: string;
  uploadedBy?: string;
  datasetId?: string;
  sheet?: SheetData;
  profile?: ColumnProfile[];
  sourceType?: string;
  sourceTypeConfidence?: number;
  error?: string;
}
