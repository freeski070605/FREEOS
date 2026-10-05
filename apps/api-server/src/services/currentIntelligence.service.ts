import { createHash } from "node:crypto";
import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";
import {
  type KnowledgeAuthority,
  type KnowledgeConfidence,
  knowledgeDb,
  upsertKnowledgeRecord,
} from "./knowledgeGovernance.service";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const currentIntelligenceSourceClasses = [
  "live-observation",
  "primary-external",
  "reliable-secondary",
  "unverified",
] as const;
export const currentIntelligenceStatuses = ["current", "stale", "disputed", "archived"] as const;
export const currentIntelligenceConfidences = ["confirmed", "high", "moderate", "low", "unverified", "disputed"] as const;

export type CurrentIntelligenceSourceClass = (typeof currentIntelligenceSourceClasses)[number];
export type CurrentIntelligenceStatus = (typeof currentIntelligenceStatuses)[number];
export type CurrentIntelligenceConfidence = (typeof currentIntelligenceConfidences)[number];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS current_intelligence_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE,
        topic TEXT NOT NULL,
        claim TEXT NOT NULL,
        project_key TEXT,
        source_url TEXT NOT NULL,
        source_title TEXT NOT NULL DEFAULT '',
        source_domain TEXT NOT NULL DEFAULT '',
        source_class TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'moderate',
        evidence TEXT NOT NULL DEFAULT '',
        research_result_id INTEGER,
        observed_at TEXT NOT NULL,
        freshness_days INTEGER NOT NULL DEFAULT 7,
        status TEXT NOT NULL DEFAULT 'current',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_current_intel_project ON current_intelligence_items(project_key);
      CREATE INDEX IF NOT EXISTS idx_current_intel_status ON current_intelligence_items(status);
      CREATE INDEX IF NOT EXISTS idx_current_intel_observed ON current_intelligence_items(observed_at DESC);
    `);
    schemaReady = true;
  }
  return database;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertProject(projectKey?: string | null): string | null {
  const key = clean(projectKey);
  if (!key) return null;
  if (!getMemoryStore().getProjectByKey(key)) throw new Error(`Unknown projectKey: ${key}.`);
  return key;
}

function domainFromSource(sourceUrl: string): string {
  if (sourceUrl.startsWith("local://")) return "local";
  try { return new URL(sourceUrl).hostname.replace(/^www\./i, ""); }
  catch { return "unknown"; }
}

function sourceKeyFor(input: { sourceKey?: string; sourceUrl: string; claim: string; projectKey?: string | null }): string {
  const explicit = clean(input.sourceKey);
  if (explicit) return explicit;
  return createHash("sha256")
    .update(`${input.projectKey ?? "global"}\n${input.sourceUrl}\n${input.claim}`)
    .digest("hex");
}

function authorityFor(sourceClass: CurrentIntelligenceSourceClass): KnowledgeAuthority {
  if (sourceClass === "live-observation") return "live-observation";
  if (sourceClass === "primary-external") return "primary-external";
  if (sourceClass === "reliable-secondary") return "reliable-secondary";
  return "unapproved-draft";
}

function knowledgeStatusFor(status: CurrentIntelligenceStatus): "active" | "stale" | "disputed" | "archived" {
  if (status === "current") return "active";
  return status;
}

function confidenceFor(value: CurrentIntelligenceConfidence): KnowledgeConfidence {
  return value;
}

function map(row: Row) {
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key),
    topic: String(row.topic),
    claim: String(row.claim),
    projectKey: row.project_key == null ? null : String(row.project_key),
    sourceUrl: String(row.source_url),
    sourceTitle: String(row.source_title ?? ""),
    sourceDomain: String(row.source_domain ?? ""),
    sourceClass: String(row.source_class) as CurrentIntelligenceSourceClass,
    confidence: String(row.confidence) as CurrentIntelligenceConfidence,
    evidence: String(row.evidence ?? ""),
    researchResultId: row.research_result_id == null ? null : Number(row.research_result_id),
    observedAt: String(row.observed_at),
    freshnessDays: Number(row.freshness_days),
    status: String(row.status) as CurrentIntelligenceStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function registerKnowledge(item: ReturnType<typeof map>) {
  return upsertKnowledgeRecord({
    sourceType: "current-intelligence",
    sourceRef: `current-intel:${item.id}`,
    projectKey: item.projectKey,
    title: item.topic,
    authority: authorityFor(item.sourceClass),
    status: knowledgeStatusFor(item.status),
    confidence: confidenceFor(item.confidence),
    sensitivity: item.projectKey ? "project-restricted" : "internal",
    provenance: `${item.sourceClass}; source=${item.sourceUrl}${item.researchResultId ? `; researchResult=${item.researchResultId}` : ""}`,
    effectiveAt: item.observedAt,
    verifiedAt: item.observedAt,
    freshnessDays: item.freshnessDays,
    notes: item.claim,
  });
}

export function createCurrentIntelligence(input: {
  sourceKey?: string;
  topic: string;
  claim: string;
  projectKey?: string | null;
  sourceUrl: string;
  sourceTitle?: string;
  sourceClass: CurrentIntelligenceSourceClass;
  confidence?: CurrentIntelligenceConfidence;
  evidence?: string;
  researchResultId?: number | null;
  observedAt?: string;
  freshnessDays?: number;
}) {
  const database = db();
  const topic = clean(input.topic);
  const claim = clean(input.claim);
  const sourceUrl = clean(input.sourceUrl);
  if (!topic || !claim || !sourceUrl) throw new Error("topic, claim, and sourceUrl are required.");
  if (!currentIntelligenceSourceClasses.includes(input.sourceClass)) throw new Error("Unknown current intelligence source class.");
  const projectKey = assertProject(input.projectKey);
  const confidence = input.confidence && currentIntelligenceConfidences.includes(input.confidence) ? input.confidence : "moderate";
  const freshnessDays = Number.isFinite(input.freshnessDays) ? Math.max(0, Math.trunc(input.freshnessDays as number)) : 7;
  const observedAt = clean(input.observedAt) || new Date().toISOString();
  if (Number.isNaN(new Date(observedAt).getTime())) throw new Error("observedAt must be a valid date/time.");
  const sourceKey = sourceKeyFor({ sourceKey: input.sourceKey, sourceUrl, claim, projectKey });
  const sourceDomain = domainFromSource(sourceUrl);

  database.prepare(`
    INSERT INTO current_intelligence_items (
      source_key, topic, claim, project_key, source_url, source_title, source_domain,
      source_class, confidence, evidence, research_result_id, observed_at, freshness_days, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current')
    ON CONFLICT(source_key) DO UPDATE SET
      topic = excluded.topic,
      claim = excluded.claim,
      project_key = excluded.project_key,
      source_url = excluded.source_url,
      source_title = excluded.source_title,
      source_domain = excluded.source_domain,
      source_class = excluded.source_class,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      research_result_id = excluded.research_result_id,
      observed_at = excluded.observed_at,
      freshness_days = excluded.freshness_days,
      status = 'current',
      updated_at = CURRENT_TIMESTAMP
  `).run(
    sourceKey, topic, claim, projectKey, sourceUrl, clean(input.sourceTitle), sourceDomain,
    input.sourceClass, confidence, clean(input.evidence), input.researchResultId ?? null,
    observedAt, freshnessDays,
  );

  const row = database.prepare("SELECT * FROM current_intelligence_items WHERE source_key = ?").get(sourceKey) as Row;
  const item = map(row);
  registerKnowledge(item);
  refreshCurrentIntelligenceFreshness();
  return getCurrentIntelligence(item.id)!;
}

export function createCurrentIntelligenceFromResearch(resultId: number, input: {
  topic?: string;
  claim?: string;
  sourceClass?: CurrentIntelligenceSourceClass;
  confidence?: CurrentIntelligenceConfidence;
  freshnessDays?: number;
  observedAt?: string;
}) {
  if (!Number.isInteger(resultId) || resultId < 1) throw new Error("Invalid research result ID.");
  const row = db().prepare(`
    SELECT r.*, COALESCE(s.domain, '') AS domain
    FROM research_results r
    LEFT JOIN research_sources s ON s.result_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(resultId) as Row | undefined;
  if (!row) throw new Error("Research result not found.");
  const claim = clean(input.claim) || clean(row.summary) || clean(row.content_preview) || clean(row.snippet);
  if (!claim) throw new Error("Research result has no usable claim text. Summarize or read it first.");
  return createCurrentIntelligence({
    sourceKey: `research-result:${resultId}`,
    topic: clean(input.topic) || String(row.title),
    claim,
    projectKey: row.project_key == null ? null : String(row.project_key),
    sourceUrl: String(row.url),
    sourceTitle: String(row.title),
    sourceClass: input.sourceClass ?? "reliable-secondary",
    confidence: input.confidence ?? "moderate",
    evidence: `Captured from FREEOS research result #${resultId}.`,
    researchResultId: resultId,
    observedAt: input.observedAt,
    freshnessDays: input.freshnessDays,
  });
}

