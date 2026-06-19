// RAG Source Configuration
export interface RagSource {
  id: number;
  sourceKey: string;
  projectKey: string | null;
  sourceType: "folder" | "project" | "root";
  rootPath: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// RAG Document
export interface RagDocument {
  id: number;
  sourceId: number | null;
  projectKey: string | null;
  filePath: string;
  fileName: string;
  fileExt: string;
  fileSize: number;
  fileHash: string;
  title: string | null;
  status: "pending" | "indexed" | "error";
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// RAG Chunk
export interface RagChunk {
  id: number;
  documentId: number;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenEstimate: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// RAG Embedding
export interface RagEmbedding {
  id: number;
  chunkId: number;
  provider: string;
  model: string;
  dimensions: number | null;
  embeddingJson: number[];
  createdAt: string;
}

// RAG Index Job
export interface RagIndexJob {
  id: number;
  jobType: "scan" | "index" | "reindex";
  status: "started" | "running" | "completed" | "error";
  rootPath: string;
  projectKey: string | null;
  filesSeen: number;
  filesIndexed: number;
  chunksCreated: number;
  errors: Array<{ file: string; error: string }> | null;
  startedAt: string;
  finishedAt: string | null;
}

// RAG Query Record
export interface RagQuery {
  id: number;
  query: string;
  projectKey: string | null;
  mode: "keyword" | "hybrid" | "embeddings";
  topK: number;
  resultsCount: number;
  createdAt: string;
}

// Search Result
export interface RagSearchResult {
  chunkId: number;
  documentId: number;
  documentPath: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  score: number;
  model?: string;
}

// RAG Status
export interface RagStatus {
  enabled: boolean;
  documentsDir: string;
  allowedRoots: string[];
  excludedGlobs: string[];
  chunkSize: number;
  chunkOverlap: number;
  maxFileSizeMb: number;
  embeddingsEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingModelAvailable?: boolean;
  indexedDocumentCount: number;
  chunkCount: number;
  embeddingCount: number;
  lastIndexJob?: Partial<RagIndexJob>;
}

// RAG Context
export interface RagContext {
  context: string;
  sources: Array<{
    documentPath: string;
    documentName: string;
    chunks: number[];
  }>;
}

// Knowledge Document (legacy compatibility)
export interface KnowledgeDocument {
  id: string;
  path: string;
  title: string;
  indexedAt?: string;
}

// Retrieval Result (legacy compatibility)
export interface RetrievalResult {
  documentId: string;
  excerpt: string;
  score: number;
}

