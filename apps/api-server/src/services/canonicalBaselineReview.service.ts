import { getToolRegistry } from "@freeos/tool-runner";
import {
  getKnowledgeGovernanceStatus,
  knowledgeDb,
  linkKnowledgeBaseline,
  supersedeKnowledge,
  upsertKnowledgeRecord,
} from "./knowledgeGovernance.service";
import { setLearningQueueStatus } from "./continuousLearning.service";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const projectBaselineReviewStatuses = ["blocked", "pending", "approved", "rejected"] as const;
export type ProjectBaselineReviewStatus = (typeof projectBaselineReviewStatuses)[number];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project_baseline_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL UNIQUE,
        project_key TEXT NOT NULL,
        baseline_text TEXT NOT NULL,
        remaining_unknowns_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'blocked',
        owner_note TEXT NOT NULL DEFAULT '',
        approved_knowledge_record_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_project_baseline_review_project ON project_baseline_reviews(project_key);
      CREATE INDEX IF NOT EXISTS idx_project_baseline_review_status ON project_baseline_reviews(status);
    `);
    schemaReady = true;
  }
  return database;
}

function parseStrings(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function mapReview(row: Row) {
  return {
    id: Number(row.id),
    draftId: Number(row.draft_id),
    projectKey: String(row.project_key),
    baselineText: String(row.baseline_text),
    remainingUnknowns: parseStrings(row.remaining_unknowns_json),
    status: String(row.status) as ProjectBaselineReviewStatus,
    ownerNote: String(row.owner_note ?? ""),
    approvedKnowledgeRecordId: row.approved_knowledge_record_id == null ? null : Number(row.approved_knowledge_record_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
  };
}

function getDraft(draftId: number): Row {
  if (!Number.isInteger(draftId) || draftId < 1) throw new Error("Invalid project inspection draft ID.");
  const row = db().prepare("SELECT * FROM project_inspection_drafts WHERE id=?").get(draftId) as Row | undefined;
  if (!row) throw new Error("Project inspection draft not found.");
  return row;
}

function getReviewRow(id: number): Row {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid project baseline review ID.");
  const row = db().prepare("SELECT * FROM project_baseline_reviews WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new Error("Project baseline review not found.");
  return row;
}

export function prepareProjectBaselineReview(draftId: number) {
  const database = db();
  const draft = getDraft(draftId);
  const unknowns = parseStrings(draft.unknowns_json);
  const nextStatus: ProjectBaselineReviewStatus = unknowns.length > 0 ? "blocked" : "pending";

  database.prepare(`
    INSERT INTO project_baseline_reviews (
      draft_id, project_key, baseline_text, remaining_unknowns_json, status
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(draft_id) DO UPDATE SET
      project_key=excluded.project_key,
      baseline_text=CASE WHEN project_baseline_reviews.status IN ('blocked','pending') THEN excluded.baseline_text ELSE project_baseline_reviews.baseline_text END,
      remaining_unknowns_json=CASE WHEN project_baseline_reviews.status IN ('blocked','pending') THEN excluded.remaining_unknowns_json ELSE project_baseline_reviews.remaining_unknowns_json END,
      status=CASE WHEN project_baseline_reviews.status IN ('approved','rejected') THEN project_baseline_reviews.status ELSE excluded.status END,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    draftId,
    String(draft.project_key),
    String(draft.baseline_draft),
    JSON.stringify(unknowns),
    nextStatus,
  );

  const row = database.prepare("SELECT * FROM project_baseline_reviews WHERE draft_id=?").get(draftId) as Row;
  const review = mapReview(row);
  return {
    review,
    canonicalWritePerformed: false,
    durableMemoryCreated: false,
    ownerApprovalRequired: true,
    blockedByUnknowns: review.remainingUnknowns.length > 0,
    rule: "A project baseline may become canonical only after unresolved UNKNOWNs are addressed and Drew explicitly approves the review.",
  };
}

