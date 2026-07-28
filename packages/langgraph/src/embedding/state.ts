export interface EmbeddingState {
  datasetId: string;
  uploadsDir?: string;
  /**
   * Rows already parsed by Stage 1 in this same request. Supplied by the upload
   * path so a workbook is read from disk once, not twice; omitted by the
   * standalone POST /datasets/:id/embed endpoint, which falls back to re-reading.
   */
  rows?: Record<string, unknown>[];
  embeddedCount?: number;
  error?: string;
}
