import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const learningQueuePriorities = ["high", "medium", "low"] as const;
export const learningQueueStatuses = ["open", "resolved", "dismissed"] as const;
export const learningSignalTypes = [
  "experience-review",
  "current-intelligence-refresh",
  "knowledge-review",
  "project-education",
] as const;

export type LearningQueuePriority = (typeof learningQueuePriorities)[number];
export type LearningQueueStatus = (typeof learningQueueStatuses)[number];
export type LearningSignalType = (typeof learningSignalTypes)[number];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS continuous_learning_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'running',
        discovered_count INTEGER NOT NULL DEFAULT 0,
        queued_count INTEGER NOT NULL DEFAULT 0,
        auto_resolved_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS continuous_learning_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        project_key TEXT,
        title TEXT NOT NULL,
        why_it_matters TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        evidence TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        UNIQUE(signal_type, source_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_continuous_learning_status ON continuous_learning_queue(status);
      CREATE INDEX IF NOT EXISTS idx_continuous_learning_priority ON continuous_learning_queue(priority);
      CREATE INDEX IF NOT EXISTS idx_continuous_learning_project ON continuous_learning_queue(project_key);
      CREATE INDEX IF NOT EXISTS idx_continuous_learning_signal ON continuous_learning_queue(signal_type);
    `);
    schemaReady = true;
  }
  return database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function mapQueue(row: Row) {
  return {
    id: Number(row.id),
    signalType: String(row.signal_type) as LearningSignalType,
    sourceRef: String(row.source_ref),
    projectKey: row.project_key == null ? null : String(row.project_key),
    title: String(row.title),
    whyItMatters: String(row.why_it_matters),
    recommendedAction: String(row.recommended_action),
    priority: String(row.priority) as LearningQueuePriority,
    evidence: String(row.evidence ?? ""),
    status: String(row.status) as LearningQueueStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  };
}

type Discovery = {
  signalType: LearningSignalType;
  sourceRef: string;
  projectKey: string | null;
  title: string;
  whyItMatters: string;
  recommendedAction: string;
  priority: LearningQueuePriority;
  evidence: string;
};

function discoverExperience(database: Database): Discovery[] {
  if (!tableExists(database, "experience_events")) return [];
  const rows = database.prepare(`
    SELECT id, project_key, title, outcome, cause, candidate_lesson, confidence, evidence
    FROM experience_events
    WHERE status = 'observed'
      AND candidate_lesson <> ''
    ORDER BY id DESC
  `).all() as Row[];

  return rows.map((row) => {
    const outcome = String(row.outcome);
    const priority: LearningQueuePriority = outcome === "failure" || outcome === "owner-correction"
      ? "high"
      : outcome === "partial" ? "medium" : "low";
    return {
      signalType: "experience-review",
      sourceRef: `experience:${Number(row.id)}`,
      projectKey: row.project_key == null ? null : String(row.project_key),
      title: `Review experience lesson: ${String(row.title)}`,
      whyItMatters: `A ${outcome} experience produced a candidate lesson that has not yet become a Learning Proposal.`,
      recommendedAction: "Review the evidence and candidate lesson. If it is durable and correctly scoped, create a Learning Proposal for owner approval.",
      priority,
      evidence: [String(row.evidence ?? ""), String(row.cause ?? ""), `candidateLesson=${String(row.candidate_lesson)}`, `confidence=${String(row.confidence)}`].filter(Boolean).join("; "),
    };
  });
}

function discoverStaleCurrentIntelligence(database: Database): Discovery[] {
  if (!tableExists(database, "current_intelligence_items")) return [];
  const rows = database.prepare(`
    SELECT id, project_key, topic, claim, source_url, source_class, confidence, observed_at, freshness_days
    FROM current_intelligence_items
    WHERE status = 'stale'
    ORDER BY observed_at DESC, id DESC
  `).all() as Row[];

  return rows.map((row) => ({
    signalType: "current-intelligence-refresh" as const,
    sourceRef: `current-intelligence:${Number(row.id)}`,
    projectKey: row.project_key == null ? null : String(row.project_key),
    title: `Refresh current intelligence: ${String(row.topic)}`,
    whyItMatters: "This evidence has exceeded its freshness horizon and must not be treated as current fact.",
    recommendedAction: "Re-research or re-verify the claim from an appropriate source. Replace it with fresh Current Intelligence or archive it if it is no longer useful.",
    priority: "medium" as const,
    evidence: `claim=${String(row.claim)}; source=${String(row.source_url)}; class=${String(row.source_class)}; confidence=${String(row.confidence)}; observedAt=${String(row.observed_at)}; freshnessDays=${Number(row.freshness_days)}`,
  }));
}

function discoverKnowledgeReview(database: Database): Discovery[] {
  if (!tableExists(database, "knowledge_records")) return [];
  const rows = database.prepare(`
    SELECT id, source_type, source_ref, project_key, title, authority, status, confidence, provenance
    FROM knowledge_records
    WHERE status IN ('stale', 'disputed')
      AND source_type <> 'current-intelligence'
    ORDER BY CASE status WHEN 'disputed' THEN 0 ELSE 1 END, authority_rank DESC, id DESC
  `).all() as Row[];

  return rows.map((row) => ({
    signalType: "knowledge-review" as const,
    sourceRef: `knowledge:${Number(row.id)}`,
    projectKey: row.project_key == null ? null : String(row.project_key),
    title: `${String(row.status) === "disputed" ? "Resolve disputed" : "Refresh stale"} knowledge: ${String(row.title)}`,
    whyItMatters: String(row.status) === "disputed"
      ? "Two or more knowledge claims may conflict, so FREEOS should not let this record silently control reasoning."
      : "This governed knowledge record has exceeded its freshness window.",
    recommendedAction: String(row.status) === "disputed"
      ? "Review the evidence and authority chain, resolve the conflict, and record the winning/superseding knowledge explicitly."
      : "Verify the source again, update its verified time if still valid, or supersede/archive it if it changed.",
    priority: String(row.status) === "disputed" ? "high" as const : "medium" as const,
    evidence: `authority=${String(row.authority)}; confidence=${String(row.confidence)}; source=${String(row.source_type)}:${String(row.source_ref)}; provenance=${String(row.provenance ?? "")}`,
  }));
}

function discoverProjectEducation(database: Database): Discovery[] {
  if (!tableExists(database, "projects") || !tableExists(database, "knowledge_baselines") || !tableExists(database, "knowledge_records")) return [];
  const rows = database.prepare(`
    SELECT p.project_key, p.name,
      SUM(CASE WHEN kb.role='canonical' AND kr.status='active' THEN 1 ELSE 0 END) AS canonical_count,
      SUM(CASE WHEN kr.status='active' THEN 1 ELSE 0 END) AS active_count
    FROM projects p
    LEFT JOIN knowledge_baselines kb ON kb.project_key = p.project_key
    LEFT JOIN knowledge_records kr ON kr.id = kb.knowledge_record_id
    WHERE p.status = 'active'
    GROUP BY p.project_key, p.name
    HAVING COALESCE(SUM(CASE WHEN kb.role='canonical' AND kr.status='active' THEN 1 ELSE 0 END), 0) = 0
    ORDER BY p.name
  `).all() as Row[];

  return rows.map((row) => ({
    signalType: "project-education" as const,
    sourceRef: `project:${String(row.project_key)}`,
    projectKey: String(row.project_key),
    title: `Build canonical project baseline: ${String(row.name)}`,
    whyItMatters: "This active project has supporting knowledge but no active canonical project baseline, so FREEOS has less project-specific institutional certainty than it should.",
    recommendedAction: "Review the project's real files, decisions, current state, constraints, ownership, roadmap, and known issues; then establish an approved canonical baseline without duplicating global knowledge unnecessarily.",
    priority: "medium" as const,
    evidence: `activeBaselineLinks=${Number(row.active_count ?? 0)}; canonicalBaselineLinks=${Number(row.canonical_count ?? 0)}`,
  }));
}

function upsertDiscovery(database: Database, discovery: Discovery): { created: boolean; item: ReturnType<typeof mapQueue> } {
  const existing = database.prepare("SELECT * FROM continuous_learning_queue WHERE signal_type = ? AND source_ref = ?").get(discovery.signalType, discovery.sourceRef) as Row | undefined;
  if (!existing) {
    const result = database.prepare(`
      INSERT INTO continuous_learning_queue (
        signal_type, source_ref, project_key, title, why_it_matters,
        recommended_action, priority, evidence, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      discovery.signalType,
      discovery.sourceRef,
      discovery.projectKey,
      discovery.title,
      discovery.whyItMatters,
      discovery.recommendedAction,
      discovery.priority,
      discovery.evidence,
    );
    const row = database.prepare("SELECT * FROM continuous_learning_queue WHERE id = ?").get(result.lastInsertRowid) as Row;
    return { created: true, item: mapQueue(row) };
  }

  database.prepare(`
    UPDATE continuous_learning_queue
    SET project_key = ?, title = ?, why_it_matters = ?, recommended_action = ?,
        priority = ?, evidence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    discovery.projectKey,
    discovery.title,
    discovery.whyItMatters,
    discovery.recommendedAction,
    discovery.priority,
    discovery.evidence,
    Number(existing.id),
  );
  const row = database.prepare("SELECT * FROM continuous_learning_queue WHERE id = ?").get(Number(existing.id)) as Row;
  return { created: false, item: mapQueue(row) };
}

export function runContinuousLearningScan(triggerType = "manual") {
  const database = db();
  const started = database.prepare("INSERT INTO continuous_learning_runs (trigger_type, status) VALUES (?, 'running')").run(triggerType || "manual");
  const runId = Number(started.lastInsertRowid);

  try {
    const discoveries = [
      ...discoverExperience(database),
      ...discoverStaleCurrentIntelligence(database),
      ...discoverKnowledgeReview(database),
      ...discoverProjectEducation(database),
    ];

    const seen = new Set<string>();
    let queued = 0;
    for (const discovery of discoveries) {
      seen.add(`${discovery.signalType}|${discovery.sourceRef}`);
      const result = upsertDiscovery(database, discovery);
      if (result.created) queued += 1;
    }

    const managed = learningSignalTypes.map(() => "?").join(",");
    const openRows = database.prepare(`SELECT id, signal_type, source_ref FROM continuous_learning_queue WHERE status='open' AND signal_type IN (${managed})`).all(...learningSignalTypes) as Row[];
    let autoResolved = 0;
    for (const row of openRows) {
      const key = `${String(row.signal_type)}|${String(row.source_ref)}`;
      if (seen.has(key)) continue;
      database.prepare(`
        UPDATE continuous_learning_queue
        SET status='resolved', resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
            evidence = CASE WHEN evidence='' THEN 'Signal no longer present on latest scan.' ELSE evidence || '; Signal no longer present on latest scan.' END
        WHERE id=?
      `).run(Number(row.id));
      autoResolved += 1;
    }

    database.prepare(`
      UPDATE continuous_learning_runs
      SET status='completed', discovered_count=?, queued_count=?, auto_resolved_count=?, finished_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(discoveries.length, queued, autoResolved, runId);

    return {
      runId,
      triggerType: triggerType || "manual",
      discovered: discoveries.length,
      queued,
      autoResolved,
      status: getContinuousLearningStatus(),
    };
  } catch (error) {
    database.prepare("UPDATE continuous_learning_runs SET status='failed', notes=?, finished_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(error instanceof Error ? error.message : "Unknown Continuous Learning Engine failure.", runId);
    throw error;
  }
}

