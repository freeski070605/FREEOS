import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";

export const knowledgeAuthorities = [
  "constitution-hard-rule",
  "current-owner-instruction",
  "live-observation",
  "approved-canonical",
  "approved-memory",
  "primary-external",
  "reliable-secondary",
  "unapproved-draft",
  "model-background",
  "inference",
] as const;

export const knowledgeStatuses = ["active", "stale", "disputed", "superseded", "archived"] as const;
export const knowledgeConfidences = ["confirmed", "high", "moderate", "low", "unverified", "disputed"] as const;
export const knowledgeSensitivities = ["public", "internal", "project-restricted", "private"] as const;
export const baselineRoles = ["canonical", "supporting"] as const;

export type KnowledgeAuthority = (typeof knowledgeAuthorities)[number];
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];
export type KnowledgeConfidence = (typeof knowledgeConfidences)[number];
export type KnowledgeSensitivity = (typeof knowledgeSensitivities)[number];
export type BaselineRole = (typeof baselineRoles)[number];

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const authorityRank: Record<KnowledgeAuthority, number> = {
  "constitution-hard-rule": 100,
  "current-owner-instruction": 95,
  "live-observation": 90,
  "approved-canonical": 85,
  "approved-memory": 80,
  "primary-external": 70,
  "reliable-secondary": 60,
  "unapproved-draft": 30,
  "model-background": 20,
  inference: 10,
};

let schemaReady = false;

export function knowledgeDb(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        project_key TEXT,
        title TEXT NOT NULL,
        authority TEXT NOT NULL,
        authority_rank INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        confidence TEXT NOT NULL DEFAULT 'moderate',
        sensitivity TEXT NOT NULL DEFAULT 'internal',
        provenance TEXT NOT NULL DEFAULT '',
        effective_at TEXT,
        verified_at TEXT,
        freshness_days INTEGER,
        supersedes_id INTEGER,
        conflict_group TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_type, source_ref),
        FOREIGN KEY (supersedes_id) REFERENCES knowledge_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_records(project_key);
      CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_records(status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_authority ON knowledge_records(authority_rank DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_conflict_group ON knowledge_records(conflict_group);

      CREATE TABLE IF NOT EXISTS knowledge_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,
        knowledge_record_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'supporting',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_key, knowledge_record_id),
        FOREIGN KEY (knowledge_record_id) REFERENCES knowledge_records(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_baseline_project ON knowledge_baselines(project_key);

      CREATE TABLE IF NOT EXISTS knowledge_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        left_record_id INTEGER NOT NULL,
        right_record_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        winning_record_id INTEGER,
        resolution_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        FOREIGN KEY (left_record_id) REFERENCES knowledge_records(id),
        FOREIGN KEY (right_record_id) REFERENCES knowledge_records(id),
        FOREIGN KEY (winning_record_id) REFERENCES knowledge_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_conflicts_status ON knowledge_conflicts(status);
    `);
    schemaReady = true;
  }
  return database;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function inferRagAuthority(filePath: string): KnowledgeAuthority {
  const path = normalizePath(filePath);
  if (path.includes("freeos_constitution")) return "constitution-hard-rule";
  if (path.includes("/docs/knowledge/") || path.includes("/data/documents/core/")) return "approved-canonical";
  return "unapproved-draft";
}

function inferSensitivity(projectKey: string | null): KnowledgeSensitivity {
  return projectKey ? "project-restricted" : "internal";
}

function mapRecord(row: Row) {
  return {
    id: Number(row.id),
    sourceType: String(row.source_type),
    sourceRef: String(row.source_ref),
    projectKey: row.project_key == null ? null : String(row.project_key),
    title: String(row.title),
    authority: String(row.authority) as KnowledgeAuthority,
    authorityRank: Number(row.authority_rank),
    status: String(row.status) as KnowledgeStatus,
    confidence: String(row.confidence) as KnowledgeConfidence,
    sensitivity: String(row.sensitivity) as KnowledgeSensitivity,
    provenance: String(row.provenance ?? ""),
    effectiveAt: row.effective_at == null ? null : String(row.effective_at),
    verifiedAt: row.verified_at == null ? null : String(row.verified_at),
    freshnessDays: row.freshness_days == null ? null : Number(row.freshness_days),
    supersedesId: row.supersedes_id == null ? null : Number(row.supersedes_id),
    conflictGroup: row.conflict_group == null ? null : String(row.conflict_group),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getKnowledgeRecord(id: number) {
  if (!Number.isInteger(id) || id < 1) return null;
  const row = knowledgeDb().prepare("SELECT * FROM knowledge_records WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRecord(row) : null;
}

export function upsertKnowledgeRecord(input: {
  sourceType: string;
  sourceRef: string;
  projectKey?: string | null;
  title: string;
  authority: KnowledgeAuthority;
  status?: KnowledgeStatus;
  confidence?: KnowledgeConfidence;
  sensitivity?: KnowledgeSensitivity;
  provenance?: string;
  effectiveAt?: string | null;
  verifiedAt?: string | null;
  freshnessDays?: number | null;
  notes?: string;
}) {
  const database = knowledgeDb();
  database.prepare(`
    INSERT INTO knowledge_records (
      source_type, source_ref, project_key, title, authority, authority_rank, status,
      confidence, sensitivity, provenance, effective_at, verified_at, freshness_days, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_type, source_ref) DO UPDATE SET
      project_key = excluded.project_key,
      title = excluded.title,
      authority = excluded.authority,
      authority_rank = excluded.authority_rank,
      confidence = excluded.confidence,
      sensitivity = excluded.sensitivity,
      provenance = excluded.provenance,
      effective_at = COALESCE(excluded.effective_at, knowledge_records.effective_at),
      verified_at = COALESCE(excluded.verified_at, knowledge_records.verified_at),
      freshness_days = COALESCE(excluded.freshness_days, knowledge_records.freshness_days),
      notes = CASE WHEN excluded.notes <> '' THEN excluded.notes ELSE knowledge_records.notes END,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.sourceType,
    input.sourceRef,
    input.projectKey ?? null,
    input.title,
    input.authority,
    authorityRank[input.authority],
    input.status ?? "active",
    input.confidence ?? "moderate",
    input.sensitivity ?? inferSensitivity(input.projectKey ?? null),
    input.provenance ?? "",
    input.effectiveAt ?? null,
    input.verifiedAt ?? null,
    input.freshnessDays ?? null,
    input.notes ?? "",
  );
  const row = database.prepare("SELECT * FROM knowledge_records WHERE source_type = ? AND source_ref = ?").get(input.sourceType, input.sourceRef) as Row;
  return mapRecord(row);
}

