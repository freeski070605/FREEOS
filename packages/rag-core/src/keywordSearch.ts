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

export interface KeywordSearchDebug {
  query: string;
  normalizedQuery: string;
  expandedQueriesTried: string[];
  termsUsed: string[];
  fallbackUsed: boolean;
  resultsCount: number;
  documentsSearched: number;
  chunksSearched: number;
}

export interface KeywordSearchWithDebugResult {
  results: KeywordSearchResult[];
  debug: KeywordSearchDebug;
}

interface SearchRow {
  chunkId: number;
  documentId: number;
  documentPath: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  documentTitle: string | null;
}

const STOPWORDS = new Set([
  "who", "what", "where", "when", "why", "how", "is", "are", "was", "were", "am",
  "be", "been", "being", "the", "a", "an", "of", "to", "for", "with", "about", "using",
  "indexed", "documents", "document", "explain", "tell", "me",
]);

const PHRASE_BOOSTS = [
  "Drew Free",
  "FREEOS Owner Profile",
  "owner profile",
  "final authority",
  "creator",
  "Bryan-Michael Cox",
  "Babyface",
  "Drew-fit",
  "local-first",
  "music",
  "R&B",
];

function canonicalize(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9&\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const canonical = canonicalize(value);
  return canonical ? canonical.split(" ").filter(Boolean) : [];
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeQuery(query: string): { normalizedQuery: string; tokens: string[] } {
  const tokens = tokenize(query).filter((token) => !STOPWORDS.has(token));
  return { normalizedQuery: tokens.join(" "), tokens };
}

function buildQueryExpansion(normalizedQuery: string): string[] {
  const terms = new Set(tokenize(normalizedQuery));
  const expansions: string[] = [];

  if (/\bdrew free\b/.test(normalizedQuery)) {
    expansions.push("owner creator final authority FREEOS");
  }
  if (/\bdrew fit\b/.test(normalizedQuery)) {
    expansions.push("correction music R&B tech local-first");
  }
  if (terms.has("bryan") && terms.has("babyface")) {
    expansions.push("Bryan-Michael Cox Babyface hook correction music R&B tech local-first Drew-fit");
  }

  return expansions;
}

function hasFtsIndex(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks_fts'").get() as { found?: number } | undefined;
    return row?.found === 1;
  } catch {
    return false;
  }
}

function projectClause(projectKey?: string): { sql: string; params: unknown[] } {
  return projectKey
    ? { sql: " AND (d.project_key = ? OR d.project_key IS NULL)", params: [projectKey] }
    : { sql: "", params: [] };
}

function getCorpusCounts(db: Database.Database, projectKey?: string): { documents: number; chunks: number } {
  const project = projectClause(projectKey);
  const row = db.prepare(`
    SELECT COUNT(DISTINCT d.id) AS documents, COUNT(c.id) AS chunks
    FROM rag_documents d
    LEFT JOIN rag_chunks c ON c.document_id = d.id
    WHERE d.status = 'indexed'${project.sql}
  `).get(...project.params) as { documents: number; chunks: number };
  return { documents: Number(row.documents), chunks: Number(row.chunks) };
}

function relevantPhraseBoosts(terms: string[]): string[] {
  const termSet = new Set(terms);
  return PHRASE_BOOSTS
    .map(canonicalize)
    .filter((phrase) => tokenize(phrase).some((token) => termSet.has(token)));
}

function scoreRow(row: SearchRow, terms: string[], normalizedQuery: string): { score: number; matchedTerms: number } {
  const fields = [
    { value: canonicalize(row.content), weight: 1 },
    { value: canonicalize(row.documentPath), weight: 2 },
    { value: canonicalize(row.documentName), weight: 3 },
    { value: canonicalize(row.documentTitle ?? ""), weight: 3 },
  ];
  const fieldTokens = fields.map((field) => new Set(tokenize(field.value)));
  let score = 0;
  let matchedTerms = 0;

  for (const term of terms) {
    let matched = false;
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!fieldTokens[index].has(term)) continue;
      matched = true;
      const occurrences = field.value.split(term).length - 1;
      score += field.weight * (12 + Math.min(occurrences, 5) * 3);
    }
    if (matched) matchedTerms += 1;
  }

  // Unique token overlap is the primary ranking signal. Field and phrase boosts break ties.
  score += matchedTerms * 100;
  if (normalizedQuery) {
    for (const field of fields) {
      if (field.value.includes(normalizedQuery)) score += field.weight * 60;
    }
  }
  for (const phrase of relevantPhraseBoosts(terms)) {
    for (const field of fields) {
      if (field.value.includes(phrase)) score += field.weight * 35;
    }
  }

  return { score, matchedTerms };
}

function rankRows(rows: SearchRow[], terms: string[], normalizedQuery: string, topK: number): KeywordSearchResult[] {
  return rows
    .map((row) => ({ row, ...scoreRow(row, terms, normalizedQuery) }))
    .filter((candidate) => candidate.matchedTerms >= 1)
    .sort((a, b) => b.matchedTerms - a.matchedTerms || b.score - a.score || a.row.chunkIndex - b.row.chunkIndex)
    .slice(0, topK)
    .map(({ row, score }) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      documentPath: row.documentPath,
      documentName: row.documentName,
      chunkIndex: row.chunkIndex,
      content: row.content,
      score,
    }));
}

