import { existsSync, readdirSync } from "node:fs";
import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project_inspection_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL UNIQUE,
        learning_work_id INTEGER,
        queue_item_id INTEGER,
        evidence_json TEXT NOT NULL,
        unknowns_json TEXT NOT NULL,
        baseline_draft TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_project_inspection_status ON project_inspection_drafts(status);
      CREATE INDEX IF NOT EXISTS idx_project_inspection_work ON project_inspection_drafts(learning_work_id);
    `);
    schemaReady = true;
  }
  return database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapDraft(row: Row) {
  let evidence: Record<string, unknown> = {};
  try { evidence = JSON.parse(String(row.evidence_json ?? "{}")) as Record<string, unknown>; }
  catch { evidence = {}; }
  return {
    id: Number(row.id),
    projectKey: String(row.project_key),
    learningWorkId: row.learning_work_id == null ? null : Number(row.learning_work_id),
    queueItemId: row.queue_item_id == null ? null : Number(row.queue_item_id),
    evidence,
    unresolvedUnknowns: parseJsonArray(row.unknowns_json),
    baselineDraft: String(row.baseline_draft),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rows(database: Database, sql: string, ...params: unknown[]): Row[] {
  return database.prepare(sql).all(...params) as Row[];
}

function folderSnapshot(folderPath: string) {
  if (!folderPath || !existsSync(folderPath)) return { exists: false, folderPath, topLevelEntries: [] as string[] };
  try {
    const entries = readdirSync(folderPath, { withFileTypes: true })
      .slice(0, 100)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
    return { exists: true, folderPath, topLevelEntries: entries };
  } catch {
    return { exists: true, folderPath, topLevelEntries: [] as string[] };
  }
}

function summarizeRows(input: Row[], fields: string[], limit = 12) {
  return input.slice(0, limit).map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) out[field] = row[field] ?? null;
    return out;
  });
}

function inspectEvidence(projectKey: string) {
  const database = db();
  const project = database.prepare("SELECT * FROM projects WHERE project_key=?").get(projectKey) as Row | undefined;
  if (!project) throw new Error(`Project not found: ${projectKey}.`);

  const memories = rows(database, "SELECT id,title,content,category,source,created_at,updated_at FROM memories WHERE project_key=? ORDER BY updated_at DESC LIMIT 50", projectKey);
  const notes = rows(database, "SELECT id,title,content,source,tags,created_at,updated_at FROM project_notes WHERE project_key=? ORDER BY updated_at DESC LIMIT 50", projectKey);
  const ragDocuments = tableExists(database, "rag_documents")
    ? rows(database, "SELECT id,file_name,file_path,title,status,indexed_at FROM rag_documents WHERE project_key=? ORDER BY indexed_at DESC,id DESC LIMIT 100", projectKey)
    : [];
  const baselines = tableExists(database, "knowledge_baselines") && tableExists(database, "knowledge_records")
    ? rows(database, `
        SELECT kb.role,kr.id,kr.title,kr.source_type,kr.source_ref,kr.authority,kr.status,kr.confidence,kr.provenance
        FROM knowledge_baselines kb
        JOIN knowledge_records kr ON kr.id=kb.knowledge_record_id
        WHERE kb.project_key=?
        ORDER BY CASE kb.role WHEN 'canonical' THEN 0 ELSE 1 END, kr.authority_rank DESC, kr.id DESC
      `, projectKey)
    : [];
  const currentIntelligence = tableExists(database, "current_intelligence_items")
    ? rows(database, "SELECT id,topic,claim,status,source_class,confidence,observed_at,freshness_days,source_url FROM current_intelligence_items WHERE project_key=? ORDER BY observed_at DESC,id DESC LIMIT 30", projectKey)
    : [];
  const experiences = tableExists(database, "experience_events")
    ? rows(database, "SELECT id,title,outcome,status,cause,evidence,candidate_lesson,confidence,created_at FROM experience_events WHERE project_key=? ORDER BY id DESC LIMIT 30", projectKey)
    : [];
  const research = tableExists(database, "research_sessions")
    ? rows(database, "SELECT id,title,query,status,created_at,updated_at FROM research_sessions WHERE project_key=? ORDER BY id DESC LIMIT 30", projectKey)
    : [];
  const queue = tableExists(database, "continuous_learning_queue")
    ? rows(database, "SELECT id,signal_type,title,priority,status,why_it_matters,recommended_action,updated_at FROM continuous_learning_queue WHERE project_key=? ORDER BY id DESC LIMIT 30", projectKey)
    : [];

  const canonicalBaselines = baselines.filter((row) => String(row.role) === "canonical" && String(row.status) === "active");
  const approvedSpecific = memories.length;
  const activeCurrent = currentIntelligence.filter((row) => String(row.status) === "current").length;
  const folder = folderSnapshot(String(project.folder_path ?? ""));
  const description = String(project.description ?? "").trim();
  const ownershipExplicit = /\bDFB[- ]owned\b/i.test(description) ? "DFB-owned" : null;

  const unknowns: string[] = [];
  if (!ownershipExplicit) unknowns.push("Ownership classification is not explicitly established by project-specific approved evidence.");
  if (approvedSpecific === 0) unknowns.push("No project-specific approved memory currently establishes owner decisions, goals, or constraints.");
  if (notes.length === 0) unknowns.push("No project notes are registered for this project.");
  if (ragDocuments.length === 0) unknowns.push("No project-scoped RAG documents are indexed for this project.");
  if (activeCurrent === 0) unknowns.push("No fresh project-scoped Current Intelligence verifies the present operational state.");
  if (!folder.exists) unknowns.push("The registered project folder is not currently available at its configured path.");
  if (canonicalBaselines.length === 0) unknowns.push("No active canonical project baseline exists yet.");

  const evidence = {
    project: {
      projectKey,
      name: String(project.name),
      description,
      status: String(project.status),
      folderPath: String(project.folder_path ?? ""),
      ownershipFromRegistryDescription: ownershipExplicit,
    },
    counts: {
      approvedMemories: memories.length,
      projectNotes: notes.length,
      projectRagDocuments: ragDocuments.length,
      baselineLinks: baselines.length,
      canonicalBaselineLinks: canonicalBaselines.length,
      currentIntelligenceItems: currentIntelligence.length,
      currentIntelligenceCurrent: activeCurrent,
      experienceEvents: experiences.length,
      researchSessions: research.length,
      learningQueueItems: queue.length,
    },
    folder,
    approvedMemories: summarizeRows(memories, ["id", "title", "category", "source", "updated_at"]),
    projectNotes: summarizeRows(notes, ["id", "title", "source", "updated_at"]),
    ragDocuments: summarizeRows(ragDocuments, ["id", "file_name", "file_path", "status", "indexed_at"]),
    baselines: summarizeRows(baselines, ["id", "role", "title", "authority", "status", "confidence", "source_type", "source_ref"]),
    currentIntelligence: summarizeRows(currentIntelligence, ["id", "topic", "status", "source_class", "confidence", "observed_at", "freshness_days"]),
    experienceEvents: summarizeRows(experiences, ["id", "title", "outcome", "status", "confidence", "created_at"]),
    researchSessions: summarizeRows(research, ["id", "title", "query", "status", "created_at"]),
    learningQueue: summarizeRows(queue, ["id", "signal_type", "title", "priority", "status", "updated_at"]),
  };

  const lines = [
    `# ${String(project.name)} — PROJECT BASELINE DRAFT`,
    "",
    "> DRAFT — NOT CANONICAL. This document is generated from currently registered local evidence and must not be treated as approved institutional truth until the canonical review path is completed.",
    "",
    "## Identity / Scope",
    description ? `- Registry description: ${description}` : "- Registry description: UNKNOWN",
    `- Project key: ${projectKey}`,
    `- Registry status: ${String(project.status)}`,
    `- Ownership: ${ownershipExplicit ?? "UNKNOWN"}`,
    "",
    "## Evidence Inventory",
    `- Approved project memories: ${memories.length}`,
    `- Project notes: ${notes.length}`,
    `- Project-scoped indexed documents: ${ragDocuments.length}`,
    `- Baseline links: ${baselines.length} (${canonicalBaselines.length} active canonical)`,
    `- Current Intelligence: ${currentIntelligence.length} (${activeCurrent} current)`,
    `- Experience events: ${experiences.length}`,
    `- Research sessions: ${research.length}`,
    `- Registered folder available: ${folder.exists ? "yes" : "no"}`,
    "",
    "## Current State",
    activeCurrent > 0
      ? "- Fresh project-scoped Current Intelligence exists; review the evidence entries before promoting any current-state claim into canonical project knowledge."
      : "- UNKNOWN — no fresh project-scoped Current Intelligence currently verifies operational state.",
    "",
    "## Goals / Constraints / Blockers / Roadmap",
    memories.length > 0 || notes.length > 0 || ragDocuments.length > 0
      ? "- Evidence exists that may support these sections, but this deterministic inspection does not infer claims that are not explicitly established. Review the listed sources before canonicalization."
      : "- UNKNOWN — no project-specific approved evidence is currently registered strongly enough to establish these fields.",
    "",
    "## Existing Global / Supporting Knowledge",
    baselines.length > 0
      ? `- ${baselines.length} governed baseline link(s) already apply. Link applicable global knowledge instead of duplicating it.`
      : "- No governed baseline links are currently registered.",
    "",
    "## Unresolved UNKNOWNs",
    ...(unknowns.length ? unknowns.map((item) => `- ${item}`) : ["- None identified by the deterministic inspector."]),
    "",
    "## Recommended Next Step",
    ragDocuments.length === 0 && notes.length === 0 && memories.length === 0
      ? "- Locate or register the project's real source files/notes first. FREEOS should not fabricate a canonical baseline from the registry description alone."
      : "- Review the listed project-specific evidence, resolve the UNKNOWNs, then submit the minimum project-specific baseline through the canonical approval workflow.",
  ];

  return { project, evidence, unknowns, baselineDraft: lines.join("\n") };
}

