import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";
import { availableLocalProjectSources } from "./projectSource.service";

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

function managedFolderSnapshot(folderPath: string) {
  const resolvedPath = folderPath
    ? (isAbsolute(folderPath) ? folderPath : resolve(getMemoryStore().rootDir, folderPath))
    : "";
  if (!resolvedPath || !existsSync(resolvedPath)) {
    return { exists: false, folderPath, resolvedPath, topLevelEntries: [] as string[], starterOnly: false };
  }
  try {
    const entries = readdirSync(resolvedPath, { withFileTypes: true })
      .slice(0, 100)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
    const substantive = entries.filter((entry) => entry.toLowerCase() !== "file:readme.md");
    return { exists: true, folderPath, resolvedPath, topLevelEntries: entries, starterOnly: substantive.length === 0 };
  } catch {
    return { exists: true, folderPath, resolvedPath, topLevelEntries: [] as string[], starterOnly: false };
  }
}

function summarizeRows(input: Row[], fields: string[], limit = 12) {
  return input.slice(0, limit).map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) out[field] = row[field] ?? null;
    return out;
  });
}

function governedProjectRagDocuments(database: Database, projectKey: string): Row[] {
  if (!tableExists(database, "rag_documents") || !tableExists(database, "knowledge_records")) return [];
  const chunkSelect = tableExists(database, "rag_chunks")
    ? `(SELECT c.content FROM rag_chunks c WHERE c.document_id=d.id ORDER BY c.chunk_index LIMIT 1) AS first_chunk`
    : `NULL AS first_chunk`;
  return rows(database, `
    SELECT d.id,d.file_name,d.file_path,d.title,d.status,d.indexed_at,
           kr.id AS knowledge_record_id,kr.authority,kr.authority_rank,
           kr.status AS governance_status,kr.confidence,kr.provenance,
           ${chunkSelect}
    FROM rag_documents d
    JOIN knowledge_records kr
      ON kr.source_type='rag-document'
     AND kr.source_ref=d.file_path
     AND kr.project_key=d.project_key
    WHERE d.project_key=?
      AND d.status='indexed'
      AND kr.status='active'
    ORDER BY kr.authority_rank DESC,d.indexed_at DESC,d.id DESC
    LIMIT 100
  `, projectKey);
}

