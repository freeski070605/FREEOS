import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const learningWorkTypes = [
  "research-verification",
  "document-study",
  "experiment",
  "project-inspection",
  "owner-review",
] as const;
export const learningWorkStatuses = ["prepared", "completed", "cancelled"] as const;

export type LearningWorkType = (typeof learningWorkTypes)[number];
export type LearningWorkStatus = (typeof learningWorkStatuses)[number];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS learning_work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_item_id INTEGER NOT NULL UNIQUE,
        project_key TEXT,
        work_type TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL,
        boundaries TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared',
        result_summary TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '',
        prepared_by TEXT NOT NULL DEFAULT 'learning-work-rule-engine-v1',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_learning_work_status ON learning_work_items(status);
      CREATE INDEX IF NOT EXISTS idx_learning_work_type ON learning_work_items(work_type);
      CREATE INDEX IF NOT EXISTS idx_learning_work_project ON learning_work_items(project_key);
    `);
    schemaReady = true;
  }
  return database;
}

function mapWork(row: Row) {
  let plan: string[] = [];
  try {
    const parsed = JSON.parse(String(row.plan_json ?? "[]"));
    if (Array.isArray(parsed)) plan = parsed.filter((item): item is string => typeof item === "string");
  } catch { plan = []; }
  return {
    id: Number(row.id),
    queueItemId: Number(row.queue_item_id),
    projectKey: row.project_key == null ? null : String(row.project_key),
    workType: String(row.work_type) as LearningWorkType,
    title: String(row.title),
    objective: String(row.objective),
    plan,
    acceptanceCriteria: String(row.acceptance_criteria),
    boundaries: String(row.boundaries),
    status: String(row.status) as LearningWorkStatus,
    resultSummary: String(row.result_summary ?? ""),
    evidence: String(row.evidence ?? ""),
    preparedBy: String(row.prepared_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

function queueItem(id: number): Row {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid learning queue item ID.");
  const row = db().prepare("SELECT * FROM continuous_learning_queue WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("Learning queue item not found.");
  return row;
}

function classify(queue: Row): LearningWorkType {
  const signal = String(queue.signal_type);
  if (signal === "current-intelligence-refresh") return "research-verification";
  if (signal === "project-education") return "project-inspection";

  if (signal === "experience-review") {
    const match = String(queue.source_ref).match(/^experience:(\d+)$/);
    const experience = match
      ? db().prepare("SELECT outcome, confidence FROM experience_events WHERE id = ?").get(Number(match[1])) as Row | undefined
      : undefined;
    const outcome = String(experience?.outcome ?? "");
    const confidence = String(experience?.confidence ?? "");
    if (["failure", "partial", "owner-correction"].includes(outcome) && !["confirmed"].includes(confidence)) return "experiment";
    return "owner-review";
  }

  if (signal === "knowledge-review") {
    const match = String(queue.source_ref).match(/^knowledge:(\d+)$/);
    const knowledge = match
      ? db().prepare("SELECT status, source_type, authority FROM knowledge_records WHERE id = ?").get(Number(match[1])) as Row | undefined
      : undefined;
    if (String(knowledge?.status ?? "") === "disputed") return "owner-review";
    const sourceType = String(knowledge?.source_type ?? "");
    if (["rag-document", "project-note", "approved-memory"].includes(sourceType)) return "document-study";
    return "research-verification";
  }

  return "owner-review";
}

function recipe(workType: LearningWorkType, queue: Row) {
  if (workType === "research-verification") {
    return {
      objective: `Obtain fresh evidence for: ${String(queue.title)}`,
      plan: [
        "Restate the claim or freshness gap precisely before searching.",
        "Identify the strongest appropriate source class, preferring primary sources when available.",
        "Collect source URL, publication/update time, and the specific evidence that supports or contradicts the claim.",
        "Compare the fresh evidence with the stale/current record and note any material change.",
        "Prepare a Current Intelligence update with an explicit freshness horizon; do not create durable memory automatically.",
      ],
      acceptance: "A current claim is supported by dated evidence with source class, confidence, observed time, and freshness horizon, or the result is explicitly UNKNOWN/unverified.",
      boundaries: "Research/read/prepare only. Do not treat search snippets as verified fact, do not auto-promote research to durable memory, and do not bypass the Learning Proposal approval path.",
    };
  }
  if (workType === "document-study") {
    return {
      objective: `Re-evaluate governed local knowledge for: ${String(queue.title)}`,
      plan: [
        "Locate the exact governed source record and its provenance.",
        "Read the controlling source and enough surrounding context to avoid snippet-level conclusions.",
        "Check whether the source still supports the recorded claim and whether a newer controlling source exists.",
        "Prepare a keep, refresh, supersede, archive, or conflict-resolution recommendation with evidence.",
      ],
      acceptance: "The recommendation cites the controlling local source and explains why its authority/status should remain or change.",
      boundaries: "Read-only study. Do not rewrite canonical knowledge or change authority/status without the existing governance path.",
    };
  }
  if (workType === "experiment") {
    return {
      objective: `Test the candidate lesson behind: ${String(queue.title)}`,
      plan: [
        "State the candidate lesson as a falsifiable expectation.",
        "Design the smallest reversible test that can confirm or weaken it.",
        "Define expected result, failure signal, rollback/cleanup, and evidence to capture before running anything.",
        "Run only inside an approved low-risk sandbox/test scope; otherwise stop at the prepared experiment plan.",
        "Compare expected vs actual result and feed the outcome back into Experience Learning.",
      ],
      acceptance: "A reproducible test plan exists with expected result, actual-evidence requirements, and a clear condition for whether the candidate lesson deserves a Learning Proposal.",
      boundaries: "No production changes, purchases, sends, deployments, trading, destructive actions, credential access, or approval bypass. Capability does not imply authority.",
    };
  }
  if (workType === "project-inspection") {
    return {
      objective: `Build project-specific institutional certainty for: ${String(queue.title)}`,
      plan: [
        "Inspect the project's real files, registered notes, governed baseline links, decisions, and current-state evidence.",
        "Separate observed facts from assumptions and identify ownership, scope, constraints, active goals, blockers, and known issues.",
        "Identify which existing global canonical knowledge already applies so it is linked rather than duplicated.",
        "Draft the minimum project-specific canonical baseline needed to close the gap.",
        "Route any durable additions through owner review/Learning Proposal or the approved canonical-document workflow.",
      ],
      acceptance: "A concise baseline draft identifies current state, goals, constraints, ownership, roadmap/blockers, sources, and unresolved UNKNOWNs without duplicating global knowledge.",
      boundaries: "Read/inspect/prepare only. Do not assume DFB ownership, invent project facts, alter client data, or silently promote drafts to canonical knowledge.",
    };
  }
  return {
    objective: `Prepare an owner decision for: ${String(queue.title)}`,
    plan: [
      "Assemble the relevant evidence, provenance, authority, confidence, and unresolved uncertainty.",
      "Reduce the issue to the smallest real owner decision required.",
      "Present the recommended option and the strongest reasonable alternative with consequences.",
      "Wait for Drew's decision before any durable knowledge, conflict resolution, or authority change.",
    ],
    acceptance: "The owner can decide from one concise brief without needing to reconstruct the evidence chain.",
    boundaries: "Decision support only. FREEOS may recommend and prepare, but Drew remains final authority for the decision and any durable learning it creates.",
  };
}

export function prepareLearningWork(queueItemId: number) {
  const database = db();
  const queue = queueItem(queueItemId);
  if (String(queue.status) !== "open") throw new Error("Learning work can only be prepared from an open learning queue item.");
  const workType = classify(queue);
  const prepared = recipe(workType, queue);
  const existing = database.prepare("SELECT * FROM learning_work_items WHERE queue_item_id = ?").get(queueItemId) as Row | undefined;

  if (!existing) {
    database.prepare(`
      INSERT INTO learning_work_items (
        queue_item_id, project_key, work_type, title, objective, plan_json,
        acceptance_criteria, boundaries, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared')
    `).run(
      queueItemId,
      queue.project_key ?? null,
      workType,
      String(queue.title),
      prepared.objective,
      JSON.stringify(prepared.plan),
      prepared.acceptance,
      prepared.boundaries,
    );
  } else if (String(existing.status) !== "completed") {
    database.prepare(`
      UPDATE learning_work_items
      SET project_key=?, work_type=?, title=?, objective=?, plan_json=?,
          acceptance_criteria=?, boundaries=?, status='prepared', updated_at=CURRENT_TIMESTAMP,
          completed_at=NULL
      WHERE queue_item_id=?
    `).run(
      queue.project_key ?? null,
      workType,
      String(queue.title),
      prepared.objective,
      JSON.stringify(prepared.plan),
      prepared.acceptance,
      prepared.boundaries,
      queueItemId,
    );
  }

  const row = database.prepare("SELECT * FROM learning_work_items WHERE queue_item_id = ?").get(queueItemId) as Row;
  return {
    work: mapWork(row),
    queue: {
      id: Number(queue.id),
      signalType: String(queue.signal_type),
      sourceRef: String(queue.source_ref),
      priority: String(queue.priority),
      recommendedAction: String(queue.recommended_action ?? ""),
    },
  };
}

export function prepareNextLearningWork() {
  reconcileLearningWork();
  const row = db().prepare(`
    SELECT q.id
    FROM continuous_learning_queue q
    LEFT JOIN learning_work_items w ON w.queue_item_id = q.id AND w.status IN ('prepared','completed')
    WHERE q.status='open' AND w.id IS NULL
    ORDER BY CASE q.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, q.updated_at DESC, q.id DESC
    LIMIT 1
  `).get() as Row | undefined;
  return row ? prepareLearningWork(Number(row.id)) : null;
}

export function reconcileLearningWork() {
  const database = db();
  const rows = database.prepare(`
    SELECT w.id
    FROM learning_work_items w
    JOIN continuous_learning_queue q ON q.id = w.queue_item_id
    WHERE w.status='prepared' AND q.status <> 'open'
  `).all() as Row[];
  for (const row of rows) {
    database.prepare("UPDATE learning_work_items SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(row.id));
  }
  return { cancelled: rows.length };
}

export function listLearningWork(input: { status?: LearningWorkStatus; workType?: LearningWorkType; projectKey?: string; limit?: number } = {}) {
  reconcileLearningWork();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.status) { clauses.push("status=?"); params.push(input.status); }
  if (input.workType) { clauses.push("work_type=?"); params.push(input.workType); }
  if (input.projectKey?.trim()) { clauses.push("project_key=?"); params.push(input.projectKey.trim()); }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (db().prepare(`SELECT * FROM learning_work_items ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...params) as Row[]).map(mapWork);
}

