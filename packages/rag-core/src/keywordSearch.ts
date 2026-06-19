import Database from "better-sqlite3";

export interface KeywordSearchResult {
  chunkId: number;
  documentId: number;
  documentPath: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export function searchKeywords(
  query: string,
  db: Database.Database,
  topK: number = 8,
  projectKey?: string,
): KeywordSearchResult[] {
  // Simple keyword search using LIKE and basic scoring
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 2)
    .slice(0, 5); // Limit to first 5 keywords

  if (keywords.length === 0) {
    return [];
  }

  // Build query that searches in chunks and ranks by relevance
  let sql = `
    SELECT
      c.id as chunkId,
      c.document_id as documentId,
      d.file_path as documentPath,
      d.file_name as documentName,
      c.chunk_index as chunkIndex,
      c.content,
      COUNT(CASE WHEN 1=1 THEN 1 END) as score
    FROM rag_chunks c
    JOIN rag_documents d ON c.document_id = d.id
    WHERE 1=1
  `;

  const params: unknown[] = [];

  // Add keyword conditions
  for (const keyword of keywords) {
    sql += ` AND c.content LIKE ?`;
    params.push(`%${keyword}%`);
  }

  // Add project filter if provided
  if (projectKey) {
    sql += ` AND (d.project_key = ? OR d.project_key IS NULL)`;
    params.push(projectKey);
  }

  sql += ` GROUP BY c.id ORDER BY score DESC LIMIT ?`;
  params.push(topK);

  try {
    const results = db.prepare(sql).all(...params) as Array<{
      chunkId: number;
      documentId: number;
      documentPath: string;
      documentName: string;
      chunkIndex: number;
      content: string;
      score: number;
    }>;

    // Recalculate score based on keyword matches
    return results.map((r) => {
      let score = 0;
      const contentLower = r.content.toLowerCase();
      for (const keyword of keywords) {
        const matches = (contentLower.match(new RegExp(keyword, "g")) || []).length;
        score += matches * (100 / keywords.length);
      }
      return {
        ...r,
        score: Math.min(100, score),
      };
    });
  } catch (error) {
    console.error("Keyword search error:", error);
    return [];
  }
}

// Full-text search using SQLite FTS5 if available
export function setupFtsIndex(db: Database.Database): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        content,
        content=rag_chunks,
        content_rowid=id
      );
    `);
  } catch (error) {
    // FTS5 might not be available, that's okay
    console.warn("FTS5 not available, using basic keyword search");
  }
}

export function searchFts(
  query: string,
  db: Database.Database,
  topK: number = 8,
  projectKey?: string,
): KeywordSearchResult[] {
  try {
    let sql = `
      SELECT
        c.id as chunkId,
        c.document_id as documentId,
        d.file_path as documentPath,
        d.file_name as documentName,
        c.chunk_index as chunkIndex,
        c.content,
        rank as score
      FROM rag_chunks_fts
      JOIN rag_chunks c ON rag_chunks_fts.rowid = c.id
      JOIN rag_documents d ON c.document_id = d.id
      WHERE rag_chunks_fts MATCH ?
    `;

    const params: unknown[] = [query];

    if (projectKey) {
      sql += ` AND (d.project_key = ? OR d.project_key IS NULL)`;
      params.push(projectKey);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(topK);

    const results = db.prepare(sql).all(...params) as Array<{
      chunkId: number;
      documentId: number;
      documentPath: string;
      documentName: string;
      chunkIndex: number;
      content: string;
      score: number;
    }>;

    return results.map((r) => ({
      ...r,
      score: Math.abs(r.score * 10), // Convert rank to positive score
    }));
  } catch (error) {
    // Fallback to keyword search if FTS fails
    return searchKeywords(query, db, topK, projectKey);
  }
}