export function listLearningQueue(input: { status?: LearningQueueStatus; projectKey?: string; signalType?: LearningSignalType; limit?: number } = {}) {
  const database = db();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.status) { clauses.push("status = ?"); params.push(input.status); }
  if (input.projectKey?.trim()) { clauses.push("project_key = ?"); params.push(input.projectKey.trim()); }
  if (input.signalType) { clauses.push("signal_type = ?"); params.push(input.signalType); }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database.prepare(`
    SELECT * FROM continuous_learning_queue
    ${where}
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      CASE status WHEN 'open' THEN 0 ELSE 1 END,
      updated_at DESC, id DESC
    LIMIT ?
  `).all(...params) as Row[];
  return rows.map(mapQueue);
}

export function setLearningQueueStatus(id: number, status: "resolved" | "dismissed") {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid learning queue item ID.");
  const database = db();
  const existing = database.prepare("SELECT * FROM continuous_learning_queue WHERE id=?").get(id) as Row | undefined;
  if (!existing) throw new Error("Learning queue item not found.");
  database.prepare(`
    UPDATE continuous_learning_queue
    SET status=?, resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(status, id);
  return mapQueue(database.prepare("SELECT * FROM continuous_learning_queue WHERE id=?").get(id) as Row);
}

export function getContinuousLearningStatus() {
  const database = db();
  const count = (where = "") => Number((database.prepare(`SELECT COUNT(*) AS count FROM continuous_learning_queue ${where}`).get() as { count: number }).count);
  const lastRun = database.prepare("SELECT * FROM continuous_learning_runs ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  const bySignal = (database.prepare(`
    SELECT signal_type AS signalType, COUNT(*) AS count
    FROM continuous_learning_queue
    WHERE status='open'
    GROUP BY signal_type
    ORDER BY count DESC, signal_type
  `).all() as Row[]).map((row) => ({ signalType: String(row.signalType), count: Number(row.count) }));

  return {
    enabled: true,
    mode: "observe-recommend",
    durableLearningRequiresApproval: true,
    autonomousResearchEnabled: false,
    autonomousDurableMemoryEnabled: false,
    queue: {
      total: count(),
      open: count("WHERE status='open'"),
      high: count("WHERE status='open' AND priority='high'"),
      medium: count("WHERE status='open' AND priority='medium'"),
      low: count("WHERE status='open' AND priority='low'"),
      resolved: count("WHERE status='resolved'"),
      dismissed: count("WHERE status='dismissed'"),
      bySignal,
    },
    lastRun: lastRun ? {
      id: Number(lastRun.id),
      triggerType: String(lastRun.trigger_type),
      status: String(lastRun.status),
      discovered: Number(lastRun.discovered_count),
      queued: Number(lastRun.queued_count),
      autoResolved: Number(lastRun.auto_resolved_count),
      startedAt: String(lastRun.started_at),
      finishedAt: lastRun.finished_at == null ? null : String(lastRun.finished_at),
      notes: String(lastRun.notes ?? ""),
    } : null,
    rule: "Continuous Learning may discover and prioritize learning work, but it may not create durable knowledge without the existing Learning Proposal approval path.",
  };
}