export function getLearningWork(id: number) {
  reconcileLearningWork();
  const row = db().prepare("SELECT * FROM learning_work_items WHERE id=?").get(id) as Row | undefined;
  return row ? mapWork(row) : null;
}

export function completeLearningWork(id: number, input: { resultSummary: string; evidence?: string }) {
  const existing = getLearningWork(id);
  if (!existing) throw new Error("Learning work item not found.");
  if (existing.status !== "prepared") throw new Error("Only prepared learning work can be completed.");
  const summary = input.resultSummary?.trim();
  if (!summary) throw new Error("resultSummary is required.");
  db().prepare(`
    UPDATE learning_work_items
    SET status='completed', result_summary=?, evidence=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(summary, input.evidence?.trim() ?? "", id);
  return getLearningWork(id)!;
}

export function getLearningWorkStatus() {
  reconcileLearningWork();
  const database = db();
  const count = (where = "1=1") => Number((database.prepare(`SELECT COUNT(*) AS count FROM learning_work_items WHERE ${where}`).get() as { count: number }).count);
  const byType = database.prepare("SELECT work_type AS workType, COUNT(*) AS count FROM learning_work_items WHERE status='prepared' GROUP BY work_type ORDER BY count DESC, work_type").all() as Array<{ workType: string; count: number }>;
  return {
    enabled: true,
    mode: "prepare-only",
    autonomousExternalResearchEnabled: false,
    autonomousExperimentsEnabled: false,
    autonomousCanonicalWritesEnabled: false,
    durableLearningRequiresApproval: true,
    total: count(),
    prepared: count("status='prepared'"),
    completed: count("status='completed'"),
    cancelled: count("status='cancelled'"),
    byType,
    workTypes: learningWorkTypes,
    rule: "Learning Work Executor may classify and prepare learning work. External research, experiments, canonical changes, and durable learning remain separately governed.",
  };
}