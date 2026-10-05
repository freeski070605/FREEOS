import { existsSync } from "node:fs";
import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

const strategicRanks: Record<string, number> = {
  freeos: 1,
  "dfb-solutions": 2,
  "dfb-ai-studio": 3,
  "dfb-social-os": 3,
  "still-raising-drew": 4,
  "get-ya-5": 4,
  "chester-world": 4,
  reemteam: 5,
  "dfb-sounds": 6,
  "dfb-transportation": 7,
  "client-builds": 7,
  "divine-decor": 7,
  "business-ideas": 8,
  signalflow: 8,
};

function db(): Database {
  return getToolRegistry().database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function count(database: Database, table: string, where: string, ...params: unknown[]): number {
  if (!tableExists(database, table)) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params) as { count: number };
  return Number(row.count ?? 0);
}

function portfolioScore(rank: number | null): number {
  if (rank == null) return 10;
  const scores: Record<number, number> = { 1: 100, 2: 90, 3: 80, 4: 70, 5: 60, 6: 50, 7: 40, 8: 30 };
  return scores[rank] ?? 10;
}

function readinessBand(score: number): "READY" | "WORKABLE" | "EVIDENCE_POOR" {
  if (score >= 60) return "READY";
  if (score >= 30) return "WORKABLE";
  return "EVIDENCE_POOR";
}

function scoreEvidence(database: Database, projectKey: string, folderPath: string) {
  const approvedMemories = count(database, "memories", "project_key=? AND status='approved'", projectKey);
  const projectNotes = count(database, "project_notes", "project_key=?", projectKey);
  const ragDocuments = count(database, "rag_documents", "project_key=? AND status='indexed'", projectKey);
  const currentIntelligence = count(database, "current_intelligence_items", "project_key=? AND status='current'", projectKey);
  const experienceEvents = count(database, "experience_events", "project_key=?", projectKey);
  const researchSessions = count(database, "research_sessions", "project_key=?", projectKey);
  const folderAvailable = Boolean(folderPath && existsSync(folderPath));

  const score = Math.min(100,
    Math.min(40, approvedMemories * 20) +
    Math.min(20, projectNotes * 10) +
    Math.min(20, ragDocuments * 5) +
    Math.min(10, currentIntelligence * 10) +
    Math.min(5, experienceEvents * 5) +
    Math.min(5, researchSessions * 5) +
    (folderAvailable ? 20 : 0)
  );

  return {
    score,
    band: readinessBand(score),
    counts: { approvedMemories, projectNotes, ragDocuments, currentIntelligence, experienceEvents, researchSessions },
    folderAvailable,
  };
}

export function rankOpenProjectEducation() {
  const database = db();
  if (!tableExists(database, "continuous_learning_queue") || !tableExists(database, "projects")) {
    return { items: [], rule: "No project-learning queue is available yet." };
  }

  const rows = database.prepare(`
    SELECT q.id AS queue_id, q.project_key, q.title, q.priority, q.status,
           p.name, p.description, p.folder_path, p.status AS project_status
    FROM continuous_learning_queue q
    JOIN projects p ON p.project_key=q.project_key
    WHERE q.status='open'
      AND q.signal_type='project-education'
      AND p.status='active'
    ORDER BY q.id
  `).all() as Row[];

  const items = rows.map((row) => {
    const projectKey = String(row.project_key);
    const strategicRank = strategicRanks[projectKey] ?? null;
    const strategicScore = portfolioScore(strategicRank);
    const evidence = scoreEvidence(database, projectKey, String(row.folder_path ?? ""));
    const combinedScore = Math.round(strategicScore * 0.55 + evidence.score * 0.45);
    const nextAction = evidence.band === "EVIDENCE_POOR"
      ? "Locate/register real project evidence before attempting canonicalization."
      : evidence.band === "WORKABLE"
        ? "Run project inspection and resolve remaining UNKNOWNs from the strongest available local evidence."
        : "Prioritize inspection/review now; enough project-specific evidence exists to make meaningful progress.";

    return {
      queueItemId: Number(row.queue_id),
      projectKey,
      projectName: String(row.name),
      title: String(row.title),
      strategicRank,
      strategicScore,
      evidenceReadinessScore: evidence.score,
      evidenceReadinessBand: evidence.band,
      combinedScore,
      evidence: {
        ...evidence.counts,
        folderAvailable: evidence.folderAvailable,
      },
      nextAction,
    };
  }).sort((a, b) =>
    b.combinedScore - a.combinedScore ||
    b.evidenceReadinessScore - a.evidenceReadinessScore ||
    (a.strategicRank ?? 99) - (b.strategicRank ?? 99) ||
    a.projectName.localeCompare(b.projectName),
  ).map((item, index) => ({ rank: index + 1, ...item }));

  return {
    items,
    weights: { strategicPriority: 0.55, evidenceReadiness: 0.45 },
    strategicSource: "docs/knowledge/08_DFB_EXECUTIVE_LAYER.md",
    rule: "Rank project-education work by DFB strategic priority and evidence readiness. Empty projects should not block better-supported higher-value learning work.",
  };
}

export function nextRankedProjectEducationQueueItemId(): number | null {
  const ranked = rankOpenProjectEducation().items;
  return ranked.length ? ranked[0].queueItemId : null;
}