function ftsExpression(query: string): string {
  return unique(tokenize(query))
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function searchFtsRows(query: string, db: Database.Database, limit: number, projectKey?: string): SearchRow[] {
  const expression = ftsExpression(query);
  if (!hasFtsIndex(db) || !expression) return [];
  const project = projectClause(projectKey);

  try {
    return db.prepare(`
      SELECT c.id AS chunkId, c.document_id AS documentId, d.file_path AS documentPath,
        d.file_name AS documentName, c.chunk_index AS chunkIndex, c.content,
        d.title AS documentTitle
      FROM rag_chunks_fts
      JOIN rag_chunks c ON rag_chunks_fts.rowid = c.id
      JOIN rag_documents d ON c.document_id = d.id
      WHERE rag_chunks_fts MATCH ? AND d.status = 'indexed'${project.sql}
      ORDER BY rank
      LIMIT ?
    `).all(expression, ...project.params, limit) as SearchRow[];
  } catch (error) {
    console.error("FTS search error:", error);
    return [];
  }
}

function canonicalSqlField(field: string): string {
  return `replace(replace(lower(COALESCE(${field}, '')), '-', ' '), '_', ' ')`;
}

function searchLikePhrases(phrases: string[], db: Database.Database, projectKey?: string): SearchRow[] {
  const meaningfulPhrases = unique(phrases.map(canonicalize).filter(Boolean));
  if (meaningfulPhrases.length === 0) return [];

  const fields = ["c.content", "d.file_path", "d.file_name", "d.title"];
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const phrase of meaningfulPhrases) {
    for (const field of fields) {
      conditions.push(`${canonicalSqlField(field)} LIKE ?`);
      params.push(`%${phrase}%`);
    }
  }
  const project = projectClause(projectKey);

  return db.prepare(`
    SELECT c.id AS chunkId, c.document_id AS documentId, d.file_path AS documentPath,
      d.file_name AS documentName, c.chunk_index AS chunkIndex, c.content,
      d.title AS documentTitle
    FROM rag_chunks c
    JOIN rag_documents d ON c.document_id = d.id
    WHERE d.status = 'indexed' AND (${conditions.join(" OR ")})${project.sql}
  `).all(...params, ...project.params) as SearchRow[];
}

function getAllChunkRows(db: Database.Database, projectKey?: string): SearchRow[] {
  const project = projectClause(projectKey);
  return db.prepare(`
    SELECT c.id AS chunkId, c.document_id AS documentId, d.file_path AS documentPath,
      d.file_name AS documentName, c.chunk_index AS chunkIndex, c.content,
      d.title AS documentTitle
    FROM rag_chunks c
    JOIN rag_documents d ON c.document_id = d.id
    WHERE d.status = 'indexed'${project.sql}
  `).all(...project.params) as SearchRow[];
}

export function searchKeywords(query: string, db: Database.Database, topK: number = 8, projectKey?: string): KeywordSearchResult[] {
  return searchKeywordsWithDebug(query, db, topK, projectKey).results;
}

export function searchKeywordsWithDebug(
  query: string,
  db: Database.Database,
  topK: number = 8,
  projectKey?: string,
): KeywordSearchWithDebugResult {
  const normalized = normalizeQuery(query);
  const expansions = buildQueryExpansion(normalized.normalizedQuery);
  const expandedQuery = [normalized.normalizedQuery, ...expansions].filter(Boolean).join(" ");
  const expandedQueriesTried = unique([normalized.normalizedQuery, expandedQuery].filter(Boolean));
  const termsUsed = unique(tokenize(expandedQuery));
  const corpus = getCorpusCounts(db, projectKey);
  const safeTopK = Math.max(1, Math.floor(topK));

  let fallbackUsed = false;
  let rows: SearchRow[] = [];
  for (const variant of expandedQueriesTried) {
    rows.push(...searchFtsRows(variant, db, Math.max(safeTopK * 20, 100), projectKey));
  }
  rows = Array.from(new Map(rows.map((row) => [row.chunkId, row])).values());

  if (rows.length === 0) {
    fallbackUsed = true;
    rows = searchLikePhrases(expandedQueriesTried, db, projectKey);
  } else {
    // FTS indexes chunk content only. Add exact metadata phrase matches so path,
    // filename, and title boosts can still introduce an otherwise unseen document.
    const metadataMatches = searchLikePhrases(expandedQueriesTried, db, projectKey);
    rows = Array.from(new Map([...rows, ...metadataMatches].map((row) => [row.chunkId, row])).values());
  }
  if (rows.length === 0) {
    // Final fallback intentionally scores every eligible chunk and accepts any strong token match.
    rows = getAllChunkRows(db, projectKey);
  }

  const results = rankRows(rows, termsUsed, normalized.normalizedQuery, safeTopK);
  return {
    results,
    debug: {
      query,
      normalizedQuery: normalized.normalizedQuery,
      expandedQueriesTried,
      termsUsed,
      fallbackUsed,
      resultsCount: results.length,
      documentsSearched: corpus.documents,
      chunksSearched: corpus.chunks,
    },
  };
}

export function setupFtsIndex(db: Database.Database): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        content,
        content=rag_chunks,
        content_rowid=id
      );
    `);
  } catch {
    console.warn("FTS5 not available, using basic keyword search");
  }
}

export function searchFts(query: string, db: Database.Database, topK: number = 8, projectKey?: string): KeywordSearchResult[] {
  const normalized = normalizeQuery(query);
  return rankRows(searchFtsRows(query, db, topK, projectKey), normalized.tokens, normalized.normalizedQuery, topK);
}
