import { Router } from "express";
import {
  bootstrapSkillAcademy,
  createPracticeSession,
  evaluatePracticeSession,
  getSkillAcademyStatus,
  getSkillCatalog,
  importTeachingPack,
  listPracticeSessions,
} from "../services/skillAcademy.service";

export const skillAcademyRouter = Router();

const body = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

skillAcademyRouter.get("/status", (_request, response, next) => {
  try { response.json(getSkillAcademyStatus()); }
  catch (error) { next(error); }
});

skillAcademyRouter.get("/catalog", (request, response, next) => {
  try { response.json({ domains: getSkillCatalog(text(request.query.domainKey)) }); }
  catch (error) { next(error); }
});

skillAcademyRouter.post("/bootstrap", (_request, response, next) => {
  try {
    response.status(201).json({
      status: bootstrapSkillAcademy(),
      masteryChanged: false,
      durableMemoryCreated: false,
      rule: "Bootstrap creates the competency scaffold only. It does not claim FREEOS has learned or mastered the seeded skills.",
    });
  } catch (error) { next(error); }
});

skillAcademyRouter.post("/teaching-packs/import", (request, response, next) => {
  try {
    const input = body(request.body);
    response.status(201).json(importTeachingPack({
      packKey: input.packKey,
      title: input.title,
      sourceLabel: input.sourceLabel,
      sourceRef: input.sourceRef,
      ownerApproved: input.ownerApproved,
      domain: body(input.domain),
      competencies: Array.isArray(input.competencies) ? input.competencies as never[] : [],
    }));
  } catch (error) {
    if (error instanceof Error && /is required|must contain/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

skillAcademyRouter.post("/practice", (request, response, next) => {
  try {
    const input = body(request.body);
    response.status(201).json({
      session: createPracticeSession({
        competencyKey: input.competencyKey,
        drillKey: input.drillKey,
        resultSummary: input.resultSummary,
        evidence: input.evidence,
      }),
      masteryChanged: false,
    });
  } catch (error) {
    if (error instanceof Error && /required|Unknown competencyKey|does not belong/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

skillAcademyRouter.post("/practice/:id/evaluate", (request, response, next) => {
  try {
    const input = body(request.body);
    response.json(evaluatePracticeSession(Number(request.params.id), {
      score: input.score,
      humanReviewed: input.humanReviewed,
      evaluator: input.evaluator,
      notes: input.notes,
    }));
  } catch (error) {
    if (error instanceof Error && /Invalid practice|not found|score must/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

skillAcademyRouter.get("/practice", (request, response, next) => {
  try {
    response.json({
      sessions: listPracticeSessions(text(request.query.competencyKey), Number(request.query.limit) || 100),
    });
  } catch (error) { next(error); }
});
