export interface ColumnClassification {
  columnId: string;
  columnName: string;
  semanticRole: string;
  semanticRoleConfidence: number;
  isTechnical: boolean;
}

export interface RelationshipCandidate {
  fromColumnId: string;
  toColumnId: string;
  relationshipType: string;
  confidence: number;
  reasoning: string;
}

export interface UnderstandingState {
  datasetId: string;
  businessPurpose?: string;
  classifications?: ColumnClassification[];
  relationships?: RelationshipCandidate[];
  error?: string;
}