export function registerApprovedMemory(memoryId: number) {
  const memory = getMemoryStore().listApprovedMemories({ limit: 500 }).find((item) => item.id === memoryId);
  if (!memory) return null;
  const authority: KnowledgeAuthority = memory.category === "decision" && /owner|command|learning-auto-detect/i.test(memory.source)
    ? "current-owner-instruction"
    : "approved-memory";
  return upsertKnowledgeRecord({
    sourceType: "approved-memory",
    sourceRef: `memory:${memory.id}`,
    projectKey: memory.projectKey,
    title: memory.title,
    authority,
    confidence: "high",
    sensitivity: inferSensitivity(memory.projectKey),
    provenance: `Approved memory #${memory.id}; source=${memory.source}; category=${memory.category}`,
    effectiveAt: memory.createdAt,
    verifiedAt: memory.updatedAt,
  });
}

function baseline(recordId: number, projectKey: string, role: BaselineRole) {
  knowledgeDb().prepare(`
    INSERT INTO knowledge_baselines (project_key, knowledge_record_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(project_key, knowledge_record_id) DO UPDATE SET role = excluded.role
  `).run(projectKey, recordId, role);
}

function baselineEducationDocs() {
  const database = knowledgeDb();
  const projects = getMemoryStore().listProjects().map((project) => project.projectKey);
  const docs = database.prepare("SELECT id, source_ref, title FROM knowledge_records WHERE source_type = 'rag-document' AND status = 'active'").all() as Row[];

  const findByName = (needle: string) => docs.find((row) => String(row.source_ref).toLowerCase().includes(needle.toLowerCase()));
  const owner = findByName("01_OWNER_AND_DFB_FOUNDATION.md");
  const freeos = findByName("02_FREEOS_OPERATING_MODEL.md");
  const solutions = findByName("03_DFB_SOLUTIONS.md");
  const entertainment = findByName("04_ENTERTAINMENT_IP.md");
  const reem = findByName("05_REEMTEAM.md");
  const sounds = findByName("06_DFB_SOUNDS_AND_DIGITAL_DREW.md");
  const transport = findByName("07_TRANSPORTATION_CLIENTS_AND_INCUBATION.md");
  const executive = findByName("08_DFB_EXECUTIVE_LAYER.md");

  for (const projectKey of projects) {
    if (owner) baseline(Number(owner.id), projectKey, "supporting");
    if (executive) baseline(Number(executive.id), projectKey, "supporting");
  }

  const add = (row: Row | undefined, keys: string[], role: BaselineRole = "canonical") => {
    if (!row) return;
    for (const key of keys) if (projects.includes(key)) baseline(Number(row.id), key, role);
  };

  add(freeos, ["freeos"]);
  add(solutions, ["dfb-solutions"]);
  add(entertainment, ["still-raising-drew", "get-ya-5", "chester-world"], "canonical");
  add(entertainment, ["dfb-ai-studio", "dfb-social-os"], "supporting");
  add(reem, ["reemteam"]);
  add(sounds, ["dfb-sounds"]);
  add(transport, ["dfb-transportation", "business-ideas"], "canonical");
  add(transport, ["dfb-solutions", "client-builds"], "supporting");
}