function summarizeGovernedDocuments(input: Row[], limit = 12) {
  return input.slice(0, limit).map((row) => ({
    id: Number(row.id),
    fileName: String(row.file_name ?? ""),
    filePath: String(row.file_path ?? ""),
    title: row.title == null ? null : String(row.title),
    indexedAt: row.indexed_at == null ? null : String(row.indexed_at),
    knowledgeRecordId: Number(row.knowledge_record_id),
    authority: String(row.authority),
    authorityRank: Number(row.authority_rank),
    governanceStatus: String(row.governance_status),
    confidence: String(row.confidence),
    provenance: String(row.provenance ?? ""),
    firstChunkExcerpt: row.first_chunk == null ? null : String(row.first_chunk).replace(/\s+/g, " ").trim().slice(0, 600),
  }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerptAround(content: string, needle: string, radius = 700): string | null {
  const index = content.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - Math.floor(radius / 3));
  const end = Math.min(content.length, index + radius);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function canonicalSupportingContext(database: Database, projectKey: string, projectName: string) {
  if (!["knowledge_baselines", "knowledge_records", "rag_documents", "rag_chunks"].every((name) => tableExists(database, name))) {
    return { ownershipClassification: null as string | null, directionExcerpt: null as string | null, directionRecordId: null as number | null, support: [] as Record<string, unknown>[] };
  }

  const docs = rows(database, `
    SELECT kb.role,kr.id AS knowledge_record_id,kr.title AS knowledge_title,kr.authority,kr.authority_rank,
           kr.confidence,d.id AS document_id,d.file_name,d.file_path
    FROM knowledge_baselines kb
    JOIN knowledge_records kr ON kr.id=kb.knowledge_record_id
    JOIN rag_documents d ON d.file_path=kr.source_ref
    WHERE kb.project_key=?
      AND kr.status='active'
      AND kr.source_type='rag-document'
      AND kr.authority_rank>=85
      AND d.status='indexed'
    ORDER BY kr.authority_rank DESC,CASE kb.role WHEN 'canonical' THEN 0 ELSE 1 END,kr.id
  `, projectKey);

  const support: Record<string, unknown>[] = [];
  let ownershipClassification: string | null = null;
  let directionExcerpt: string | null = null;
  let directionRecordId: number | null = null;
  const projectPattern = escapeRegex(projectName);

  for (const doc of docs) {
    const chunks = rows(database, "SELECT content FROM rag_chunks WHERE document_id=? ORDER BY chunk_index", Number(doc.document_id));
    const content = chunks.map((row) => String(row.content ?? "")).join("\n");
    if (!content.toLowerCase().includes(projectName.toLowerCase()) && !content.toLowerCase().includes(projectKey.toLowerCase())) continue;

    if (!ownershipClassification) {
      const classifications: Array<[string, string]> = [
        ["Shared infrastructure", "DFB internal shared infrastructure"],
        ["Owned IP / brands", "DFB-owned IP / brand"],
        ["Service/cash-flow businesses", "DFB service/cash-flow business"],
        ["Client / partner builds", "client / partner build; ownership not assumed"],
        ["Business Ideas / incubation", "DFB incubation / exploratory opportunity"],
      ];
      for (const [heading, classification] of classifications) {
        const pattern = new RegExp(`${escapeRegex(heading)}[\\s\\S]{0,1600}${projectPattern}`, "i");
        if (pattern.test(content)) {
          ownershipClassification = classification;
          break;
        }
      }
    }

    if (!directionExcerpt) {
      const sectionPattern = new RegExp(`###\\s+${projectPattern}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "i");
      const match = content.match(sectionPattern);
      if (match?.[1]?.trim()) {
        directionExcerpt = match[1].replace(/\s+/g, " ").trim().slice(0, 1400);
        directionRecordId = Number(doc.knowledge_record_id);
      }
    }

    support.push({
      knowledgeRecordId: Number(doc.knowledge_record_id),
      title: String(doc.knowledge_title),
      role: String(doc.role),
      authority: String(doc.authority),
      authorityRank: Number(doc.authority_rank),
      confidence: String(doc.confidence),
      fileName: String(doc.file_name),
      excerpt: excerptAround(content, projectName),
    });
  }

  return { ownershipClassification, directionExcerpt, directionRecordId, support };
}

function inspectEvidence(projectKey: string) {
  const database = db();
  const project = database.prepare("SELECT * FROM projects WHERE project_key=?").get(projectKey) as Row | undefined;
  if (!project) throw new Error(`Project not found: ${projectKey}.`);

  const projectName = String(project.name);
  const memories = rows(database, "SELECT id,title,content,category,source,created_at,updated_at FROM memories WHERE project_key=? AND status='approved' ORDER BY updated_at DESC LIMIT 50", projectKey);
  const notes = rows(database, "SELECT id,title,content,source,tags,created_at,updated_at FROM project_notes WHERE project_key=? ORDER BY updated_at DESC LIMIT 50", projectKey);
  const rawRagDocuments = tableExists(database, "rag_documents")
    ? rows(database, "SELECT id,file_name,file_path,title,status,indexed_at FROM rag_documents WHERE project_key=? AND status='indexed' ORDER BY indexed_at DESC,id DESC LIMIT 100", projectKey)
    : [];
  const ragDocuments = governedProjectRagDocuments(database, projectKey);
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
  const activeCurrent = currentIntelligence.filter((row) => String(row.status) === "current");
  const liveLocalState = activeCurrent.filter((row) => String(row.source_class) === "live-observation" && String(row.topic).toLowerCase() === "project local state");
  const managedFolder = managedFolderSnapshot(String(project.folder_path ?? ""));
  const sourceRoots = availableLocalProjectSources(projectKey);
  const description = String(project.description ?? "").trim();
  const ownershipFromRegistry = /\bDFB[- ]owned\b/i.test(description) ? "DFB-owned" : null;
  const canonicalSupport = canonicalSupportingContext(database, projectKey, projectName);
  const ownershipClassification = ownershipFromRegistry ?? canonicalSupport.ownershipClassification;
  const ownerDirectionMemories = memories.filter((row) =>
    String(row.category).toLowerCase() === "decision" ||
    /\b(goal|goals|constraint|constraints|priority|priorities|direction|scope|decision)\b/i.test(`${String(row.title)} ${String(row.content ?? "")}`),
  );
  const ownerDirectionEstablished = Boolean(canonicalSupport.directionExcerpt) || ownerDirectionMemories.length > 0;
  const governedEvidenceEstablished = ragDocuments.length > 0 || canonicalSupport.support.length > 0;

  const unknowns: string[] = [];
  if (!ownershipClassification) unknowns.push("Ownership / organizational classification is not established by active controlling evidence.");
  if (!ownerDirectionEstablished) unknowns.push("Owner-approved project direction (goals, scope, or constraints) is not established by active controlling evidence.");
  if (!governedEvidenceEstablished) unknowns.push("No active governed evidence currently supports the project baseline.");
  if (liveLocalState.length === 0) unknowns.push("No fresh live observation verifies the current local project state.");
  if (sourceRoots.length === 0) unknowns.push("No available real project source root is registered for read-only inspection.");

  const advisories: string[] = [];
  if (memories.length === 0) advisories.push("No project-specific approved memory is registered; this is not a blocker when stronger controlling evidence establishes the needed facts.");
  if (notes.length === 0) advisories.push("No project notes are registered; notes are optional working evidence, not a canonicalization requirement.");
  if (canonicalBaselines.length === 0) advisories.push("No active canonical project baseline exists yet; this is expected before the first approval and is not itself an approval blocker.");
  if (rawRagDocuments.length > ragDocuments.length) advisories.push(`${rawRagDocuments.length - ragDocuments.length} raw indexed project document(s) are not active governed project evidence and do not count as controlling support.`);

  const evidence = {
    project: {
      projectKey,
      name: projectName,
      description,
      status: String(project.status),
      managedKnowledgeFolderPath: String(project.folder_path ?? ""),
      ownershipFromRegistryDescription: ownershipFromRegistry,
      ownershipClassification,
    },
    semanticSupport: {
      ownershipClassification,
      ownerDirectionEstablished,
      directionExcerpt: canonicalSupport.directionExcerpt,
      directionRecordId: canonicalSupport.directionRecordId,
      canonicalSupportingRecords: canonicalSupport.support,
    },
    advisories,
    counts: {
      approvedMemories: memories.length,
      projectNotes: notes.length,
      projectRagDocuments: ragDocuments.length,
      projectRagDocumentsAll: rawRagDocuments.length,
      baselineLinks: baselines.length,
      canonicalBaselineLinks: canonicalBaselines.length,
      currentIntelligenceItems: currentIntelligence.length,
      currentIntelligenceCurrent: activeCurrent.length,
      currentIntelligenceLocalState: liveLocalState.length,
      experienceEvents: experiences.length,
      researchSessions: research.length,
      learningQueueItems: queue.length,
      registeredAvailableSourceRoots: sourceRoots.length,
      canonicalSupportingRecords: canonicalSupport.support.length,
    },
    managedKnowledgeFolder: managedFolder,
    projectSourceRoots: sourceRoots.map((source) => ({
      id: source.id,
      label: source.label,
      location: source.location,
      resolvedPath: source.resolvedPath,
      available: source.available,
      topLevelEntries: source.topLevelEntries,
    })),
    approvedMemories: summarizeRows(memories, ["id", "title", "category", "source", "updated_at"]),
    projectNotes: summarizeRows(notes, ["id", "title", "source", "updated_at"]),
    ragDocuments: summarizeGovernedDocuments(ragDocuments),
    rawRagDocuments: summarizeRows(rawRagDocuments, ["id", "file_name", "file_path", "status", "indexed_at"]),
    baselines: summarizeRows(baselines, ["id", "role", "title", "authority", "status", "confidence", "source_type", "source_ref"]),
    currentIntelligence: summarizeRows(currentIntelligence, ["id", "topic", "claim", "status", "source_class", "confidence", "observed_at", "freshness_days"]),
    experienceEvents: summarizeRows(experiences, ["id", "title", "outcome", "status", "confidence", "created_at"]),
    researchSessions: summarizeRows(research, ["id", "title", "query", "status", "created_at"]),
    learningQueue: summarizeRows(queue, ["id", "signal_type", "title", "priority", "status", "updated_at"]),
  };

  const governedEvidenceLines = ragDocuments.length
    ? ragDocuments.slice(0, 12).map((row) => `- ${String(row.title ?? row.file_name)} [${String(row.authority)}/${String(row.confidence)}] (${String(row.file_name)})`)
    : ["- None currently registered as active governed project-scoped RAG evidence."];
  const canonicalSupportLines = canonicalSupport.support.length
    ? canonicalSupport.support.slice(0, 8).map((row) => `- ${String(row.title)} [${String(row.authority)}/${String(row.confidence)}; role=${String(row.role)}]${row.excerpt ? `: ${String(row.excerpt)}` : ""}`)
    : ["- No active controlling baseline document explicitly mentions this project."];
  const currentStateLine = liveLocalState.length > 0
    ? `- ${String(liveLocalState[0].claim)} [live-observation/${String(liveLocalState[0].confidence)}; observed=${String(liveLocalState[0].observed_at)}]`
    : "- UNKNOWN — no fresh live observation currently verifies the local project state.";
  const directionLine = canonicalSupport.directionExcerpt
    ? `- Approved supporting context: ${canonicalSupport.directionExcerpt}`
    : ownerDirectionMemories.length > 0
      ? `- ${ownerDirectionMemories.length} approved project decision/direction memory item(s) are available for review.`
      : "- UNKNOWN — no active controlling evidence currently establishes owner-approved project direction.";

  const lines = [
    `# ${projectName} — PROJECT BASELINE DRAFT`,
    "",
    "> DRAFT — NOT CANONICAL. This document is generated from currently registered governed evidence and must not be treated as approved institutional truth until the canonical review path is completed.",
    "",
    "## Identity / Scope",
    description ? `- Registry description: ${description}` : "- Registry description: UNKNOWN",
    `- Project key: ${projectKey}`,
    `- Registry status: ${String(project.status)}`,
    `- Organizational / ownership classification: ${ownershipClassification ?? "UNKNOWN"}`,
    "",
    "## Evidence Inventory",
    `- Approved project memories: ${memories.length}`,
    `- Project notes: ${notes.length}`,
    `- Governed project-scoped indexed documents: ${ragDocuments.length}`,
    `- Raw project-scoped indexed documents: ${rawRagDocuments.length}`,
    `- Active controlling baseline documents that explicitly support this project: ${canonicalSupport.support.length}`,
    `- Available registered source roots: ${sourceRoots.length}`,
    `- Managed FREEOS knowledge folder available: ${managedFolder.exists ? "yes" : "no"}${managedFolder.starterOnly ? " (starter README only)" : ""}`,
    `- Baseline links: ${baselines.length} (${canonicalBaselines.length} active project canonical)`,
    `- Current Intelligence: ${currentIntelligence.length} (${activeCurrent.length} current; ${liveLocalState.length} live local-state observation)`,
    `- Experience events: ${experiences.length}`,
    `- Research sessions: ${research.length}`,
    "",
    "## Controlling Supporting Context",
    ...canonicalSupportLines,
    "",
    "## Governed Project Evidence",
    ...governedEvidenceLines,
    "",
    "## Current State",
    currentStateLine,
    "",
    "## Goals / Scope / Constraints",
    directionLine,
    "",
    "## Existing Global / Supporting Knowledge",
    baselines.length > 0
      ? `- ${baselines.length} governed baseline link(s) apply. Relevant approved supporting knowledge may establish project facts without being duplicated into lower-authority project notes.`
      : "- No governed baseline links are currently registered.",
    "",
    "## Advisories (Non-blocking)",
    ...(advisories.length ? advisories.map((item) => `- ${item}`) : ["- None."]),
    "",
    "## Unresolved Semantic UNKNOWNs",
    ...(unknowns.length ? unknowns.map((item) => `- ${item}`) : ["- None identified by the deterministic inspector."]),
    "",
    "## Recommended Next Step",
    unknowns.length === 0
      ? "- Semantic evidence gaps are resolved. Prepare the baseline for explicit owner review; canonicalization still requires Drew's approval."
      : "- Resolve only the remaining semantic evidence gaps, then prepare the baseline for explicit owner review. Do not create notes or memories merely to satisfy a storage-channel checklist.",
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
      `Read-only project inspection completed for ${projectKey}; baseline draft #${draft.id} prepared with ${draft.unresolvedUnknowns.length} unresolved semantic UNKNOWN(s).`,
      `project_inspection_draft_id=${draft.id}; canonicalWritePerformed=false; durableMemoryCreated=false`,
      workId,
    );
  }

  return {
    draft,
    canonicalWritePerformed: false,
    durableMemoryCreated: false,
    queueResolved: false,
    rule: "Project inspection may read and prepare governed evidence. Only semantic evidence gaps block review; missing storage channels and the absence of a first canonical baseline are not blockers by themselves.",
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
    gapModel: "semantic-evidence-v2",
    total: count(),
    prepared: count("status='prepared'"),
    canonicalWritesEnabled: false,
    durableMemoryCreatedAutomatically: false,
    storageChannelAbsenceBlocksCanonicalReview: false,
    missingFirstCanonicalBaselineBlocksCanonicalReview: false,
    rule: "Project Inspection assembles active governed evidence and blocks only on unresolved semantic facts. Canonicalization remains a separate explicit owner-approved step.",
  };
}