export function getCurrentIntelligence(id: number) {
  const row = db().prepare("SELECT * FROM current_intelligence_items WHERE id = ?").get(id) as Row | undefined;
  return row ? map(row) : null;
}

export function listCurrentIntelligence(input: { projectKey?: string; status?: CurrentIntelligenceStatus; limit?: number } = {}) {
  refreshCurrentIntelligenceFreshness();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.projectKey?.trim()) { clauses.push("project_key = ?"); params.push(assertProject(input.projectKey)); }
  if (input.status) { clauses.push("status = ?"); params.push(input.status); }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 250);
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (db().prepare(`SELECT * FROM current_intelligence_items ${where} ORDER BY observed_at DESC, id DESC LIMIT ?`).all(...params) as Row[]).map(map);
}

export function refreshCurrentIntelligenceFreshness() {
  const database = db();
  const rows = database.prepare("SELECT * FROM current_intelligence_items WHERE status IN ('current','stale')").all() as Row[];
  const now = Date.now();
  let stale = 0;
  let current = 0;
  for (const row of rows) {
    const item = map(row);
    const ageDays = (now - new Date(item.observedAt).getTime()) / 86_400_000;
    const next: CurrentIntelligenceStatus = ageDays > item.freshnessDays ? "stale" : "current";
    if (next !== item.status) {
      database.prepare("UPDATE current_intelligence_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(next, item.id);
      database.prepare("UPDATE knowledge_records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE source_type='current-intelligence' AND source_ref = ?")
        .run(knowledgeStatusFor(next), `current-intel:${item.id}`);
      if (next === "stale") stale += 1; else current += 1;
    }
  }
  return { stale, current };
}

export function setCurrentIntelligenceStatus(id: number, status: "disputed" | "archived") {
  const existing = getCurrentIntelligence(id);
  if (!existing) throw new Error("Current intelligence item not found.");
  db().prepare("UPDATE current_intelligence_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  knowledgeDb().prepare("UPDATE knowledge_records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE source_type='current-intelligence' AND source_ref = ?")
    .run(status, `current-intel:${id}`);
  return getCurrentIntelligence(id)!;
}

function scopedCandidates(projectKey: string | undefined, status: CurrentIntelligenceStatus) {
  const scoped = projectKey ? listCurrentIntelligence({ projectKey, status, limit: 200 }) : [];
  const global = listCurrentIntelligence({ status, limit: 200 }).filter((item) => item.projectKey === null);
  const unique = new Map<number, ReturnType<typeof map>>();
  for (const item of [...scoped, ...global]) unique.set(item.id, item);
  return [...unique.values()];
}

function rankForQuery(query: string, projectKey: string | undefined, status: CurrentIntelligenceStatus, limit: number) {
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
  return scopedCandidates(projectKey, status)
    .map((item) => {
      const haystack = `${item.topic}\n${item.claim}\n${item.sourceTitle}\n${item.sourceDomain}`.toLowerCase();
      const relevance = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
      const authority = authorityFor(item.sourceClass);
      const authorityRank = Number((knowledgeDb().prepare("SELECT authority_rank FROM knowledge_records WHERE source_type='current-intelligence' AND source_ref = ?").get(`current-intel:${item.id}`) as Row | undefined)?.authority_rank ?? 0);
      return { ...item, relevance, authority, authorityRank };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.authorityRank - a.authorityRank || b.observedAt.localeCompare(a.observedAt))
    .slice(0, limit);
}

export function buildCurrentIntelligenceContext(input: { query: string; projectKey?: string; limit?: number }) {
  const query = clean(input.query);
  const projectKey = input.projectKey?.trim() || undefined;
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 20);
  const ranked = rankForQuery(query, projectKey, "current", limit);
  const staleMatches = rankForQuery(query, projectKey, "stale", Math.min(limit, 5));

  const context = ranked.length === 0 ? "" : [
    "CURRENT INTELLIGENCE",
    "These are freshness-bounded observations, not permanent memory. Prefer newer/higher-authority current evidence when claims conflict. Never treat stale/disputed/archived items as current fact.",
    ...ranked.map((item) => `- [${item.sourceClass}; authority=${item.authority}(${item.authorityRank}); observed=${item.observedAt}; freshness=${item.freshnessDays}d; confidence=${item.confidence}] ${item.topic}: ${item.claim} Source: ${item.sourceUrl}`),
  ].join("\n");

  return {
    context,
    items: ranked,
    staleMatches,
    refreshNeeded: ranked.length === 0,
    staleEvidenceAvailable: staleMatches.length > 0,
    query,
    projectKey: projectKey ?? null,
  };
}

export function getCurrentIntelligenceStatus() {
  refreshCurrentIntelligenceFreshness();
  const database = db();
  const count = (where = "") => Number((database.prepare(`SELECT COUNT(*) AS count FROM current_intelligence_items ${where}`).get() as { count: number }).count);
  return {
    total: count(),
    current: count("WHERE status='current'"),
    stale: count("WHERE status='stale'"),
    disputed: count("WHERE status='disputed'"),
    archived: count("WHERE status='archived'"),
    sourceClasses: currentIntelligenceSourceClasses,
    confidences: currentIntelligenceConfidences,
    rule: "Current intelligence is evidence with an expiration horizon. It does not become durable memory automatically.",
  };
}