export function reviseProjectBaselineReview(id: number, input: {
  baselineText?: string;
  remainingUnknowns?: string[];
  ownerNote?: string;
}) {
  const database = db();
  const existing = mapReview(getReviewRow(id));
  if (["approved", "rejected"].includes(existing.status)) throw new Error("Approved or rejected project baseline reviews cannot be revised in place.");

  const baselineText = input.baselineText?.trim() || existing.baselineText;
  const remainingUnknowns = input.remainingUnknowns === undefined
    ? existing.remainingUnknowns
    : cleanStrings(input.remainingUnknowns);
  const ownerNote = input.ownerNote?.trim() ?? existing.ownerNote;
  const status: ProjectBaselineReviewStatus = remainingUnknowns.length > 0 ? "blocked" : "pending";

  database.prepare(`
    UPDATE project_baseline_reviews
    SET baseline_text=?, remaining_unknowns_json=?, owner_note=?, status=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(baselineText, JSON.stringify(remainingUnknowns), ownerNote, status, id);

  return {
    review: mapReview(database.prepare("SELECT * FROM project_baseline_reviews WHERE id=?").get(id) as Row),
    canonicalWritePerformed: false,
    ownerApprovalRequired: true,
  };
}

export function approveProjectBaselineReview(id: number) {
  const database = db();
  const review = mapReview(getReviewRow(id));
  if (review.status !== "pending") {
    if (review.status === "blocked") throw new Error("Project baseline review is blocked by unresolved UNKNOWNs.");
    throw new Error(`Project baseline review is already ${review.status}.`);
  }
  if (review.remainingUnknowns.length > 0) throw new Error("Project baseline review still has unresolved UNKNOWNs.");

  const draft = getDraft(review.draftId);
  const project = database.prepare("SELECT name FROM projects WHERE project_key=?").get(review.projectKey) as Row | undefined;
  const projectName = String(project?.name ?? review.projectKey);
  const now = new Date().toISOString();

  const record = upsertKnowledgeRecord({
    sourceType: "project-canonical-baseline",
    sourceRef: `project-baseline-review:${review.id}`,
    projectKey: review.projectKey,
    title: `${projectName} canonical project baseline`,
    authority: "approved-canonical",
    status: "active",
    confidence: "confirmed",
    sensitivity: "project-restricted",
    provenance: `Owner-approved project baseline review #${review.id}; inspection draft #${review.draftId}; learning work #${draft.learning_work_id ?? "unknown"}`,
    effectiveAt: now,
    verifiedAt: now,
    notes: review.baselineText,
  });

  const previous = database.prepare(`
    SELECT id
    FROM knowledge_records
    WHERE source_type='project-canonical-baseline'
      AND project_key=?
      AND status='active'
      AND id<>?
    ORDER BY id
  `).all(review.projectKey, record.id) as Row[];
  for (const row of previous) {
    supersedeKnowledge(Number(row.id), record.id, `Superseded by owner-approved project baseline review #${review.id}.`);
  }

  linkKnowledgeBaseline(record.id, review.projectKey, "canonical");

  database.transaction(() => {
    database.prepare(`
      UPDATE project_baseline_reviews
      SET status='approved', approved_knowledge_record_id=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(record.id, id);
    database.prepare("UPDATE project_inspection_drafts SET status='approved', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(review.draftId);
  })();

  const queueItemId = draft.queue_item_id == null ? null : Number(draft.queue_item_id);
  if (queueItemId) {
    const queue = database.prepare("SELECT status FROM continuous_learning_queue WHERE id=?").get(queueItemId) as Row | undefined;
    if (queue && String(queue.status) === "open") setLearningQueueStatus(queueItemId, "resolved");
  }

  return {
    review: mapReview(database.prepare("SELECT * FROM project_baseline_reviews WHERE id=?").get(id) as Row),
    knowledgeRecord: record,
    canonicalWritePerformed: true,
    durableMemoryCreated: false,
    learningQueueResolved: Boolean(queueItemId),
    governance: getKnowledgeGovernanceStatus(),
  };
}

export function rejectProjectBaselineReview(id: number, note = "") {
  const database = db();
  const review = mapReview(getReviewRow(id));
  if (review.status === "approved") throw new Error("Approved project baseline reviews cannot be rejected.");
  if (review.status === "rejected") return review;
  database.prepare(`
    UPDATE project_baseline_reviews
    SET status='rejected', owner_note=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(note.trim() || review.ownerNote, id);
  return mapReview(database.prepare("SELECT * FROM project_baseline_reviews WHERE id=?").get(id) as Row);
}

export function getProjectBaselineReview(id: number) {
  if (!Number.isInteger(id) || id < 1) return null;
  const row = db().prepare("SELECT * FROM project_baseline_reviews WHERE id=?").get(id) as Row | undefined;
  return row ? mapReview(row) : null;
}

export function listProjectBaselineReviews(input: { projectKey?: string; status?: ProjectBaselineReviewStatus; limit?: number } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.projectKey?.trim()) { clauses.push("project_key=?"); params.push(input.projectKey.trim()); }
  if (input.status) { clauses.push("status=?"); params.push(input.status); }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (db().prepare(`SELECT * FROM project_baseline_reviews ${where} ORDER BY updated_at DESC,id DESC LIMIT ?`).all(...params) as Row[]).map(mapReview);
}

export function getProjectBaselineReviewStatus() {
  const database = db();
  const count = (where = "1=1") => Number((database.prepare(`SELECT COUNT(*) AS count FROM project_baseline_reviews WHERE ${where}`).get() as { count: number }).count);
  return {
    enabled: true,
    mode: "owner-approved-canonicalization",
    total: count(),
    blocked: count("status='blocked'"),
    pending: count("status='pending'"),
    approved: count("status='approved'"),
    rejected: count("status='rejected'"),
    canonicalWritesRequireExplicitApproval: true,
    unresolvedUnknownsBlockApproval: true,
    durableMemoryCreatedAutomatically: false,
    rule: "Inspection drafts are not canonical. UNKNOWNs must be resolved, then Drew must explicitly approve before approved-canonical project knowledge is written.",
  };
}
