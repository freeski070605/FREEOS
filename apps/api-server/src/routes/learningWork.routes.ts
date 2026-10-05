import { Router } from "express";
import {
  completeLearningWork,
  getLearningWork,
  getLearningWorkStatus,
  learningWorkStatuses,
  learningWorkTypes,
  listLearningWork,
  prepareLearningWork,
  prepareNextLearningWork,
  reconcileLearningWork,
} from "../services/learningWork.service";
import { nextRankedProjectEducationQueueItemId, rankOpenProjectEducation } from "../services/learningPriority.service";

export const learningWorkRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

learningWorkRouter.get("/status", (_request, response, next) => {
  try { response.json(getLearningWorkStatus()); }
  catch (error) { next(error); }
});

learningWorkRouter.get("/items", (request, response, next) => {
  try {
    const status = text(request.query.status);
    const workType = text(request.query.workType);
    response.json({
      items: listLearningWork({
        status: status && learningWorkStatuses.includes(status as (typeof learningWorkStatuses)[number])
          ? status as (typeof learningWorkStatuses)[number]
          : undefined,
        workType: workType && learningWorkTypes.includes(workType as (typeof learningWorkTypes)[number])
          ? workType as (typeof learningWorkTypes)[number]
          : undefined,
        projectKey: text(request.query.projectKey),
        limit: Number(request.query.limit) || 100,
      }),
    });
  } catch (error) { next(error); }
});

learningWorkRouter.get("/items/:id", (request, response, next) => {
  try {
    const item = getLearningWork(Number(request.params.id));
    if (!item) { response.status(404).json({ error: "Learning work item not found." }); return; }
    response.json({ item });
  } catch (error) { next(error); }
});

learningWorkRouter.post("/prepare/:queueId", (request, response, next) => {
  try { response.status(201).json(prepareLearningWork(Number(request.params.queueId))); }
  catch (error) {
    if (error instanceof Error && /not found|only be prepared|Invalid learning queue/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

learningWorkRouter.post("/prepare-next", (_request, response, next) => {
  try {
    const prepared = prepareNextLearningWork();
    response.json({ prepared, nothingToPrepare: prepared === null });
  } catch (error) { next(error); }
});

learningWorkRouter.post("/prepare-next-project", (_request, response, next) => {
  try {
    const queueItemId = nextRankedProjectEducationQueueItemId();
    if (queueItemId == null) {
      response.json({ prepared: null, nothingToPrepare: true, ranking: rankOpenProjectEducation() });
      return;
    }
    response.json({
      prepared: prepareLearningWork(queueItemId),
      nothingToPrepare: false,
      ranking: rankOpenProjectEducation(),
    });
  } catch (error) { next(error); }
});

learningWorkRouter.post("/reconcile", (_request, response, next) => {
  try { response.json({ result: reconcileLearningWork(), status: getLearningWorkStatus() }); }
  catch (error) { next(error); }
});

learningWorkRouter.post("/items/:id/complete", (request, response, next) => {
  try {
    const input = body(request.body);
    const resultSummary = text(input.resultSummary);
    if (!resultSummary) { response.status(400).json({ error: "resultSummary is required." }); return; }
    response.json({
      item: completeLearningWork(Number(request.params.id), {
        resultSummary,
        evidence: text(input.evidence),
      }),
      durableMemoryCreated: false,
    });
  } catch (error) { next(error); }
});
