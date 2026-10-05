import { Router } from "express";
import {
  getContinuousLearningStatus,
  learningQueuePriorities,
  learningQueueStatuses,
  learningSignalTypes,
  listLearningQueue,
  runContinuousLearningScan,
  setLearningQueueStatus,
} from "../services/continuousLearning.service";
import { rankOpenProjectEducation } from "../services/learningPriority.service";

export const continuousLearningRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

continuousLearningRouter.get("/status", (_request, response, next) => {
  try {
    response.json({
      ...getContinuousLearningStatus(),
      priorities: learningQueuePriorities,
      statuses: learningQueueStatuses,
      signalTypes: learningSignalTypes,
    });
  } catch (error) { next(error); }
});

continuousLearningRouter.post("/run", (request, response, next) => {
  try {
    const input = body(request.body);
    response.json(runContinuousLearningScan(text(input.triggerType) ?? "manual"));
  } catch (error) { next(error); }
});

continuousLearningRouter.get("/queue", (request, response, next) => {
  try {
    const status = text(request.query.status);
    const signalType = text(request.query.signalType);
    response.json({
      items: listLearningQueue({
        status: status && learningQueueStatuses.includes(status as (typeof learningQueueStatuses)[number])
          ? status as (typeof learningQueueStatuses)[number]
          : undefined,
        projectKey: text(request.query.projectKey),
        signalType: signalType && learningSignalTypes.includes(signalType as (typeof learningSignalTypes)[number])
          ? signalType as (typeof learningSignalTypes)[number]
          : undefined,
        limit: Number(request.query.limit) || 100,
      }),
    });
  } catch (error) { next(error); }
});

continuousLearningRouter.get("/project-priorities", (_request, response, next) => {
  try { response.json(rankOpenProjectEducation()); }
  catch (error) { next(error); }
});

continuousLearningRouter.post("/queue/:id/resolve", (request, response, next) => {
  try { response.json({ item: setLearningQueueStatus(Number(request.params.id), "resolved") }); }
  catch (error) { next(error); }
});

continuousLearningRouter.post("/queue/:id/dismiss", (request, response, next) => {
  try { response.json({ item: setLearningQueueStatus(Number(request.params.id), "dismissed") }); }
  catch (error) { next(error); }
});
