import { Router } from "express";
import {
  authorityRank,
  baselineRoles,
  bootstrapKnowledgeGovernance,
  createKnowledgeConflict,
  getKnowledgeGovernanceStatus,
  getKnowledgeRecord,
  knowledgeAuthorities,
  knowledgeConfidences,
  knowledgeDb,
  knowledgeSensitivities,
  knowledgeStatuses,
  rankedKnowledge,
  refreshKnowledgeFreshness,
  resolveKnowledgeConflict,
  supersedeKnowledge,
  upsertKnowledgeRecord,
} from "../services/knowledgeGovernance.service";

export const knowledgeRouter = Router();

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

knowledgeRouter.get("/status", (_request, response, next) => {
  try {
    response.json(getKnowledgeGovernanceStatus());
  } catch (error) { next(error); }
});

knowledgeRouter.post("/bootstrap", (_request, response, next) => {
  try {
    response.json(bootstrapKnowledgeGovernance());
  } catch (error) { next(error); }
});

knowledgeRouter.post("/refresh-freshness", (_request, response, next) => {
  try {
    response.json({ result: refreshKnowledgeFreshness(), status: getKnowledgeGovernanceStatus() });
  } catch (error) { next(error); }
});

knowledgeRouter.get("/records", (request, response, next) => {
  try {
    const projectKey = cleanString(request.query.projectKey);
    response.json({ records: rankedKnowledge(projectKey) });
  } catch (error) { next(error); }
});

knowledgeRouter.get("/records/:id", (request, response, next) => {
  try {
    const item = getKnowledgeRecord(Number(request.params.id));
    if (!item) {
      response.status(404).json({ error: "Knowledge record not found." });
      return;
    }
    response.json({ record: item });
  } catch (error) { next(error); }
});

knowledgeRouter.post("/records", (request, response, next) => {
  try {
    const body = record(request.body);
    const sourceType = cleanString(body.sourceType);
    const sourceRef = cleanString(body.sourceRef);
    const title = cleanString(body.title);
    const authority = cleanString(body.authority);
    if (!sourceType || !sourceRef || !title || !authority) {
      response.status(400).json({ error: "sourceType, sourceRef, title, and authority are required." });
      return;
    }
    if (!knowledgeAuthorities.includes(authority as (typeof knowledgeAuthorities)[number])) {
      response.status(400).json({ error: "Unknown knowledge authority." });
      return;
    }
    const item = upsertKnowledgeRecord({
      sourceType,
      sourceRef,
      projectKey: cleanString(body.projectKey) ?? null,
      title,
      authority: authority as (typeof knowledgeAuthorities)[number],
      status: knowledgeStatuses.includes(body.status as (typeof knowledgeStatuses)[number]) ? body.status as (typeof knowledgeStatuses)[number] : "active",
      confidence: knowledgeConfidences.includes(body.confidence as (typeof knowledgeConfidences)[number]) ? body.confidence as (typeof knowledgeConfidences)[number] : "moderate",
      sensitivity: knowledgeSensitivities.includes(body.sensitivity as (typeof knowledgeSensitivities)[number]) ? body.sensitivity as (typeof knowledgeSensitivities)[number] : "internal",
      provenance: cleanString(body.provenance) ?? "",
      effectiveAt: cleanString(body.effectiveAt) ?? null,
      verifiedAt: cleanString(body.verifiedAt) ?? null,
      freshnessDays: Number.isFinite(Number(body.freshnessDays)) ? Number(body.freshnessDays) : null,
      notes: cleanString(body.notes) ?? "",
    });
    response.status(201).json({ record: item });
  } catch (error) { next(error); }
});

knowledgeRouter.post("/records/:id/supersede", (request, response, next) => {
  try {
    const body = record(request.body);
    const newId = Number(body.newRecordId);
    if (!Number.isInteger(newId) || newId < 1) {
      response.status(400).json({ error: "newRecordId is required." });
      return;
    }
    response.json(supersedeKnowledge(Number(request.params.id), newId, cleanString(body.note) ?? ""));
  } catch (error) { next(error); }
});

knowledgeRouter.get("/baselines", (request, response, next) => {
  try {
    const projectKey = cleanString(request.query.projectKey);
    const params: unknown[] = [];
    const where = projectKey ? "WHERE kb.project_key = ?" : "";
    if (projectKey) params.push(projectKey);
    const rows = knowledgeDb().prepare(`
      SELECT kb.id, kb.project_key, kb.role, kb.created_at,
             kr.id AS knowledge_record_id, kr.title, kr.authority, kr.authority_rank,
             kr.status, kr.source_type, kr.source_ref
      FROM knowledge_baselines kb
      JOIN knowledge_records kr ON kr.id = kb.knowledge_record_id
      ${where}
      ORDER BY kb.project_key, CASE kb.role WHEN 'canonical' THEN 0 ELSE 1 END, kr.authority_rank DESC
    `).all(...params);
    response.json({ baselines: rows, roles: baselineRoles });
  } catch (error) { next(error); }
});

knowledgeRouter.get("/conflicts", (request, response, next) => {
  try {
    const status = cleanString(request.query.status);
    const rows = status
      ? knowledgeDb().prepare("SELECT * FROM knowledge_conflicts WHERE status = ? ORDER BY id DESC").all(status)
      : knowledgeDb().prepare("SELECT * FROM knowledge_conflicts ORDER BY id DESC").all();
    response.json({ conflicts: rows });
  } catch (error) { next(error); }
});

knowledgeRouter.post("/conflicts", (request, response, next) => {
  try {
    const body = record(request.body);
    const leftId = Number(body.leftRecordId);
    const rightId = Number(body.rightRecordId);
    const reason = cleanString(body.reason);
    if (!Number.isInteger(leftId) || !Number.isInteger(rightId) || !reason) {
      response.status(400).json({ error: "leftRecordId, rightRecordId, and reason are required." });
      return;
    }
    response.status(201).json({ conflict: createKnowledgeConflict(leftId, rightId, reason) });
  } catch (error) { next(error); }
});

knowledgeRouter.post("/conflicts/:id/resolve", (request, response, next) => {
  try {
    const body = record(request.body);
    const winner = Number(body.winningRecordId);
    const note = cleanString(body.resolutionNote);
    if (!Number.isInteger(winner) || !note) {
      response.status(400).json({ error: "winningRecordId and resolutionNote are required." });
      return;
    }
    response.json({ conflict: resolveKnowledgeConflict(Number(request.params.id), winner, note) });
  } catch (error) { next(error); }
});

knowledgeRouter.get("/policy", (_request, response) => {
  response.json({
    authorityOrder: knowledgeAuthorities.map((authority) => ({ authority, rank: authorityRank[authority] })),
    statuses: knowledgeStatuses,
    confidences: knowledgeConfidences,
    sensitivities: knowledgeSensitivities,
    baselineRoles,
    rule: "Higher-authority active knowledge wins by default; stale or disputed knowledge must be surfaced with caution; superseded knowledge is historical, not controlling.",
  });
});
