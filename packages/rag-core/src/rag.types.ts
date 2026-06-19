export interface KnowledgeDocument {
  id: string;
  path: string;
  title: string;
  indexedAt?: string;
}

export interface RetrievalResult {
  documentId: string;
  excerpt: string;
  score: number;
}