export function inspectProjectFromLearningWork(workId: number) {
  if (!Number.isInteger(workId) || workId < 1) throw new Error("Invalid learning work ID.");
  const database = db();
  const work = database.prepare("SELECT * FROM learning_work_items WHERE id=?").get(workId) as Row | undefined;
  if (!work) throw new Error("Learning work item not found.");
  if (String(work.work_type) !== "project-inspection") throw new Error("Learning work item is not project-inspection work.");
  if (!["prepared", "completed"].includes(String(work.status))) throw new Error("Project inspection work must be prepared or completed.");
  const projectKey = String(work.project_key ?? "").trim();
  if (!projectKey) throw new Error("Project inspection work has no projectKey.");

  const inspected = inspectEvidence(projectKey);
  database.prepare(`
    INSERT INTO project_inspection_drafts (
      project_key, learning_work_id, queue_item_id, evidence_json, unknowns_json, baseline_draft, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'prepared')
    ON CONFLICT(project_key) DO UPDATE SET
      learning_work_id=excluded.learning_work_id,
      queue_item_id=excluded.queue_item_id,
      evidence_json=excluded.evidence_json,
      unknowns_json=excluded.unknowns_json,
      baseline_draft=excluded.baseline_draft,
      status='prepared',
      updated_at=CURRENT_TIMESTAMP
  `).run(
    projectKey,
    workId,
    Number(work.queue_item_id),
    JSON.stringify(inspected.evidence),
    JSON.stringify(inspected.unknowns),
    inspected.baselineDraft,
  );

  const draftRow = database.prepare("SELECT * FROM project_inspection_drafts WHERE project_key=?").get(projectKey) as Row;
  const draft = mapDraft(draftRow);

  if (String(work.status) === "prepared") {
    database.prepare(`
      UPDATE learning_work_items
      SET status='completed',
          result_summary=?,
          evidence=?,
          completed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      `Read-only project inspection completed for ${projectKey}; baseline draft #${draft.id} prepared with ${draft.unresolvedUnknowns.length} unresolved UNKNOWN(s).`,
      `project_inspection_draft_id=${draft.id}; canonicalWritePerformed=false; durableMemoryCreated=false`,
      workId,
    );
  }

  return {
    draft,
    canonicalWritePerformed: false,
    durableMemoryCreated: false,
    queueResolved: false,
    rule: "Project inspection may read and prepare. It must not fabricate missing facts or silently make the draft canonical.",
  };
}

