import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RagConfig } from "./rag.config";
import type {
  RagSource,
  RagDocument,
  RagChunk,
  RagIndexJob,
  RagStatus,
  RagSearchResult,
  RagContext,
} from "./rag.types";
import { validateAllowedPath, isExcludedPath, isSupportedFileType } from "./fileFilters";
import { hashFile, hashContent } from "./hash";
import { extractTextFromFile } from "./textExtractors";
import { chunkText, estimateTokens } from "./chunker";
import { scanDirectory } from "./fileScanner";
import { searchKeywords, searchFts } from "./keywordSearch";
import { embedChunkWithOllama, isOllamaAvailable, checkOllamaModel } from "./ollamaEmbeddings";

interface Row {
  [key: string]: unknown;
}

function rowToSource(row: Row): RagSource {
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key),
    projectKey: row.project_key ? String(row.project_key) : null,
    sourceType: String(row.source_type) as "folder" | "project" | "root",
    rootPath: String(row.root_path),
    displayName: String(row.display_name),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToDocument(row: Row): RagDocument {
  return {
    id: Number(row.id),
    sourceId: row.source_id ? Number(row.source_id) : null,
    projectKey: row.project_key ? String(row.project_key) : null,
    filePath: String(row.file_path),
    fileName: String(row.file_name),
    fileExt: String(row.file_ext),
    fileSize: Number(row.file_size),
    fileHash: String(row.file_hash),
    title: row.title ? String(row.title) : null,
    status: String(row.status) as "pending" | "indexed" | "error",
    indexedAt: row.indexed_at ? String(row.indexed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToChunk(row: Row): RagChunk {
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    chunkIndex: Number(row.chunk_index),
    content: String(row.content),
    contentHash: String(row.content_hash),
    tokenEstimate: row.token_estimate ? Number(row.token_estimate) : null,
    metadata: row.metadata ? JSON.parse(String(row.metadata)) : null,
    createdAt: String(row.created_at),
  };
}

export class RagService {
  readonly config: RagConfig;
  readonly #db: Database.Database;

  constructor(config: RagConfig, db: Database.Database) {
    this.config = config;
    this.#db = db;
  }

  async getStatus(): Promise<RagStatus> {
    try {
      const docCount = this.#db.prepare("SELECT COUNT(*) as count FROM rag_documents WHERE status = 'indexed'").get() as Row;
      const chunkCount = this.#db.prepare("SELECT COUNT(*) as count FROM rag_chunks").get() as Row;
      const embeddingCount = this.#db.prepare("SELECT COUNT(*) as count FROM rag_embeddings").get() as Row;
      
      const lastJob = this.#db
        .prepare("SELECT * FROM rag_index_jobs ORDER BY finished_at DESC LIMIT 1")
        .get() as Row | undefined;

      let embeddingModelAvailable = false;
      if (this.config.embeddingsEnabled && this.config.embeddingProvider === "ollama") {
        const isOllamaUp = await isOllamaAvailable(process.env.OLLAMA_BASE_URL);
        if (isOllamaUp) {
          embeddingModelAvailable = await checkOllamaModel(this.config.embeddingModel, process.env.OLLAMA_BASE_URL);
        }
      }

      return {
        enabled: this.config.enabled,
        documentsDir: this.config.documentsDir,
        allowedRoots: this.config.allowedRoots,
        excludedGlobs: this.config.excludedGlobs,
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
        maxFileSizeMb: this.config.maxFileSizeMb,
        embeddingsEnabled: this.config.embeddingsEnabled,
        embeddingProvider: this.config.embeddingProvider,
        embeddingModel: this.config.embeddingModel,
        embeddingModelAvailable,
        indexedDocumentCount: Number(docCount.count),
        chunkCount: Number(chunkCount.count),
        embeddingCount: Number(embeddingCount.count),
        lastIndexJob: lastJob
          ? {
              id: Number(lastJob.id),
              jobType: String(lastJob.job_type) as "scan" | "index" | "reindex",
              status: String(lastJob.status) as "started" | "running" | "completed" | "error",
              rootPath: String(lastJob.root_path),
              filesSeen: Number(lastJob.files_seen),
              filesIndexed: Number(lastJob.files_indexed),
              chunksCreated: Number(lastJob.chunks_created),
              startedAt: String(lastJob.started_at),
              finishedAt: lastJob.finished_at ? String(lastJob.finished_at) : null,
            }
          : undefined,
      };
    } catch (error) {
      console.error("Error getting RAG status:", error);
      throw error;
    }
  }

  createSource(
    sourceKey: string,
    displayName: string,
    rootPath: string,
    projectKey?: string,
    sourceType: "folder" | "project" | "root" = "folder",
  ): RagSource {
    if (!validateAllowedPath(rootPath, this.config)) {
      throw new Error(`Root path not in allowed roots: ${rootPath}`);
    }

    const stmt = this.#db.prepare(`
      INSERT OR REPLACE INTO rag_sources (source_key, project_key, source_type, root_path, display_name)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(sourceKey, projectKey || null, sourceType, rootPath, displayName);

    const row = this.#db.prepare("SELECT * FROM rag_sources WHERE source_key = ?").get(sourceKey) as Row;
    return rowToSource(row);
  }

  async indexFolder(
    rootPath: string,
    projectKey?: string,
    sourceKey?: string,
    force: boolean = false,
    createEmbeddings: boolean = false,
  ): Promise<RagIndexJob> {
    if (!validateAllowedPath(rootPath, this.config)) {
      throw new Error(`Root path not in allowed roots: ${rootPath}`);
    }

    // Create index job record
    const jobStmt = this.#db.prepare(`
      INSERT INTO rag_index_jobs (job_type, status, root_path, project_key)
      VALUES (?, ?, ?, ?)
    `);

    const jobResult = jobStmt.run("index", "running", rootPath, projectKey || null);
    const jobId = Number(jobResult.lastInsertRowid);

    try {
      const { files, errors } = scanDirectory(rootPath, this.config);
      let filesIndexed = 0;
      let chunksCreated = 0;
      const indexErrors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        try {
          const indexed = await this.indexFile(file.path, projectKey, sourceKey, force, createEmbeddings);
          if (indexed) {
            filesIndexed++;
            // Count chunks for this document
            const doc = this.#db
              .prepare("SELECT id FROM rag_documents WHERE file_path = ?")
              .get(file.path) as Row | undefined;
            if (doc) {
              const chunks = this.#db
                .prepare("SELECT COUNT(*) as count FROM rag_chunks WHERE document_id = ?")
                .get(doc.id) as Row;
              chunksCreated += Number(chunks.count);
            }
          }
        } catch (error) {
          indexErrors.push({
            file: file.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Update job record
      const updateStmt = this.#db.prepare(`
        UPDATE rag_index_jobs
        SET status = ?, files_seen = ?, files_indexed = ?, chunks_created = ?, errors = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      updateStmt.run(
        "completed",
        files.length,
        filesIndexed,
        chunksCreated,
        indexErrors.length > 0 ? JSON.stringify(indexErrors) : null,
        jobId,
      );

      const finalJob = this.#db.prepare("SELECT * FROM rag_index_jobs WHERE id = ?").get(jobId) as Row;
      return this.rowToIndexJob(finalJob);
    } catch (error) {
      const updateStmt = this.#db.prepare(`
        UPDATE rag_index_jobs
        SET status = ?, errors = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      updateStmt.run("error", JSON.stringify([{ error: error instanceof Error ? error.message : String(error) }]), jobId);

      const finalJob = this.#db.prepare("SELECT * FROM rag_index_jobs WHERE id = ?").get(jobId) as Row;
      return this.rowToIndexJob(finalJob);
    }
  }

  async indexFile(
    filePath: string,
    projectKey?: string,
    sourceKey?: string,
    force: boolean = false,
    createEmbeddings: boolean = false,
  ): Promise<boolean> {
    if (!validateAllowedPath(filePath, this.config)) {
      return false;
    }

    if (isExcludedPath(filePath, this.config)) {
      return false;
    }

    if (!isSupportedFileType(filePath)) {
      return false;
    }

    if (!existsSync(filePath)) {
      return false;
    }

    try {
      const stat = statSync(filePath);
      const sizeInMb = stat.size / (1024 * 1024);

      if (sizeInMb > this.config.maxFileSizeMb) {
        return false;
      }

      // Calculate file hash
      const fileHash = hashFile(filePath);

      // Check if file already indexed with same hash
      const existingDoc = this.#db
        .prepare("SELECT * FROM rag_documents WHERE file_path = ?")
        .get(filePath) as Row | undefined;

      if (existingDoc && !force && existingDoc.file_hash === fileHash) {
        return false; // Already indexed with no changes
      }

      // Extract text
      const text = extractTextFromFile(filePath);
      if (!text || text.trim().length === 0) {
        return false;
      }

      // Create or update document record
      let documentId: number;

      if (existingDoc) {
        const updateStmt = this.#db.prepare(`
          UPDATE rag_documents
          SET file_hash = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateStmt.run(fileHash, existingDoc.id);
        documentId = Number(existingDoc.id);

        // Delete old chunks
        this.#db.prepare("DELETE FROM rag_chunks WHERE document_id = ?").run(documentId);
      } else {
        const insertStmt = this.#db.prepare(`
          INSERT INTO rag_documents (source_id, project_key, file_path, file_name, file_ext, file_size, file_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const sourceId = sourceKey
          ? (this.#db.prepare("SELECT id FROM rag_sources WHERE source_key = ?").get(sourceKey) as Row | undefined)?.id
          : null;

        const fileName = filePath.split(/[\\/]/).pop() || "unknown";
        const fileExt = fileName.substring(fileName.lastIndexOf(".")) || "";

        const result = insertStmt.run(sourceId || null, projectKey || null, filePath, fileName, fileExt, stat.size, fileHash);
        documentId = Number(result.lastInsertRowid);
      }

      // Create chunks
      const chunks = chunkText(text, this.config.chunkSize, this.config.chunkOverlap);
      const chunkStmt = this.#db.prepare(`
        INSERT INTO rag_chunks (document_id, chunk_index, content, content_hash, token_estimate)
        VALUES (?, ?, ?, ?, ?)
      `);

      let chunkCount = 0;
      for (const chunk of chunks) {
        const contentHash = hashContent(chunk.content);
        const tokens = estimateTokens(chunk.content);
        chunkStmt.run(documentId, chunk.index, chunk.content, contentHash, tokens);
        chunkCount++;

        // Create embeddings if enabled
        if (createEmbeddings && this.config.embeddingsEnabled && this.config.embeddingProvider === "ollama") {
          try {
            const embedding = await embedChunkWithOllama(chunk.content, this.config.embeddingModel, process.env.OLLAMA_BASE_URL);
            if (embedding && embedding.length > 0) {
              const chunkId = this.#db.prepare("SELECT last_insert_rowid() as id").get() as Row;
              const embeddingStmt = this.#db.prepare(`
                INSERT OR REPLACE INTO rag_embeddings (chunk_id, provider, model, dimensions, embedding_json)
                VALUES (?, ?, ?, ?, ?)
              `);
              embeddingStmt.run(
                Number(chunkId.id),
                "ollama",
                this.config.embeddingModel,
                embedding.length,
                JSON.stringify(embedding),
              );
            }
          } catch (error) {
            console.warn("Failed to create embedding for chunk:", error);
          }
        }
      }

      // Update document status
      const updateStatusStmt = this.#db.prepare(`
        UPDATE rag_documents
        SET status = ?, indexed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStatusStmt.run("indexed", documentId);

      return true;
    } catch (error) {
      console.error("Error indexing file:", filePath, error);
      return false;
    }
  }

  async search(
    query: string,
    mode: "keyword" | "hybrid" | "embeddings" = "keyword",
    projectKey?: string,
    topK?: number,
  ): Promise<RagSearchResult[]> {
    const k = topK || this.config.topK;

    // Log the query
    const logStmt = this.#db.prepare(`
      INSERT INTO rag_queries (query, project_key, mode, top_k)
      VALUES (?, ?, ?, ?)
    `);
    logStmt.run(query, projectKey || null, mode, k);

    if (mode === "keyword") {
      return this.keywordSearch(query, projectKey, k);
    } else if (mode === "hybrid") {
      if (this.config.embeddingsEnabled && (await isOllamaAvailable(process.env.OLLAMA_BASE_URL))) {
        return this.hybridSearch(query, projectKey, k);
      } else {
        return this.keywordSearch(query, projectKey, k);
      }
    } else if (mode === "embeddings") {
      if (!this.config.embeddingsEnabled || !this.config.embeddingProvider) {
        throw new Error("Embeddings not enabled or not configured");
      }
      return this.embeddingSearch(query, projectKey, k);
    }

    return [];
  }

  private keywordSearch(query: string, projectKey?: string, topK: number = 8): RagSearchResult[] {
    const results = searchKeywords(query, this.#db, topK, projectKey);
    return results as RagSearchResult[];
  }

  private async hybridSearch(query: string, projectKey?: string, topK: number = 8): Promise<RagSearchResult[]> {
    // Try embedding-based search first, fall back to keyword
    try {
      return await this.embeddingSearch(query, projectKey, topK);
    } catch {
      return this.keywordSearch(query, projectKey, topK);
    }
  }

  private async embeddingSearch(query: string, projectKey?: string, topK: number = 8): Promise<RagSearchResult[]> {
    const embedding = await embedChunkWithOllama(query, this.config.embeddingModel, process.env.OLLAMA_BASE_URL);

    if (!embedding || embedding.length === 0) {
      // Fall back to keyword search
      return this.keywordSearch(query, projectKey, topK);
    }

    // Search embeddings using cosine similarity
    const results = this.#db
      .prepare(`
        SELECT
          c.id as chunkId,
          c.document_id as documentId,
          d.file_path as documentPath,
          d.file_name as documentName,
          c.chunk_index as chunkIndex,
          c.content
        FROM rag_embeddings e
        JOIN rag_chunks c ON e.chunk_id = c.id
        JOIN rag_documents d ON c.document_id = d.id
        WHERE 1=1
      `)
      .all() as Array<{
        chunkId: number;
        documentId: number;
        documentPath: string;
        documentName: string;
        chunkIndex: number;
        content: string;
      }>;

    // Calculate similarity scores
    const scored = results.map((r) => {
      const embRow = this.#db.prepare("SELECT embedding_json FROM rag_embeddings WHERE chunk_id = ?").get(r.chunkId) as Row;
      const chunkEmbedding = JSON.parse(String(embRow.embedding_json)) as number[];
      const score = cosineSimilarity(embedding, chunkEmbedding);
      return { ...r, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentPath: r.documentPath,
        documentName: r.documentName,
        chunkIndex: r.chunkIndex,
        content: r.content,
        score: r.score,
        model: this.config.embeddingModel,
      }));
  }

  async buildContext(
    query: string,
    projectKey?: string,
    topK: number = 8,
    includeMemory: boolean = true,
    includeProjectNotes: boolean = true,
    includeDocuments: boolean = true,
  ): Promise<RagContext> {
    let contextParts: string[] = [];
    const sources = new Map<string, Set<number>>();

    // Get document chunks
    if (includeDocuments) {
      const results = await this.search(query, "keyword", projectKey, topK);
      for (const result of results) {
        contextParts.push(`[${result.documentName}] ${result.content}`);

        if (!sources.has(result.documentPath)) {
          sources.set(result.documentPath, new Set());
        }
        sources.get(result.documentPath)!.add(result.chunkIndex);
      }
    }

    const contextText = contextParts.join("\n\n");

    return {
      context: contextText,
      sources: Array.from(sources.entries()).map(([path, chunks]) => ({
        documentPath: path,
        documentName: path.split(/[\\/]/).pop() || "unknown",
        chunks: Array.from(chunks).sort((a, b) => a - b),
      })),
    };
  }

  listDocuments(projectKey?: string): RagDocument[] {
    let sql = "SELECT * FROM rag_documents WHERE 1=1";
    const params: unknown[] = [];

    if (projectKey) {
      sql += " AND project_key = ?";
      params.push(projectKey);
    }

    const rows = this.#db.prepare(sql).all(...params) as Row[];
    return rows.map(rowToDocument);
  }

  getDocumentChunks(documentId: number): RagChunk[] {
    const rows = this.#db
      .prepare("SELECT * FROM rag_chunks WHERE document_id = ? ORDER BY chunk_index")
      .all(documentId) as Row[];
    return rows.map(rowToChunk);
  }

  deleteDocumentIndexOnly(documentId: number): void {
    // Only delete index records, not the source file
    this.#db.prepare("DELETE FROM rag_chunks WHERE document_id = ?").run(documentId);
    this.#db.prepare("DELETE FROM rag_embeddings WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE document_id = ?)").run(documentId);

    // Update document status
    this.#db.prepare("UPDATE rag_documents SET status = ?, indexed_at = NULL WHERE id = ?").run("pending", documentId);
  }

  listSources(): RagSource[] {
    const rows = this.#db.prepare("SELECT * FROM rag_sources ORDER BY created_at DESC").all() as Row[];
    return rows.map(rowToSource);
  }

  private rowToIndexJob(row: Row): RagIndexJob {
    return {
      id: Number(row.id),
      jobType: String(row.job_type) as "scan" | "index" | "reindex",
      status: String(row.status) as "started" | "running" | "completed" | "error",
      rootPath: String(row.root_path),
      projectKey: row.project_key ? String(row.project_key) : null,
      filesSeen: Number(row.files_seen),
      filesIndexed: Number(row.files_indexed),
      chunksCreated: Number(row.chunks_created),
      errors: row.errors ? JSON.parse(String(row.errors)) : null,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
