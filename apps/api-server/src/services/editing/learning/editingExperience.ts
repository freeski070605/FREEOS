import { getToolRegistry } from "@freeos/tool-runner";

export interface EditingExperience {
  projectKey?: string;
  editClass: string;
  issue: string;
  evidence: string;
  attemptedBehavior: string;
  result: string;
  ownerCorrection?: string;
  proposedLesson: string;
  confidence: "low" | "moderate" | "high" | "confirmed";
  scope: "project" | "personal" | "global";
}

// The shared experience_events table is the governed learning inbox. Recording
// an observation never promotes it into an approved skill or universal rule.
export function recordEditingExperience(item: EditingExperience): number {
  const db = getToolRegistry().database;
  db.exec(`CREATE TABLE IF NOT EXISTS experience_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_key TEXT, source_type TEXT NOT NULL DEFAULT 'manual',
    source_ref TEXT, title TEXT NOT NULL, expected_result TEXT NOT NULL, actual_result TEXT NOT NULL,
    outcome TEXT NOT NULL, cause TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
    candidate_lesson TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT 'global',
    sensitivity TEXT NOT NULL DEFAULT 'internal', confidence TEXT NOT NULL DEFAULT 'moderate',
    status TEXT NOT NULL DEFAULT 'observed', learning_proposal_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const result = db.prepare(`INSERT INTO experience_events
    (project_key, source_type, title, expected_result, actual_result, outcome, cause, evidence,
     candidate_lesson, scope, sensitivity, confidence, status)
    VALUES (?, 'editing-planner', ?, ?, ?, ?, ?, ?, ?, ?, 'project-restricted', ?, 'observed')`)
    .run(item.projectKey ?? null, `${item.editClass}: ${item.issue}`.slice(0, 220),
      "A legal, grounded, coherent edit", item.result,
      item.ownerCorrection ? "owner-correction" : "failure", item.attemptedBehavior.slice(0, 2000),
      JSON.stringify({ editClass: item.editClass, issue: item.issue, evidence: item.evidence.slice(0, 4000), ownerCorrection: item.ownerCorrection?.slice(0, 4000) ?? null }),
      item.proposedLesson.slice(0, 2000), item.ownerCorrection && item.scope === "global" ? "project" : item.scope, item.confidence);
  return Number(result.lastInsertRowid);
}
