import Database from "better-sqlite3";
import type { RagConfig } from "./rag.config";
import type { RagContext, RagSearchResult } from "./rag.types";
import { RagService as BaseRagService } from "./ragService";

type RagMode = "keyword" | "hybrid" | "embeddings";
type Row = Record<string, unknown>;

type GovernanceMeta = {
  recordId: number | null;
  authority: string;
  authorityRank: number;
  status: string;
  confidence: string;
  baselineRole: "canonical" | "supporting" | null;
  directProject: boolean;
  governedScore: number;
};

type GovernedResult = RagSearchResult & { governance: GovernanceMeta };

const confidenceBonus: Record<string, number> = {
  confirmed: 0.02,
  high: 0.015,
  moderate: 0.01,
  low: 0.005,
  unverified: 0,
  disputed: -0.02,
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

/**
 * Governance-aware wrapper around the existing RAG service.
 *
 * Important behavior:
 * - retrieval relevance still finds the candidate pool;
 * - active governed knowledge is re-ranked using authority and project baseline role;
 * - superseded, archived, stale, and disputed documents are excluded from default retrieval;
 * - project-scoped queries may include global documents only when they are explicitly
 *   baselined for that project or are high-authority global canonical knowledge;
 * - if governance has not been bootstrapped yet, the legacy retrieval behavior is preserved.
 */
export class RagService extends BaseRagService {
  readonly #governanceDb: Database.Database;

  constructor(config: RagConfig, db: Database.Database) {
    super(config, db);
    this.#governanceDb = db;
  }

  private governanceReady(): boolean {
    return tableExists(this.#governanceDb, "knowledge_records") && tableExists(this.#governanceDb, "knowledge_baselines");
  }

  private governanceFor(documentId: number, projectKey?: string) {
    const row = this.#governanceDb.prepare(`
      SELECT
        rd.project_key AS document_project_key,
        kr.id AS record_id,
        kr.authority,
        kr.authority_rank,
        kr.status,
        kr.confidence,
        kb.role AS baseline_role
      FROM rag_documents rd
      LEFT JOIN knowledge_records kr
        ON kr.source_type = 'rag-document'
       AND kr.source_ref = rd.file_path
      LEFT JOIN knowledge_baselines kb
        ON kb.knowledge_record_id = kr.id
       AND kb.project_key = ?
      WHERE rd.id = ?
      ORDER BY kr.authority_rank DESC
      LIMIT 1
    `).get(projectKey ?? "", documentId) as Row | undefined;

    const documentProjectKey = row?.document_project_key == null ? null : String(row.document_project_key);
    const authorityRank = row?.authority_rank == null ? 30 : Number(row.authority_rank);
    const authority = row?.authority == null ? "unapproved-draft" : String(row.authority);
    const status = row?.status == null ? "active" : String(row.status);
    const confidence = row?.confidence == null ? "moderate" : String(row.confidence);
    const baselineRole = row?.baseline_role === "canonical" || row?.baseline_role === "supporting"
      ? row.baseline_role
      : null;

    return {
      recordId: row?.record_id == null ? null : Number(row.record_id),
      documentProjectKey,
      authority,
      authorityRank,
      status,
      confidence,
      baselineRole,
      directProject: Boolean(projectKey && documentProjectKey === projectKey),
    };
  }

  private governResults(results: RagSearchResult[], projectKey: string | undefined, topK: number): GovernedResult[] {
    if (!this.governanceReady()) {
      return results.slice(0, topK).map((result, index) => ({
        ...result,
        governance: {
          recordId: null,
          authority: "unapproved-draft",
          authorityRank: 30,
          status: "active",
          confidence: "moderate",
          baselineRole: null,
          directProject: false,
          governedScore: 1 - index / Math.max(results.length, 1),
        },
      }));
    }

    const unique = new Map<number, RagSearchResult>();
    for (const result of results) {
      const existing = unique.get(result.chunkId);
      if (!existing || result.score > existing.score) unique.set(result.chunkId, result);
    }

    const rankedByRelevance = [...unique.values()].sort((a, b) => b.score - a.score);
    const denominator = Math.max(rankedByRelevance.length - 1, 1);

    const governed: GovernedResult[] = [];
    rankedByRelevance.forEach((result, index) => {
      const meta = this.governanceFor(result.documentId, projectKey);

      // Default retrieval is intentionally conservative. Historical, stale, and
      // disputed knowledge remains inspectable through Knowledge Governance but
      // cannot silently control a normal RAG answer.
      if (meta.status !== "active") return;

      if (projectKey) {
        const globallyControlling = meta.documentProjectKey === null && meta.authorityRank >= 85;
        if (!meta.directProject && !meta.baselineRole && !globallyControlling) return;
      }

      const relevance = 1 - index / denominator;
      const baselineBoost = meta.baselineRole === "canonical"
        ? 0.10
        : meta.baselineRole === "supporting"
          ? 0.06
          : meta.directProject
            ? 0.04
            : 0;
      const governedScore =
        relevance * 0.70 +
        (meta.authorityRank / 100) * 0.18 +
        baselineBoost +
        (confidenceBonus[meta.confidence] ?? 0);

      governed.push({
        ...result,
        governance: {
          recordId: meta.recordId,
          authority: meta.authority,
          authorityRank: meta.authorityRank,
          status: meta.status,
          confidence: meta.confidence,
          baselineRole: meta.baselineRole,
          directProject: meta.directProject,
          governedScore: Number(governedScore.toFixed(6)),
        },
      });
    });

    return governed
      .sort((a, b) => b.governance.governedScore - a.governance.governedScore)
      .slice(0, topK);
  }

  override async search(
    query: string,
    mode: RagMode = "keyword",
    projectKey?: string,
    topK?: number,
  ): Promise<RagSearchResult[]> {
    const k = Math.max(1, topK ?? this.config.topK);
    if (!this.governanceReady()) return super.search(query, mode, projectKey, k);

    const candidateK = Math.min(Math.max(k * 4, 16), 80);
    const direct = await super.search(query, mode, projectKey, candidateK);
    const global = projectKey
      ? await super.search(query, mode, undefined, candidateK)
      : [];

    return this.governResults([...direct, ...global], projectKey, k);
  }

  override async buildContext(
    query: string,
    projectKey?: string,
    topK: number = 8,
    includeMemory: boolean = true,
    includeProjectNotes: boolean = true,
    includeDocuments: boolean = true,
    mode: RagMode = "keyword",
  ): Promise<RagContext> {
    const result = await super.buildContext(
      query,
      projectKey,
      topK,
      includeMemory,
      includeProjectNotes,
      includeDocuments,
      mode,
    );

    if (!includeDocuments || result.sources.length === 0 || !this.governanceReady()) return result;

    const governedSources = result.sources.map((source) => {
      const doc = this.#governanceDb.prepare("SELECT id FROM rag_documents WHERE file_path = ?").get(source.documentPath) as Row | undefined;
      if (!doc?.id) return `- ${source.documentName}: governance metadata unavailable`;
      const meta = this.governanceFor(Number(doc.id), projectKey);
      const baseline = meta.baselineRole ? `; baseline=${meta.baselineRole}` : "";
      return `- ${source.documentName}: authority=${meta.authority}(${meta.authorityRank}); status=${meta.status}; confidence=${meta.confidence}${baseline}`;
    });

    const governanceHeader = [
      "KNOWLEDGE GOVERNANCE FOR RETRIEVED DOCUMENTS",
      "Only active governed documents were admitted to this document context.",
      "When retrieved sources disagree, prefer the higher-authority source; project canonical baselines outrank supporting context at the same authority. Do not treat retrieval score alone as truth.",
      ...governedSources,
    ].join("\n");

    return {
      ...result,
      context: `${governanceHeader}\n\n${result.context}`,
    };
  }
}