export function bootstrapKnowledgeGovernance() {
  const database = knowledgeDb();
  let memories = 0;
  let notes = 0;
  let ragDocuments = 0;

  for (const memory of getMemoryStore().listApprovedMemories({ limit: 500 })) {
    registerApprovedMemory(memory.id);
    memories += 1;
  }

  const noteRows = database.prepare("SELECT * FROM project_notes ORDER BY id").all() as Row[];
  for (const row of noteRows) {
    upsertKnowledgeRecord({
      sourceType: "project-note",
      sourceRef: `project-note:${Number(row.id)}`,
      projectKey: String(row.project_key),
      title: String(row.title),
      authority: "unapproved-draft",
      confidence: "moderate",
      sensitivity: "project-restricted",
      provenance: `Project note #${Number(row.id)}; source=${String(row.source ?? "manual")}`,
      effectiveAt: String(row.created_at),
      verifiedAt: String(row.updated_at),
    });
    notes += 1;
  }

  const ragRows = database.prepare("SELECT * FROM rag_documents WHERE status = 'indexed' ORDER BY id").all() as Row[];
  for (const row of ragRows) {
    const filePath = String(row.file_path);
    const authority = inferRagAuthority(filePath);
    upsertKnowledgeRecord({
      sourceType: "rag-document",
      sourceRef: filePath,
      projectKey: row.project_key == null ? null : String(row.project_key),
      title: String(row.title ?? row.file_name),
      authority,
      confidence: authority === "approved-canonical" || authority === "constitution-hard-rule" ? "confirmed" : "moderate",
      sensitivity: inferSensitivity(row.project_key == null ? null : String(row.project_key)),
      provenance: `Indexed RAG document #${Number(row.id)}; file=${filePath}; hash=${String(row.file_hash ?? "")}`,
      effectiveAt: row.indexed_at == null ? null : String(row.indexed_at),
      verifiedAt: row.indexed_at == null ? null : String(row.indexed_at),
    });
    ragDocuments += 1;
  }

  baselineEducationDocs();
  refreshKnowledgeFreshness();

  return { memories, notes, ragDocuments, status: getKnowledgeGovernanceStatus() };
}