export function listProjectInspectionDrafts(input: { projectKey?: string; limit?: number } = {}) {
  const database = db();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rowsResult = input.projectKey?.trim()
    ? database.prepare("SELECT * FROM project_inspection_drafts WHERE project_key=? ORDER BY updated_at DESC LIMIT ?").all(input.projectKey.trim(), limit) as Row[]
    : database.prepare("SELECT * FROM project_inspection_drafts ORDER BY updated_at DESC,id DESC LIMIT ?").all(limit) as Row[];
  return rowsResult.map(mapDraft);
}

export function getProjectInspectionDraft(id: number) {
  if (!Number.isInteger(id) || id < 1) return null;
  const row = db().prepare("SELECT * FROM project_inspection_drafts WHERE id=?").get(id) as Row | undefined;
  return row ? mapDraft(row) : null;
}

export function getProjectInspectionStatus() {
  const database = db();
  const count = (where = "1=1") => Number((database.prepare(`SELECT COUNT(*) AS count FROM project_inspection_drafts WHERE ${where}`).get() as { count: number }).count);
  return {
    enabled: true,
    mode: "read-only-inspect-and-draft",
    total: count(),
    prepared: count("status='prepared'"),
    canonicalWritesEnabled: false,
    durableMemoryCreatedAutomatically: false,
    rule: "Project Inspection may assemble evidence and produce a draft baseline, but canonicalization remains a separate approved step.",
  };
}
