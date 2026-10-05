import { Router } from "express";
import {
  buildCurrentIntelligenceContext,
  createCurrentIntelligence,
  createCurrentIntelligenceFromResearch,
  currentIntelligenceConfidences,
  currentIntelligenceSourceClasses,
  currentIntelligenceStatuses,
  getCurrentIntelligenceStatus,
  listCurrentIntelligence,
  refreshCurrentIntelligenceFreshness,
  setCurrentIntelligenceStatus,
} from "../services/currentIntelligence.service";

export const currentIntelligenceRouter = Router();

type JsonRecord = Record<string, unknown>;
const body = (value: unknown): JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

currentIntelligenceRouter.get("/status", (_request, response, next) => {
  try { response.json(getCurrentIntelligenceStatus()); }
  catch (error) { next(error); }
});

currentIntelligenceRouter.get("/items", (request, response, next) => {
  try {
    const status = text(request.query.status);
    response.json({
      items: listCurrentIntelligence({
        projectKey: text(request.query.projectKey),
        status: status && currentIntelligenceStatuses.includes(status as (typeof currentIntelligenceStatuses)[number])
          ? status as (typeof currentIntelligenceStatuses)[number]
          : undefined,
        limit: Number(request.query.limit) || 50,
      }),
    });
  } catch (error) { next(error); }
});

currentIntelligenceRouter.post("/items", (request, response, next) => {
  try {
    const input = body(request.body);
    const sourceClass = text(input.sourceClass);
    if (!sourceClass || !currentIntelligenceSourceClasses.includes(sourceClass as (typeof currentIntelligenceSourceClasses)[number])) {
      response.status(400).json({ error: "A valid sourceClass is required." });
      return;
    }
    const confidence = text(input.confidence);
    const item = createCurrentIntelligence({
      sourceKey: text(input.sourceKey),
      topic: text(input.topic) ?? "",
      claim: text(input.claim) ?? "",
      projectKey: text(input.projectKey) ?? null,
      sourceUrl: text(input.sourceUrl) ?? "",
      sourceTitle: text(input.sourceTitle),
      sourceClass: sourceClass as (typeof currentIntelligenceSourceClasses)[number],
      confidence: confidence && currentIntelligenceConfidences.includes(confidence as (typeof currentIntelligenceConfidences)[number])
        ? confidence as (typeof currentIntelligenceConfidences)[number]
        : undefined,
      evidence: text(input.evidence),
      researchResultId: Number.isInteger(Number(input.researchResultId)) ? Number(input.researchResultId) : null,
      observedAt: text(input.observedAt),
      freshnessDays: Number.isFinite(Number(input.freshnessDays)) ? Number(input.freshnessDays) : undefined,
    });
    response.status(201).json({ item, durableMemoryCreated: false });
  } catch (error) { next(error); }
});

currentIntelligenceRouter.post("/from-research/:id", (request, response, next) => {
  try {
    const input = body(request.body);
    const sourceClass = text(input.sourceClass);
    const confidence = text(input.confidence);
    const item = createCurrentIntelligenceFromResearch(Number(request.params.id), {
      topic: text(input.topic),
      claim: text(input.claim),
      sourceClass: sourceClass && currentIntelligenceSourceClasses.includes(sourceClass as (typeof currentIntelligenceSourceClasses)[number])
        ? sourceClass as (typeof currentIntelligenceSourceClasses)[number]
        : undefined,
      confidence: confidence && currentIntelligenceConfidences.includes(confidence as (typeof currentIntelligenceConfidences)[number])
        ? confidence as (typeof currentIntelligenceConfidences)[number]
        : undefined,
      freshnessDays: Number.isFinite(Number(input.freshnessDays)) ? Number(input.freshnessDays) : undefined,
      observedAt: text(input.observedAt),
    });
    response.status(201).json({ item, durableMemoryCreated: false });
  } catch (error) { next(error); }
});

currentIntelligenceRouter.post("/refresh", (_request, response, next) => {
  try { response.json({ result: refreshCurrentIntelligenceFreshness(), status: getCurrentIntelligenceStatus() }); }
  catch (error) { next(error); }
});

currentIntelligenceRouter.get("/context", (request, response, next) => {
  try {
    const query = text(request.query.query) ?? "";
    if (!query) { response.status(400).json({ error: "query is required." }); return; }
    response.json(buildCurrentIntelligenceContext({
      query,
      projectKey: text(request.query.projectKey),
      limit: Number(request.query.limit) || 6,
    }));
  } catch (error) { next(error); }
});

currentIntelligenceRouter.post("/items/:id/dispute", (request, response, next) => {
  try { response.json({ item: setCurrentIntelligenceStatus(Number(request.params.id), "disputed") }); }
  catch (error) { next(error); }
});

currentIntelligenceRouter.post("/items/:id/archive", (request, response, next) => {
  try { response.json({ item: setCurrentIntelligenceStatus(Number(request.params.id), "archived") }); }
  catch (error) { next(error); }
});