export function refreshKnowledgeFreshness() {
  const database = knowledgeDb();
  const rows = database.prepare(`
    SELECT id, status, verified_at, effective_at, freshness_days
    FROM knowledge_records
    WHERE status IN ('active', 'stale') AND freshness_days IS NOT NULL
  `).all() as Row[];
  let stale = 0;
  let reactivated = 0;
  const now = Date.now();
  for (const row of rows) {
    const days = Number(row.freshness_days);
    const reference = row.verified_at ?? row.effective_at;
    if (!reference || !Number.isFinite(days) || days < 0) continue;
    const ageDays = (now - new Date(String(reference)).getTime()) / 86_400_000;
    const next = ageDays > days ? "stale" : "active";
    if (next !== String(row.status)) {
      database.prepare("UPDATE knowledge_records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(next, Number(row.id));
      if (next === "stale") stale += 1; else reactivated += 1;
    }
  }
  return { stale, reactivated };
}

export function getKnowledgeGovernanceStatus() {
  const database = knowledgeDb();
  const count = (sql: string, ...params: unknown[]) => Number((database.prepare(sql).get(...params) as { count: number }).count);
  const projects = getMemoryStore().listProjects();
  const coverage = projects.map((project) => {
    const row = database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN kb.role = 'canonical' AND kr.status = 'active' THEN 1 ELSE 0 END) AS canonical,
        SUM(CASE WHEN kr.status = 'active' THEN 1 ELSE 0 END) AS active
      FROM knowledge_baselines kb
      JOIN knowledge_records kr ON kr.id = kb.knowledge_record_id
      WHERE kb.project_key = ?
    `).get(project.projectKey) as Row;
    return {
      projectKey: project.projectKey,
      projectName: project.name,
      baselineRecords: Number(row.total ?? 0),
      activeBaselineRecords: Number(row.active ?? 0),
      canonicalRecords: Number(row.canonical ?? 0),
      coverage: Number(row.canonical ?? 0) > 0 ? "BASELINED" : Number(row.total ?? 0) > 0 ? "SUPPORTING_ONLY" : "MISSING",
    };
  });

  return {
    enabled: true,
    records: count("SELECT COUNT(*) AS count FROM knowledge_records"),
    active: count("SELECT COUNT(*) AS count FROM knowledge_records WHERE status = 'active'"),
    stale: count("SELECT COUNT(*) AS count FROM knowledge_records WHERE status = 'stale'"),
    disputed: count("SELECT COUNT(*) AS count FROM knowledge_records WHERE status = 'disputed'"),
    superseded: count("SELECT COUNT(*) AS count FROM knowledge_records WHERE status = 'superseded'"),
    openConflicts: count("SELECT COUNT(*) AS count FROM knowledge_conflicts WHERE status = 'open'"),
    baselineLinks: count("SELECT COUNT(*) AS count FROM knowledge_baselines"),
    authorityOrder: knowledgeAuthorities.map((authority) => ({ authority, rank: authorityRank[authority] })),
    coverage,
  };
}

export function supersedeKnowledge(oldId: number, newId: number, note = "") {
  const database = knowledgeDb();
  const oldRecord = getKnowledgeRecord(oldId);
  const newRecord = getKnowledgeRecord(newId);
  if (!oldRecord || !newRecord) throw new Error("Both knowledge records must exist.");
  database.transaction(() => {
    database.prepare("UPDATE knowledge_records SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(oldId);
    database.prepare("UPDATE knowledge_records SET supersedes_id = ?, notes = CASE WHEN ? <> '' THEN ? ELSE notes END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(oldId, note, note, newId);
  })();
  return { superseded: getKnowledgeRecord(oldId), active: getKnowledgeRecord(newId) };
}

export function createKnowledgeConflict(leftId: number, rightId: number, reason: string) {
  if (leftId === rightId) throw new Error("A knowledge record cannot conflict with itself.");
  const left = getKnowledgeRecord(leftId);
  const right = getKnowledgeRecord(rightId);
  if (!left || !right) throw new Error("Both knowledge records must exist.");
  const database = knowledgeDb();
  const group = `conflict:${Math.min(leftId, rightId)}:${Math.max(leftId, rightId)}`;
  const result = database.transaction(() => {
    database.prepare("UPDATE knowledge_records SET status = 'disputed', conflict_group = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)").run(group, leftId, rightId);
    return database.prepare(`
      INSERT INTO knowledge_conflicts (left_record_id, right_record_id, reason)
      VALUES (?, ?, ?)
    `).run(leftId, rightId, reason);
  })();
  return database.prepare("SELECT * FROM knowledge_conflicts WHERE id = ?").get(result.lastInsertRowid);
}

export function resolveKnowledgeConflict(conflictId: number, winningRecordId: number, resolutionNote: string) {
  const database = knowledgeDb();
  const conflict = database.prepare("SELECT * FROM knowledge_conflicts WHERE id = ?").get(conflictId) as Row | undefined;
  if (!conflict) throw new Error("Knowledge conflict not found.");
  const left = Number(conflict.left_record_id);
  const right = Number(conflict.right_record_id);
  if (![left, right].includes(winningRecordId)) throw new Error("Winner must be one of the conflicting records.");
  const loser = winningRecordId === left ? right : left;
  database.transaction(() => {
    database.prepare("UPDATE knowledge_records SET status = 'active', conflict_group = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(winningRecordId);
    database.prepare("UPDATE knowledge_records SET status = 'superseded', conflict_group = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(loser);
    database.prepare(`
      UPDATE knowledge_conflicts
      SET status = 'resolved', winning_record_id = ?, resolution_note = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(winningRecordId, resolutionNote, conflictId);
  })();
  return database.prepare("SELECT * FROM knowledge_conflicts WHERE id = ?").get(conflictId);
}

export function rankedKnowledge(projectKey?: string) {
  const database = knowledgeDb();
  const params: unknown[] = [];
  const where = projectKey ? "WHERE (kr.project_key = ? OR kb.project_key = ? OR kr.project_key IS NULL)" : "";
  if (projectKey) params.push(projectKey, projectKey);
  const rows = database.prepare(`
    SELECT DISTINCT kr.*, kb.role AS baseline_role
    FROM knowledge_records kr
    LEFT JOIN knowledge_baselines kb ON kb.knowledge_record_id = kr.id
    ${where}
    ORDER BY
      CASE kr.status WHEN 'active' THEN 0 WHEN 'stale' THEN 1 WHEN 'disputed' THEN 2 WHEN 'superseded' THEN 3 ELSE 4 END,
      kr.authority_rank DESC,
      kr.updated_at DESC
    LIMIT 250
  `).all(...params) as Row[];
  return rows.map((row) => ({ ...mapRecord(row), baselineRole: row.baseline_role == null ? null : String(row.baseline_role) }));
}
