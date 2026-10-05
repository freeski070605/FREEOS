import { Router } from "express";
import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";

export const experienceRouter = Router();

const outcomes = ["success", "partial", "failure", "owner-correction"] as const;
const confidences = ["confirmed", "high", "moderate", "low", "unverified", "disputed"] as const;
const scopes = ["global", "project", "client", "business", "personal"] as const;
const sensitivities = ["public", "internal", "project-restricted", "private"] as const;

type ExperienceOutcome = (typeof outcomes)[number];
type Confidence = (typeof confidences)[number];
type ExperienceScope = (typeof scopes)[number];
type Sensitivity = (typeof sensitivities)[number];
type JsonRecord = Record<string, unknown>;
type Row = Record<string, unknown>;

let schemaReady = false;

function db() {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS experience_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        title TEXT NOT NULL,
        expected_result TEXT NOT NULL,
        actual_result TEXT NOT NULL,
        outcome TEXT NOT NULL,
        cause TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '',
        candidate_lesson TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'global',
        sensitivity TEXT NOT NULL DEFAULT 'internal',
        confidence TEXT NOT NULL DEFAULT 'moderate',
        status TEXT NOT NULL DEFAULT 'observed',
        learning_proposal_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_experience_created ON experience_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_experience_outcome ON experience_events(outcome);
      CREATE INDEX IF NOT EXISTS idx_experience_project ON experience_events(project_key);
      CREATE INDEX IF NOT EXISTS idx_experience_status ON experience_events(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_experience_source_ref
        ON experience_events(source_type, source_ref)
        WHERE source_ref IS NOT NULL;
    `);
    schemaReady = true;
  }
  return database;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value as T[number])
    ? value as T[number]
    : fallback;
}

function rowView(row: Row) {
  return {
    id: Number(row.id),
    projectKey: row.project_key == null ? null : String(row.project_key),
    sourceType: String(row.source_type),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    title: String(row.title),
    expectedResult: String(row.expected_result),
    actualResult: String(row.actual_result),
    outcome: String(row.outcome) as ExperienceOutcome,
    cause: String(row.cause ?? ""),
    evidence: String(row.evidence ?? ""),
    candidateLesson: String(row.candidate_lesson ?? ""),
    scope: String(row.scope) as ExperienceScope,
    sensitivity: String(row.sensitivity) as Sensitivity,
    confidence: String(row.confidence) as Confidence,
    status: String(row.status),
    learningProposalId: row.learning_proposal_id == null ? null : Number(row.learning_proposal_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function getEvent(id: number) {
  if (!Number.isInteger(id) || id < 1) return null;
  const row = db().prepare("SELECT * FROM experience_events WHERE id = ?").get(id) as Row | undefined;
  return row ? rowView(row) : null;
}

function assertProject(projectKey: string | undefined) {
  if (!projectKey) return undefined;
  if (!getMemoryStore().getProjectByKey(projectKey)) {
    throw new Error(`Unknown projectKey: ${projectKey}.`);
  }
  return projectKey;
}

experienceRouter.get("/status", (_request, response, next) => {
  try {
    const database = db();
    const count = (where = "1=1") => Number((database.prepare(`SELECT COUNT(*) AS count FROM experience_events WHERE ${where}`).get() as { count: number }).count);
    response.json({
      enabled: true,
      durableLearningRequiresApproval: true,
      total: count(),
      observed: count("status = 'observed'"),
      proposalsCreated: count("status = 'proposal-created'"),
      withCandidateLesson: count("candidate_lesson <> ''"),
      success: count("outcome = 'success'"),
      partial: count("outcome = 'partial'"),
      failure: count("outcome = 'failure'"),
      ownerCorrection: count("outcome = 'owner-correction'"),
      outcomes,
      confidences,
      scopes,
      sensitivities,
    });
  } catch (error) { next(error); }
});

experienceRouter.get("/", (request, response, next) => {
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const projectKey = cleanString(request.query.projectKey);
    const outcome = cleanString(request.query.outcome);
    const status = cleanString(request.query.status);
    if (projectKey) { clauses.push("project_key = ?"); params.push(projectKey); }
    if (outcome) { clauses.push("outcome = ?"); params.push(outcome); }
    if (status) { clauses.push("status = ?"); params.push(status); }
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
    params.push(limit);
    const sql = `SELECT * FROM experience_events${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    const events = (db().prepare(sql).all(...params) as Row[]).map(rowView);
    response.json({ events, count: events.length });
  } catch (error) { next(error); }
});

experienceRouter.post("/", (request, response, next) => {
  try {
    const body = record(request.body);
    const title = cleanString(body.title);
    const expectedResult = cleanString(body.expectedResult);
    const actualResult = cleanString(body.actualResult);
    if (!title || !expectedResult || !actualResult) {
      response.status(400).json({ error: "title, expectedResult, and actualResult are required." });
      return;
    }

    const projectKey = assertProject(cleanString(body.projectKey));
    const outcome = oneOf(body.outcome, outcomes, "partial");
    const scope = oneOf(body.scope, scopes, projectKey ? "project" : "global");
    const sensitivity = oneOf(body.sensitivity, sensitivities, projectKey ? "project-restricted" : "internal");
    const confidence = oneOf(body.confidence, confidences, "moderate");
    const sourceType = cleanString(body.sourceType) ?? "manual";
    const sourceRef = cleanString(body.sourceRef) ?? null;

    const database = db();
    if (sourceRef) {
      const duplicate = database.prepare("SELECT * FROM experience_events WHERE source_type = ? AND source_ref = ?").get(sourceType, sourceRef) as Row | undefined;
      if (duplicate) {
        response.status(200).json({ event: rowView(duplicate), duplicate: true });
        return;
      }
    }

    const result = database.prepare(`
      INSERT INTO experience_events (
        project_key, source_type, source_ref, title, expected_result, actual_result,
        outcome, cause, evidence, candidate_lesson, scope, sensitivity, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectKey ?? null,
      sourceType,
      sourceRef,
      title,
      expectedResult,
      actualResult,
      outcome,
      cleanString(body.cause) ?? "",
      cleanString(body.evidence) ?? "",
      cleanString(body.candidateLesson) ?? "",
      scope,
      sensitivity,
      confidence,
    );

    response.status(201).json({ event: getEvent(Number(result.lastInsertRowid)), duplicate: false });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown projectKey:")) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

experienceRouter.post("/capture/tool-runs", (request, response, next) => {
  try {
    const body = record(request.body);
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
    const database = db();
    const rows = database.prepare(`
      SELECT id, tool_key, status, error, started_at, finished_at
      FROM tool_runs
      WHERE status IN ('completed', 'failed', 'blocked')
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const sourceRef = `tool-run:${Number(row.id)}`;
      const exists = database.prepare("SELECT id FROM experience_events WHERE source_type = 'tool-run' AND source_ref = ?").get(sourceRef);
      if (exists) { skipped += 1; continue; }

      const status = String(row.status);
      const toolKey = String(row.tool_key);
      const outcome: ExperienceOutcome = status === "completed" ? "success" : status === "failed" ? "failure" : "partial";
      const actual = status === "completed"
        ? "Tool run completed successfully."
        : cleanString(row.error) ?? `Tool run ended with status ${status}.`;
      const cause = status === "blocked"
        ? "Execution was blocked by FREEOS controls or validation."
        : status === "failed" ? actual : "";

      database.prepare(`
        INSERT INTO experience_events (
          source_type, source_ref, title, expected_result, actual_result, outcome,
          cause, evidence, scope, sensitivity, confidence
        ) VALUES ('tool-run', ?, ?, ?, ?, ?, ?, ?, 'global', 'internal', ?)
      `).run(
        sourceRef,
        `Tool ${toolKey}: ${status}`,
        `Tool ${toolKey} completes safely within its allowed scope.`,
        actual,
        outcome,
        cause,
        `tool_run_id=${Number(row.id)}; started_at=${String(row.started_at ?? "")}; finished_at=${String(row.finished_at ?? "")}`,
        status === "completed" ? "high" : "moderate",
      );
      imported += 1;
    }

    response.json({ scanned: rows.length, imported, skipped });
  } catch (error) { next(error); }
});

experienceRouter.post("/:id/propose", (request, response, next) => {
  try {
    const id = Number(request.params.id);
    const event = getEvent(id);
    if (!event) {
      response.status(404).json({ error: "Experience event not found." });
      return;
    }
    if (event.learningProposalId) {
      response.status(409).json({ error: "This experience already has a Learning Proposal.", learningProposalId: event.learningProposalId });
      return;
    }

    const body = record(request.body);
    const candidateLesson = cleanString(body.candidateLesson) ?? event.candidateLesson;
    if (!candidateLesson) {
      response.status(400).json({ error: "candidateLesson is required before an experience can become a Learning Proposal." });
      return;
    }
    const whyItMatters = cleanString(body.whyItMatters)
      ?? `Expected: ${event.expectedResult} Actual: ${event.actualResult}${event.cause ? ` Cause: ${event.cause}` : ""}`;
    const confidence = oneOf(body.confidence, confidences, event.confidence);
    const scope = oneOf(body.scope, scopes, event.scope);
    const projectKey = event.projectKey ?? undefined;

    const proposal = getMemoryStore().createProposal({
      title: (cleanString(body.title) ?? `Experience lesson: ${event.title}`).slice(0, 120),
      content: candidateLesson,
      category: projectKey ? "project" : "reference",
      projectKey,
      source: "experience-learning",
      reason: whyItMatters,
      tags: [
        "learning-proposal",
        "experience-learning",
        `experience-id:${event.id}`,
        `outcome:${event.outcome}`,
        `scope:${scope}`,
        `sensitivity:${event.sensitivity}`,
        `confidence:${confidence}`,
      ],
    });

    db().prepare(`
      UPDATE experience_events
      SET candidate_lesson = ?, confidence = ?, scope = ?, status = 'proposal-created', learning_proposal_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(candidateLesson, confidence, scope, proposal.id, id);

    response.status(201).json({ event: getEvent(id), proposal, durableMemoryCreated: false });
  } catch (error) { next(error); }
});

experienceRouter.post("/:id/close", (request, response, next) => {
  try {
    const id = Number(request.params.id);
    const event = getEvent(id);
    if (!event) {
      response.status(404).json({ error: "Experience event not found." });
      return;
    }
    db().prepare("UPDATE experience_events SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    response.json({ event: getEvent(id) });
  } catch (error) { next(error); }
});
